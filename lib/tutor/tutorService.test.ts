import { describe, expect, it } from "vitest";
import { planTurn } from "./tutorService";
import type { RuntimeGap, TutorRuntimeState } from "./tutorStateMachine";

function gap(id: string, status: RuntimeGap["status"] = "open"): RuntimeGap {
  return {
    gap_id: id,
    checkpoint_label: id,
    status,
    turn_no: 0,
    attempts: 0,
    awaiting_evidence: false,
  } as RuntimeGap;
}

function state(...gaps: RuntimeGap[]): TutorRuntimeState {
  return { next_seq: 1, gaps };
}

describe("planTurn choose", () => {
  it("starts the chosen open gap instead of the first one", () => {
    const plan = planTurn(state(gap("a"), gap("b")), { kind: "choose", gapId: "b", studentMessage: "b" });
    expect(plan?.activeGapId).toBe("b");
    expect(plan?.phase).toBe("probe");
    expect(plan?.state.gaps.find((g) => g.gap_id === "b")?.status).toBe("in_progress");
    expect(plan?.state.gaps.find((g) => g.gap_id === "a")?.status).toBe("open");
  });

  it("falls back to drive when the chosen gap is not open", () => {
    const plan = planTurn(state(gap("a"), gap("b", "closed")), { kind: "choose", gapId: "b", studentMessage: "x" });
    expect(plan?.activeGapId).toBe("a");
  });

  it("keeps the in-progress gap when one is active", () => {
    const plan = planTurn(state(gap("a", "in_progress"), gap("b")), { kind: "choose", gapId: "b", studentMessage: "x" });
    expect(plan?.activeGapId).toBe("a");
  });

  it("falls back to drive for an unknown gap id", () => {
    const plan = planTurn(state(gap("a")), { kind: "choose", gapId: "zzz", studentMessage: "x" });
    expect(plan?.activeGapId).toBe("a");
  });
});
