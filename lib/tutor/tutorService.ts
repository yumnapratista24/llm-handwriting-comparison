import { randomUUID } from "node:crypto";
import { getRun, loadRubricForRun } from "@/lib/db";
import { getModel, rubricMaxScore } from "@/lib/models";
import { getServerSupabase } from "@/lib/supabase-server";
import {
  addMessage,
  createSession,
  getResultForTutor,
  getSession,
  getSessionByResult,
  insertAttempt,
  listMessages,
  loadRunTopics,
  saveDerivedTopics,
  syncSessionGaps,
  updateSessionState,
  type TutorAttemptInsert,
  type TutorMessageRow,
  type TutorSessionRow,
  type TutorSessionStatus,
  type TutorTopicRow,
} from "./db";
import { DeriveTopicsError, deriveTopicsLlm, validateDerivedTopics } from "./deriveTopics";
import { buildTutorHandoff, singleQuestionEvidence } from "./handoffGaps";
import type { ChatCompletionsClient, ChatMessage, LlmProvider } from "./llm";
import { buildOpeningMessage, computeScaledScore } from "./openingMessage";
import { initTutorConversationState } from "./tutorConversationState";
import {
  buildJudgeCriterion,
  foldTutorReply,
  planTutorTurn,
  type TutorDecision,
  type TutorTurnPlan,
} from "./tutorTurn";
import { JudgeUnavailableError, judgeAttempt, pickJudgeModel } from "./tutorJudge";
import {
  TUTORING_POLICY,
  TUTORING_POLICY_VERSION,
  TUTOR_FAIL_CLOSED_MESSAGE,
  TUTOR_JUDGE_UNAVAILABLE_MESSAGE,
} from "./tutorPolicy";
import { buildGapStateBlock, buildTutorStaticTiers } from "./tutorPromptTier";
import {
  activeGap,
  allGapsTerminal,
  beginGapTurn,
  classifyStudentTurn,
  findGap,
  coerceRuntimeState,
  type AttemptOutcome,
  type TutorRuntimeState,
} from "./tutorStateMachine";
import { checkVerbatimOverlap } from "./tutorVerbatim";

const PERSONA_TIER = "# Persona\nKamu adalah tutor AI yang hangat dan ringkas.";
const CONTEXT_MAX_MESSAGES = 30;
const LOCK_ATTEMPTS = 2;
const DEFAULT_DERIVE_TOPICS_MODEL = "openai/gpt-5.6";
const NO_RUBRIC_SCORE_MAX = 100;
const DERIVE_FAILED_MESSAGE = "Gagal menyusun topik tutoring dari soal. Coba lagi sebentar lagi.";

export function deriveTopicsModel(): string {
  return process.env.TUTOR_DERIVE_TOPICS_MODEL?.trim() || DEFAULT_DERIVE_TOPICS_MODEL;
}

export class TutorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "TutorError";
  }
}

export interface TutorGapView {
  gap_id: string;
  checkpoint_label: string;
  status: string;
  turn_no: number;
  attempts: number;
  topic_id: string | null;
  topic_label: string | null;
  topic_order: number | null;
}

export interface TutorMessageView {
  seq: number;
  role: "user" | "assistant";
  content: string;
}

export function gapViews(state: TutorRuntimeState): TutorGapView[] {
  return state.gaps.map((g) => ({
    gap_id: g.gap_id,
    checkpoint_label: g.checkpoint_label?.trim() || g.gap_id,
    status: g.status,
    turn_no: g.turn_no,
    attempts: g.attempts,
    topic_id: typeof g.topic_id === "string" && g.topic_id ? g.topic_id : null,
    topic_label: typeof g.topic_label === "string" && g.topic_label.trim() ? g.topic_label.trim() : null,
    topic_order: typeof g.topic_order === "number" && Number.isFinite(g.topic_order) ? g.topic_order : null,
  }));
}

function messageViews(rows: TutorMessageRow[]): TutorMessageView[] {
  return rows.map((m) => ({ seq: m.seq, role: m.role, content: m.content }));
}

function statusFor(state: TutorRuntimeState): TutorSessionStatus {
  return allGapsTerminal(state) ? "completed" : "active";
}

