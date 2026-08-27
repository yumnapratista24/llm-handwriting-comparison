// Server-side reader for user file uploads that must not ride in the API
// request body: serverless platforms cap request bodies (~4.5MB on Vercel),
// which made larger rubric/source-material PDFs fail with "content too large".
//
// Two accepted modes:
//   - JSON { storagePath, filename }: the browser already uploaded the file to
//     the grading-uploads bucket under tmp/ (lib/storage.ts uploadTransientFile);
//     we download it here and delete it via cleanup() when processing is done.
//   - multipart/form-data with a `file` field: the legacy direct upload, kept
//     for small files and backward compatibility.
import { getServerSupabase } from "@/lib/supabase-server";
import { GRADING_UPLOADS_BUCKET } from "@/lib/storage";

export interface RelayedFile {
  buffer: Buffer;
  filename: string;
  // Best-effort removal of the tmp/ relay object (no-op for form uploads).
  cleanup: () => Promise<void>;
}

export async function readUploadedFile(
  request: Request,
): Promise<RelayedFile | null> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    let body: { storagePath?: string; filename?: string };
    try {
      body = (await request.json()) as { storagePath?: string; filename?: string };
    } catch {
      return null;
    }
    const storagePath = body.storagePath?.trim();
    // Only relay objects may be fetched through this path.
    if (!storagePath || !storagePath.startsWith("tmp/")) return null;

    const supabase = getServerSupabase();
    const { data, error } = await supabase.storage
      .from(GRADING_UPLOADS_BUCKET)
      .download(storagePath);
    if (error || !data) return null;

    return {
      buffer: Buffer.from(await data.arrayBuffer()),
      filename: body.filename?.trim() || storagePath.split("/").pop() || "berkas",
      cleanup: async () => {
        const { error: rmErr } = await supabase.storage
          .from(GRADING_UPLOADS_BUCKET)
          .remove([storagePath]);
        if (rmErr) console.error("[upload-relay] cleanup:", rmErr.message);
      },
    };
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return null;
  }
  const file = form.get("file");
  if (!(file instanceof File)) return null;
  return {
    buffer: Buffer.from(await file.arrayBuffer()),
    filename: file.name,
    cleanup: async () => {},
  };
}
