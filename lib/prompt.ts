// Grading prompt + grade_answer tool schema.
// DEFAULT_PROMPT is the editable behavior definition shown in the PromptDrawer.
// IMPORTANT_NOTES is always appended server-side via composeSystemPrompt() — never editable.

export const DEFAULT_PROMPT =
  `You are an expert academic grader. First, extract the text from the handwritten answer image(s), then grade it.

Language: Bahasa Indonesia (semua teks keluaran harus dalam Bahasa Indonesia).
Feedback Style: Use Glow and Grow format: Start with strengths (Glow), then suggest specific improvements (Grow).`;

export const IMPORTANT_NOTES =
  `IMPORTANT:
1. First extract and transcribe the handwritten text from the image(s) verbatim into extracted_text. If the student's answer is already provided as text, use it as-is and do not transcribe anything.
2. In extraction_note, give one short caveat about the transcription's reliability — note any faded/ambiguous words or likely misreads, or state that everything was read clearly. If the answer was provided as text, note that.
3. If a rubric is provided in the user message, score STRICTLY and ONLY by those criteria. For each criterion, choose exactly one of its defined score levels — do not award a value that isn't one of the listed levels, and do not interpolate between levels. The overall score is the SUM of the levels you awarded across all criteria — do NOT scale or normalize it to 100. If no rubric is provided, evaluate based on accuracy, completeness, and clarity on a 0–100 scale.
4. When a rubric is provided, you MUST return rubric_breakdown with exactly one entry per criterion — each entry must include the criterion name, its max level value, the level value you awarded (must match one of the criterion's defined levels exactly), and a one-sentence reason (in Bahasa Indonesia) explaining why that level fits best.
5. If MATERI SUMBER (source material) is provided, grade the answer against it: reward accuracy relative to the material and coverage of its key points, flag key points from the material that the answer missed, and do not reward claims that contradict it. Cite the supporting chunks in the citations field using their chunk id (the value after "chunk:"). Do not reproduce answer-key or full-solution content from the material verbatim to the student. If the material does not cover a point you need, you may supplement from general knowledge but state clearly in the feedback that it is not from the material (and do not cite a chunk for it).
6. Write feedback_text as a short paragraph for the student, plus concrete strengths (glow) and improvements (grow).
7. You MUST call the grade_answer function with your evaluation. Do not reply with free text.`;

export function composeSystemPrompt(userPrompt?: string): string {
  const base = userPrompt?.trim() || DEFAULT_PROMPT;
  return `${base}\n\n${IMPORTANT_NOTES}`;
}

export interface RubricLevelCell {
  level: number;        // shared level value, e.g. 0, 1, 2, 3
  description: string;  // what qualifies for this level at this criterion
}

export interface RubricCriterion {
  criterion: string;         // title
  description?: string;      // short criterion description
  cells: RubricLevelCell[];  // one entry per shared level
}

export function rubricCriterionMax(r: RubricCriterion): number {
  return r.cells.length ? Math.max(...r.cells.map((c) => c.level)) : 0;
}

// Reconcile extracted criteria onto one shared, index-aligned level set.
// RubricBuilder's add/remove-level controls assume cells[i] is the same level
// value across every criterion row — an LLM reading a table can't be trusted
// to return that directly, so every import goes through this first.
export function normalizeRubric(raw: RubricCriterion[]): RubricCriterion[] {
  const levelSet = new Set<number>();
  for (const r of raw) {
    for (const c of r.cells) levelSet.add(c.level);
  }
  const levels = [...levelSet].sort((a, b) => a - b);

  return raw.map((r) => {
    const byLevel = new Map(r.cells.map((c) => [c.level, c.description]));
    return {
      criterion: r.criterion,
      description: r.description,
      cells: levels.map((level) => ({
        level,
        description: byLevel.get(level) ?? "",
      })),
    };
  });
}

// Minimal chunk shape for the prompt (kept independent of server-only rag types).
export interface PromptChunk {
  chunkId: string;
  document: string;
  content: string;
}

// Delimited source-material block, assembled separately from buildUserPrompt and
// injected by the grade route as its own message part.
export function buildMaterialBlock(chunks: PromptChunk[]): string {
  const body = chunks
    .map((c) => {
      const tag = c.document ? ` · ${c.document}` : "";
      return `[chunk:${c.chunkId}${tag}]\n${c.content}`;
    })
    .join("\n\n");
  return `=== MATERI SUMBER (rujukan penilaian) ===\n${body}\n=== AKHIR MATERI SUMBER ===`;
}

