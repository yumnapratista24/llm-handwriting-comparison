import { ingestDocument } from "@/lib/rag";

export const runtime = "nodejs";

function err(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Ingest a source document into Pinecone. No Postgres — the client holds the
// returned ref in session state and sends documentIds on each grade request.
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return err("Body permintaan tidak valid", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return err("Tidak ada berkas materi", 400);

  const filename = file.name;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!["pdf", "doc", "docx"].includes(ext)) {
    return err("Format tidak didukung — gunakan PDF, DOC, atau DOCX", 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const ref = await ingestDocument(buffer, filename, ext);
    return Response.json(ref);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ingest gagal";
    console.error("[ingest]:", message);
    const status = /belum diset|tidak ada teks|kosong/i.test(message) ? 422 : 502;
    return err(`Gagal memproses materi: ${message}`, status);
  }
}
