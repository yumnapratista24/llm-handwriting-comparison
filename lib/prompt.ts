// Grading prompt + grade_answer tool schema.
// DEFAULT_PROMPT is the editable behavior definition shown in the PromptDrawer.
// IMPORTANT_NOTES is always appended server-side via composeSystemPrompt() — never editable.

export const DEFAULT_PROMPT =
  `You are an expert academic grader. First, extract the text from the handwritten answer image(s), then grade it.

Language: Bahasa Indonesia (semua teks keluaran harus dalam Bahasa Indonesia).
Feedback Style: Use Glow and Grow format: Start with strengths (Glow), then suggest specific improvements (Grow).`;

export const IMPORTANT_NOTES =
  `IMPORTANT:
1. First extract and transcribe the handwritten text from the image(s) verbatim into extracted_text.
2. In extraction_note, give one short caveat about the transcription's reliability — note any faded/ambiguous words or likely misreads, or state that everything was read clearly.
3. If a rubric is provided in the user message, score STRICTLY and ONLY by those criteria. Score each criterion individually, sum the points, then scale proportionally to 0–100 if the rubric total ≠ 100. If no rubric is provided, evaluate based on accuracy, completeness, and clarity.
4. When a rubric is provided, you MUST return rubric_breakdown with exactly one entry per criterion — each entry must include the criterion name, its max points, the points you awarded, and a one-sentence reason (in Bahasa Indonesia) explaining why you awarded that score.
5. Write feedback_text as a short paragraph for the student, plus concrete strengths (glow) and improvements (grow).
6. You MUST call the grade_answer function with your evaluation. Do not reply with free text.`;

export function composeSystemPrompt(userPrompt?: string): string {
  const base = userPrompt?.trim() || DEFAULT_PROMPT;
  return `${base}\n\n${IMPORTANT_NOTES}`;
}

export interface RubricCriterion {
  criterion: string;
  max: number;
}

export function buildUserPrompt(question: string, rubric?: RubricCriterion[]): string {
  const rubricBlock =
    rubric && rubric.length > 0
      ? `\n\nRubric (grade STRICTLY by these criteria only):\n` +
        rubric.map((r) => `- ${r.criterion}: max ${r.max} poin`).join("\n") +
        `\nTotal: ${rubric.reduce((s, r) => s + r.max, 0)} poin\n\nScore each criterion individually, then sum. Scale proportionally to 0–100 if total ≠ 100.`
      : "";
  return `Question: ${question}${rubricBlock}\n\nThe student has submitted handwritten answer(s). Please extract the text and grade it.`;
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
    description: "Overall score from 0 to 100.",
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
      max: { type: "number" },
      awarded: { type: "number" },
      reason: {
        type: "string",
        description: "One sentence in Bahasa Indonesia explaining why this score was awarded.",
      },
    },
    required: ["criterion", "max", "awarded", "reason"],
  },
  description:
    "One entry per rubric criterion. REQUIRED when a rubric is provided in the user message.",
};

const BASE_REQUIRED = [
  "extracted_text",
  "extraction_note",
  "score",
  "feedback_text",
  "strengths",
  "improvements",
];

export function buildGradeTool(hasRubric: boolean) {
  const required = hasRubric ? [...BASE_REQUIRED, "rubric_breakdown"] : BASE_REQUIRED;
  return {
    type: "function" as const,
    function: {
      name: "grade_answer",
      description: "Submit the grading result for the student's handwritten answer.",
      parameters: {
        type: "object",
        properties: { ...BASE_PROPERTIES, rubric_breakdown: RUBRIC_BREAKDOWN_PROPERTY },
        required,
      },
    },
  };
}

export const GRADE_TOOL = buildGradeTool(false);