export interface TutorSessionView {
  sessionId: string;
  gaps: TutorGapView[];
  messages: TutorMessageView[];
  status: TutorSessionStatus;
}

function sessionView(session: TutorSessionRow, messages: TutorMessageRow[]): TutorSessionView {
  return {
    sessionId: session.id,
    gaps: gapViews(coerceRuntimeState(session.state)),
    messages: messageViews(messages),
    status: session.status,
  };
}

async function syncGapsSafely(
  sessionId: string,
  version: number,
  state: TutorRuntimeState,
  initialRatios?: Map<string, number>,
): Promise<void> {
  try {
    await syncSessionGaps(sessionId, version, state, initialRatios);
  } catch (e) {
    console.error(`[tutor] session gap sync failed (session=${sessionId}):`, e instanceof Error ? e.message : e);
  }
}

async function recordAttemptSafely(row: TutorAttemptInsert): Promise<void> {
  try {
    await insertAttempt(row);
  } catch (e) {
    console.error(`[tutor] attempt log failed (session=${row.sessionId}):`, e instanceof Error ? e.message : e);
  }
}

async function ensureRunTopics(
  run: { id: string; question: string; title?: string | null },
  completions: ChatCompletionsClient | null,
): Promise<TutorTopicRow[]> {
  const existing = await loadRunTopics(run.id);
  if (existing.length) return existing;

  const prompt = run.question?.trim() ?? "";
  if (!prompt) throw new TutorError("Soal pada run ini kosong, topik tutoring tidak bisa disusun.", 422, "no_question");
  if (!completions) throw new TutorError("OPENROUTER_API_KEY belum diset di environment server", 500);

  const model = deriveTopicsModel();
  let raw;
  try {
    raw = await deriveTopicsLlm(
      {
        assessmentTitle: run.title ?? "",
        course: null,
        major: null,
        questions: [{ id: run.id, prompt, answerReference: null }],
        model,
      },
      completions,
    );
  } catch (e) {
    if (e instanceof DeriveTopicsError) {
      console.error(`[tutor] topic derivation failed (run=${run.id}): ${e.message}`);
      throw new TutorError(DERIVE_FAILED_MESSAGE, 502, "derive_failed");
    }
    throw e;
  }

  const { topics, warnings } = validateDerivedTopics(raw, [run.id]);
  for (const w of warnings) console.warn(`[tutor] ${w} (run=${run.id})`);
  if (!topics.length) throw new TutorError(DERIVE_FAILED_MESSAGE, 502, "derive_failed");

  await saveDerivedTopics({ runId: run.id, model, derivationRunId: randomUUID(), topics });
  const saved = await loadRunTopics(run.id);
  if (!saved.length) throw new TutorError(DERIVE_FAILED_MESSAGE, 502, "derive_failed");
  return saved;
}

export async function findSession(resultId: string): Promise<TutorSessionView | null> {
  const existing = await getSessionByResult(resultId);
  return existing ? sessionView(existing, await listMessages(existing.id)) : null;
}

export async function getOrCreateSession(
  resultId: string,
  completions: ChatCompletionsClient | null,
): Promise<TutorSessionView> {
  const result = await getResultForTutor(resultId);
  if (!result) throw new TutorError("Hasil penilaian tidak ditemukan", 404);
  if (result.status && result.status !== "done") {
    throw new TutorError("Hasil ini belum selesai dinilai", 409);
  }

  const existing = await getSessionByResult(resultId);
  if (existing) return sessionView(existing, await listMessages(existing.id));

  const supabase = getServerSupabase();
  const run = await getRun(result.run_id, supabase);
  if (!run) throw new TutorError("Run penilaian tidak ditemukan", 404);
  const rubric = await loadRubricForRun(result.run_id, supabase);
  const maxScore = rubric.length ? rubricMaxScore(rubric) : NO_RUBRIC_SCORE_MAX;

  const topics = await ensureRunTopics(run, completions);
  const handoff = buildTutorHandoff(topics, [
    singleQuestionEvidence({
      runId: run.id,
      question: run.question,
      studentAnswer: result.extracted_text,
      criterionFeedback: result.feedback_text,
      score: result.score,
      maxScore,
    }),
  ]);
  if (!handoff.gaps.length) throw new TutorError(DERIVE_FAILED_MESSAGE, 502, "derive_failed");

  const state: TutorRuntimeState = initTutorConversationState(handoff.gaps);
  const opening = buildOpeningMessage({
    assessmentTitle: run.title ?? "",
    courseName: null,
    scaledScore: computeScaledScore(result.score, maxScore),
    unmasteredCount: handoff.unmasteredCount,
  });

  const { session, created } = await createSession({
    resultId,
    modelKey: result.model_key,
    policyVersion: TUTORING_POLICY_VERSION,
    status: statusFor(state),
    state,
  });
  if (created) {
    await syncGapsSafely(session.id, session.version, state, handoff.initialRatios);
    await addMessage(session.id, { role: "assistant", content: opening, meta: { kind: "opening" } });
  }
  return sessionView(session, await listMessages(session.id));
}

