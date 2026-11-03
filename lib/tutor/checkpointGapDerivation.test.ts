import { test } from "vitest";
import assert from "node:assert/strict";
import {
  deriveCheckpointGaps,
  MASTERY_THRESHOLD,
  type CheckpointSourceInput,
  type TopicInput,
} from "./checkpointGapDerivation";

function src(over: Partial<CheckpointSourceInput> & { questionId: string; score: number; max: number }): CheckpointSourceInput {
  return {
    questionPrompt: `prompt-${over.questionId}`,
    answerReference: `ref-${over.questionId}`,
    studentAnswer: `ans-${over.questionId}`,
    criterionFeedback: `fb-${over.questionId}`,
    ...over,
  };
}

test("checkpoint gap: aggregate below threshold → gap, weakest-first sources", () => {
  const topics: TopicInput[] = [
    {
      topicId: "t1",
      topicLabel: "Topik 1",
      topicOrder: 0,
      checkpoints: [
        {
          checkpointId: "cp-a",
          checkpointLabel: "CP A",
          descriptor: "descriptor A",
          orderIndex: 0,
          sources: [
            src({ questionId: "q1", score: 1, max: 4 }),
            src({ questionId: "q2", score: 3, max: 4 }),
          ],
        },
      ],
    },
  ];

  const { flat } = deriveCheckpointGaps(topics);
  assert.equal(flat.length, 1);
  const g = flat[0];
  assert.equal(g.studentStatus, "gap");
  assert.equal(g.ratio, 0.5);
  assert.deepEqual(g.weakSourceRefs.map((w) => w.questionId), ["q1", "q2"]);
  assert.equal(g.weakSourceRefs[0].score, 0.25);
  assert.equal(g.weakSourceRefs[1].score, 0.75);
  assert.equal(g.studentAnswer, "ans-q1");
  assert.equal(g.criterionFeedback, "fb-q1");
  assert.equal(g.topicId, "t1");
  assert.equal(g.topicLabel, "Topik 1");
  assert.equal(g.topicOrder, 0);
  assert.deepEqual(g.sourceQuestions.map((s) => s.questionId), ["q1", "q2"]);
  assert.equal(g.sourceQuestions[0].answerReference, "ref-q1");
  assert.deepEqual(
    g.weakSourceRefs.map((w) => w.studentAnswer),
    ["ans-q1", "ans-q2"],
  );
  assert.deepEqual(
    g.weakSourceRefs.map((w) => w.criterionFeedback),
    ["fb-q1", "fb-q2"],
  );
});

test("checkpoint gap: >=90% aggregate → mastered (init closed)", () => {
  const topics: TopicInput[] = [
    {
      topicId: "t1",
      topicLabel: "T",
      topicOrder: 0,
      checkpoints: [
        {
          checkpointId: "cp-m",
          checkpointLabel: "CP M",
          descriptor: "d",
          orderIndex: 0,
          sources: [src({ questionId: "q9", score: 9, max: 10 })],
        },
      ],
    },
  ];
  const { flat } = deriveCheckpointGaps(topics);
  assert.equal(flat[0].studentStatus, "mastered");
  assert.equal(flat[0].ratio, MASTERY_THRESHOLD);
});

test("checkpoint gap: full marks → mastered, no weak refs", () => {
  const topics: TopicInput[] = [
    {
      topicId: "t1",
      topicLabel: "T",
      topicOrder: 0,
      checkpoints: [
        {
          checkpointId: "cp-full",
          checkpointLabel: "CP",
          descriptor: "d",
          orderIndex: 0,
          sources: [src({ questionId: "q", score: 10, max: 10 })],
        },
      ],
    },
  ];
  const { flat } = deriveCheckpointGaps(topics);
  assert.equal(flat[0].studentStatus, "mastered");
  assert.equal(flat[0].ratio, 1);
  assert.equal(flat[0].weakSourceRefs.length, 0);
  assert.equal(flat[0].studentAnswer, "ans-q");
});

test("checkpoint gap: weakest-first ordering within topic and flat", () => {
  const topics: TopicInput[] = [
    {
      topicId: "t2",
      topicLabel: "Second",
      topicOrder: 1,
      checkpoints: [
        {
          checkpointId: "cp-c",
          checkpointLabel: "C",
          descriptor: "d",
          orderIndex: 0,
          sources: [src({ questionId: "q4", score: 10, max: 10 })],
        },
      ],
    },
    {
      topicId: "t1",
      topicLabel: "First",
      topicOrder: 0,
      checkpoints: [
        {
          checkpointId: "cp-b",
          checkpointLabel: "B",
          descriptor: "d",
          orderIndex: 1,
          sources: [src({ questionId: "q3", score: 8, max: 10 })],
        },
        {
          checkpointId: "cp-a",
          checkpointLabel: "A",
          descriptor: "d",
          orderIndex: 0,
          sources: [src({ questionId: "q1", score: 2, max: 10 })],
        },
      ],
    },
  ];

  const { topics: out, flat } = deriveCheckpointGaps(topics);
  assert.deepEqual(out.map((t) => t.topicId), ["t1", "t2"]);
  assert.deepEqual(out[0].checkpoints.map((c) => c.checkpointId), ["cp-a", "cp-b"]);
  assert.deepEqual(flat.map((c) => c.checkpointId), ["cp-a", "cp-b", "cp-c"]);
});

test("checkpoint gap: no scored sources (max 0) → unknown → gap, not divide-by-zero", () => {
  const topics: TopicInput[] = [
    {
      topicId: "t1",
      topicLabel: "T",
      topicOrder: 0,
      checkpoints: [
        {
          checkpointId: "cp",
          checkpointLabel: "CP",
          descriptor: "d",
          orderIndex: 0,
          sources: [src({ questionId: "q", score: 0, max: 0 })],
        },
      ],
    },
  ];
  const { flat } = deriveCheckpointGaps(topics);
  assert.equal(flat[0].ratio, 0);
  assert.equal(flat[0].studentStatus, "gap");
});
