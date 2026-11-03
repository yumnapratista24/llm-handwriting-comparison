import assert from "node:assert/strict";
import { describe, expect, it, test } from "vitest";
import type OpenAI from "openai";
import {
  DERIVE_TOOL,
  DeriveTopicsError,
  buildSystemPrompt,
  buildUserPrompt,
  deriveTopicsLlm,
  validateDerivedTopics,
} from "./deriveTopics";
import type { ChatCompletionsClient } from "./llm";

test("validateDerivedTopics: keeps well-formed topics, assigns dense order", () => {
  const raw = [
    {
      label: "Topik A",
      description: "desc",
      checkpoints: [
        { label: "CP1", descriptor: "d1", source_question_ids: ["q1", "q2"] },
      ],
    },
    {
      label: "Topik B",
      checkpoints: [
        { label: "CP2", descriptor: "d2", source_question_ids: ["q2"] },
      ],
    },
  ];
  const { topics, warnings } = validateDerivedTopics(raw, ["q1", "q2"]);
  assert.equal(topics.length, 2);
  assert.equal(topics[0].orderIndex, 0);
  assert.equal(topics[1].orderIndex, 1);
  assert.equal(topics[0].description, "desc");
  assert.equal(topics[1].description, null);
  assert.deepEqual(topics[0].checkpoints[0].sourceQuestionIds, ["q1", "q2"]);
  assert.equal(warnings.length, 0);
});

test("validateDerivedTopics: drops unknown question ids and dedupes", () => {
  const raw = [
    {
      label: "T",
      checkpoints: [
        { label: "CP", descriptor: "d", source_question_ids: ["q1", "ghost", "q1"] },
      ],
    },
  ];
  const { topics, warnings } = validateDerivedTopics(raw, ["q1"]);
  assert.deepEqual(topics[0].checkpoints[0].sourceQuestionIds, ["q1"]);
  assert.ok(warnings.some((w) => w.includes("ghost")));
});

test("validateDerivedTopics: drops checkpoint with no valid sources, then empty topic", () => {
  const raw = [
    {
      label: "T",
      checkpoints: [
        { label: "CP", descriptor: "d", source_question_ids: ["ghost"] },
      ],
    },
  ];
  const { topics } = validateDerivedTopics(raw, ["q1"]);
  assert.equal(topics.length, 0);
});

test("validateDerivedTopics: drops blank labels/descriptors", () => {
  const raw = [
    { label: "  ", checkpoints: [{ label: "x", descriptor: "d", source_question_ids: ["q1"] }] },
    {
      label: "Good",
      checkpoints: [
        { label: "", descriptor: "d", source_question_ids: ["q1"] },
        { label: "ok", descriptor: "", source_question_ids: ["q1"] },
        { label: "keep", descriptor: "d", source_question_ids: ["q1"] },
      ],
    },
  ];
  const { topics } = validateDerivedTopics(raw, ["q1"]);
  assert.equal(topics.length, 1);
  assert.equal(topics[0].label, "Good");
  assert.equal(topics[0].checkpoints.length, 1);
  assert.equal(topics[0].checkpoints[0].label, "keep");
});

test("validateDerivedTopics: non-array input → empty + warning", () => {
  const { topics, warnings } = validateDerivedTopics(null, ["q1"]);
  assert.equal(topics.length, 0);
  assert.ok(warnings.some((w) => w.includes("not an array")));
});

type CreateBody = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

function completion(args: string | null): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: "c1",
    object: "chat.completion",
    created: 0,
    model: "m",
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        logprobs: null,
        message: {
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls:
            args === null
              ? []
              : [{ id: "t1", type: "function", function: { name: "define_topics", arguments: args } }],
        },
      },
    ],
  };
}

function client(...responses: Array<OpenAI.Chat.Completions.ChatCompletion | Error>) {
  const calls: CreateBody[] = [];
  const c: ChatCompletionsClient = {
    async create(body) {
      calls.push(body);
      const next = responses.shift();
      if (!next) throw new Error("no more responses");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { c, calls };
}

const INPUT = {
  assessmentTitle: "Kuis 1",
  course: null,
  major: null,
  questions: [{ id: "run-1", prompt: "Jelaskan OOP", answerReference: null }],
  model: "openai/gpt-5.6",
};

describe("deriveTopicsLlm", () => {
  it("sends Binder's forced tool call and parses topics", async () => {
    const topics = [{ label: "OOP", checkpoints: [{ label: "Enkapsulasi", descriptor: "d", source_question_ids: ["run-1"] }] }];
    const { c, calls } = client(completion(JSON.stringify({ topics })));
    expect(await deriveTopicsLlm(INPUT, c, 0)).toEqual(topics);
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("openai/gpt-5.6");
    expect(calls[0].temperature).toBe(0.2);
    expect(calls[0].tools).toEqual([DERIVE_TOOL]);
    expect(calls[0].tool_choice).toEqual({ type: "function", function: { name: "define_topics" } });
    expect(calls[0].messages).toEqual([
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(INPUT) },
    ]);
  });

  it("builds the user prompt from title and questions", () => {
    expect(buildUserPrompt(INPUT)).toBe(
      "Context (use it to pitch topics at the right level and terminology):\nAssessment title: Kuis 1\n\nGroup the following questions into topics + checkpoints:\n\n[Question 1] id: run-1\nPrompt: Jelaskan OOP",
    );
  });

  it("retries once on a 5xx error", async () => {
    const err = Object.assign(new Error("upstream"), { status: 503 });
    const { c, calls } = client(err, completion(JSON.stringify({ topics: [] })));
    expect(await deriveTopicsLlm(INPUT, c, 0)).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it("does not retry a 4xx error", async () => {
    const err = Object.assign(new Error("bad request"), { status: 400 });
    const { c, calls } = client(err, completion("{}"));
    await expect(deriveTopicsLlm(INPUT, c, 0)).rejects.toBeInstanceOf(DeriveTopicsError);
    expect(calls).toHaveLength(1);
  });

  it("fails when no tool call comes back", async () => {
    const { c } = client(completion(null));
    await expect(deriveTopicsLlm(INPUT, c, 0)).rejects.toThrow("AI did not return a topic decomposition");
  });

  it("fails on invalid JSON arguments", async () => {
    const { c } = client(completion("{not json"));
    await expect(deriveTopicsLlm(INPUT, c, 0)).rejects.toThrow("not valid JSON");
  });

  it("returns an empty list when topics is not an array", async () => {
    const { c } = client(completion(JSON.stringify({ topics: "x" })));
    expect(await deriveTopicsLlm(INPUT, c, 0)).toEqual([]);
  });
});