export interface TutorTurnResult {
  reply: string;
  gaps: TutorGapView[];
  status: TutorSessionStatus;
}

function toHistory(rows: TutorMessageRow[]): ChatMessage[] {
  const history = rows.map((m) => ({ role: m.role, content: m.content }));
  while (history.length && history[0].role === "assistant") history.shift();
  return history;
}

async function freshSession(sessionId: string): Promise<TutorSessionRow> {
  const session = await getSession(sessionId);
  if (!session) throw new TutorError("Sesi tutoring tidak ditemukan", 404);
  return session;
}

type TurnDecision = TutorDecision | { kind: "choose"; gapId: string; studentMessage: string };

function planChosenGapTurn(state: TutorRuntimeState, gapId: string): TutorTurnPlan | null {
  const gap = findGap(state, gapId);
  if (!gap || gap.status !== "open" || activeGap(state)) return null;
  const { state: next, gap: begun } = beginGapTurn(state, gapId);
  const phase = begun.turn_no >= TUTORING_POLICY.max_turns ? "explain_transfer" : begun.turn_no === 1 ? "probe" : "ask_next";
  return { phase, activeGapId: begun.gap_id, state: next, expectsAnswer: true };
}

export function planTurn(state: TutorRuntimeState, decision: TurnDecision): TutorTurnPlan | null {
  if (decision.kind !== "choose") return planTutorTurn(state, decision);
  return (
    planChosenGapTurn(state, decision.gapId) ??
    planTutorTurn(state, { kind: "drive", studentMessage: decision.studentMessage })
  );
}