export function buildUserPrompt(
  question: string,
  rubric?: RubricCriterion[],
  answerText?: string,
): string {
  const rubricBlock =
    rubric && rubric.length > 0
      ? `\n\nRubric (grade STRICTLY by these criteria and level descriptions; the awarded score for each criterion MUST be exactly one of its defined level values):\n` +
        rubric
          .map((r, i) => {
            const desc = r.description ? ` — ${r.description}` : "";
            const levels = [...r.cells]
              .sort((a, b) => a.level - b.level)
              .map((c) => `   - Level ${c.level}: ${c.description}`)
              .join("\n");
            return `${i + 1}. ${r.criterion}${desc}\n${levels}`;
          })
          .join("\n\n") +
        `\n\nScore each criterion by choosing the single best-matching level (no interpolation between levels). The overall score is the SUM of the levels you award — do NOT scale or normalize it to 100.`
      : "";

  const answer = answerText?.trim();
  const answerBlock = answer
    ? `\n\nStudent answer (already provided as text — no transcription needed):\n${answer}`
    : "";
  const closing = answer
    ? `\n\nGrade the answer above.`
    : `\n\nThe student has submitted handwritten answer(s). Please extract the text and grade it.`;

  return `Question: ${question}${rubricBlock}${answerBlock}${closing}`;
}

const BASE_PROPERTIES = {
  extracted_text: {
    type: "string",
    description: "The full transcription of the handwritten answer, preserving line breaks.",
  },
  extraction_note: {
    type: "string",
    description:
      "One short line about how reliable the transcription is: faded/ambiguous words, likely misreads, or a note that it was all clear.",
  },
  score: {
    type: "number",
    description:
      "Overall score. When a rubric is provided: the SUM of rubric_breakdown[].awarded (do not scale to 100). When no rubric is provided: 0 to 100 based on accuracy, completeness, and clarity.",
  },
  feedback_text: {
    type: "string",
    description: "A short overall feedback paragraph for the student (Bahasa Indonesia).",
  },
  strengths: {
    type: "array",
    items: { type: "string" },
    description:
      "Concrete strengths of the answer. The way you provide should align with the user prompt given, user might use specific method.",
  },
  improvements: {
    type: "array",
    items: { type: "string" },
    description:
      "Concrete, actionable improvements. The way you provide should align with the user prompt given, user might use specific method.",
  },
};

const RUBRIC_BREAKDOWN_PROPERTY = {
  type: "array",
  items: {
    type: "object",
    properties: {
      criterion: { type: "string" },
      max: { type: "number", description: "This criterion's highest defined level value." },
      awarded: {
        type: "number",
        description: "The level value you chose for this criterion — MUST exactly match one of its defined levels.",
      },
      reason: {
        type: "string",
        description: "One sentence in Bahasa Indonesia explaining why this level fits best.",
      },
    },
    required: ["criterion", "max", "awarded", "reason"],
  },
  description:
    "One entry per rubric criterion. REQUIRED when a rubric is provided in the user message.",
};

const CITATIONS_PROPERTY = {
  type: "array",
  items: {
    type: "object",
    properties: {
      chunk_id: {
        type: "string",
        description: "The id of the cited source-material chunk (the value after 'chunk:').",
      },
      document: { type: "string", description: "The source document filename." },
      snippet: {
        type: "string",
        description: "A short quoted phrase from the chunk supporting the feedback.",
      },
    },
    required: ["chunk_id", "document", "snippet"],
  },
  description:
    "Source-material passages that support the grading/feedback. Required when MATERI SUMBER is provided.",
};

const BASE_REQUIRED = [
  "extracted_text",
  "extraction_note",
  "score",
  "feedback_text",
  "strengths",
  "improvements",
];

export function buildGradeTool(hasRubric: boolean, hasMaterial = false) {
  const required = [...BASE_REQUIRED];
  if (hasRubric) required.push("rubric_breakdown");
  if (hasMaterial) required.push("citations");
  return {
    type: "function" as const,
    function: {
      name: "grade_answer",
      description: "Submit the grading result for the student's handwritten answer.",
      parameters: {
        type: "object",
        properties: {
          ...BASE_PROPERTIES,
          rubric_breakdown: RUBRIC_BREAKDOWN_PROPERTY,
          citations: CITATIONS_PROPERTY,
        },
        required,
      },
    },
  };
}

