import { describe, expect, it } from "vitest";
import {
  allGapsTerminal,
  applyAttempt,
  applyGapAction,
  beginGapTurn,
  chooseDriveGap,
  classifyStudentTurn,
  coerceRuntimeState,
  externalGapId,
  finalGapsSnapshot,
  findGap,
  recordTutorQuestion,
  type RuntimeGap,
  type TutorRuntimeState,
} from "./tutorStateMachine";

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

describe("golden dialogues — the escalation ladder (§2 / §8)", () => {
  it("G1 — pass at turn 1 closes the gap as INDEPENDENT", () => {
    let s = state([gap()]);

    const begun = beginGapTurn(s, "g1");
    expect(begun.gap.status).toBe("in_progress");
    expect(begun.gap.turn_no).toBe(1);
    expect(begun.gap.awaiting_evidence).toBe(false);
    s = begun.state;

    s = recordTutorQuestion(s, "g1", "Apa yang ingin kamu buktikan?", { isExplanation: false });
    expect(findGap(s, "g1")!.awaiting_evidence).toBe(true);

    s = applyAttempt(s, "g1", { verdict: "pass", missingElements: [], confidence: 0.88 });
    const g = findGap(s, "g1")!;
    expect(g.status).toBe("closed");
    expect(g.awaiting_evidence).toBe(false);
    expect(g.closing_turn).toBe(1);
    expect(g.independent).toBe(true);
  });

  it("G2 — fail, fail, then pass at turn 3 closes NOT independent, after an explanation", () => {
    let s = state([gap({ status: "in_progress", turn_no: 1 })]);

    s = applyAttempt(s, "g1", { verdict: "fail", missingElements: ["akibat"] });
    expect(findGap(s, "g1")!.turn_no).toBe(2);
    expect(findGap(s, "g1")!.status).toBe("in_progress");

    s = applyAttempt(s, "g1", { verdict: "fail", missingElements: ["akibat"] });
    expect(findGap(s, "g1")!.turn_no).toBe(3);

    s = recordTutorQuestion(
      s,
      "g1",
      "Penjelasan: analisis butuh sebab dan akibat. Sekarang kasus baru: ...",
      { isExplanation: true },
    );
    expect(findGap(s, "g1")!.awaiting_evidence).toBe(true);
    expect(findGap(s, "g1")!.last_explanation).toContain("Penjelasan");

    s = applyAttempt(s, "g1", { verdict: "pass", missingElements: [], confidence: 0.8 });
    const g = findGap(s, "g1")!;
    expect(g.status).toBe("closed");
    expect(g.closing_turn).toBe(3);
    expect(g.independent).toBe(false);
  });

  it("G3 — a failed turn-3 answer allows ONE follow-up, then exhausts", () => {
    let s = state([gap({ status: "in_progress", turn_no: 3, attempts: 2 })]);

    s = applyAttempt(s, "g1", { verdict: "fail", missingElements: ["bukti"] });
    let g = findGap(s, "g1")!;
    expect(g.status).toBe("in_progress");
    expect(g.turn_no).toBe(3);
    expect(g.turn3_fails).toBe(1);

    s = applyAttempt(s, "g1", { verdict: "fail", missingElements: ["bukti"] });
    g = findGap(s, "g1")!;
    expect(g.status).toBe("exhausted");
    expect(g.turn3_fails).toBe(2);
  });

  it("attempt_ceiling (6) exhausts immediately, whatever the turn", () => {
    const s = state([gap({ status: "in_progress", turn_no: 2, attempts: 5 })]);
    const next = applyAttempt(s, "g1", { verdict: "fail", missingElements: [] });
    const g = findGap(next, "g1")!;
    expect(g.attempts).toBe(6);
    expect(g.status).toBe("exhausted");
  });

  it("records last_verdict/last_missing on a fail; clears missing on a pass", () => {
    let g = findGap(
      applyAttempt(state([gap({ status: "in_progress", turn_no: 1 })]), "g1", {
        verdict: "fail",
        missingElements: ["akibat", "bukti"],
      }),
      "g1",
    )!;
    expect(g.last_verdict).toBe("fail");
    expect(g.last_missing).toEqual(["akibat", "bukti"]);

    g = findGap(
      applyAttempt(state([gap({ status: "in_progress", turn_no: 1 })]), "g1", {
        verdict: "pass",
        missingElements: [],
        confidence: 0.9,
      }),
      "g1",
    )!;
    expect(g.last_verdict).toBe("pass");
    expect(g.last_missing).toEqual([]);
  });

  it("a contaminated auto-fail still counts as an attempt", () => {
    const s = state([gap({ status: "in_progress", turn_no: 3, attempts: 3 })]);
    const next = applyAttempt(s, "g1", {
      verdict: "fail",
      missingElements: [],
      confidence: null,
      contaminated: true,
    });
    const g = findGap(next, "g1")!;
    expect(g.attempts).toBe(4);
    expect(g.status).toBe("in_progress");
    expect(g.turn3_fails).toBe(1);
  });
});

