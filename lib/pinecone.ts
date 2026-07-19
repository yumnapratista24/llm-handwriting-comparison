// Pinecone + OpenAI embeddings, wired through LangChain.
// Server-only: PINECONE_API_KEY / PINECONE_INDEX / OPENAI_API_KEY never reach the client.
// Grading still goes through the SumoPod proxy; only embeddings hit OpenAI directly.
import { Pinecone } from "@pinecone-database/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PineconeStore } from "@langchain/pinecone";

export const EMBEDDING_MODEL = "text-embedding-3-small"; // 1536-d

let _pc: Pinecone | null = null;
let _embeddings: OpenAIEmbeddings | null = null;

function pinecone(): Pinecone {
  if (_pc) return _pc;
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) throw new Error("PINECONE_API_KEY belum diset di .env.local");
  _pc = new Pinecone({ apiKey });
  return _pc;
}

export function pineconeIndex() {
  const name = process.env.PINECONE_INDEX;
  if (!name) throw new Error("PINECONE_INDEX belum diset di .env.local");
  return pinecone().index(name);
}

export function embeddings(): OpenAIEmbeddings {
  if (_embeddings) return _embeddings;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY belum diset di .env.local");
  _embeddings = new OpenAIEmbeddings({ apiKey, model: EMBEDDING_MODEL });
  return _embeddings;
}

// A PineconeStore bound to the index + embeddings. Reused for ingest + retrieval.
export function getVectorStore(): Promise<PineconeStore> {
  return PineconeStore.fromExistingIndex(embeddings(), {
    pineconeIndex: pineconeIndex(),
  });
}
