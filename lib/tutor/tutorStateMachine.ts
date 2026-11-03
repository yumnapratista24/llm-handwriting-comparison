import { TUTORING_POLICY } from "./tutorPolicy";
import type { HandoffGap } from "./tutorConversationState";

export const TERMINAL_STATUSES = [
  "closed",
  "exhausted",
  "skipped",
  "disputed",
  "abandoned",
] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];
export type GapStatus = "open" | "in_progress" | TerminalStatus;

export function isTerminalStatus(status: string): status is TerminalStatus {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export type RuntimeGap = HandoffGap & {
  status: GapStatus;
  turn_no: number;
  attempts: number;
  awaiting_evidence: boolean;
  last_verdict?: "pass" | "fail" | null;
  last_missing?: string[];
  closing_turn?: number | null;
  independent?: boolean | null;
  turn3_fails?: number;
  last_explanation?: string | null;
};

export interface TutorRuntimeState {
  next_seq: number;
  gaps: RuntimeGap[];
}

export interface AttemptOutcome {
  verdict: "pass" | "fail";
  missingElements: string[];
  confidence?: number | null;
  downgraded?: boolean;
  contaminated?: boolean;
}

export type StudentTurnKind =
  | { mode: "attempt"; gap: RuntimeGap }
  | { mode: "drive" };

export function coerceRuntimeState(raw: unknown): TutorRuntimeState {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as { next_seq?: unknown; gaps?: unknown };
    if (Array.isArray(o.gaps)) {
      return {
        next_seq: typeof o.next_seq === "number" && o.next_seq > 0 ? o.next_seq : 1,
        gaps: o.gaps as RuntimeGap[],
      };
    }
  }
  return { next_seq: 1, gaps: Array.isArray(raw) ? (raw as RuntimeGap[]) : [] };
}

export function findGap(state: TutorRuntimeState, gapId: string): RuntimeGap | undefined {
  return state.gaps.find((g) => g.gap_id === gapId);
}

export function activeGap(state: TutorRuntimeState): RuntimeGap | undefined {
  return state.gaps.find((g) => g.status === "in_progress");
}

export function nonTerminalGaps(state: TutorRuntimeState): RuntimeGap[] {
  return state.gaps.filter((g) => !isTerminalStatus(g.status));
}

export function allGapsTerminal(state: TutorRuntimeState): boolean {
  return state.gaps.length > 0 && state.gaps.every((g) => isTerminalStatus(g.status));
}

export function classifyStudentTurn(state: TutorRuntimeState): StudentTurnKind {
  const gap = state.gaps.find((g) => g.status === "in_progress" && g.awaiting_evidence);
  return gap ? { mode: "attempt", gap } : { mode: "drive" };
}

function replaceGap(state: TutorRuntimeState, gap: RuntimeGap): TutorRuntimeState {
  return { ...state, gaps: state.gaps.map((g) => (g.gap_id === gap.gap_id ? gap : g)) };
}

function topicIdOf(gap: RuntimeGap): string | null {
  const v = (gap as Record<string, unknown>).topic_id;
  return typeof v === "string" && v.length > 0 ? v : null;
}

function orderedTopicIds(gaps: RuntimeGap[]): Array<string | null> {
  const seen = new Set<string | null>();
  const order: Array<string | null> = [];
  for (const g of gaps) {
    const tid = topicIdOf(g);
    if (!seen.has(tid)) {
      seen.add(tid);
      order.push(tid);
    }
  }
  return order;
}

