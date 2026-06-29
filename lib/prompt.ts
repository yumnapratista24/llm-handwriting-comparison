// Grading prompt + grade_answer tool schema.
// DEFAULT_PROMPT is the editable system prompt shown in the PromptDrawer.
// The question is always sent in the user message — no {{soal}} token needed.

export const DEFAULT_PROMPT =
  `You are an expert academic grader. First, extract the text from the handwritten answer image(s), then grade it.

Language: Bahasa Indonesia (semua teks keluaran harus dalam Bahasa Indonesia).
Feedback Style: Use Glow and Grow format: Start with strengths (Glow), then suggest specific improvements (Grow).

No specific rubric provided. Evaluate based on accuracy, completeness, and clarity.

IMPORTANT:
1. First extract and transcribe the handwritten text from the image(s) verbatim into extracted_text.
2. In extraction_note, give one short caveat about the transcription's reliability — note any faded/ambiguous words or likely misreads, or state that everything was read clearly.
3. Grade the content and give an overall score from 0 to 100.
4. Write feedback_text as a short paragraph for the student, plus concrete strengths (glow) and improvements (grow).
5. You MUST call the grade_answer function with your evaluation. Do not reply with free text.`;

export function buildUserPrompt(question: string): string {
  return `Question: ${question}

The student has submitted handwritten answer(s). Please extract the text and grade it.`;
}

export const GRADE_TOOL = {
  type: "function" as const,
  function: {
    name: "grade_answer",
    description: "Submit the grading result for the student's handwritten answer.",
    parameters: {
      type: "object",
      properties: {
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
          description: "Concrete strengths of the answer (glow).",
        },
        improvements: {
          type: "array",
          items: { type: "string" },
          description: "Concrete, actionable improvements (grow).",
        },
      },
      required: ["extracted_text", "extraction_note", "score", "feedback_text", "strengths", "improvements"],
    },
  },
};
