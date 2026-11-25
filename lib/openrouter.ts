// Single source of truth for the ONE AI provider this app talks to.
//
// All chat/completion and embedding traffic must go through OpenRouter
// (https://openrouter.ai/api/v1), which speaks the OpenAI-compatible protocol.
// Nothing else in this repo may construct a bare OpenAI client or hit
// api.openai.com directly — `lib/openrouter.test.ts` enforces that invariant,
// and the only accepted credential is OPENROUTER_API_KEY (we never fall back to
// OPENAI_API_KEY, even when it is present in the environment).
import OpenAI from "openai";
import { OpenAIEmbeddings } from "@langchain/openai";

/** OpenRouter API base. Every client must be pointed at this base URL. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Raw-fetch endpoint used by the in-process batch executor (lib/job-executor.ts). */
export const OPENROUTER_CHAT_COMPLETIONS_URL = `${OPENROUTER_BASE_URL}/chat/completions`;

/**
 * OpenRouter serves OpenAI's embedding models under a vendor-prefixed id.
 * 1536-d — must stay in sync with the Pinecone index dimension (`first-index`).
 * The grading worker embeds with the same id, so ingest + retrieval share one
 * vector space.
 */
export const OPENROUTER_EMBEDDING_MODEL = "openai/text-embedding-3-small";

export const OPENROUTER_KEY_MISSING_MESSAGE =
  "OPENROUTER_API_KEY belum diset di environment server (lokal: .env.local, deployment: Environment Variables)";

/** Trimmed OpenRouter key, or undefined when unset/blank. */
export function openRouterKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY?.trim() || undefined;
}

/** OpenAI-protocol client bound to OpenRouter — never to api.openai.com. */
export function openRouterClient(apiKey?: string): OpenAI {
  const key = apiKey?.trim() || openRouterKey();
  if (!key) throw new Error(OPENROUTER_KEY_MISSING_MESSAGE);
  return new OpenAI({ apiKey: key, baseURL: OPENROUTER_BASE_URL });
}

/**
 * LangChain embeddings bound to OpenRouter. `dimensions` is intentionally not
 * set: text-embedding-3-small's native 1536-d output is what the Pinecone index
 * already stores. `encodingFormat: "float"` is explicit because the OpenAI SDK
 * otherwise defaults to "base64", while OpenRouter documents float embeddings.
 */
export function openRouterEmbeddings(apiKey?: string): OpenAIEmbeddings {
  const key = apiKey?.trim() || openRouterKey();
  if (!key) throw new Error(OPENROUTER_KEY_MISSING_MESSAGE);
  return new OpenAIEmbeddings({
    apiKey: key,
    model: OPENROUTER_EMBEDDING_MODEL,
    encodingFormat: "float",
    configuration: { baseURL: OPENROUTER_BASE_URL },
  });
}
