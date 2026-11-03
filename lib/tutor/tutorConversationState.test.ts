import { describe, expect, it } from "vitest";
import {
  initTutorConversationState,
  composeTutorOpening,
  flattenTopicsToGaps,
  type HandoffTopic,
} from "./tutorConversationState";

describe("initTutorConversationState", () => {
  it("attaches initial runtime fields to each gap and preserves static fields", () => {
    const state = initTutorConversationState([
      {
        gap_id: "g1",
        criterion_name: "Analysis",
        target_level: 3,
        level_descriptions: [{ score: 1, description: "weak" }],
      },
      { gap_id: "g2", criterion_name: "Evidence" },
    ]);

    expect(state.gaps).toHaveLength(2);
    expect(state.gaps[0]).toEqual({
      gap_id: "g1",
      criterion_name: "Analysis",
      target_level: 3,
      level_descriptions: [{ score: 1, description: "weak" }],
      status: "open",
      turn_no: 0,
      attempts: 0,
      awaiting_evidence: false,
    });
    expect(state.gaps[1]).toMatchObject({
      gap_id: "g2",
      criterion_name: "Evidence",
      status: "open",
      turn_no: 0,
      attempts: 0,
      awaiting_evidence: false,
    });
  });

  it("passes the question context (question_id / question_prompt) straight through", () => {
    const state = initTutorConversationState([
      {
        gap_id: "g1",
        criterion_name: "Analysis",
        question_id: "q-1",
        question_prompt: "Mengapa banjir sering terjadi di kota?",
      },
      {
        gap_id: "g2",
        criterion_name: "Evidence",
        question_id: "q-1",
        question_prompt: "Mengapa banjir sering terjadi di kota?",
      },
    ]);
    expect(state.gaps[0]).toMatchObject({
      question_id: "q-1",
      question_prompt: "Mengapa banjir sering terjadi di kota?",
    });
    expect(state.gaps[1]).toMatchObject({
      question_id: "q-1",
      question_prompt: "Mengapa banjir sering terjadi di kota?",
    });
  });

  it("tolerates a gap with no question context (absent question_id/question_prompt)", () => {
    const state = initTutorConversationState([{ gap_id: "g1", criterion_name: "Analysis" }]);
    expect(state.gaps[0].question_id).toBeUndefined();
    expect(state.gaps[0].question_prompt).toBeUndefined();
  });

  it("sets thread-level next_seq to 1", () => {
    expect(initTutorConversationState([{ gap_id: "g1" }]).next_seq).toBe(1);
  });

  it("handles an empty gap list", () => {
    expect(initTutorConversationState([])).toEqual({ next_seq: 1, gaps: [] });
  });

  it("inits a MASTERED checkpoint as closed (never re-tutored) and a gap checkpoint as open", () => {
    const s = initTutorConversationState([
      { gap_id: "cp-1", student_status: "mastered" },
      { gap_id: "cp-2", student_status: "gap" },
    ]);
    expect(s.gaps[0].status).toBe("closed");
    expect(s.gaps[1].status).toBe("open");
  });
});

