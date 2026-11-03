import type { JudgeCriterion, JudgeSourceQuestion } from "./tutorJudge";
import type { TutorPhaseKind } from "./tutorPromptTier";
import {
  applyAttempt,
  beginGapTurn,
  chooseDriveGap,
  findGap,
  recordTutorQuestion,
  type AttemptOutcome,
  type RuntimeGap,
  type TutorRuntimeState,
} from "./tutorStateMachine";
import { TUTORING_POLICY } from "./tutorPolicy";

export interface TutorTurnPlan {
  phase: TutorPhaseKind;
  activeGapId: string | null;
  state: TutorRuntimeState;
  expectsAnswer: boolean;
}

function gapString(gap: RuntimeGap, key: string): string | null {
  const v = (gap as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function readSourceQuestions(gap: RuntimeGap): JudgeSourceQuestion[] {
  const raw = (gap as Record<string, unknown>).source_questions;
  if (!Array.isArray(raw)) return [];
  const out: JudgeSourceQuestion[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const prompt = typeof o.question_prompt === "string" ? o.question_prompt : "";
    if (!prompt.trim()) continue;
    const ref = typeof o.answer_reference === "string" && o.answer_reference.trim()
      ? o.answer_reference
      : null;
    out.push({ questionPrompt: prompt, answerReference: ref });
  }
  return out;
}

export function buildJudgeCriterion(gap: RuntimeGap, studentAnswer: string): JudgeCriterion {
  return {
    descriptor: gapString(gap, "descriptor") ?? "",
    checkpointLabel:
      gapString(gap, "checkpoint_label") ?? gapString(gap, "criterion_name") ?? gap.gap_id,
    sourceQuestions: readSourceQuestions(gap),
    originalAnswer: gapString(gap, "student_answer"),
    studentAnswer,
  };
}

export function planDriveTurn(state: TutorRuntimeState, studentMessage: string): TutorTurnPlan {
  const gap = chooseDriveGap(state, studentMessage);
  if (!gap) {
    return {
      phase: "complete",
      activeGapId: null,
      state,
      expectsAnswer: false,
    };
  }
  const { state: next, gap: begun } = beginGapTurn(state, gap.gap_id);
  const phase: TutorPhaseKind =
    begun.turn_no >= TUTORING_POLICY.max_turns
      ? "explain_transfer"
      : begun.turn_no === 1
        ? "probe"
        : "ask_next";
  return {
    phase,
    activeGapId: begun.gap_id,
    state: next,
    expectsAnswer: true,
  };
}

export type TutorDecision =
  | { kind: "attempt"; gapId: string; outcome: AttemptOutcome }
  | { kind: "drive"; studentMessage: string };

export function planTutorTurn(
  state: TutorRuntimeState,
  decision: TutorDecision,
): TutorTurnPlan | null {
  if (decision.kind === "drive") return planDriveTurn(state, decision.studentMessage);
  const gap = findGap(state, decision.gapId);
  if (!gap || gap.status !== "in_progress" || !gap.awaiting_evidence) return null;
  return planAttemptTurn(state, decision.gapId, decision.outcome);
}

export function planAttemptTurn(
  state: TutorRuntimeState,
  gapId: string,
  outcome: AttemptOutcome,
): TutorTurnPlan {
  const next = applyAttempt(state, gapId, outcome);
  const gap = findGap(next, gapId);
  if (!gap) throw new Error(`planAttemptTurn: gap ${gapId} vanished`);

  let phase: TutorPhaseKind;
  let expectsAnswer: boolean;
  if (gap.status === "closed") {
    phase = "closed";
    expectsAnswer = false;
  } else if (gap.status === "exhausted") {
    phase = "exhausted";
    expectsAnswer = false;
  } else if (outcome.contaminated) {
    phase = "contaminated";
    expectsAnswer = true;
  } else {
    phase = gap.turn_no >= TUTORING_POLICY.max_turns ? "explain_transfer" : "ask_next";
    expectsAnswer = true;
  }
  return { phase, activeGapId: gapId, state: next, expectsAnswer };
}

export function foldTutorReply(
  state: TutorRuntimeState,
  plan: TutorTurnPlan,
  replyText: string,
): { state: TutorRuntimeState } {
  if (plan.expectsAnswer && plan.activeGapId) {
    const next = recordTutorQuestion(state, plan.activeGapId, replyText, {
      isExplanation: plan.phase === "explain_transfer",
    });
    return { state: next };
  }
  return { state };
}

export function finalizeTutorReply(
  plan: TutorTurnPlan,
  replyText: string,
): { state: TutorRuntimeState } {
  return foldTutorReply(plan.state, plan, replyText);
}
