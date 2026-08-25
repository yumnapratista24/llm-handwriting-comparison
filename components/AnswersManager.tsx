"use client";

// Batch answer intake: bulk drop/pick of up to 50 student answers (images or
// PDF, one file = one new entry), with a per-entry typed-text alternative,
// editable labels, per-entry multi-image support (max 5), and immediate
// upload to Supabase storage + grading_answers/grading_answer_files.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  addAnswerFile,
  createAnswer,
  deleteAnswer,
  deleteAnswerFile,
  updateAnswer,
} from "@/lib/db";
import { getSignedUrl, removeAnswerFile, uploadAnswerFile } from "@/lib/storage";
import type { AnswerKind, AnswerStatus } from "@/lib/models";

const MAX_ANSWERS = 50;
const MAX_IMAGES_PER_ANSWER = 5;
// Bulk uploads run through a small worker pool instead of one-by-one: enough
// parallelism to hide network latency without saturating the browser's
// per-host connection budget or the extract endpoint.
const UPLOAD_CONCURRENCY = 5;

// Run `worker` over `items` with at most `limit` in flight at once.
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]);
    }
  });
  await Promise.all(lanes);
}

export interface AnswerFileState {
  id: string; // grading_answer_files.id once persisted, temp id while uploading
  name: string;
  storagePath?: string;
  mimeType?: string | null;
  uploadStatus: "uploading" | "done" | "error";
  errorMessage?: string;
  previewUrl?: string; // populated for images: object URL immediately, then a signed URL
}

export interface AnswerEntryState {
  id: string; // grading_answers.id
  position: number;
  studentLabel: string;
  kind: AnswerKind;
  answerText: string;
  extractionNote?: string | null;
  isScanned: boolean;
  status: AnswerStatus;
  error?: string | null;
  files: AnswerFileState[];
  extracting: boolean;
  // True from bulk-drop reservation until this entry's row/upload/extraction
  // pipeline finishes — keeps Generate blocked while the pool is draining.
  preparing?: boolean;
}

interface Props {
  answers: AnswerEntryState[];
  onAnswersChange: (updater: (prev: AnswerEntryState[]) => AnswerEntryState[]) => void;
  ensureRunId: () => Promise<string>;
  runId: string | null;
  accent: string;
}

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  letterSpacing: ".13em",
  color: "#a2967f",
  fontWeight: 500,
};

function nextLabel(answers: AnswerEntryState[]): string {
  return `Siswa ${answers.length + 1}`;
}

function isImageFile(f: File) {
  return f.type.startsWith("image/");
}
function isPdfFile(f: File) {
  return f.type === "application/pdf" || /\.pdf$/i.test(f.name);
}

