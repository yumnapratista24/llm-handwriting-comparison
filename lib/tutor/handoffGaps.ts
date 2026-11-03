import {
  deriveCheckpointGaps,
  type CheckpointGapResult,
  type CheckpointSourceInput,
  type DerivedCheckpointGap,
  type TopicInput,
} from "./checkpointGapDerivation";
import {
  flattenTopicsToGaps,
  type HandoffCheckpoint,
  type HandoffGap,
  type HandoffTopic,
} from "./tutorConversationState";

export interface StoredCheckpoint {
  id: string;
  label: string;
  descriptor: string;
  order_index: number;
  source_question_ids: string[];
}

export interface StoredTopic {
  id: string;
  label: string;
  order_index: number;
  tutor_checkpoints: StoredCheckpoint[];
}

export interface QuestionEvidence {
  questionId: string;
  questionPrompt: string | null;
  answerReference: string | null;
  studentAnswer: string | null;
  score: number;
  max: number;
  criterionFeedback: string | null;
}

export function singleQuestionEvidence(input: {
  runId: string;
  question: string | null;
  studentAnswer: string | null;
  criterionFeedback: string | null;
  score: number | null;
  maxScore: number;
}): QuestionEvidence {
  const scored = typeof input.score === "number" && Number.isFinite(input.score);
  return {
    questionId: input.runId,
    questionPrompt: input.question,
    answerReference: null,
    studentAnswer: input.studentAnswer,
    score: scored ? (input.score as number) : 0,
    max: scored ? input.maxScore : 0,
    criterionFeedback: input.criterionFeedback,
  };
}

export function buildTopicInputs(topics: StoredTopic[], evidence: QuestionEvidence[]): TopicInput[] {
  const byQuestion = new Map(evidence.map((e) => [e.questionId, e]));
  return topics.map((t) => ({
    topicId: t.id,
    topicLabel: t.label,
    topicOrder: t.order_index,
    checkpoints: t.tutor_checkpoints.map((c) => ({
      checkpointId: c.id,
      checkpointLabel: c.label,
      descriptor: c.descriptor,
      orderIndex: c.order_index,
      sources: c.source_question_ids.map((qid): CheckpointSourceInput => {
        const e = byQuestion.get(qid);
        return {
          questionId: qid,
          questionPrompt: e?.questionPrompt ?? null,
          answerReference: e?.answerReference ?? null,
          studentAnswer: e?.studentAnswer ?? null,
          score: e?.score ?? 0,
          max: e?.max ?? 0,
          criterionFeedback: e?.criterionFeedback ?? null,
        };
      }),
    })),
  }));
}

function checkpointPayload(derived: DerivedCheckpointGap): HandoffCheckpoint {
  return {
    checkpoint_id: derived.checkpointId,
    checkpoint_label: derived.checkpointLabel,
    descriptor: derived.descriptor,
    student_status: derived.studentStatus,
    topic_miss_summary: null,
    source_questions: derived.sourceQuestions.map((s) => ({
      question_id: s.questionId,
      question_prompt: s.questionPrompt ?? "",
      answer_reference: s.answerReference,
    })),
    weak_source_refs: derived.weakSourceRefs.map((w) => ({
      question_id: w.questionId,
      question_prompt: w.questionPrompt ?? "",
      score: w.score,
      criterion_feedback: w.criterionFeedback,
    })),
    student_answer: derived.studentAnswer,
    criterion_feedback: derived.criterionFeedback,
  };
}

export function handoffTopics(result: CheckpointGapResult): HandoffTopic[] {
  return result.topics.map((t) => ({
    topic_id: t.topicId,
    topic_label: t.topicLabel,
    topic_order: t.topicOrder,
    checkpoints: t.checkpoints.map(checkpointPayload),
  }));
}

export function unmasteredTopicCount(result: CheckpointGapResult): number {
  return result.topics.filter((t) => t.checkpoints.some((c) => c.studentStatus === "gap")).length;
}

export interface TutorHandoff {
  gaps: HandoffGap[];
  unmasteredCount: number;
  initialRatios: Map<string, number>;
}

export function buildTutorHandoff(topics: StoredTopic[], evidence: QuestionEvidence[]): TutorHandoff {
  const result = deriveCheckpointGaps(buildTopicInputs(topics, evidence));
  return {
    gaps: flattenTopicsToGaps(handoffTopics(result)),
    unmasteredCount: unmasteredTopicCount(result),
    initialRatios: new Map(result.flat.map((c) => [c.checkpointId, c.ratio])),
  };
}