describe("flattenTopicsToGaps", () => {
  const topics: HandoffTopic[] = [
    {
      topic_id: "t-1",
      topic_label: "Konsep OOP",
      topic_order: 0,
      checkpoints: [
        {
          checkpoint_id: "cp-1",
          checkpoint_label: "Enkapsulasi",
          descriptor: "membedakan enkapsulasi dan abstraksi",
          student_status: "gap",
          source_questions: [{ question_id: "q-1", question_prompt: "Apa itu enkapsulasi?" }],
          weak_source_refs: [{ question_id: "q-1", question_prompt: "Apa itu enkapsulasi?", score: 1 }],
          student_answer: "menyembunyikan data",
          criterion_feedback: "perlu contoh",
        },
        {
          checkpoint_id: "cp-2",
          checkpoint_label: "Abstraksi",
          descriptor: "menjelaskan abstraksi",
          student_status: "mastered",
        },
      ],
    },
    {
      topic_id: "t-2",
      topic_label: "Implementasi OOP",
      topic_order: 1,
      checkpoints: [
        {
          checkpoint_id: "cp-3",
          checkpoint_label: "Pewarisan",
          descriptor: "mengimplementasikan pewarisan",
          student_status: "gap",
        },
      ],
    },
  ];

  it("flattens each checkpoint to one gap, gap_id = checkpoint_id, topic denormalized on", () => {
    const gaps = flattenTopicsToGaps(topics);
    expect(gaps).toHaveLength(3);
    expect(gaps[0]).toMatchObject({
      gap_id: "cp-1",
      checkpoint_id: "cp-1",
      checkpoint_label: "Enkapsulasi",
      descriptor: "membedakan enkapsulasi dan abstraksi",
      topic_id: "t-1",
      topic_label: "Konsep OOP",
      topic_order: 0,
      student_status: "gap",
    });
    expect(gaps[0].source_questions).toHaveLength(1);
    expect(gaps[0].weak_source_refs).toHaveLength(1);
    expect(gaps.map((g) => g.gap_id)).toEqual(["cp-1", "cp-2", "cp-3"]);
    expect(gaps[2].topic_id).toBe("t-2");
  });

  it("keeps the payload gap_id separately as binderlab_gap_id; gap_id stays checkpoint_id", () => {
    const gaps = flattenTopicsToGaps([
      {
        topic_id: "t",
        topic_label: "T",
        topic_order: 0,
        checkpoints: [
          { checkpoint_id: "cp-1", gap_id: "uuid-1", checkpoint_label: "L", descriptor: "d", student_status: "gap" },
          { checkpoint_id: "cp-2", checkpoint_label: "L", descriptor: "d", student_status: "gap" },
          { checkpoint_id: "cp-3", gap_id: "", checkpoint_label: "L", descriptor: "d", student_status: "gap" },
        ],
      },
    ]);
    expect(gaps[0]).toMatchObject({ gap_id: "cp-1", checkpoint_id: "cp-1", binderlab_gap_id: "uuid-1" });
    expect(gaps[1].binderlab_gap_id).toBeNull();
    expect(gaps[2].binderlab_gap_id).toBeNull();
  });

  it("init preserves binderlab_gap_id", () => {
    const s = initTutorConversationState([{ gap_id: "cp-1", binderlab_gap_id: "uuid-1" }]);
    expect(s.gaps[0].binderlab_gap_id).toBe("uuid-1");
  });

  it("defaults missing arrays and tolerates a topic with no checkpoints", () => {
    const gaps = flattenTopicsToGaps([
      { topic_id: "t-x", topic_label: "Kosong", topic_order: 0 },
      {
        topic_id: "t-y",
        topic_label: "Isi",
        topic_order: 1,
        checkpoints: [{ checkpoint_id: "cp", checkpoint_label: "L", descriptor: "d", student_status: "gap" }],
      },
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].source_questions).toEqual([]);
    expect(gaps[0].weak_source_refs).toEqual([]);
    expect(gaps[0].student_answer).toBeNull();
  });

  it("round-trips through init: mastered → closed, gap → open, container flat", () => {
    const s = initTutorConversationState(flattenTopicsToGaps(topics));
    expect(s.gaps.map((g) => g.status)).toEqual(["open", "closed", "open"]);
    expect(s.gaps[1].gap_id).toBe("cp-2");
  });
});

describe("composeTutorOpening", () => {
  it("names the assessment and class when both are present, with the gap count", () => {
    const text = composeTutorOpening({
      classLabel: "Fisika 10A",
      assessmentTitle: "Ulangan Bab 3",
      gapCount: 2,
    });
    expect(text).toContain("Ulangan Bab 3");
    expect(text).toContain("Fisika 10A");
    expect(text).toContain("2 bagian");
  });

  it("falls back to just the class when there is no assessment title", () => {
    const text = composeTutorOpening({ classLabel: "Fisika 10A", gapCount: 1 });
    expect(text).toContain("di kelas Fisika 10A");
    expect(text).toContain("1 bagian");
  });

  it("says 'beberapa bagian' when there are zero gaps", () => {
    const text = composeTutorOpening({ classLabel: "X", gapCount: 0 });
    expect(text).toContain("beberapa bagian");
  });

  it("still produces a sensible sentence with no class or assessment", () => {
    const text = composeTutorOpening({ gapCount: 3 });
    expect(text).toContain("Halo!");
    expect(text).toContain("3 bagian");
  });
});
