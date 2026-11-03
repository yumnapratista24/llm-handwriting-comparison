import type OpenAI from "openai";
import type { ChatCompletionsClient } from "./llm";

export const DERIVE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "define_topics",
    description:
      "Group the assessment's questions into coherent tutoring TOPICS, each carrying 1-3 masterable CHECKPOINTS defined from the question material.",
    parameters: {
      type: "object",
      properties: {
        topics: {
          type: "array",
          description:
            "Peer-level topics that together cover every source question (MECE-ish).",
          items: {
            type: "object",
            properties: {
              label: {
                type: "string",
                description:
                  "Short name of the coherent concept, e.g. 'Konsep OOP', 'Higher-order Functions'.",
              },
              description: {
                type: "string",
                description: "One-sentence scope of the topic (optional).",
              },
              checkpoints: {
                type: "array",
                description:
                  "1-2 checkpoints (soft max 3). Each is independently assessable and non-overlapping.",
                items: {
                  type: "object",
                  properties: {
                    label: {
                      type: "string",
                      description: "Short name of the masterable unit.",
                    },
                    descriptor: {
                      type: "string",
                      description:
                        "The scientific bar: what a student must demonstrate to have mastered this checkpoint. Grounded in the source questions' material, not in a rubric level.",
                    },
                    source_question_ids: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "The question ids (verbatim, from the list provided) this checkpoint covers.",
                    },
                  },
                  required: ["label", "descriptor", "source_question_ids"],
                },
              },
            },
            required: ["label", "checkpoints"],
          },
        },
      },
      required: ["topics"],
    },
  },
};

export interface DeriveQuestionInput {
  id: string;
  prompt: string;
  answerReference: string | null;
}

export interface DeriveLlmInput {
  assessmentTitle: string;
  course: string | null;
  major: string | null;
  questions: DeriveQuestionInput[];
  model: string;
}

export function buildSystemPrompt(): string {
  return `You are an expert curriculum designer decomposing an assessment into tutoring TOPICS and masterable CHECKPOINTS.

A TOPIC is a coherent cluster of concepts spanning one or more questions. A CHECKPOINT is a single unit of mastery a student must demonstrate — defined from the question material itself (prompt + model answer), NOT copied from a grading rubric. Each checkpoint carries a scientific 'descriptor' stating exactly what mastery looks like.

Rules you MUST follow:
1. UNIFORM GRANULARITY — all topics sit at a comparable, peer level. Do not mix one broad "paradigm" topic with narrow "sub-concept" topics.
2. ONE COHERENT CONCEPT PER TOPIC, with at most 2 checkpoints (soft maximum 3). Every checkpoint must be (a) grounded in the material of the topic's source questions, (b) independently assessable, and (c) non-overlapping with the others.
3. COLLECTIVELY COVER EVERY QUESTION in the assessment; keep overlap minimal (MECE-ish). Each question appears under at least one checkpoint's source_question_ids.
4. Split along a theory-vs-application axis ONLY when it is natural for the material — never force it.
5. Use ONLY the question ids given below in source_question_ids — verbatim, no invented ids.

You MUST call define_topics. Detect the language of the questions and write labels, descriptions, and descriptors in that same language.`;
}

export function buildUserPrompt(input: DeriveLlmInput): string {
  const ctxLines: string[] = [];
  ctxLines.push(`Assessment title: ${input.assessmentTitle}`);
  if (input.course) ctxLines.push(`Course (mata kuliah): ${input.course}`);
  if (input.major) ctxLines.push(`Major (jurusan): ${input.major}`);
  const context = ctxLines.join("\n");

  const questionBlocks = input.questions
    .map((q, i) => {
      const parts = [`[Question ${i + 1}] id: ${q.id}`, `Prompt: ${q.prompt}`];
      if (q.answerReference) parts.push(`Model answer: ${q.answerReference}`);
      return parts.join("\n");
    })
    .join("\n\n");

  return `Context (use it to pitch topics at the right level and terminology):
${context}

Group the following questions into topics + checkpoints:

${questionBlocks}`;
}

export interface DerivedCheckpointInput {
  label: string;
  descriptor: string;
  source_question_ids: string[];
}
export interface DerivedTopicInput {
  label: string;
  description?: string | null;
  checkpoints: DerivedCheckpointInput[];
}

