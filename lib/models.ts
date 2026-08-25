// Single source of truth for models, verdict styling, accents, and shared types.

export type VerdictKind = "ok" | "partial" | "bad";

export interface ModelInfo {
  key: string;
  label: string;
  openrouterId: string;
  vendor: string;
  dot: string;
}

export const MODELS: ModelInfo[] = [
  {
    key: "gpt4o",
    label: "GPT-4o",
    openrouterId: "openai/gpt-4o",
    vendor: "OpenAI",
    dot: "#5a8f7b",
  },
  {
    key: "gpt41",
    label: "GPT-4.1",
    openrouterId: "openai/gpt-4.1",
    vendor: "OpenAI",
    dot: "#5a8f7b",
  },
  {
    key: "sonnet",
    label: "Claude Sonnet 4",
    openrouterId: "anthropic/claude-sonnet-4.6",
    vendor: "Anthropic",
    dot: "#c08552",
  },
  {
    key: "opus",
    label: "Claude Opus 4",
    openrouterId: "anthropic/claude-opus-4.7",
    vendor: "Anthropic",
    dot: "#b5552f",
  },
  {
    key: "gemini25",
    label: "Gemini 2.5 Flash",
    openrouterId: "google/gemini-2.5-flash",
    vendor: "Google",
    dot: "#6b8fc7",
  },
  {
    key: "gemini35",
    label: "Gemini 3.5 Flash",
    openrouterId: "google/gemini-3.5-flash",
    vendor: "Google",
    dot: "#6b8fc7",
  },
  {
    key: "qwenplus",
    label: "Qwen3.7 Plus",
    openrouterId: "qwen/qwen3.7-plus",
    vendor: "Alibaba",
    dot: "#9a78b8",
  },
  {
    key: "qwen3vl235",
    label: "Qwen3-VL 235B",
    openrouterId: "qwen/qwen3-vl-235b-a22b-instruct",
    vendor: "Alibaba",
    dot: "#9a78b8",
  },
  {
    key: "qwen3vl30",
    label: "Qwen3-VL 30B",
    openrouterId: "qwen/qwen3-vl-30b-a3b-instruct",
    vendor: "Alibaba",
    dot: "#9a78b8",
  },
  {
    key: "gemini25pro",
    label: "Gemini 2.5 Pro",
    openrouterId: "google/gemini-2.5-pro",
    vendor: "Google",
    dot: "#6b8fc7",
  },
  {
    key: "gemini25lite",
    label: "Gemini 2.5 Flash Lite",
    openrouterId: "google/gemini-2.5-flash-lite",
    vendor: "Google",
    dot: "#6b8fc7",
  },
  {
    key: "gemini37",
    label: "Gemini 3.7 Flash",
    openrouterId: "google/gemini-3.7-flash",
    vendor: "Google",
    dot: "#6b8fc7",
  },
  {
    key: "mistralsmall",
    label: "Mistral Small 3.2",
    openrouterId: "mistralai/mistral-small-3.2-24b-instruct",
    vendor: "Mistral AI",
    dot: "#caa23c",
  },
  {
    key: "glm46v",
    label: "GLM-4.6V",
    openrouterId: "z-ai/glm-4.6v",
    vendor: "Zhipu AI",
    dot: "#4f9d8f",
  },
  {
    key: "gptluna",
    label: "GPT-5.6 Luna",
    openrouterId: "openai/gpt-5.6-luna",
    vendor: "OpenAI",
    dot: "#5a8f7b",
  },
];

export function getModel(key: string): ModelInfo | undefined {
  return MODELS.find((m) => m.key === key);
}

export const VERDICT_STYLES: Record<
  VerdictKind,
  { bg: string; fg: string; dot: string; label: string }
> = {
  ok: { bg: "#e7f0e8", fg: "#3f6b4a", dot: "#5b9268", label: "Benar" },
  partial: {
    bg: "#f6ecd5",
    fg: "#8a661f",
    dot: "#c79a3a",
    label: "Sebagian benar",
  },
  bad: { bg: "#f4e2dc", fg: "#9a4632", dot: "#c26a52", label: "Kurang tepat" },
};

