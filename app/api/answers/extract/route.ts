import { getServerSupabase } from "@/lib/supabase-server";
import { GRADING_UPLOADS_BUCKET } from "@/lib/storage";

export const runtime = "nodejs";

// Below this average of characters per page a PDF is almost certainly scanned
// (image-only), so the worker should send it as a file part for OCR instead of
// trusting the (near-empty) extracted text.
const SCANNED_CHARS_PER_PAGE = 40;

interface ExtractRequest {
  answerId?: string;
}

interface AnswerFileRow {
  storage_path: string;
}

function err(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Download a PDF answer from storage, extract its text with unpdf, and record
// answer_text + is_scanned on the grading_answers row.
export async function POST(request: Request) {
  let body: ExtractRequest;
  try {
    body = (await request.json()) as ExtractRequest;
  } catch {
    return err("Body permintaan tidak valid", 400);
  }

  const answerId = body.answerId?.trim();
  if (!answerId) return err("answerId kosong", 400);

  const supabase = getServerSupabase();

  const { data: answer, error: answerErr } = await supabase
    .from("grading_answers")
    .select("id, kind")
    .eq("id", answerId)
    .maybeSingle();
  if (answerErr) return err(`Gagal memuat jawaban: ${answerErr.message}`, 502);
  if (!answer) return err("Jawaban tidak ditemukan", 404);
  if (answer.kind !== "pdf") {
    return err("Ekstraksi hanya berlaku untuk jawaban PDF", 400);
  }

  const { data: files, error: filesErr } = await supabase
    .from("grading_answer_files")
    .select("storage_path")
    .eq("answer_id", answerId)
    .order("position", { ascending: true });
  if (filesErr) return err(`Gagal memuat berkas: ${filesErr.message}`, 502);
  const fileRows = (files ?? []) as AnswerFileRow[];
  if (!fileRows.length) return err("Berkas PDF jawaban tidak ditemukan", 404);

  const storagePath = fileRows[0].storage_path;
  const { data: blob, error: dlErr } = await supabase.storage
    .from(GRADING_UPLOADS_BUCKET)
    .download(storagePath);
  if (dlErr || !blob) {
    return err(`Gagal mengunduh berkas: ${dlErr?.message ?? "tidak ditemukan"}`, 502);
  }

  const buffer = new Uint8Array(await blob.arrayBuffer());

  let answerText: string;
  let totalPages: number;
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(buffer);
    const out = await extractText(pdf, { mergePages: true });
    answerText = out.text.trim();
    totalPages = out.totalPages;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ekstraksi teks gagal";
    console.error("[answers/extract]:", message);
    return err(`Gagal membaca PDF: ${message}`, 502);
  }

  const avgPerPage = totalPages > 0 ? answerText.length / totalPages : answerText.length;
  const isScanned = avgPerPage < SCANNED_CHARS_PER_PAGE;

  const { error: updErr } = await supabase
    .from("grading_answers")
    .update({
      answer_text: answerText,
      is_scanned: isScanned,
      status: "ready",
      error: null,
    })
    .eq("id", answerId);
  if (updErr) return err(`Gagal menyimpan hasil ekstraksi: ${updErr.message}`, 502);

  return Response.json({ answerText, isScanned });
}
