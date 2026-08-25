// Browser-usable helpers over the Supabase storage bucket that holds answer
// uploads (images + PDFs). Object paths follow the batch-grading contract:
//   runs/{run_id}/answers/{answer_id}/{uuid}-{sanitized-filename}
// The bucket is PRIVATE — previews go through short-lived signed URLs.
import { getSupabase } from "@/lib/supabase";

export const GRADING_UPLOADS_BUCKET = "grading-uploads";

export interface UploadedFileRef {
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}

// Keep filenames storage-safe while staying human-readable: collapse anything
// that isn't a word char, dot, or dash into a single dash.
export function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, "-");
  const safe = trimmed.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-");
  const cleaned = safe.replace(/^[-.]+/, "").replace(/-+$/, "");
  return cleaned || "file";
}

export function answerObjectPath(
  runId: string,
  answerId: string,
  filename: string,
): string {
  const uuid = crypto.randomUUID();
  return `runs/${runId}/answers/${answerId}/${uuid}-${sanitizeFilename(filename)}`;
}

// Upload one answer file and return its storage ref (path + mime + size).
export async function uploadAnswerFile(
  runId: string,
  answerId: string,
  file: File,
): Promise<UploadedFileRef> {
  const supabase = getSupabase();
  const storagePath = answerObjectPath(runId, answerId, file.name);
  const { error } = await supabase.storage
    .from(GRADING_UPLOADS_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
  if (error) throw new Error(error.message);
  return {
    storagePath,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  };
}

// Short-lived signed URL for previewing a private object (default 1h).
export async function getSignedUrl(
  storagePath: string,
  expiresIn = 3600,
): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from(GRADING_UPLOADS_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error || !data) {
    throw new Error(error?.message ?? "Gagal membuat signed URL");
  }
  return data.signedUrl;
}

// Remove an uploaded object (best-effort cleanup when a file is detached).
export async function removeAnswerFile(storagePath: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.storage
    .from(GRADING_UPLOADS_BUCKET)
    .remove([storagePath]);
  if (error) throw new Error(error.message);
}
