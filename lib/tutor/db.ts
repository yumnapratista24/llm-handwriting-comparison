import { getServerSupabase } from "@/lib/supabase-server";
import type { ValidatedTopic } from "./deriveTopics";
import type { TutorRuntimeState } from "./tutorStateMachine";

export type TutorSessionStatus = "active" | "completed";

export interface TutorSessionRow {
  id: string;
  grading_result_id: string;
  model_key: string;
  policy_version: string;
  status: TutorSessionStatus;
  state: TutorRuntimeState;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TutorMessageRow {
  id: string;
  session_id: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}

const UNIQUE_VIOLATION = "23505";

export interface TutorResultRow {
  id: string;
  run_id: string;
  model_key: string;
  score: number | null;
  extracted_text: string | null;
  feedback_text: string | null;
  status: string | null;
}

export async function getResultForTutor(resultId: string): Promise<TutorResultRow | null> {
  const { data, error } = await getServerSupabase()
    .from("grading_results")
    .select("id, run_id, model_key, score, extracted_text, feedback_text, status")
    .eq("id", resultId)
    .maybeSingle<TutorResultRow>();
  if (error) throw new Error(error.message);
  return data;
}

export async function getSessionByResult(resultId: string): Promise<TutorSessionRow | null> {
  const { data, error } = await getServerSupabase()
    .from("tutor_sessions")
    .select("*")
    .eq("grading_result_id", resultId)
    .maybeSingle<TutorSessionRow>();
  if (error) throw new Error(error.message);
  return data;
}

export async function getSession(sessionId: string): Promise<TutorSessionRow | null> {
  const { data, error } = await getServerSupabase()
    .from("tutor_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle<TutorSessionRow>();
  if (error) throw new Error(error.message);
  return data;
}

export async function createSession(input: {
  resultId: string;
  modelKey: string;
  policyVersion: string;
  status: TutorSessionStatus;
  state: TutorRuntimeState;
}): Promise<{ session: TutorSessionRow; created: boolean }> {
  const { data, error } = await getServerSupabase()
    .from("tutor_sessions")
    .insert({
      grading_result_id: input.resultId,
      model_key: input.modelKey,
      policy_version: input.policyVersion,
      status: input.status,
      state: input.state,
    })
    .select("*")
    .single<TutorSessionRow>();
  if (!error) return { session: data, created: true };
  if (error.code === UNIQUE_VIOLATION) {
    const existing = await getSessionByResult(input.resultId);
    if (existing) return { session: existing, created: false };
  }
  throw new Error(error.message);
}

export async function updateSessionState(
  sessionId: string,
  expectedVersion: number,
  patch: { state: TutorRuntimeState; status: TutorSessionStatus },
): Promise<TutorSessionRow | null> {
  const { data, error } = await getServerSupabase()
    .from("tutor_sessions")
    .update({
      state: patch.state,
      status: patch.status,
      version: expectedVersion + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("version", expectedVersion)
    .select("*");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as TutorSessionRow[];
  return rows[0] ?? null;
}

export async function deleteSessionsForResult(resultId: string): Promise<void> {
  const { error } = await getServerSupabase()
    .from("tutor_sessions")
    .delete()
    .eq("grading_result_id", resultId);
  if (error) throw new Error(error.message);
}

export async function listMessages(sessionId: string, limit?: number): Promise<TutorMessageRow[]> {
  const supabase = getServerSupabase();
  if (limit) {
    const { data, error } = await supabase
      .from("tutor_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("seq", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return ((data ?? []) as TutorMessageRow[]).reverse();
  }
  const { data, error } = await supabase
    .from("tutor_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("seq", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TutorMessageRow[];
}

async function nextSeq(sessionId: string): Promise<number> {
  const { data, error } = await getServerSupabase()
    .from("tutor_messages")
    .select("seq")
    .eq("session_id", sessionId)
    .order("seq", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const last = (data ?? [])[0] as { seq: number } | undefined;
  return (last?.seq ?? 0) + 1;
}

export async function addMessage(
  sessionId: string,
  message: { role: "user" | "assistant"; content: string; meta?: Record<string, unknown> | null },
): Promise<TutorMessageRow> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const seq = await nextSeq(sessionId);
    const { data, error } = await getServerSupabase()
      .from("tutor_messages")
      .insert({
        session_id: sessionId,
        seq,
        role: message.role,
        content: message.content,
        meta: message.meta ?? null,
      })
      .select("*")
      .single<TutorMessageRow>();
    if (!error) return data;
    if (error.code !== UNIQUE_VIOLATION) throw new Error(error.message);
  }
  throw new Error("Gagal menyimpan pesan tutor (urutan bentrok)");
}

export interface TutorCheckpointRow {
  id: string;
  topic_id: string;
  label: string;
  descriptor: string;
  order_index: number;
  source_question_ids: string[];
}

export interface TutorTopicRow {
  id: string;
  run_id: string;
  label: string;
  description: string | null;
  order_index: number;
  derivation_model: string;
  derivation_run_id: string;
  tutor_checkpoints: TutorCheckpointRow[];
}

export async function loadRunTopics(runId: string): Promise<TutorTopicRow[]> {
  const { data, error } = await getServerSupabase()
    .from("tutor_topics")
    .select(
      "id, run_id, label, description, order_index, derivation_model, derivation_run_id, tutor_checkpoints(id, topic_id, label, descriptor, order_index, source_question_ids)",
    )
    .eq("run_id", runId)
    .order("order_index", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as TutorTopicRow[]).map((t) => ({
    ...t,
    tutor_checkpoints: [...(t.tutor_checkpoints ?? [])].sort((a, b) => a.order_index - b.order_index),
  }));
}

export async function saveDerivedTopics(input: {
  runId: string;
  model: string;
  derivationRunId: string;
  topics: ValidatedTopic[];
}): Promise<boolean> {
  const { data, error } = await getServerSupabase().rpc("tutor_save_derived_topics", {
    p_run_id: input.runId,
    p_derivation_model: input.model,
    p_derivation_run_id: input.derivationRunId,
    p_topics: input.topics.map((t) => ({
      label: t.label,
      description: t.description,
      order_index: t.orderIndex,
      checkpoints: t.checkpoints.map((c) => ({
        label: c.label,
        descriptor: c.descriptor,
        source_question_ids: c.sourceQuestionIds,
      })),
    })),
  });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function syncSessionGaps(
  sessionId: string,
  sessionVersion: number,
  state: TutorRuntimeState,
  initialRatios?: Map<string, number>,
): Promise<void> {
  const now = new Date().toISOString();
  const rows = state.gaps
    .filter((g) => typeof g.checkpoint_id === "string" && g.checkpoint_id.length > 0)
    .map((g) => {
      const checkpointId = g.checkpoint_id as string;
      const ratio = initialRatios?.get(checkpointId);
      return {
        session_id: sessionId,
        checkpoint_id: checkpointId,
        status: g.status,
        student_status: g.student_status ?? null,
        turn_no: g.turn_no,
        attempts: g.attempts,
        awaiting_evidence: g.awaiting_evidence,
        last_verdict: g.last_verdict ?? null,
        closing_turn: g.closing_turn ?? null,
        independent: g.independent ?? null,
        turn3_fails: g.turn3_fails ?? 0,
        session_version: sessionVersion,
        updated_at: now,
        ...(ratio !== undefined ? { initial_ratio: ratio } : {}),
      };
    });
  if (!rows.length) return;
  const { error } = await getServerSupabase()
    .from("tutor_session_gaps")
    .upsert(rows, { onConflict: "session_id,checkpoint_id" });
  if (error) throw new Error(error.message);
}

export interface TutorAttemptInsert {
  sessionId: string;
  checkpointId: string | null;
  studentMessageId: string;
  studentSeq: number;
  turnNo: number;
  attemptNo: number;
  verdict: "pass" | "fail" | null;
  missingElements: string[];
  confidence: number | null;
  downgraded: boolean | null;
  contaminated: boolean;
  judgeModel: string | null;
  judgeError: string | null;
  applied: boolean;
}

export async function insertAttempt(row: TutorAttemptInsert): Promise<void> {
  const { error } = await getServerSupabase()
    .from("tutor_attempts")
    .insert({
      session_id: row.sessionId,
      checkpoint_id: row.checkpointId,
      student_message_id: row.studentMessageId,
      student_seq: row.studentSeq,
      turn_no: row.turnNo,
      attempt_no: row.attemptNo,
      verdict: row.verdict,
      missing_elements: row.missingElements,
      confidence: row.confidence,
      downgraded: row.downgraded,
      contaminated: row.contaminated,
      judge_model: row.judgeModel,
      judge_error: row.judgeError,
      applied: row.applied,
    });
  if (error) throw new Error(error.message);
}