export async function runTutorTurn(
  sessionId: string,
  content: string,
  llm: LlmProvider,
  chosenGapId?: string | null,
): Promise<TutorTurnResult> {
  const session = await freshSession(sessionId);
  if (session.status === "completed") {
    throw new TutorError("Sesi tutoring sudah selesai", 409);
  }

  const studentMessage = await addMessage(sessionId, { role: "user", content });

  const failClosed = async (message: string, state: TutorRuntimeState | null): Promise<TutorTurnResult> => {
    await addMessage(sessionId, { role: "assistant", content: message, meta: { kind: "fail_closed" } });
    return { reply: message, gaps: state ? gapViews(state) : [], status: session.status };
  };

  let state: TutorRuntimeState;
  try {
    state = coerceRuntimeState(session.state);
  } catch {
    return failClosed(TUTOR_FAIL_CLOSED_MESSAGE, null);
  }

  const model = getModel(session.model_key);
  if (!model) throw new TutorError(`Model tidak dikenal: ${session.model_key}`, 400);
  const result = await getResultForTutor(session.grading_result_id);
  if (!result) throw new TutorError("Hasil penilaian tidak ditemukan", 404);
  const run = await getRun(result.run_id, getServerSupabase());
  if (!run) throw new TutorError("Run penilaian tidak ditemukan", 404);

  const classified = classifyStudentTurn(state);
  let decision: TurnDecision;
  let attemptLog: TutorAttemptInsert | null = null;
  if (classified.mode === "attempt") {
    const gap = classified.gap;
    const attemptBase = {
      sessionId,
      checkpointId: typeof gap.checkpoint_id === "string" && gap.checkpoint_id ? gap.checkpoint_id : null,
      studentMessageId: studentMessage.id,
      studentSeq: studentMessage.seq,
      turnNo: gap.turn_no,
      attemptNo: gap.attempts + 1,
    };
    const verbatim = checkVerbatimOverlap(content, gap.last_explanation ?? null);
    let outcome: AttemptOutcome;
    let judgeModel: string | null = null;
    if (verbatim.contaminated) {
      outcome = { verdict: "fail", missingElements: [], confidence: null, contaminated: true };
    } else {
      judgeModel = pickJudgeModel(model.openrouterId);
      try {
        const jr = await judgeAttempt(llm, judgeModel, buildJudgeCriterion(gap, content), {
          maxTokens: 512,
        });
        outcome = {
          verdict: jr.verdict,
          missingElements: jr.missingElements,
          confidence: jr.confidence,
          downgraded: jr.downgraded,
        };
      } catch (e) {
        await recordAttemptSafely({
          ...attemptBase,
          verdict: null,
          missingElements: [],
          confidence: null,
          downgraded: null,
          contaminated: false,
          judgeModel,
          judgeError: e instanceof Error ? e.message : String(e),
          applied: false,
        });
        if (e instanceof JudgeUnavailableError) return failClosed(TUTOR_JUDGE_UNAVAILABLE_MESSAGE, state);
        throw e;
      }
    }
    attemptLog = {
      ...attemptBase,
      verdict: outcome.verdict,
      missingElements: outcome.missingElements,
      confidence: outcome.confidence ?? null,
      downgraded: outcome.downgraded ?? null,
      contaminated: outcome.contaminated ?? false,
      judgeModel,
      judgeError: null,
      applied: false,
    };
    decision = { kind: "attempt", gapId: gap.gap_id, outcome };
  } else if (chosenGapId) {
    decision = { kind: "choose", gapId: chosenGapId, studentMessage: content };
  } else {
    decision = { kind: "drive", studentMessage: content };
  }

  let plan: TutorTurnPlan | null = null;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS && !plan; attempt++) {
    const fresh = await freshSession(sessionId);
    const freshPlan = planTurn(coerceRuntimeState(fresh.state), decision);
    if (!freshPlan) break;
    const written = await updateSessionState(sessionId, fresh.version, {
      state: freshPlan.state,
      status: fresh.status,
    });
    if (written) {
      plan = freshPlan;
      await syncGapsSafely(sessionId, written.version, freshPlan.state);
    }
  }
  if (attemptLog) await recordAttemptSafely({ ...attemptLog, applied: plan !== null });
  if (!plan) return failClosed(TUTOR_FAIL_CLOSED_MESSAGE, state);
  const committedPlan: TutorTurnPlan = plan;

  const system = [
    PERSONA_TIER,
    ...buildTutorStaticTiers({ assessmentTitle: run.title }),
    buildGapStateBlock({
      state: committedPlan.state,
      phase: committedPlan.phase,
      activeGapId: committedPlan.activeGapId,
    }),
  ].join("\n\n");
  const history = toHistory(await listMessages(sessionId, CONTEXT_MAX_MESSAGES));

  const res = await llm.chat({ model: model.openrouterId, system, messages: history, webSearch: false });
  const reply = res.text.trim();
  if (!reply) throw new TutorError("Model tidak mengembalikan balasan", 502);

  let finalState = committedPlan.state;
  let finalStatus: TutorSessionStatus = "active";
  let folded = false;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS && !folded; attempt++) {
    const fresh = await freshSession(sessionId);
    const { state: foldedState } = foldTutorReply(coerceRuntimeState(fresh.state), committedPlan, reply);
    const status: TutorSessionStatus = fresh.status === "active" ? statusFor(foldedState) : fresh.status;
    const written = await updateSessionState(sessionId, fresh.version, { state: foldedState, status });
    if (written) {
      folded = true;
      finalState = foldedState;
      finalStatus = status;
      await syncGapsSafely(sessionId, written.version, foldedState);
    }
  }
  if (!folded) {
    console.warn(
      `[tutor] post-reply fold dropped after lock retries (session=${sessionId}) — awaiting_evidence flip for this reply was not recorded`,
    );
  }

  await addMessage(sessionId, {
    role: "assistant",
    content: reply,
    meta: { phase: committedPlan.phase, activeGapId: committedPlan.activeGapId, usage: res.usage ?? null },
  });

  return { reply, gaps: gapViews(finalState), status: finalStatus };
}
