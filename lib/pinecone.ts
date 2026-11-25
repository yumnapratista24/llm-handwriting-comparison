// Pinecone + embeddings, wired through LangChain.
// Server-only: PINECONE_API_KEY / PINECONE_INDEX / OPENROUTER_API_KEY never reach the client.
// Embeddings are forced through OpenRouter (openai/text-embedding-3-small) — the
// same model the grading worker embeds queries with, so both sides share one
// 1536-d vector space. There is no direct OpenAI path anymore.
import { Pinecone } from "@pinecone-database/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PineconeStore } from "@langchain/pinecone";
import { OPENROUTER_EMBEDDING_MODEL, openRouterEmbeddings } from "@/lib/openrouter";

export const EMBEDDING_MODEL = OPENROUTER_EMBEDDING_MODEL; // 1536-d

let _pc: Pinecone | null = null;
let _embeddings: OpenAIEmbeddings | null = null;

function pinecone(): Pinecone {
  if (_pc) return _pc;
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) throw new Error("PINECONE_API_KEY belum diset di environment server (lokal: .env.local, deployment: Environment Variables)");
  _pc = new Pinecone({ apiKey });
  return _pc;
}

export function pineconeIndex() {
  const name = process.env.PINECONE_INDEX;
  if (!name) throw new Error("PINECONE_INDEX belum diset di environment server (lokal: .env.local, deployment: Environment Variables)");
  return pinecone().index(name);
}

export function embeddings(): OpenAIEmbeddings {
  if (_embeddings) return _embeddings;
  _embeddings = openRouterEmbeddings();
  return _embeddings;
}

// A PineconeStore bound to the index + embeddings. Reused for ingest + retrieval.
export function getVectorStore(): Promise<PineconeStore> {
  return PineconeStore.fromExistingIndex(embeddings(), {
    pineconeIndex: pineconeIndex(),
  });
}
