import { describe, expect, it } from "vitest";
import { buildGapStateBlock } from "./tutorPromptTier";
import type { RuntimeGap, TutorRuntimeState } from "./tutorStateMachine";

function gap(overrides: Partial<RuntimeGap> = {}): RuntimeGap {
  return {
    gap_id: "g1",
    checkpoint_label: "Analisis Kausal",
    status: "in_progress",
    turn_no: 1,
    attempts: 0,
    awaiting_evidence: true,
    ...overrides,
  } as RuntimeGap;
}

function state(gaps: RuntimeGap[]): TutorRuntimeState {
  return { next_seq: 1, gaps };
}

describe("buildGapStateBlock — active checkpoint carries descriptor + weak-source highlight", () => {
  it("renders the descriptor, source questions, and the weak-source highlight when present", () => {
    const block = buildGapStateBlock({
      state: state([
        gap({
          topic_id: "t-1",
          topic_label: "Konsep OOP",
          descriptor: "membedakan enkapsulasi dan abstraksi",
          source_questions: [
            { question_id: "q-1", question_prompt: "Apa itu enkapsulasi?" },
          ],
          weak_source_refs: [
            { question_id: "q-1", question_prompt: "Apa itu enkapsulasi?", score: 1, criterion_feedback: "kurang contoh" },
          ],
          student_answer: "enkapsulasi itu menyembunyikan data",
          criterion_feedback: "perlu contoh konkret",
        }),
      ]),
      phase: "probe",
    });
    expect(block).toContain("# STATUS GAP");
    expect(block).toContain("Checkpoint aktif: Analisis Kausal");
    expect(block).toContain("Topik: Konsep OOP");
    expect(block).toContain("Deskriptor");
    expect(block).toContain("membedakan enkapsulasi dan abstraksi");
    expect(block).toContain("Soal terkait");
    expect(block).toContain("Apa itu enkapsulasi?");
    expect(block).toContain("kamu masih belum tepat di: Apa itu enkapsulasi?");
    expect(block).toContain("kurang contoh");
    expect(block).toContain("enkapsulasi itu menyembunyikan data");
  });

  it("nests the remaining-work list per topic ('Topik: {label}')", () => {
    const block = buildGapStateBlock({
      state: state([
        gap({ gap_id: "a", checkpoint_label: "CP A", topic_id: "t-1", topic_label: "Konsep OOP", status: "open", awaiting_evidence: false }),
        gap({ gap_id: "b", checkpoint_label: "CP B", topic_id: "t-1", topic_label: "Konsep OOP", status: "closed", awaiting_evidence: false }),
        gap({ gap_id: "c", checkpoint_label: "CP C", topic_id: "t-2", topic_label: "Implementasi OOP", status: "open", awaiting_evidence: false }),
      ]),
      phase: "offer_gaps",
    });
    expect(block).toContain("Topik: Konsep OOP");
    expect(block).toContain("Topik: Implementasi OOP");
    expect(block).toContain("CP A: belum dikerjakan");
    expect(block).toContain("CP B: selesai");
    expect(block).toContain("CP C: belum dikerjakan");
    expect(block).toContain("Tawarkan topik");
  });

  it("tolerates a legacy row with no descriptor / topic (falls under an unlabelled group)", () => {
    const block = buildGapStateBlock({
      state: state([gap({ checkpoint_label: undefined, criterion_name: "Analisis" } as Partial<RuntimeGap>)]),
      phase: "probe",
    });
    expect(block).toContain("# STATUS GAP");
    expect(block).not.toContain("Deskriptor");
    expect(block).not.toContain("Topik:");
  });
});
