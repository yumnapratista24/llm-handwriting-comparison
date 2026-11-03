import { describe, expect, it } from "vitest";
import { buildTutorHandoff, singleQuestionEvidence, type StoredTopic } from "./handoffGaps";
import { initTutorConversationState } from "./tutorConversationState";
import { gapViews } from "./tutorService";

const RUN = "run-1";

function topics(): StoredTopic[] {
  return [
    {
      id: "t2",
      label: "Topik B",
      order_index: 1,
      tutor_checkpoints: [
        { id: "cp-b1", label: "B1", descriptor: "db1", order_index: 0, source_question_ids: [RUN] },
      ],
    },
    {
      id: "t1",
      label: "Topik A",
      order_index: 0,
      tutor_checkpoints: [
        { id: "cp-a1", label: "A1", descriptor: "da1", order_index: 0, source_question_ids: [RUN] },
        { id: "cp-a2", label: "A2", descriptor: "da2", order_index: 1, source_question_ids: [RUN] },
      ],
    },
  ];
}

function evidence(score: number | null, maxScore = 10) {
  return singleQuestionEvidence({
    runId: RUN,
    question: "Jelaskan OOP",
    studentAnswer: "jawaban",
    criterionFeedback: "kurang lengkap",
    score,
    maxScore,
  });
}

describe("buildTutorHandoff", () => {
  it("maps checkpoints into handoff gaps in topic order", () => {
    const h = buildTutorHandoff(topics(), [evidence(4)]);
    expect(h.gaps.map((g) => g.gap_id)).toEqual(["cp-a1", "cp-a2", "cp-b1"]);
    const first = h.gaps[0];
    expect(first).toMatchObject({
      gap_id: "cp-a1",
      binderlab_gap_id: null,
      checkpoint_id: "cp-a1",
      checkpoint_label: "A1",
      descriptor: "da1",
      topic_id: "t1",
      topic_label: "Topik A",
      topic_order: 0,
      topic_miss_summary: null,
      student_status: "gap",
      source_questions: [{ question_id: RUN, question_prompt: "Jelaskan OOP", answer_reference: null }],
      weak_source_refs: [
        { question_id: RUN, question_prompt: "Jelaskan OOP", score: 0.4, criterion_feedback: "kurang lengkap" },
      ],
      student_answer: "jawaban",
      criterion_feedback: "kurang lengkap",
    });
    expect(h.unmasteredCount).toBe(2);
    expect(h.initialRatios.get("cp-b1")).toBe(0.4);
  });

  it("marks every checkpoint mastered at or above 90%", () => {
    const h = buildTutorHandoff(topics(), [evidence(9)]);
    expect(h.gaps.every((g) => g.student_status === "mastered")).toBe(true);
    expect(h.gaps[0].weak_source_refs).toEqual([
      { question_id: RUN, question_prompt: "Jelaskan OOP", score: 0.9, criterion_feedback: "kurang lengkap" },
    ]);
    expect(h.unmasteredCount).toBe(0);
    const state = initTutorConversationState(h.gaps);
    expect(state.gaps.every((g) => g.status === "closed")).toBe(true);
  });

  it("treats a missing score as an unknown gap", () => {
    const h = buildTutorHandoff(topics(), [evidence(null)]);
    expect(h.gaps.every((g) => g.student_status === "gap")).toBe(true);
    expect(h.gaps[0].weak_source_refs).toEqual([]);
    expect(h.initialRatios.get("cp-a1")).toBe(0);
  });

  it("treats a source with no evidence as unscored", () => {
    const t = topics();
    t[0].tutor_checkpoints[0].source_question_ids = ["other"];
    const h = buildTutorHandoff(t, [evidence(10)]);
    const b1 = h.gaps.find((g) => g.gap_id === "cp-b1");
    expect(b1?.student_status).toBe("gap");
    expect(b1?.source_questions).toEqual([{ question_id: "other", question_prompt: "", answer_reference: null }]);
  });

  it("exposes topic fields on the gap view", () => {
    const state = initTutorConversationState(buildTutorHandoff(topics(), [evidence(4)]).gaps);
    expect(gapViews(state)[2]).toEqual({
      gap_id: "cp-b1",
      checkpoint_label: "B1",
      status: "open",
      turn_no: 0,
      attempts: 0,
      topic_id: "t2",
      topic_label: "Topik B",
      topic_order: 1,
    });
  });
});
