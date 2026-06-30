// Single source of truth for models, verdict styling, accents, and shared types.

export type VerdictKind = "ok" | "partial" | "bad";

export interface ModelInfo {
  key: string;
  label: string;
  sumopodId: string;
  vendor: string;
  dot: string;
}

export const MODELS: ModelInfo[] = [
  {
    key: "gpt4o",
    label: "GPT-4o",
    sumopodId: "gpt-4o",
    vendor: "OpenAI",
    dot: "#5a8f7b",
  },
  {
    key: "gpt41",
    label: "GPT-4.1",
    sumopodId: "gpt-4.1",
    vendor: "OpenAI",
    dot: "#5a8f7b",
  },
  {
    key: "sonnet",
    label: "Claude Sonnet 4",
    sumopodId: "claude-sonnet-4-6",
    vendor: "Anthropic",
    dot: "#c08552",
  },
  {
    key: "opus",
    label: "Claude Opus 4",
    sumopodId: "claude-opus-4-7",
    vendor: "Anthropic",
    dot: "#b5552f",
  },
  {
    key: "gemini25",
    label: "Gemini 2.5 Flash",
    sumopodId: "gemini/gemini-2.5-flash",
    vendor: "Google",
    dot: "#6b8fc7",
  },
  {
    key: "gemini35",
    label: "Gemini 3.5 Flash",
    sumopodId: "gemini/gemini-3.5-flash",
    vendor: "Google",
    dot: "#6b8fc7",
  },
  {
    key: "qwenplus",
    label: "Qwen3.7 Plus",
    sumopodId: "qwen3.7-plus",
    vendor: "Alibaba",
    dot: "#9a78b8",
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

export function deriveVerdict(score: number): VerdictKind {
  if (score >= 85) return "ok";
  if (score >= 60) return "partial";
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

export interface GradeResponse extends GradePayload {
  usage: Usage;
  latency: number;
  rubric_breakdown?: Array<{
    criterion: string;
    max: number;
    awarded: number;
    reason: string;
  }>;
}

export interface UploadImage {
  id: string;
  label: string;
  src: string;
}

// ── v2 run/result model ─────────────────────────────────────────────────────

export type ResultStatus = "pending" | "done";

export interface RunResult {
  id: string;
  runId: string;
  modelKey: string;
  status: ResultStatus;
  // Populated when status === "done"
  grade?: GradeResponse;
  verdictKind?: VerdictKind;
}

export interface RubricDef {
  criterion: string;
  max: number;
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
}
