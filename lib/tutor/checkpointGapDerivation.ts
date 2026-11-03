export const MASTERY_THRESHOLD = 0.9;

export interface CheckpointSourceInput {
  questionId: string;
  questionPrompt: string | null;
  answerReference: string | null;
  studentAnswer: string | null;
  score: number;
  max: number;
  criterionFeedback: string | null;
}

export interface CheckpointInput {
  checkpointId: string;
  checkpointLabel: string;
  descriptor: string;
  orderIndex: number;
  sources: CheckpointSourceInput[];
}

export interface TopicInput {
  topicId: string;
  topicLabel: string;
  topicOrder: number;
  checkpoints: CheckpointInput[];
}

export interface WeakSourceRef {
  questionId: string;
  questionPrompt: string | null;
  score: number;
  studentAnswer: string | null;
  criterionFeedback: string | null;
}

export interface SourceQuestionRef {
  questionId: string;
  questionPrompt: string | null;
  answerReference: string | null;
}

export interface DerivedCheckpointGap {
  checkpointId: string;
  checkpointLabel: string;
  descriptor: string;
  topicId: string;
  topicLabel: string;
  topicOrder: number;
  studentStatus: "gap" | "mastered";
  ratio: number;
  sourceQuestions: SourceQuestionRef[];
  weakSourceRefs: WeakSourceRef[];
  studentAnswer: string | null;
  criterionFeedback: string | null;
}

export interface DerivedTopicGaps {
  topicId: string;
  topicLabel: string;
  topicOrder: number;
  checkpoints: DerivedCheckpointGap[];
}

export interface CheckpointGapResult {
  topics: DerivedTopicGaps[];
  flat: DerivedCheckpointGap[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sourceRatio(s: CheckpointSourceInput): number {
  return s.max > 0 ? s.score / s.max : 1;
}

function deriveOne(topic: TopicInput, cp: CheckpointInput): DerivedCheckpointGap {
  let sumScore = 0;
  let sumMax = 0;
  for (const s of cp.sources) {
    if (s.max > 0) {
      sumScore += s.score;
      sumMax += s.max;
    }
  }
  const hasScale = sumMax > 0;
  const ratio = hasScale ? sumScore / sumMax : 0;
  const studentStatus: "gap" | "mastered" =
    hasScale && ratio >= MASTERY_THRESHOLD ? "mastered" : "gap";

  const weak = cp.sources
    .filter((s) => s.max > 0 && s.score < s.max)
    .sort((a, b) => sourceRatio(a) - sourceRatio(b));

  const weakSourceRefs: WeakSourceRef[] = weak.map((s) => ({
    questionId: s.questionId,
    questionPrompt: s.questionPrompt,
    score: round2(sourceRatio(s)),
    studentAnswer: s.studentAnswer,
    criterionFeedback: s.criterionFeedback,
  }));

  const focus = weak[0] ?? cp.sources[0] ?? null;

  return {
    checkpointId: cp.checkpointId,
    checkpointLabel: cp.checkpointLabel,
    descriptor: cp.descriptor,
    topicId: topic.topicId,
    topicLabel: topic.topicLabel,
    topicOrder: topic.topicOrder,
    studentStatus,
    ratio,
    sourceQuestions: cp.sources.map((s) => ({
      questionId: s.questionId,
      questionPrompt: s.questionPrompt,
      answerReference: s.answerReference,
    })),
    weakSourceRefs,
    studentAnswer: focus?.studentAnswer ?? null,
    criterionFeedback: focus?.criterionFeedback ?? null,
  };
}

export function deriveCheckpointGaps(topics: TopicInput[]): CheckpointGapResult {
  const outTopics: DerivedTopicGaps[] = [];
  const flat: DerivedCheckpointGap[] = [];

  const orderedTopics = [...topics].sort((a, b) => a.topicOrder - b.topicOrder);
  for (const topic of orderedTopics) {
    const derived = topic.checkpoints
      .map((cp) => deriveOne(topic, cp))
      .sort((a, b) => a.ratio - b.ratio);
    if (derived.length === 0) continue;
    outTopics.push({
      topicId: topic.topicId,
      topicLabel: topic.topicLabel,
      topicOrder: topic.topicOrder,
      checkpoints: derived,
    });
    flat.push(...derived);
  }

  flat.sort((a, b) => a.ratio - b.ratio);
  return { topics: outTopics, flat };
}
