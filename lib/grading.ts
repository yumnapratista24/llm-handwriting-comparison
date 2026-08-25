// Grading core shared by the legacy sync route (app/api/grade) and the batch
// producer (app/api/batch-grade). Two pure pieces:
//   - buildGradeRequestPayload → the EXACT OpenRouter POST /chat/completions body
//   - parseGradeToolResponse   → parse + clamp the forced grade_answer tool call
//
// The body supports three answer content modes:
//   text   → answer text rides in the user prompt, no binary parts
//   images → one image_url part per URL (inline data: URL for sync, or the
//            storage://grading-uploads/... placeholder for batch jobs)
//   pdf    → a file part (data: URL for sync, storage:// placeholder for batch)
//            plus the request-root file-parser plugin (mistral-ocr)
//
// This module is intentionally free of the OpenAI SDK and of any server-only
// dependency so it can be reused anywhere. The sync route casts the returned
// body to the SDK param type at the call site.

import {
  composeSystemPrompt,
  buildUserPrompt,
  buildMaterialBlock,
  buildGradeTool,
  type RubricCriterion,
  type PromptChunk,
} from "@/lib/prompt";
import type { Citation, GradeResponse } from "@/lib/models";

// ── Request payload ──────────────────────────────────────────────────────────

export type GradeContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export interface FileParserPlugin {
  id: "file-parser";
  pdf: { engine: string };
}

export interface GradeRequestPayload {
  model: string;
  messages: Array<
    | { role: "system"; content: string }
    | { role: "user"; content: GradeContentPart[] }
  >;
  tools: ReturnType<typeof buildGradeTool>[];
  tool_choice: { type: "function"; function: { name: string } };
  plugins?: FileParserPlugin[];
}

// How the student's answer is carried in the request.
export type GradeAnswerContent =
  | { mode: "text"; text: string }
  | { mode: "images"; imageUrls: string[] }
  | { mode: "pdf"; filename: string; fileData: string };

export interface BuildGradeRequestParams {
  openrouterId: string;
  // The raw, user-editable system prompt (IMPORTANT_NOTES is appended here).
  systemPrompt?: string;
  question: string;
  rubric?: RubricCriterion[];
  // Retrieved source-material chunks (RAG). Empty/omitted → no material block.
  material?: PromptChunk[];
  answer: GradeAnswerContent;
}

// The file-parser plugin is only attached when a PDF file part is present.
export const FILE_PARSER_PLUGIN: FileParserPlugin = {
  id: "file-parser",
  pdf: { engine: "mistral-ocr" },
};

// Build the EXACT OpenRouter request body. Byte-identical to the legacy sync
// route for the text/images modes; adds the file part + plugin for scanned PDFs.
export function buildGradeRequestPayload(
  params: BuildGradeRequestParams,
): GradeRequestPayload {
  const { openrouterId, systemPrompt, question, rubric, answer } = params;
  const material = params.material ?? [];

  const systemMessage = composeSystemPrompt(systemPrompt);

  // Text answers grade the provided text directly — no transcription prompt.
  const userAnswerText = answer.mode === "text" ? answer.text.trim() : undefined;
  const userText = buildUserPrompt(question, rubric, userAnswerText);

  const materialContent: GradeContentPart[] = material.length
    ? [{ type: "text", text: buildMaterialBlock(material) }]
    : [];

  let answerContent: GradeContentPart[];
  if (answer.mode === "images") {
    answerContent = answer.imageUrls.map((url) => ({
      type: "image_url",
      image_url: { url },
    }));
  } else if (answer.mode === "pdf") {
    answerContent = [
      { type: "file", file: { filename: answer.filename, file_data: answer.fileData } },
    ];
  } else {
    answerContent = [];
  }

  const payload: GradeRequestPayload = {
    model: openrouterId,
    messages: [
      { role: "system", content: systemMessage },
      {
        role: "user",
        content: [...materialContent, { type: "text", text: userText }, ...answerContent],
      },
    ],
    tools: [buildGradeTool(!!rubric?.length, material.length > 0)],
    tool_choice: { type: "function", function: { name: "grade_answer" } },
  };

  if (answer.mode === "pdf") {
    payload.plugins = [FILE_PARSER_PLUGIN];
  }

  return payload;
}

// ── Response parsing / clamping ──────────────────────────────────────────────

// Everything the grade_answer tool call yields, after normalization + clamping.
// Caller attaches usage + latency to form a full GradeResponse.
export interface ParsedGrade {
  extracted_text: string;
  extraction_note: string;
  score: number;
  feedback_text: string;
  strengths: string[];
  improvements: string[];
  rubric_breakdown?: GradeResponse["rubric_breakdown"];
  citations?: Citation[];
}

export interface ParseGradeOptions {
  // Clamp bound for the score. Legacy sync path uses 100 (no scaling); batch
  // jobs pass job_meta.score_max (rubric max when a rubric is present).
  scoreMax?: number;
  // When the answer was provided as text, the extracted_text IS that text and
  // no transcription note is produced — mirrors the legacy sync behavior.
  answerText?: string;
}

// Parse the forced grade_answer tool-call arguments (a JSON string). Throws if
// the string is not valid JSON — callers map that to their own error response.
export function parseGradeToolResponse(
  args: string,
  opts: ParseGradeOptions = {},
): ParsedGrade {
  const parsed = JSON.parse(args) as Partial<GradeResponse>;
  return normalizeParsedGrade(parsed, opts);
}

// Same as parseGradeToolResponse but starting from an already-parsed object.
export function normalizeParsedGrade(
  parsed: Partial<GradeResponse>,
  opts: ParseGradeOptions = {},
): ParsedGrade {
  const scoreMax = opts.scoreMax ?? 100;
  const answer = opts.answerText?.trim();

  const extracted_text = answer ? answer : parsed.extracted_text ?? "";
  const extraction_note = answer
    ? "Jawaban diberikan dalam bentuk teks."
    : parsed.extraction_note ?? "";

  const citations =
    Array.isArray(parsed.citations) && parsed.citations.length
      ? parsed.citations
          .map((c: Citation) => ({
            chunk_id: String(c.chunk_id ?? ""),
            document: String(c.document ?? ""),
            snippet: String(c.snippet ?? ""),
          }))
          .filter((c) => c.chunk_id)
      : undefined;

  const rubric_breakdown =
    Array.isArray(parsed.rubric_breakdown) && parsed.rubric_breakdown.length
      ? parsed.rubric_breakdown.map((r: Record<string, unknown>) => ({
          criterion: String(r.criterion ?? ""),
          max: Number(r.max ?? 0),
          awarded: Number(r.awarded ?? 0),
          reason: String(r.reason ?? ""),
        }))
      : undefined;

  return {
    extracted_text,
    extraction_note,
    score:
      typeof parsed.score === "number"
        ? Math.max(0, Math.min(scoreMax, Math.round(parsed.score)))
        : 0,
    feedback_text: parsed.feedback_text ?? "",
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
    rubric_breakdown,
    citations: citations && citations.length ? citations : undefined,
  };
}
