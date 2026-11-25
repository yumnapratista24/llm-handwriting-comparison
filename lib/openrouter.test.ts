// Enforces the "OpenRouter only" invariant: every AI call — chat or embedding —
// goes to https://openrouter.ai/api/v1, and no code path can silently fall back
// to a direct OpenAI (or any other vendor) endpoint.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OPENROUTER_BASE_URL,
  OPENROUTER_CHAT_COMPLETIONS_URL,
  OPENROUTER_EMBEDDING_MODEL,
  OPENROUTER_KEY_MISSING_MESSAGE,
  openRouterClient,
  openRouterEmbeddings,
  openRouterKey,
} from "./openrouter";

const ENV_KEYS = ["OPENROUTER_API_KEY", "OPENAI_API_KEY"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  delete process.env.OPENAI_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
});

interface CapturedCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function headersToObject(headers: unknown): Record<string, string> {
  if (!headers) return {};
  if (typeof (headers as Headers).forEach === "function") {
    const out: Record<string, string> = {};
    (headers as Headers).forEach((value, name) => {
      out[name.toLowerCase()] = value;
    });
    return out;
  }
  return Object.fromEntries(
    Object.entries(headers as Record<string, string>).map(([name, value]) => [
      name.toLowerCase(),
      String(value),
    ]),
  );
}

/** Stubs global fetch and records every call the OpenAI SDK makes. */
function stubFetch(response: unknown): CapturedCall[] {
  const calls: CapturedCall[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: unknown, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const rawBody = init?.body ?? (input instanceof Request ? await input.text() : undefined);
      calls.push({
        url,
        headers: headersToObject(init?.headers ?? (input instanceof Request ? input.headers : undefined)),
        body: typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody,
      });
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  return calls;
}

describe("forced OpenRouter routing", () => {
  it("sends chat completions to OpenRouter, never to api.openai.com", async () => {
    const calls = stubFetch({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "openai/gpt-4o",
      choices: [
        { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const res = await openRouterClient().chat.completions.create({
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "hai" }],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(OPENROUTER_CHAT_COMPLETIONS_URL);
    expect(calls[0].url).not.toContain("api.openai.com");
    expect(calls[0].headers.authorization).toBe("Bearer test-openrouter-key");
    expect(res.choices[0].message.content).toBe("ok");
  });

  it("sends embeddings to OpenRouter with the vendor-prefixed model id", async () => {
    const calls = stubFetch({
      object: "list",
      data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
      model: OPENROUTER_EMBEDDING_MODEL,
      usage: { prompt_tokens: 2, total_tokens: 2 },
    });

    const vector = await openRouterEmbeddings().embedQuery("materi soal");

    expect(vector).toEqual([0.1, 0.2, 0.3]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${OPENROUTER_BASE_URL}/embeddings`);
    expect(calls[0].url).not.toContain("api.openai.com");
    expect(calls[0].headers.authorization).toBe("Bearer test-openrouter-key");
    expect((calls[0].body as { model?: string }).model).toBe(OPENROUTER_EMBEDDING_MODEL);
    // Explicit float so the OpenAI SDK does not silently request base64 (its
    // default), which OpenRouter documents as float responses.
    expect((calls[0].body as { encoding_format?: string }).encoding_format).toBe("float");
  });

  it("does not fall back to OPENAI_API_KEY when OPENROUTER_API_KEY is unset", () => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.OPENAI_API_KEY = "sk-openai-credential-that-must-not-be-used";
    const calls = stubFetch({});

    expect(openRouterKey()).toBeUndefined();
    expect(() => openRouterClient()).toThrow(OPENROUTER_KEY_MISSING_MESSAGE);
    expect(() => openRouterEmbeddings()).toThrow(OPENROUTER_KEY_MISSING_MESSAGE);
    expect(calls).toEqual([]);
  });

  it("keeps every app/lib source file free of bare OpenAI clients and api.openai.com", () => {
    const repoRoot = fileURLToPath(new URL("..", import.meta.url));
    const offenders: string[] = [];

    for (const dir of ["app", "lib"]) {
      const entries = readdirSync(join(repoRoot, dir), { recursive: true }) as string[];
      for (const entry of entries) {
        if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
        const path = join(dir, entry).replace(/\\/g, "/");
        if (path === "lib/openrouter.ts" || path.endsWith(".test.ts")) continue;
        const source = readFileSync(join(repoRoot, path), "utf8");
        if (/new\s+OpenAI\s*\(/.test(source)) offenders.push(`${path}: bare new OpenAI(...)`);
        if (/api\.openai\.com/.test(source)) offenders.push(`${path}: hardcoded api.openai.com`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