describe("recordTutorQuestion — explanation is PHASE-gated, not turn-gated (m6 / §6)", () => {
  it("a turn-3 CONTAMINATED scold does NOT overwrite last_explanation", () => {
    const s = state([
      gap({ status: "in_progress", turn_no: 3, awaiting_evidence: false, last_explanation: "PENJELASAN ASLI" }),
    ]);
    const next = recordTutorQuestion(s, "g1", "Itu kata-kataku, coba dengan kata-katamu sendiri.", {
      isExplanation: false,
    });
    expect(findGap(next, "g1")!.last_explanation).toBe("PENJELASAN ASLI");
    expect(findGap(next, "g1")!.awaiting_evidence).toBe(true);
  });

  it("a genuine explanation reply refreshes last_explanation", () => {
    const s = state([gap({ status: "in_progress", turn_no: 3 })]);
    const next = recordTutorQuestion(s, "g1", "Penjelasan baru + transfer.", { isExplanation: true });
    expect(findGap(next, "g1")!.last_explanation).toBe("Penjelasan baru + transfer.");
    expect(findGap(next, "g1")!.awaiting_evidence).toBe(true);
  });

  it("no-ops on a terminal gap (a closed/exhausted reply is a hand-off, not an evidence request)", () => {
    const s = state([gap({ status: "closed", turn_no: 1 })]);
    const next = recordTutorQuestion(s, "g1", "Bagus, lanjut ya.", { isExplanation: false });
    expect(next).toBe(s);
  });
});

describe("applyGapAction (skip/dispute endpoints §2.4)", () => {
  it("G4 — skip terminalizes the gap", () => {
    const s = state([gap({ status: "in_progress", turn_no: 1, awaiting_evidence: true })]);
    const r = applyGapAction(s, "g1", "skip");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(findGap(r.state, "g1")!.status).toBe("skipped");
      expect(findGap(r.state, "g1")!.awaiting_evidence).toBe(false);
    }
  });

  it("G5 — dispute terminalizes the gap (optional reason accepted for API stability)", () => {
    const s = state([gap({ status: "in_progress", turn_no: 2, awaiting_evidence: true })]);
    const r = applyGapAction(s, "g1", "dispute", { reason: "grader salah" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(findGap(r.state, "g1")!.status).toBe("disputed");
    }
  });

  it("unknown gap → not_found (404); already-terminal gap → terminal (409)", () => {
    const s = state([gap({ status: "closed" })]);
    expect(applyGapAction(s, "nope", "skip")).toEqual({ ok: false, reason: "not_found" });
    expect(applyGapAction(s, "g1", "skip")).toEqual({ ok: false, reason: "terminal" });
  });
});

