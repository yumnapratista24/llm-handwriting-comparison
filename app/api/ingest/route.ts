import { ingestDocument } from "@/lib/rag";
import { readUploadedFile } from "@/lib/upload-relay";

export const runtime = "nodejs";

function err(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Ingest a source document into Pinecone. No Postgres — the client holds the
// returned ref in session state and sends documentIds on each grade request.
// Accepts JSON { storagePath, filename } (storage relay, no body-size cap) or
// legacy multipart form-data — see lib/upload-relay.ts.
export async function POST(request: Request) {
  const uploaded = await readUploadedFile(request);
  if (!uploaded) return err("Tidak ada berkas materi", 400);
  const { buffer, filename, cleanup } = uploaded;

  try {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "doc", "docx"].includes(ext)) {
      return err("Format tidak didukung — gunakan PDF, DOC, atau DOCX", 400);
    }

    try {
      const ref = await ingestDocument(buffer, filename, ext);
      return Response.json(ref);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Ingest gagal";
      console.error("[ingest]:", message);
      const status = /belum diset|tidak ada teks|kosong/i.test(message) ? 422 : 502;
      return err(`Gagal memproses materi: ${message}`, status);
    }
  } finally {
    await cleanup();
  }
}
