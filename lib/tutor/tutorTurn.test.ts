import { describe, expect, it } from "vitest";
import {
  buildJudgeCriterion,
  foldTutorReply,
  planTutorTurn,
  type TutorDecision,
  type TutorTurnPlan,
} from "./tutorTurn";
import { findGap, type RuntimeGap, type TutorRuntimeState } from "./tutorStateMachine";

function gap(overrides: Partial<RuntimeGap> = {}): RuntimeGap {
  return {
    gap_id: "g1",
    criterion_name: "Analisis",
    status: "open",
    turn_no: 0,
    attempts: 0,
    awaiting_evidence: false,
    ...overrides,
  } as RuntimeGap;
}
function state(gaps: RuntimeGap[], next_seq = 1): TutorRuntimeState {
  return { next_seq, gaps };
}
function plan(overrides: Partial<TutorTurnPlan>): TutorTurnPlan {
  return {
    phase: "probe",
    activeGapId: "g1",
    state: state([gap()]),
    expectsAnswer: true,
    ...overrides,
  };
}

describe("planTutorTurn — re-plan against a FRESH row (M4 concurrency control)", () => {
  it("a drive turn plans a probe on the first open gap", () => {
    const p = planTutorTurn(state([gap({ status: "open" })]), { kind: "drive", studentMessage: "mulai" });
    expect(p).not.toBeNull();
    expect(p!.phase).toBe("probe");
    expect(p!.activeGapId).toBe("g1");
    expect(findGap(p!.state, "g1")!.turn_no).toBe(1);
  });

  it("an attempt applies the judged outcome when the gap is still awaiting", () => {
    const dec: TutorDecision = {
      kind: "attempt",
      gapId: "g1",
      outcome: { verdict: "fail", missingElements: ["akibat"] },
    };
    const p = planTutorTurn(state([gap({ status: "in_progress", turn_no: 1, awaiting_evidence: true })]), dec)!;
    expect(p.phase).toBe("ask_next");
    expect(findGap(p.state, "g1")!.turn_no).toBe(2);
    expect(findGap(p.state, "g1")!.last_verdict).toBe("fail");
  });

  it("returns NULL when the gap was concurrently terminalized (skip/dispute won the race)", () => {
    const dec: TutorDecision = {
      kind: "attempt",
      gapId: "g1",
      outcome: { verdict: "pass", missingElements: [] },
    };
    expect(planTutorTurn(state([gap({ status: "skipped", awaiting_evidence: false })]), dec)).toBeNull();
  });

  it("returns NULL when the gap is no longer awaiting (already answered by a concurrent turn)", () => {
    const dec: TutorDecision = {
      kind: "attempt",
      gapId: "g1",
      outcome: { verdict: "pass", missingElements: [] },
    };
    expect(planTutorTurn(state([gap({ status: "in_progress", turn_no: 2, awaiting_evidence: false })]), dec)).toBeNull();
  });

  it("returns NULL for an unknown gap", () => {
    const dec: TutorDecision = {
      kind: "attempt",
      gapId: "ghost",
      outcome: { verdict: "pass", missingElements: [] },
    };
    expect(planTutorTurn(state([gap({ status: "in_progress", awaiting_evidence: true })]), dec)).toBeNull();
  });
});

describe("foldTutorReply — state-explicit + phase-aware (M4 / m6)", () => {
  it("an explain_transfer reply flips awaiting_evidence and refreshes last_explanation", () => {
    const s = state([gap({ status: "in_progress", turn_no: 3 })]);
    const r = foldTutorReply(s, plan({ phase: "explain_transfer", state: s }), "Penjelasan + transfer");
    expect(findGap(r.state, "g1")!.awaiting_evidence).toBe(true);
    expect(findGap(r.state, "g1")!.last_explanation).toBe("Penjelasan + transfer");
  });

  it("a contaminated (turn-3) reply flips awaiting_evidence but keeps last_explanation", () => {
    const s = state([gap({ status: "in_progress", turn_no: 3, last_explanation: "ASLI" })]);
    const r = foldTutorReply(s, plan({ phase: "contaminated", state: s }), "pakai kata-katamu sendiri");
    expect(findGap(r.state, "g1")!.awaiting_evidence).toBe(true);
    expect(findGap(r.state, "g1")!.last_explanation).toBe("ASLI");
  });

  it("a non-question reply (closed/exhausted/complete) leaves state as-is", () => {
    const s = state([gap({ status: "closed" })]);
    const r = foldTutorReply(s, plan({ phase: "closed", expectsAnswer: false, state: s }), "Bagus, lanjut ya");
    expect(r.state).toBe(s);
  });

  it("folds into the PROVIDED state, not plan.state (the fresh-row commit)", () => {
    const planState = state([gap({ status: "in_progress", turn_no: 1 })], 1);
    const freshState = state([gap({ status: "in_progress", turn_no: 1 })], 9);
    const r = foldTutorReply(freshState, plan({ phase: "probe", state: planState }), "probe?");
    expect(r.state.next_seq).toBe(9);
  });
});

describe("buildJudgeCriterion", () => {
  it("extracts the descriptor / checkpoint label / source questions from the gap", () => {
    const c = buildJudgeCriterion(
      gap({
        checkpoint_label: "Analisis Kausal",
        descriptor: "menjelaskan sebab dan akibat dengan bukti",
        source_questions: [
          { question_id: "q-1", question_prompt: "Mengapa banjir?", answer_reference: "drainase" },
          { question_id: "q-2", question_prompt: "Apa dampaknya?" },
        ],
      }),
      "jawaban",
    );
    expect(c).toEqual({
      descriptor: "menjelaskan sebab dan akibat dengan bukti",
      checkpointLabel: "Analisis Kausal",
      sourceQuestions: [
        { questionPrompt: "Mengapa banjir?", answerReference: "drainase" },
        { questionPrompt: "Apa dampaknya?", answerReference: null },
      ],
      originalAnswer: null,
      studentAnswer: "jawaban",
    });
  });

  it("carries the original assessment answer as context; studentAnswer is THIS turn's attempt", () => {
    const c = buildJudgeCriterion(
      gap({
        checkpoint_label: "Analisis",
        descriptor: "d",
        student_answer: "karena hujan",
      }),
      "attempt pada giliran ini",
    );
    expect(c.originalAnswer).toBe("karena hujan");
    expect(c.studentAnswer).toBe("attempt pada giliran ini");
  });

  it("falls back to gap_id label / empty descriptor / [] source questions when fields are absent or malformed", () => {
    const c = buildJudgeCriterion(
      gap({ criterion_name: undefined, checkpoint_label: undefined, descriptor: undefined, source_questions: "nope" } as unknown as Partial<RuntimeGap>),
      "x",
    );
    expect(c.checkpointLabel).toBe("g1");
    expect(c.descriptor).toBe("");
    expect(c.sourceQuestions).toEqual([]);
    expect(c.originalAnswer).toBeNull();
  });

  it("drops source-question entries with no prompt text", () => {
    const c = buildJudgeCriterion(
      gap({
        descriptor: "d",
        source_questions: [
          { question_id: "q-1", question_prompt: "  " },
          { question_id: "q-2", question_prompt: "Soal nyata", answer_reference: "  " },
        ],
      }),
      "x",
    );
    expect(c.sourceQuestions).toEqual([{ questionPrompt: "Soal nyata", answerReference: null }]);
  });
});