describe("classifyStudentTurn (§8 G6 conservative default)", () => {
  it("an awaiting gap → the message is an ATTEMPT (even an injection-looking one)", () => {
    const s = state([gap({ status: "in_progress", turn_no: 1, awaiting_evidence: true })]);
    const k = classifyStudentTurn(s);
    expect(k.mode).toBe("attempt");
    if (k.mode === "attempt") expect(k.gap.gap_id).toBe("g1");
  });
  it("no awaiting gap → a DRIVE turn", () => {
    expect(classifyStudentTurn(state([gap({ status: "open" })])).mode).toBe("drive");
  });
});

describe("chooseDriveGap — TOPIC-AWARE (finish the running topic, then advance)", () => {
  it("resumes an in_progress gap first", () => {
    const s = state([gap({ gap_id: "a", status: "open" }), gap({ gap_id: "b", status: "in_progress" })]);
    expect(chooseDriveGap(s, "apa saja")?.gap_id).toBe("b");
  });

  it("finishes the running topic (next open checkpoint in it) before moving to the next topic", () => {
    const s = state([
      gap({ gap_id: "a", topic_id: "t1", status: "closed" }),
      gap({ gap_id: "b", topic_id: "t1", status: "open" }),
      gap({ gap_id: "c", topic_id: "t2", status: "open" }),
    ]);
    expect(chooseDriveGap(s, "lanjut")?.gap_id).toBe("b");
  });

  it("advances to the next topic once the running topic has no open checkpoints", () => {
    const s = state([
      gap({ gap_id: "a", topic_id: "t1", status: "closed" }),
      gap({ gap_id: "b", topic_id: "t1", status: "skipped" }),
      gap({ gap_id: "c", topic_id: "t2", status: "open" }),
      gap({ gap_id: "d", topic_id: "t2", status: "open" }),
    ]);
    expect(chooseDriveGap(s, "lanjut")?.gap_id).toBe("c");
  });

  it("legacy flat state (no topic_id) degrades to the first open gap", () => {
    const s = state([gap({ gap_id: "a", status: "closed" }), gap({ gap_id: "b", status: "open" })]);
    expect(chooseDriveGap(s, "mulai")?.gap_id).toBe("b");
  });

  it("honours the topic the student PICKED over the weakest-first default", () => {
    const s = state([
      gap({ gap_id: "a", topic_id: "t1", topic_label: "Fungsi Surjektif", status: "open" }),
      gap({ gap_id: "b", topic_id: "t2", topic_label: "Induksi Matematika", status: "open" }),
    ]);
    expect(chooseDriveGap(s, "Ayo mulai dari topik: Induksi Matematika.")?.gap_id).toBe("b");
  });

  it("drives the first OPEN checkpoint of the picked topic (skips its terminal ones)", () => {
    const s = state([
      gap({ gap_id: "a", topic_id: "t1", topic_label: "Tabel Kebenaran", status: "closed" }),
      gap({ gap_id: "b", topic_id: "t1", topic_label: "Tabel Kebenaran", status: "open" }),
      gap({ gap_id: "c", topic_id: "t2", topic_label: "Induksi", status: "open" }),
    ]);
    expect(chooseDriveGap(s, "Ayo mulai dari topik: Tabel Kebenaran.")?.gap_id).toBe("b");
  });

  it("picks the most specific topic when one label is a substring of another", () => {
    const s = state([
      gap({ gap_id: "a", topic_id: "t1", topic_label: "Fungsi", status: "open" }),
      gap({ gap_id: "b", topic_id: "t2", topic_label: "Fungsi Bijektif", status: "open" }),
    ]);
    expect(chooseDriveGap(s, "Ayo mulai dari topik: Fungsi Bijektif.")?.gap_id).toBe("b");
  });

  it("undefined when nothing non-terminal remains (→ complete)", () => {
    expect(chooseDriveGap(state([gap({ status: "closed" })]), "x")).toBeUndefined();
  });
});