export const GRADE_TOOL = buildGradeTool(false, false);

// ── Rubric extraction (upload → transcribe into the matrix rubric) ──────────

export const RUBRIC_EXTRACTION_INSTRUCTIONS =
  `You are transcribing a grading rubric (criteria × score-level grid) from the provided document or image into structured data.

Rules:
1. Transcribe faithfully — preserve the level values (e.g. 0, 1, 2, 3) and every cell's descriptive text as close to verbatim as possible. Do not summarize, paraphrase, embellish, or invent content that isn't in the source.
2. One entry per criterion (row) in the table, in the same order as the source.
3. Each criterion's cells must cover every score level that appears anywhere in the source table for that row. If a cell is genuinely blank/illegible in the source, use an empty string for its description rather than guessing.
4. If the source has a short criterion description/subtitle (separate from the criterion title), capture it in "description"; otherwise omit it.
5. If no rubric table can be found in the provided content, return an empty criteria array — do not fabricate a rubric.
6. You MUST call the extract_rubric function with your result. Do not reply with free text.`;

export function buildRubricExtractionTool() {
  return {
    type: "function" as const,
    function: {
      name: "extract_rubric",
      description: "Submit the rubric transcribed from the provided document or image.",
      parameters: {
        type: "object",
        properties: {
          criteria: {
            type: "array",
            items: {
              type: "object",
              properties: {
                criterion: { type: "string", description: "The criterion's title/name." },
                description: {
                  type: "string",
                  description: "Short criterion description/subtitle, if present in the source.",
                },
                cells: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      level: { type: "number", description: "The score level value, e.g. 0, 1, 2, 3." },
                      description: {
                        type: "string",
                        description: "The cell's descriptive text for this criterion at this level.",
                      },
                    },
                    required: ["level", "description"],
                  },
                },
              },
              required: ["criterion", "cells"],
            },
            description: "One entry per rubric criterion (row), in source order. Empty array if no rubric table was found.",
          },
        },
        required: ["criteria"],
      },
    },
  };
}

// ── Tutor chat (Socratic 2-turn fallback discussion) ─────────────────────────

import type { GradeResponse } from "@/lib/models";

export interface TutorGrounding {
  question: string;
  feedback: string;
  gaps: string; // human-readable summary of the weakest areas
}

// Summarize where the answer fell short, worst first — the focus of the discussion.
export function gapsFromResult(grade: GradeResponse): string {
  const rubricGaps = (grade.rubric_breakdown ?? [])
    .filter((r) => r.awarded < r.max)
    .sort((a, b) => a.awarded / a.max - b.awarded / b.max)
    .map((r) => `- ${r.criterion} (${r.awarded}/${r.max}): ${r.reason}`);

  if (rubricGaps.length) return rubricGaps.join("\n");

  if (grade.improvements.length) {
    return grade.improvements.map((im) => `- ${im}`).join("\n");
  }
  return "- Pemahaman umum siswa terhadap soal.";
}

export function buildTutorGrounding(question: string, grade: GradeResponse): TutorGrounding {
  return { question, feedback: grade.feedback_text, gaps: gapsFromResult(grade) };
}

// System prompt for one tutor turn. turnCount is 1-based (1, 2, then 3 = fallback).
export function buildTutorSystemPrompt(g: TutorGrounding, turnCount: number): string {
  return `You are a warm, encouraging Socratic tutor helping a student truly understand an exam question. Speak in Bahasa Indonesia. Keep each message short (2–4 sentences).

The question being discussed:
${g.question}

The student's weakest areas (the gap to close):
${g.gaps}

Your earlier written feedback to the student:
${g.feedback}

THE 2-TURN FALLBACK RULE — you are now on turn ${turnCount} of 3:
- Turn 1: Ask ONE high-level Socratic question or give a conceptual hint that targets the specific gap above. Do NOT give the answer.
- Turn 2: Give a more specific, step-by-step hint or a cognitive forcing function that nudges the student toward the idea. Still do NOT give the answer.
- Turn 3 (fallback): The student has struggled twice, so now give a direct, clear explanation using an explanation-then-analogy pattern. End by asking the student to paraphrase the idea back in their own words so you can check understanding.

Rules: stay on turn ${turnCount}'s behavior only. Never reveal a full answer before turn 3. Be concise, kind, and specific to this student's gap. Output only your message to the student (no labels, no meta-commentary).`;
}
