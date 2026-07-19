// Source-material RAG over Pinecone (via LangChain). RAG only — no full-material mode.
//   - ingestDocument     → extract text, size-chunk, embed + upsert to Pinecone
//   - retrieveForGrading  → question(+answer)-keyed similarity search, union/dedupe
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { getVectorStore } from "@/lib/pinecone";

const RETRIEVE_K = 12; // chunks per query embedding
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 100;

// A chunk retrieved for grading. `document` is the filename (for citations).
export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  document: string;
  position: number;
  content: string;
}

async function extractText(ext: string, buffer: Buffer): Promise<string> {
  if (ext === "pdf") {
    const { extractText: extract, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extract(pdf, { mergePages: true });
    return text;
  }
  if (ext === "docx" || ext === "doc") {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }
  throw new Error("unsupported");
}

// Extract → size-chunk → embed + upsert. Vectors are keyed `${documentId}#${i}`;
// chunk metadata carries documentId/filename/position/chunkId for retrieval + citations.
export async function ingestDocument(
  buffer: Buffer,
  filename: string,
  ext: string,
): Promise<{ documentId: string; filename: string; chunkCount: number }> {
  const text = (await extractText(ext, buffer)).trim();
  if (!text) throw new Error("Tidak ada teks yang bisa diekstrak dari berkas");

  const documentId = crypto.randomUUID();
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });
  const parts = await splitter.splitText(text);
  if (!parts.length) throw new Error("Dokumen kosong setelah dipotong");

  const docs = parts.map(
    (content, i) =>
      new Document({
        pageContent: content,
        metadata: {
          documentId,
          filename,
          position: i,
          chunkId: `${documentId}#${i}`,
        },
      }),
  );
  const ids = docs.map((d) => d.metadata.chunkId as string);

  const store = await getVectorStore();
  await store.addDocuments(docs, { ids });

  return { documentId, filename, chunkCount: docs.length };
}

// Embed question (+ answer text when available), similarity-search each within the
// attached documents, union/dedupe, order by (document, position) for readability.
export async function retrieveForGrading(
  documentIds: string[],
  question: string,
  answerText?: string,
): Promise<RetrievedChunk[]> {
  if (documentIds.length === 0) return [];

  const queries = [question.trim()].filter(Boolean);
  if (answerText?.trim()) queries.push(answerText.trim());
  if (!queries.length) return [];

  const store = await getVectorStore();
  const filter = { documentId: { $in: documentIds } };

  const byId = new Map<string, RetrievedChunk>();
  for (const query of queries) {
    const results = await store.similaritySearch(query, RETRIEVE_K, filter);
    for (const doc of results) {
      const chunkId = (doc.metadata.chunkId as string) ?? "";
      if (!chunkId || byId.has(chunkId)) continue;
      byId.set(chunkId, {
        chunkId,
        documentId: (doc.metadata.documentId as string) ?? "",
        document: (doc.metadata.filename as string) ?? "",
        position: (doc.metadata.position as number) ?? 0,
        content: doc.pageContent,
      });
    }
  }

  return [...byId.values()].sort((a, b) =>
    a.documentId === b.documentId
      ? a.position - b.position
      : a.documentId.localeCompare(b.documentId),
  );
}