function topicLabelOf(gap: RuntimeGap): string | null {
  const v = (gap as Record<string, unknown>).topic_label;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function topicNamedIn(open: RuntimeGap[], message: string): string | null | undefined {
  const msg = message.toLowerCase();
  let best: { tid: string | null; len: number } | undefined;
  for (const g of open) {
    const label = topicLabelOf(g);
    if (!label) continue;
    if (msg.includes(label.toLowerCase()) && (!best || label.length > best.len)) {
      best = { tid: topicIdOf(g), len: label.length };
    }
  }
  return best?.tid;
}

export function chooseDriveGap(
  state: TutorRuntimeState,
  studentMessage: string,
): RuntimeGap | undefined {
  const inProgress = activeGap(state);
  if (inProgress) return inProgress;
  const open = state.gaps.filter((g) => g.status === "open");
  if (open.length === 0) return undefined;
  const chosenTid = topicNamedIn(open, studentMessage);
  if (chosenTid !== undefined) {
    const first = open.find((g) => topicIdOf(g) === chosenTid);
    if (first) return first;
  }
  for (const tid of orderedTopicIds(state.gaps)) {
    const next = open.find((g) => topicIdOf(g) === tid);
    if (next) return next;
  }
  return open[0];
}

export function beginGapTurn(
  state: TutorRuntimeState,
  gapId: string,
): { state: TutorRuntimeState; gap: RuntimeGap } {
  const gap = findGap(state, gapId);
  if (!gap) throw new Error(`beginGapTurn: unknown gap ${gapId}`);
  const next: RuntimeGap = {
    ...gap,
    status: "in_progress",
    turn_no: gap.turn_no === 0 ? 1 : gap.turn_no,
    awaiting_evidence: false,
  };
  return { state: replaceGap(state, next), gap: next };
}

export function applyAttempt(
  state: TutorRuntimeState,
  gapId: string,
  outcome: AttemptOutcome,
): TutorRuntimeState {
  const gap = findGap(state, gapId);
  if (!gap) throw new Error(`applyAttempt: unknown gap ${gapId}`);

  const attempts = gap.attempts + 1;
  const turnNo = gap.turn_no;

  let next: RuntimeGap = {
    ...gap,
    attempts,
    awaiting_evidence: false,
    last_verdict: outcome.verdict,
    last_missing: outcome.verdict === "fail" ? outcome.missingElements : [],
  };

  if (outcome.verdict === "pass") {
    next = {
      ...next,
      status: "closed",
      closing_turn: turnNo,
      independent: turnNo < TUTORING_POLICY.max_turns,
    };
    return replaceGap(state, next);
  }

  if (attempts >= TUTORING_POLICY.attempt_ceiling) {
    next = { ...next, status: "exhausted" };
    return replaceGap(state, next);
  }

  if (turnNo < TUTORING_POLICY.max_turns) {
    next = { ...next, status: "in_progress", turn_no: turnNo + 1 };
    return replaceGap(state, next);
  }

  const turn3Fails = (gap.turn3_fails ?? 0) + 1;
  if (turn3Fails >= 2) {
    next = { ...next, status: "exhausted", turn3_fails: turn3Fails };
    return replaceGap(state, next);
  }
  next = { ...next, status: "in_progress", turn_no: 3, turn3_fails: turn3Fails };
  return replaceGap(state, next);
}

export function recordTutorQuestion(
  state: TutorRuntimeState,
  gapId: string,
  replyText: string,
  opts?: { isExplanation?: boolean },
): TutorRuntimeState {
  const gap = findGap(state, gapId);
  if (!gap) throw new Error(`recordTutorQuestion: unknown gap ${gapId}`);
  if (isTerminalStatus(gap.status)) return state;

  const isExplanation = opts?.isExplanation ?? false;
  const next: RuntimeGap = {
    ...gap,
    awaiting_evidence: true,
    ...(isExplanation ? { last_explanation: replyText } : {}),
  };
  return replaceGap(state, next);
}

export type GapAction = "skip" | "dispute";

export function applyGapAction(
  state: TutorRuntimeState,
  gapId: string,
  action: GapAction,
  _opts?: { reason?: string | null },
):
  | { ok: true; state: TutorRuntimeState }
  | { ok: false; reason: "not_found" | "terminal" } {
  const gap = findGap(state, gapId);
  if (!gap) return { ok: false, reason: "not_found" };
  if (isTerminalStatus(gap.status)) return { ok: false, reason: "terminal" };

  const status: GapStatus = action === "skip" ? "skipped" : "disputed";
  const next: RuntimeGap = { ...gap, status, awaiting_evidence: false };
  return { ok: true, state: replaceGap(state, next) };
}

export function externalGapId(gap: RuntimeGap): string {
  return gap.binderlab_gap_id ?? gap.gap_id;
}

export function finalGapsSnapshot(
  state: TutorRuntimeState,
): Array<{
  gap_id: string;
  topic_id: string | null;
  status: string;
  closing_turn: number | null;
  attempts: number;
  independent: boolean | null;
}> {
  return state.gaps.map((g) => ({
    gap_id: externalGapId(g),
    topic_id: topicIdOf(g),
    status: g.status,
    closing_turn: g.closing_turn ?? null,
    attempts: g.attempts,
    independent: g.independent ?? null,
  }));
}