export interface ValidatedCheckpoint {
  label: string;
  descriptor: string;
  sourceQuestionIds: string[];
}
export interface ValidatedTopic {
  label: string;
  description: string | null;
  orderIndex: number;
  checkpoints: ValidatedCheckpoint[];
}
export interface ValidationResult {
  topics: ValidatedTopic[];
  warnings: string[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function validateDerivedTopics(
  rawTopics: unknown,
  validQuestionIds: Iterable<string>,
): ValidationResult {
  const valid = new Set(validQuestionIds);
  const warnings: string[] = [];
  const topics: ValidatedTopic[] = [];

  const list = Array.isArray(rawTopics) ? rawTopics : [];
  if (!Array.isArray(rawTopics)) {
    warnings.push("derive-topics: model output `topics` was not an array");
  }

  for (const rawTopic of list) {
    const t = asRecord(rawTopic);
    if (!t) continue;
    const label = typeof t.label === "string" ? t.label.trim() : "";
    if (!label) {
      warnings.push("derive-topics: dropped a topic with a blank label");
      continue;
    }
    const description =
      typeof t.description === "string" && t.description.trim().length > 0
        ? t.description.trim()
        : null;

    const rawCps = Array.isArray(t.checkpoints) ? t.checkpoints : [];
    const checkpoints: ValidatedCheckpoint[] = [];
    for (const rawCp of rawCps) {
      const c = asRecord(rawCp);
      if (!c) continue;
      const cpLabel = typeof c.label === "string" ? c.label.trim() : "";
      const descriptor =
        typeof c.descriptor === "string" ? c.descriptor.trim() : "";
      if (!cpLabel || !descriptor) {
        warnings.push(
          `derive-topics: dropped a checkpoint under "${label}" with blank label/descriptor`,
        );
        continue;
      }
      const ids = Array.isArray(c.source_question_ids)
        ? c.source_question_ids
        : [];
      const seen = new Set<string>();
      const kept: string[] = [];
      for (const id of ids) {
        if (typeof id !== "string") continue;
        if (!valid.has(id)) {
          warnings.push(
            `derive-topics: checkpoint "${cpLabel}" referenced unknown question ${id} — dropped`,
          );
          continue;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        kept.push(id);
      }
      if (kept.length === 0) {
        warnings.push(
          `derive-topics: checkpoint "${cpLabel}" had no valid source questions — dropped`,
        );
        continue;
      }
      checkpoints.push({ label: cpLabel, descriptor, sourceQuestionIds: kept });
    }

    if (checkpoints.length === 0) {
      warnings.push(
        `derive-topics: topic "${label}" had no valid checkpoints — dropped`,
      );
      continue;
    }
    topics.push({
      label,
      description,
      orderIndex: topics.length,
      checkpoints,
    });
  }

  return { topics, warnings };
}

export const DERIVE_MAX_ATTEMPTS = 2;

export class DeriveTopicsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeriveTopicsError";
  }
}

function errorStatus(e: unknown): number {
  const status = (e as { status?: unknown })?.status;
  return typeof status === "number" ? status : 500;
}

export async function deriveTopicsLlm(
  input: DeriveLlmInput,
  client: ChatCompletionsClient,
  retryDelayMs = 500,
): Promise<DerivedTopicInput[]> {
  const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model: input.model,
    temperature: 0.2,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(input) },
    ],
    tools: [DERIVE_TOOL],
    tool_choice: { type: "function", function: { name: "define_topics" } },
  };

  let res: OpenAI.Chat.Completions.ChatCompletion | null = null;
  for (let attempt = 0; attempt < DERIVE_MAX_ATTEMPTS && !res; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
    try {
      res = await client.create(body);
    } catch (e) {
      const status = errorStatus(e);
      if (status >= 500 && status < 600 && attempt < DERIVE_MAX_ATTEMPTS - 1) continue;
      throw new DeriveTopicsError(e instanceof Error ? e.message : String(e));
    }
  }

  const toolCall = res?.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.type !== "function" || !toolCall.function.arguments) {
    throw new DeriveTopicsError("AI did not return a topic decomposition. Please try again.");
  }
  let parsed: { topics?: unknown };
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch {
    throw new DeriveTopicsError("Topic derivation result was not valid JSON.");
  }
  return Array.isArray(parsed.topics) ? (parsed.topics as DerivedTopicInput[]) : [];
}