export default function AnswersManager({
  answers,
  onAnswersChange,
  ensureRunId,
  runId,
  accent,
}: Props) {
  const bulkFileRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [limitNotice, setLimitNotice] = useState<string | null>(null);

  // "Latest ref" escape hatch: handleBulkFiles awaits addEntryFromFile
  // sequentially (uploads + PDF extraction in between), so the `answers` prop
  // captured in any single closure goes stale well before the loop finishes.
  // Reading this ref instead of the prop keeps position/label/cap checks
  // correct across the whole batch. Mutating refs during render is not
  // allowed, so this syncs post-commit; every mutating path below also awaits
  // a real network call before its next read, which gives React time to
  // commit + flush this effect first.
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const patchEntry = useCallback(
    (answerId: string, patch: Partial<AnswerEntryState>) => {
      onAnswersChange((prev) =>
        prev.map((a) => (a.id === answerId ? { ...a, ...patch } : a)),
      );
    },
    [onAnswersChange],
  );

  const patchFile = useCallback(
    (answerId: string, fileId: string, patch: Partial<AnswerFileState>) => {
      onAnswersChange((prev) =>
        prev.map((a) =>
          a.id !== answerId
            ? a
            : { ...a, files: a.files.map((f) => (f.id === fileId ? { ...f, ...patch } : f)) },
        ),
      );
    },
    [onAnswersChange],
  );

  // Extract text from a freshly uploaded PDF and reflect the result on the entry.
  const extractPdf = useCallback(
    async (answerId: string) => {
      patchEntry(answerId, { extracting: true });
      try {
        const res = await fetch("/api/answers/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answerId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
        patchEntry(answerId, {
          answerText: data.answerText ?? "",
          isScanned: !!data.isScanned,
          status: "ready",
          error: null,
          extracting: false,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Gagal membaca PDF";
        await updateAnswer(answerId, { status: "error", error: message }).catch(() => {});
        patchEntry(answerId, { status: "error", error: message, extracting: false });
      }
    },
    [patchEntry],
  );

  // Upload one file into an entry (existing or newly created), persist the
  // grading_answer_files row, and — for PDFs — kick off extraction after.
  const uploadIntoEntry = useCallback(
    async (rId: string, answerId: string, file: File, position: number) => {
      const tempId = `tmp-${crypto.randomUUID()}`;
      const previewUrl = isImageFile(file) ? URL.createObjectURL(file) : undefined;
      onAnswersChange((prev) =>
        prev.map((a) =>
          a.id !== answerId
            ? a
            : {
                ...a,
                files: [
                  ...a.files,
                  {
                    id: tempId,
                    name: file.name,
                    uploadStatus: "uploading",
                    previewUrl,
                  },
                ],
              },
        ),
      );

      try {
        const ref = await uploadAnswerFile(rId, answerId, file);
        const fileId = await addAnswerFile({
          answerId,
          position,
          storagePath: ref.storagePath,
          mimeType: ref.mimeType,
          sizeBytes: ref.sizeBytes,
        });
        patchFile(answerId, tempId, {
          id: fileId,
          storagePath: ref.storagePath,
          mimeType: ref.mimeType,
          uploadStatus: "done",
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Gagal mengunggah berkas";
        patchFile(answerId, tempId, { uploadStatus: "error", errorMessage: message });
      }
    },
    [onAnswersChange, patchFile],
  );

  // Bulk drop/pick: each file becomes its own new entry (images and PDFs may
  // be mixed in one drop). Entries are RESERVED synchronously first — stable
  // ids/positions/labels computed from the drop-time snapshot — then the
  // row-insert + upload + PDF-extraction pipelines run concurrently through a
  // small worker pool instead of one file at a time.
  const handleBulkFiles = useCallback(
    async (list: FileList | null) => {
      const files = Array.from(list ?? []).filter((f) => isImageFile(f) || isPdfFile(f));
      if (!files.length) return;
      setLimitNotice(null);

      const rId = await ensureRunId();
      const snapshot = answersRef.current;
      const room = MAX_ANSWERS - snapshot.length;
      if (files.length > room) {
        setLimitNotice(
          room <= 0
            ? `Maksimum ${MAX_ANSWERS} jawaban per run — sudah penuh.`
            : `Hanya ${room} berkas pertama yang ditambahkan (maksimum ${MAX_ANSWERS} jawaban).`,
        );
      }
      const toAdd = files.slice(0, Math.max(0, room));
      if (!toAdd.length) return;

      const reserved = toAdd.map((file, i) => ({
        file,
        entry: {
          id: crypto.randomUUID(),
          position: snapshot.length + i,
          studentLabel: `Siswa ${snapshot.length + i + 1}`,
          kind: (isImageFile(file) ? "images" : "pdf") as AnswerKind,
          answerText: "",
          isScanned: false,
          status: "ready" as AnswerStatus,
          files: [],
          extracting: false,
          preparing: true,
        } satisfies AnswerEntryState,
      }));

      // Update the ref synchronously (not just via the async setState) so an
      // overlapping second drop sees these entries for its cap/position math
      // even if React hasn't re-rendered yet.
      answersRef.current = [...answersRef.current, ...reserved.map((r) => r.entry)];
      onAnswersChange((prev) => [...prev, ...reserved.map((r) => r.entry)]);

      await runWithConcurrency(reserved, UPLOAD_CONCURRENCY, async ({ file, entry }) => {
        try {
          // Removed by the user while still waiting in the pool → skip, so we
          // don't resurrect a row deleteAnswer already (no-op) deleted.
          if (!answersRef.current.some((a) => a.id === entry.id)) return;
          try {
            await createAnswer({
              id: entry.id,
              runId: rId,
              position: entry.position,
              studentLabel: entry.studentLabel,
              kind: entry.kind,
              status: "ready",
            });
          } catch (e) {
            console.error("[AnswersManager] createAnswer:", e);
            patchEntry(entry.id, { status: "error", error: "Gagal menyimpan entri jawaban" });
            return;
          }
          await uploadIntoEntry(rId, entry.id, file, 0);
          if (entry.kind === "pdf") await extractPdf(entry.id);
        } finally {
          patchEntry(entry.id, { preparing: false });
        }
      });
    },
    [ensureRunId, extractPdf, onAnswersChange, patchEntry, uploadIntoEntry],
  );

  // Add more images to an existing images-kind entry (max 5 total).
  const addImagesToEntry = useCallback(
    async (answerId: string, list: FileList | null) => {
      if (!runId) return;
      const entry = answersRef.current.find((a) => a.id === answerId);
      if (!entry) return;
      const room = MAX_IMAGES_PER_ANSWER - entry.files.length;
      const files = Array.from(list ?? [])
        .filter(isImageFile)
        .slice(0, Math.max(0, room));
      // Positions are precomputed from the snapshot, so the uploads are
      // independent — run them concurrently.
      await Promise.all(
        files.map((f, i) => uploadIntoEntry(runId, answerId, f, entry.files.length + i)),
      );
    },
    [runId, uploadIntoEntry],
  );

  // Replace a pdf-kind entry's single file.
  const replacePdf = useCallback(
    async (answerId: string, file: File) => {
      if (!runId || !isPdfFile(file)) return;
      const entry = answersRef.current.find((a) => a.id === answerId);
      if (!entry) return;
      for (const f of entry.files) {
        if (f.storagePath) await removeAnswerFile(f.storagePath).catch(() => {});
        if (!f.id.startsWith("tmp-")) await deleteAnswerFile(f.id).catch(() => {});
      }
      patchEntry(answerId, { files: [], answerText: "", isScanned: false, status: "ready", error: null });
      await uploadIntoEntry(runId, answerId, file, 0);
      await extractPdf(answerId);
    },
    [extractPdf, patchEntry, runId, uploadIntoEntry],
  );

  const removeFileFromEntry = useCallback(
    async (answerId: string, file: AnswerFileState) => {
      if (file.storagePath) await removeAnswerFile(file.storagePath).catch(() => {});
      if (!file.id.startsWith("tmp-")) await deleteAnswerFile(file.id).catch(() => {});
      onAnswersChange((prev) =>
        prev.map((a) =>
          a.id !== answerId ? a : { ...a, files: a.files.filter((f) => f.id !== file.id) },
        ),
      );
    },
    [onAnswersChange],
  );

  const removeEntry = useCallback(
    async (answerId: string) => {
      const entry = answersRef.current.find((a) => a.id === answerId);
      if (entry) {
        for (const f of entry.files) {
          if (f.storagePath) await removeAnswerFile(f.storagePath).catch(() => {});
        }
      }
      await deleteAnswer(answerId, runId ?? undefined).catch((e) =>
        console.error("[AnswersManager] deleteAnswer:", e),
      );
      onAnswersChange((prev) => prev.filter((a) => a.id !== answerId));
    },
    [onAnswersChange, runId],
  );

  const renameEntry = useCallback(
    (answerId: string, label: string) => {
      patchEntry(answerId, { studentLabel: label });
      updateAnswer(answerId, { studentLabel: label }).catch((e) =>
        console.error("[AnswersManager] rename:", e),
      );
    },
    [patchEntry],
  );

  // Text-mode: create a brand-new blank text entry.
  const addBlankTextEntry = useCallback(async () => {
    const snapshot = answersRef.current;
    if (snapshot.length >= MAX_ANSWERS) {
      setLimitNotice(`Maksimum ${MAX_ANSWERS} jawaban per run.`);
      return;
    }
    const rId = await ensureRunId();
    const label = nextLabel(snapshot);
    const position = snapshot.length;
    let createdId: string;
    try {
      createdId = await createAnswer({
        runId: rId,
        position,
        studentLabel: label,
        kind: "text",
        status: "ready",
      });
    } catch (e) {
      console.error("[AnswersManager] createAnswer(text):", e);
      return;
    }
    const entry: AnswerEntryState = {
      id: createdId,
      position,
      studentLabel: label,
      kind: "text",
      answerText: "",
      isScanned: false,
      status: "ready",
      files: [],
      extracting: false,
    };
    answersRef.current = [...answersRef.current, entry];
    onAnswersChange((prev) => [...prev, entry]);
  }, [ensureRunId, onAnswersChange]);

  // Switch a file-kind entry to typed text: detach its files and flip kind.
  const switchToText = useCallback(
    async (answerId: string) => {
      const entry = answersRef.current.find((a) => a.id === answerId);
      if (!entry) return;
      for (const f of entry.files) {
        if (f.storagePath) await removeAnswerFile(f.storagePath).catch(() => {});
        if (!f.id.startsWith("tmp-")) await deleteAnswerFile(f.id).catch(() => {});
      }
      patchEntry(answerId, { kind: "text", files: [], isScanned: false, status: "ready", error: null });
      await updateAnswer(answerId, { kind: "text", isScanned: false, status: "ready", error: null }).catch(
        (e) => console.error("[AnswersManager] switchToText:", e),
      );
    },
    [patchEntry],
  );

  const commitAnswerText = useCallback(
    (answerId: string, text: string) => {
      updateAnswer(answerId, { answerText: text }).catch((e) =>
        console.error("[AnswersManager] answerText:", e),
      );
    },
    [],
  );

  const busy = answers.some(
    (a) =>
      a.preparing || a.extracting || a.files.some((f) => f.uploadStatus === "uploading"),
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 11,
        }}
      >
        <span style={labelStyle}>JAWABAN SISWA</span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: answers.length >= MAX_ANSWERS ? "#a8472f" : "#9a8e79",
          }}
        >
          {answers.length} / {MAX_ANSWERS}
          {busy ? " · mengunggah…" : ""}
        </span>
      </div>

      {/* bulk dropzone */}
      <div
        onClick={() => bulkFileRef.current?.click()}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          handleBulkFiles(e.dataTransfer.files);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        style={{
          border: `1.5px dashed ${dragActive ? accent : "#d8cdb6"}`,
          borderRadius: 9,
          background: dragActive ? "#f6efd9" : "#fbf7ee",
          padding: 18,
          textAlign: "center",
          cursor: "pointer",
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 13, color: "#6b6151", fontWeight: 500 }}>
          Tarik banyak berkas ke sini atau <span style={{ color: accent }}>telusuri</span>
        </div>
        <div style={{ fontSize: 11, color: "#a2967f", marginTop: 3 }}>
          JPG / PNG / PDF · setiap berkas menjadi satu entri siswa baru
        </div>
      </div>

      <input
        ref={bulkFileRef}
        type="file"
        accept="image/*,.pdf,application/pdf"
        multiple
        onChange={(e) => {
          handleBulkFiles(e.target.files);
          e.target.value = "";
        }}
        style={{ display: "none" }}
      />

      {limitNotice && (
        <div style={{ marginBottom: 12, fontSize: 11.5, color: "#9a4632" }}>{limitNotice}</div>
      )}

      {answers.length === 0 ? (
        <div
          style={{
            padding: "22px 14px",
            textAlign: "center",
            fontSize: 12.5,
            color: "#c4b89f",
            fontStyle: "italic",
          }}
        >
          Belum ada jawaban siswa. Tarik berkas di atas, atau tambahkan entri teks.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          {answers.map((entry) => (
            <AnswerCard
              key={entry.id}
              entry={entry}
              accent={accent}
              onRename={(label) => renameEntry(entry.id, label)}
              onRemove={() => removeEntry(entry.id)}
              onRemoveFile={(f) => removeFileFromEntry(entry.id, f)}
              onAddImages={(list) => addImagesToEntry(entry.id, list)}
              onReplacePdf={(file) => replacePdf(entry.id, file)}
              onSwitchToText={() => switchToText(entry.id)}
              onAnswerTextChange={(text) => patchEntry(entry.id, { answerText: text })}
              onAnswerTextCommit={(text) => commitAnswerText(entry.id, text)}
              onAttachFile={async (file) => {
                if (!runId) return;
                // The entry was text-kind — flip its kind first, otherwise
                // /api/batch-grade keeps treating it as a (now empty) text
                // answer and ignores the uploaded file entirely.
                if (isImageFile(file)) {
                  patchEntry(entry.id, { kind: "images" });
                  await updateAnswer(entry.id, { kind: "images" }).catch((e) =>
                    console.error("[AnswersManager] attach kind:", e),
                  );
                  await uploadIntoEntry(runId, entry.id, file, entry.files.length);
                } else if (isPdfFile(file)) {
                  patchEntry(entry.id, { kind: "pdf" });
                  await updateAnswer(entry.id, { kind: "pdf" }).catch((e) =>
                    console.error("[AnswersManager] attach kind:", e),
                  );
                  await uploadIntoEntry(runId, entry.id, file, 0);
                  await extractPdf(entry.id);
                }
              }}
            />
          ))}
        </div>
      )}

      <button
        onClick={addBlankTextEntry}
        disabled={answers.length >= MAX_ANSWERS}
        style={{
          marginTop: 12,
          border: "1px solid #e3d9c5",
          background: "#fffdf7",
          borderRadius: 7,
          padding: "7px 13px",
          fontSize: 12,
          color: answers.length >= MAX_ANSWERS ? "#c4b89f" : "#5a5142",
          cursor: answers.length >= MAX_ANSWERS ? "default" : "pointer",
        }}
      >
        + Tambah Siswa (ketik jawaban)
      </button>
    </div>
  );
}

// ── entry card ────────────────────────────────────────────────────────────────

interface CardProps {
  entry: AnswerEntryState;
  accent: string;
  onRename: (label: string) => void;
  onRemove: () => void;
  onRemoveFile: (f: AnswerFileState) => void;
  onAddImages: (list: FileList | null) => void;
  onReplacePdf: (file: File) => void;
  onSwitchToText: () => void;
  onAnswerTextChange: (text: string) => void;
  onAnswerTextCommit: (text: string) => void;
  onAttachFile: (file: File) => void;
}

function AnswerCard({
  entry,
  accent,
  onRename,
  onRemove,
  onRemoveFile,
  onAddImages,
  onReplacePdf,
  onSwitchToText,
  onAnswerTextChange,
  onAnswerTextCommit,
  onAttachFile,
}: CardProps) {
  const imgRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);

  return (
    <div
      style={{
        border: "1px solid #e6dcc7",
        borderRadius: 10,
        background: "#fffdf7",
        padding: 13,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* header: label + remove */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="text"
          value={entry.studentLabel}
          onChange={(e) => onRename(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            border: "1px solid #e3d9c5",
            borderRadius: 7,
            background: "#fbf7ee",
            padding: "5px 8px",
            fontSize: 12.5,
            fontWeight: 600,
            color: "#3a342b",
            outline: "none",
          }}
        />
        <button
          onClick={onRemove}
          title="Hapus siswa ini"
          style={{
            border: "none",
            background: "transparent",
            color: "#b3a690",
            fontSize: 16,
            lineHeight: 1,
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>

      {/* status badges */}
      {entry.status === "error" && entry.error && (
        <div
          style={{
            fontSize: 11,
            color: "#9a4632",
            background: "#f4e2dc",
            borderRadius: 6,
            padding: "5px 8px",
          }}
        >
          {entry.error}
        </div>
      )}
      {entry.extracting && (
        <div style={{ fontSize: 11, color: "#8a661f", display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              border: "2px solid #e0d5be",
              borderTopColor: "#c79a3a",
              borderRadius: "50%",
              display: "inline-block",
              animation: "spin .7s linear infinite",
            }}
          />
          Membaca teks PDF…
        </div>
      )}
      {entry.preparing && !entry.extracting && entry.files.length === 0 && (
        <div style={{ fontSize: 11, color: "#8a7d65", display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              border: "2px solid #e0d5be",
              borderTopColor: "#c4b89f",
              borderRadius: "50%",
              display: "inline-block",
              animation: "spin .7s linear infinite",
            }}
          />
          Menunggu giliran unggah…
        </div>
      )}
      {entry.kind === "pdf" && entry.isScanned && !entry.extracting && (
        <div
          style={{
            fontSize: 10.5,
            color: "#8a661f",
            background: "#f6ecd5",
            borderRadius: 20,
            padding: "3px 9px",
            display: "inline-block",
            alignSelf: "flex-start",
          }}
        >
          PDF hasil pindaian — akan dibaca via OCR
        </div>
      )}

      {/* content: text mode */}
      {entry.kind === "text" ? (
        <>
          <textarea
            value={entry.answerText}
            onChange={(e) => onAnswerTextChange(e.target.value)}
            onBlur={(e) => onAnswerTextCommit(e.target.value)}
            rows={4}
            placeholder="Ketik atau tempel jawaban siswa…"
            style={{
              width: "100%",
              border: "1px solid #e3d9c5",
              borderRadius: 8,
              background: "#fbf7ee",
              padding: "8px 10px",
              fontSize: 12.5,
              lineHeight: 1.5,
              color: "#2c2620",
              resize: "vertical",
              minHeight: 70,
            }}
          />
          <button
            onClick={() => attachRef.current?.click()}
            style={{
              alignSelf: "flex-start",
              border: "1px solid #e3d9c5",
              background: "#fbf7ee",
              borderRadius: 7,
              padding: "5px 10px",
              fontSize: 11,
              color: "#7a6f5e",
              cursor: "pointer",
            }}
          >
            Atau unggah berkas…
          </button>
          <input
            ref={attachRef}
            type="file"
            accept="image/*,.pdf,application/pdf"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onAttachFile(f);
            }}
          />
        </>
      ) : (
        <>
          {/* content: file mode */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 7 }}>
            {entry.files.map((f) => (
              <FileThumb key={f.id} file={f} kind={entry.kind} onRemove={() => onRemoveFile(f)} />
            ))}
            {entry.kind === "images" && entry.files.length < MAX_IMAGES_PER_ANSWER && !entry.preparing && (
              <button
                onClick={() => imgRef.current?.click()}
                aria-label="Tambah gambar"
                style={{
                  aspectRatio: "3/4",
                  borderRadius: 7,
                  border: "1.5px dashed #d8cdb6",
                  background: "transparent",
                  color: "#a2967f",
                  fontSize: 18,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                +
              </button>
            )}
            {entry.kind === "pdf" && entry.files.length === 0 && !entry.preparing && (
              <button
                onClick={() => pdfRef.current?.click()}
                aria-label="Unggah PDF"
                style={{
                  aspectRatio: "3/4",
                  gridColumn: "span 3",
                  borderRadius: 7,
                  border: "1.5px dashed #d8cdb6",
                  background: "transparent",
                  color: "#a2967f",
                  fontSize: 12,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                + Unggah PDF
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            {entry.kind === "images" && (
              <span style={{ fontSize: 10.5, color: "#a2967f" }}>
                {entry.files.length} / {MAX_IMAGES_PER_ANSWER} gambar
              </span>
            )}
            {entry.kind === "pdf" && entry.files.length > 0 && (
              <button
                onClick={() => pdfRef.current?.click()}
                style={{
                  border: "none",
                  background: "transparent",
                  color: accent,
                  fontSize: 10.5,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Ganti berkas PDF
              </button>
            )}
          </div>

          <button
            onClick={onSwitchToText}
            style={{
              alignSelf: "flex-start",
              border: "none",
              background: "transparent",
              color: "#9a8e79",
              fontSize: 10.5,
              cursor: "pointer",
              padding: 0,
              textDecoration: "underline",
            }}
          >
            Ganti ke jawaban teks
          </button>

          <input
            ref={imgRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              onAddImages(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={pdfRef}
            type="file"
            accept=".pdf,application/pdf"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onReplacePdf(f);
            }}
          />
        </>
      )}
    </div>
  );
}

function FileThumb({
  file,
  kind,
  onRemove,
}: {
  file: AnswerFileState;
  kind: AnswerKind;
  onRemove: () => void;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  const isImage = kind === "images";
  const src = file.previewUrl ?? signedUrl;
  const { storagePath, uploadStatus, previewUrl } = file;

  // Fetch a preview URL as a side effect (not during render) — only for
  // images that came from a resumed run (no local previewUrl yet).
  useEffect(() => {
    if (!isImage || previewUrl || !storagePath || uploadStatus !== "done") return;
    let cancelled = false;
    getSignedUrl(storagePath)
      .then((url) => {
        if (!cancelled) setSignedUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isImage, previewUrl, storagePath, uploadStatus]);

  return (
    <div
      style={{
        position: "relative",
        aspectRatio: kind === "pdf" ? undefined : "3/4",
        gridColumn: kind === "pdf" ? "span 3" : undefined,
        borderRadius: 7,
        overflow: "hidden",
        border: "1px solid #e3d9c5",
        background: "#efe7d6",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {isImage && src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={file.name}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <div
          style={{
            padding: "10px 8px",
            fontSize: 10.5,
            color: "#7a6f5e",
            textAlign: "center",
            wordBreak: "break-all",
            lineHeight: 1.4,
          }}
        >
          {kind === "pdf" ? "📄 " : ""}
          {file.name}
        </div>
      )}

      {file.uploadStatus === "uploading" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(255,253,247,.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              width: 16,
              height: 16,
              border: "2px solid #e0d5be",
              borderTopColor: "#c79a3a",
              borderRadius: "50%",
              display: "inline-block",
              animation: "spin .7s linear infinite",
            }}
          />
        </div>
      )}
      {file.uploadStatus === "error" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(244,226,220,.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9.5,
            color: "#9a4632",
            padding: 4,
            textAlign: "center",
          }}
        >
          Gagal unggah
        </div>
      )}

      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={`Hapus ${file.name}`}
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: "none",
          background: "rgba(44,38,32,.62)",
          color: "#fff",
          fontSize: 11,
          lineHeight: 1,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
