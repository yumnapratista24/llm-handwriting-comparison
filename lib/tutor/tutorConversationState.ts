export interface HandoffSourceQuestion {
  question_id: string;
  question_prompt: string;
  answer_reference?: string | null;
}

export interface HandoffWeakSourceRef {
  question_id: string;
  question_prompt: string;
  score: number;
  criterion_feedback?: string | null;
}

export interface HandoffCheckpoint {
  checkpoint_id: string;
  checkpoint_label: string;
  descriptor: string;
  student_status: "gap" | "mastered";
  source_questions?: HandoffSourceQuestion[];
  weak_source_refs?: HandoffWeakSourceRef[];
  student_answer?: string | null;
  criterion_feedback?: string | null;
  [key: string]: unknown;
}

export interface HandoffTopic {
  topic_id: string;
  topic_label: string;
  topic_order: number;
  checkpoints?: HandoffCheckpoint[];
}

export interface HandoffGap {
  gap_id: string;
  checkpoint_id?: string | null;
  checkpoint_label?: string | null;
  binderlab_gap_id?: string | null;
  descriptor?: string | null;
  topic_id?: string | null;
  topic_label?: string | null;
  topic_order?: number | null;
  topic_miss_summary?: string | null;
  student_status?: "gap" | "mastered";
  source_questions?: HandoffSourceQuestion[];
  weak_source_refs?: HandoffWeakSourceRef[];
  student_answer?: string | null;
  criterion_feedback?: string | null;
  question_id?: string | null;
  question_prompt?: string | null;
  [key: string]: unknown;
}

export type TutorGapState = HandoffGap & {
  status: "open" | "closed";
  turn_no: number;
  attempts: number;
  awaiting_evidence: boolean;
};

export function flattenTopicsToGaps(topics: HandoffTopic[]): HandoffGap[] {
  const gaps: HandoffGap[] = [];
  for (const topic of topics) {
    for (const cp of topic.checkpoints ?? []) {
      gaps.push({
        ...cp,
        gap_id: cp.checkpoint_id,
        binderlab_gap_id:
          typeof cp.gap_id === "string" && cp.gap_id.length > 0 ? cp.gap_id : null,
        checkpoint_id: cp.checkpoint_id,
        checkpoint_label: cp.checkpoint_label,
        descriptor: cp.descriptor,
        topic_id: topic.topic_id,
        topic_label: topic.topic_label,
        topic_order: topic.topic_order,
        student_status: cp.student_status,
        source_questions: cp.source_questions ?? [],
        weak_source_refs: cp.weak_source_refs ?? [],
        student_answer: cp.student_answer ?? null,
        criterion_feedback: cp.criterion_feedback ?? null,
      });
    }
  }
  return gaps;
}

export interface TutorConversationState {
  next_seq: number;
  gaps: TutorGapState[];
}

export function initTutorConversationState(gaps: HandoffGap[]): TutorConversationState {
  return {
    next_seq: 1,
    gaps: gaps.map((gap) => ({
      ...gap,
      status: gap.student_status === "mastered" ? "closed" : "open",
      turn_no: 0,
      attempts: 0,
      awaiting_evidence: false,
    })),
  };
}

export function composeTutorOpening(input: {
  classLabel?: string | null;
  assessmentTitle?: string | null;
  gapCount: number;
}): string {
  const { classLabel, assessmentTitle, gapCount } = input;
  const where = assessmentTitle
    ? `untuk ${assessmentTitle}${classLabel ? ` di kelas ${classLabel}` : ""}`
    : classLabel
      ? `di kelas ${classLabel}`
      : "kamu";
  const parts = gapCount > 0 ? `${gapCount} bagian` : "beberapa bagian";
  return (
    `Halo! Hasil penilaian ${where} sudah keluar. ` +
    `Ada ${parts} yang masih bisa kita tingkatkan bersama — yuk kita bahas satu per satu.`
  );
}
