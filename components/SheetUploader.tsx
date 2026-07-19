"use client";

import { useRef } from "react";
import type { UploadImage } from "@/lib/models";

interface Props {
  images: UploadImage[];
  maxImages: number;
  accent: string;
  onAdd: (files: FileList | null) => void;
  onRemove: (id: string) => void;
  answerText: string;
  onAnswerChange: (value: string) => void;
}

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  letterSpacing: ".13em",
  color: "#a2967f",
  fontWeight: 500,
};

export default function SheetUploader({
  images,
  maxImages,
  accent,
  onAdd,
  onRemove,
  answerText,
  onAnswerChange,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = () => fileRef.current?.click();
  const countColor = images.length >= maxImages ? "#a8472f" : "#9a8e79";
  const canAddMore = images.length < maxImages;

  return (
    <div style={{ padding: 18, borderRight: "1px solid #efe7d6" }}>
      {/* answer as text (optional alternative to image upload) */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <span style={labelStyle}>JAWABAN SISWA (TEKS)</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#c4b89f" }}>
            opsional
          </span>
        </div>
        <textarea
          value={answerText}
          onChange={(e) => onAnswerChange(e.target.value)}
          rows={3}
          placeholder="Ketik atau tempel jawaban siswa. Jika diisi, jawaban ini dinilai langsung (tanpa gambar)."
          style={{
            width: "100%",
            border: "1px solid #e3d9c5",
            borderRadius: 8,
            background: "#fbf7ee",
            padding: "11px 12px",
            fontSize: 13,
            lineHeight: 1.5,
            color: "#2c2620",
            resize: "vertical",
            minHeight: 70,
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 11,
        }}
      >
        <span style={labelStyle}>LEMBAR JAWABAN</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: countColor }}>
          {images.length} / {maxImages}
        </span>
      </div>

      <div
        onClick={pick}
        onDrop={(e) => {
          e.preventDefault();
          onAdd(e.dataTransfer.files);
        }}
        onDragOver={(e) => e.preventDefault()}
        style={{
          border: "1.5px dashed #d8cdb6",
          borderRadius: 9,
          background: "#fbf7ee",
          padding: 14,
          textAlign: "center",
          cursor: "pointer",
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 13, color: "#6b6151", fontWeight: 500 }}>
          Tarik gambar ke sini atau <span style={{ color: accent }}>telusuri</span>
        </div>
        <div style={{ fontSize: 11, color: "#a2967f", marginTop: 3 }}>
          JPG / PNG · hingga {maxImages} berkas
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 9 }}>
        {images.map((img) => (
          <div
            key={img.id}
            style={{
              position: "relative",
              aspectRatio: "3/4",
              borderRadius: 7,
              overflow: "hidden",
              border: "1px solid #e3d9c5",
              background: "#efe7d6",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.src}
              alt={img.label}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(img.id);
              }}
              aria-label={`Hapus ${img.label}`}
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                width: 19,
                height: 19,
                borderRadius: "50%",
                border: "none",
                background: "rgba(44,38,32,.62)",
                color: "#fff",
                fontSize: 12,
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
        ))}
        {canAddMore && (
          <button
            onClick={pick}
            aria-label="Tambah gambar"
            style={{
              aspectRatio: "3/4",
              borderRadius: 7,
              border: "1.5px dashed #d8cdb6",
              background: "transparent",
              color: "#a2967f",
              fontSize: 22,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            +
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          onAdd(e.target.files);
          e.target.value = "";
        }}
        style={{ display: "none" }}
      />
    </div>
  );
}
