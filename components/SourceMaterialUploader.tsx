"use client";

import { useRef, useState } from "react";
import type { AttachedDocument } from "@/lib/models";

interface Props {
  documents: AttachedDocument[];
  onChange: (docs: AttachedDocument[]) => void;
  accent: string;
}

export default function SourceMaterialUploader({ documents, onChange, accent }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = () => fileRef.current?.click();

  async function ingest(file: File): Promise<AttachedDocument> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/ingest", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
    return {
      id: data.documentId,
      filename: data.filename,
      chunkCount: data.chunkCount,
    };
  }

  async function handleFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setError(null);
    setBusy(true);
    const added: AttachedDocument[] = [];
    for (const f of files) {
      try {
        added.push(await ingest(f));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal memproses berkas");
      }
    }
    if (added.length) onChange([...documents, ...added]);
    setBusy(false);
  }

  const removeDoc = (id: string) => onChange(documents.filter((d) => d.id !== id));

  return (
    <div
      style={{
        marginTop: 16,
        border: "1px solid #e3d9c5",
        borderRadius: 10,
        overflow: "hidden",
        background: "#fbf7ee",
      }}
    >
      <div
        style={{
          padding: "11px 15px",
          borderBottom: documents.length > 0 ? "1px solid #efe7d6" : undefined,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              letterSpacing: ".08em",
              color: "#a2967f",
            }}
          >
            MATERI SUMBER
          </span>
          <span
            style={{
              marginLeft: 8,
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "#c4b89f",
            }}
          >
            opsional
          </span>
        </div>
        <button
          onClick={pick}
          disabled={busy}
          style={{
            border: "1px solid #e3d9c5",
            background: "#fffdf7",
            borderRadius: 7,
            padding: "5px 11px",
            fontSize: 12,
            color: "#5a5142",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {busy && (
            <span
              style={{
                width: 11,
                height: 11,
                border: "2px solid #d8cdb6",
                borderTopColor: accent,
                borderRadius: "50%",
                display: "inline-block",
                animation: "spin .7s linear infinite",
              }}
            />
          )}
          + Tambah Dokumen
        </button>
      </div>

      {documents.length > 0 && (
        <div style={{ padding: "10px 15px 4px", display: "flex", flexDirection: "column", gap: 8 }}>
          {documents.map((doc) => (
            <div
              key={doc.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                background: "#fffdf7",
                border: "1px solid #ece2cd",
                borderRadius: 7,
                padding: "8px 10px",
              }}
            >
              <span style={{ fontSize: 13, flexShrink: 0 }}>📄</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12.5,
                    color: "#3a342b",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {doc.filename}
                </div>
                <div
                  style={{
                    marginTop: 3,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#a2967f" }}>
                    {doc.chunkCount} potongan
                  </span>
                </div>
              </div>
              <button
                onClick={() => removeDoc(doc.id)}
                title="Hapus dokumen"
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#c0a080",
                  fontSize: 15,
                  cursor: "pointer",
                  lineHeight: 1,
                  padding: "2px",
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {documents.length === 0 && !busy && (
        <div style={{ padding: "14px 15px", fontSize: 12, color: "#c4b89f", fontStyle: "italic" }}>
          Belum ada materi. Unggah PDF/DOC/DOCX untuk menilai jawaban terhadap materi.
        </div>
      )}

      {error && (
        <div style={{ padding: "0 15px 12px", fontSize: 11.5, color: "#9a4632" }}>{error}</div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.doc,.docx"
        multiple
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
        style={{ display: "none" }}
      />
    </div>
  );
}