describe("coerceRuntimeState — back-compat across the topic revision", () => {
  it("accepts the {next_seq,gaps} object", () => {
    expect(coerceRuntimeState({ next_seq: 5, gaps: [gap()] }).next_seq).toBe(5);
  });
  it("wraps a bare legacy gap array with next_seq 1", () => {
    expect(coerceRuntimeState([gap()])).toMatchObject({ next_seq: 1 });
  });
  it("coerces BOTH a legacy gap (no topic_id) and a new checkpoint gap (with topic_id), container stays flat", () => {
    const legacy = gap({ gap_id: "old", criterion_name: "Analisis" } as Partial<RuntimeGap>);
    const fresh = gap({ gap_id: "cp", topic_id: "t1", topic_label: "OOP", descriptor: "d" } as Partial<RuntimeGap>);
    const s = coerceRuntimeState({ next_seq: 2, gaps: [legacy, fresh] });
    expect(s.gaps).toHaveLength(2);
    expect((s.gaps[0] as Record<string, unknown>).topic_id).toBeUndefined();
    expect((s.gaps[1] as Record<string, unknown>).topic_id).toBe("t1");
  });
  it("tolerates junk / the schema default / next_seq 0", () => {
    expect(coerceRuntimeState([])).toEqual({ next_seq: 1, gaps: [] });
    expect(coerceRuntimeState(null)).toEqual({ next_seq: 1, gaps: [] });
    expect(coerceRuntimeState({ next_seq: 0, gaps: [] }).next_seq).toBe(1);
  });
});

describe("allGapsTerminal + finalGapsSnapshot", () => {
  it("allGapsTerminal is true only when every gap is terminal (and there is ≥1)", () => {
    expect(allGapsTerminal(state([]))).toBe(false);
    expect(
      allGapsTerminal(state([gap({ status: "closed" }), gap({ gap_id: "b", status: "skipped" })])),
    ).toBe(true);
    expect(
      allGapsTerminal(state([gap({ status: "closed" }), gap({ gap_id: "b", status: "open" })])),
    ).toBe(false);
  });
  it("finalGapsSnapshot projects the /complete fields incl. topic_id (per-topic closure signal)", () => {
    const snap = finalGapsSnapshot(
      state([gap({ status: "closed", closing_turn: 2, attempts: 2, independent: false, topic_id: "t1" } as Partial<RuntimeGap>)]),
    );
    expect(snap[0]).toEqual({
      gap_id: "g1",
      topic_id: "t1",
      status: "closed",
      closing_turn: 2,
      attempts: 2,
      independent: false,
    });
  });

  it("finalGapsSnapshot uses the binderlab id when present, else falls back to gap_id", () => {
    const snap = finalGapsSnapshot(
      state([
        gap({ gap_id: "cp-1", binderlab_gap_id: "uuid-1", status: "closed" }),
        gap({ gap_id: "cp-2", status: "closed" }),
        gap({ gap_id: "cp-3", binderlab_gap_id: null, status: "closed" }),
      ]),
    );
    expect(snap.map((g) => g.gap_id)).toEqual(["uuid-1", "cp-2", "cp-3"]);
  });

  it("externalGapId prefers binderlab_gap_id and leaves gap_id untouched", () => {
    const g = gap({ gap_id: "cp-1", binderlab_gap_id: "uuid-1" });
    expect(externalGapId(g)).toBe("uuid-1");
    expect(g.gap_id).toBe("cp-1");
  });

  it("coerceRuntimeState preserves binderlab_gap_id", () => {
    const s = coerceRuntimeState({ next_seq: 2, gaps: [gap({ binderlab_gap_id: "uuid-1" })] });
    expect(s.gaps[0].binderlab_gap_id).toBe("uuid-1");
  });

  it("finalGapsSnapshot reports topic_id null on a legacy flat gap", () => {
    const snap = finalGapsSnapshot(state([gap({ status: "closed" })]));
    expect(snap[0].topic_id).toBeNull();
  });
});