export const ACCENTS = {
  Terracotta: "#b5552f",
  Forest: "#3f6b4a",
  Ink: "#3b332a",
} as const;

export type AccentName = keyof typeof ACCENTS;

export function deriveVerdict(score: number, maxScore = 100): VerdictKind {
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
  if (pct >= 85) return "ok";
  if (pct >= 60) return "partial";
  return "bad";
}

export interface Usage {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
}

export interface GradePayload {
  extracted_text: string;
  extraction_note: string;
  score: number;
  feedback_text: string;
  strengths: string[];
  improvements: string[];
}

export interface Citation {
  chunk_id: string;
  document: string;
  snippet: string;
}

export interface GradeResponse extends GradePayload {
  usage: Usage;
  latency: number;
  rubric_breakdown?: Array<{
    criterion: string;
    max: number;
    awarded: number;
    reason: string;
  }>;
  citations?: Citation[];
}

export interface UploadImage {
  id: string;
  label: string;
  src: string;
}

// ── v2 run/result model ─────────────────────────────────────────────────────

// Result lifecycle status.
//  - Batch jobs (grading_results.status column): "queued" | "running" | "done" | "error"
//  - Legacy sync UI (client-only, never persisted): "pending" while a model is
//    in-flight. Kept in the union so the existing sync flow keeps compiling.
export type ResultStatus = "pending" | "queued" | "running" | "done" | "error";

export interface RunResult {
  id: string;
  runId: string;
  // null for legacy sync rows; set to the graded answer for batch rows.
  answerId?: string | null;
  modelKey: string;
  status: ResultStatus;
  // Set when status === "error" (batch) — the failure message.
  error?: string | null;
  // Batch job timestamps (ISO strings) — used to detect jobs stuck in
  // queued/running (e.g. dead-lettered) so the UI can offer a retry.
  createdAt?: string | null;
  claimedAt?: string | null;
  // Populated when status === "done"
  grade?: GradeResponse;
  verdictKind?: VerdictKind;
}

// ── batch answers ───────────────────────────────────────────────────────────

export type AnswerKind = "text" | "images" | "pdf";
export type AnswerStatus = "ready" | "error";

// One uploaded binary backing an answer (grading_answer_files row).
export interface AnswerFileRef {
  id: string;
  answerId: string;
  position: number;
  storagePath: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
}

// One student answer within a batch run (grading_answers row + its files).
export interface AnswerEntry {
  id: string;
  runId: string;
  position: number;
  studentLabel: string;
  kind: AnswerKind;
  answerText?: string | null;
  extractionNote?: string | null;
  isScanned: boolean;
  status: AnswerStatus;
  error?: string | null;
  files: AnswerFileRef[];
}

export interface RubricLevelCell {
  level: number;
  description: string;
}

export interface RubricDef {
  criterion: string;
  description?: string;
  cells: RubricLevelCell[];
}

export function rubricCriterionMax(r: RubricDef): number {
  return r.cells.length ? Math.max(...r.cells.map((c) => c.level)) : 0;
}

export function rubricMaxScore(rubric: RubricDef[]): number {
  return rubric.reduce((sum, r) => sum + rubricCriterionMax(r), 0);
}

// A source document attached to a run (already ingested — chunked + embedded).
// Session-only: held in client state, sent as documentIds on grade; not persisted.
export interface AttachedDocument {
  id: string;
  filename: string;
  chunkCount: number;
}

export interface Run {
  id: string;
  ts: number;
  question: string;
  imageCount: number;
  systemPrompt: string;
  title?: string;
  rubric?: RubricDef[];
  results: RunResult[];
  // Number of student answers in a batch run (grading_runs.answer_count).
  // Legacy sync runs default to 1.
  answerCount?: number;
}
