import { MODELS, type ModelInfo } from "@/lib/models";

interface Props {
  selectedModels: string[];
  onAdd: (key: string) => void;
  onRemove: (key: string) => void;
  onGenerate: () => void;
  generating: boolean;
  hasImages: boolean;
  rubricInvalid?: boolean;
  accent: string;
}

export default function ModelPicker({
  selectedModels,
  onAdd,
  onRemove,
  onGenerate,
  generating,
  hasImages,
  rubricInvalid,
  accent,
}: Props) {
  const available = MODELS.filter((m) => !selectedModels.includes(m.key));
  const allSelected = available.length === 0;
  const disabled = generating || !hasImages || selectedModels.length === 0 || !!rubricInvalid;

  let hint = "Tiap run tersimpan otomatis di Riwayat";
  if (!hasImages) hint = "Unggah gambar atau ketik jawaban siswa";
  else if (selectedModels.length === 0) hint = "Pilih minimal satu model";
  else if (rubricInvalid) hint = "Perbaiki rubrik sebelum generate";

  const genLabel = generating
    ? "Menganalisis…"
    : selectedModels.length > 1
    ? `Generate (${selectedModels.length} model)`
    : "Generate";

  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column" }}>
      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            letterSpacing: ".13em",
            color: "#a2967f",
            fontWeight: 500,
          }}
        >
          MODEL
        </span>
        <span style={{ fontSize: 10.5, color: "#9a8e79" }}>
          {selectedModels.length} dipilih
        </span>
      </div>

      {/* add model select */}
      <div style={{ position: "relative", marginBottom: 10 }}>
        <select
          value=""
          onChange={(e) => { if (e.target.value) onAdd(e.target.value); }}
          disabled={allSelected}
          style={{
            width: "100%",
            appearance: "none",
            border: "1px solid #e3d9c5",
            borderRadius: 8,
            background: allSelected ? "#f3ecdb" : "#fbf7ee",
            padding: "10px 34px 10px 12px",
            fontSize: 13,
            color: allSelected ? "#a2967f" : "#5a5142",
            cursor: allSelected ? "default" : "pointer",
          }}
        >
          <option value="" disabled>
            {allSelected ? "Semua model dipilih" : "+ Tambah model…"}
          </option>
          {available.map((m: ModelInfo) => (
            <option key={m.key} value={m.key}>
              {m.label} · {m.vendor}
            </option>
          ))}
        </select>
        <span
          style={{
            position: "absolute",
            right: 13,
            top: "50%",
            transform: "translateY(-50%)",
            pointerEvents: "none",
            color: "#a2967f",
            fontSize: 11,
          }}
        >
          ▼
        </span>
      </div>

      {/* chips */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 7,
          minHeight: 30,
          alignContent: "flex-start",
        }}
      >
        {selectedModels.length === 0 ? (
          <span style={{ fontSize: 11.5, color: "#a2967f", padding: "6px 2px" }}>
            Belum ada model dipilih
          </span>
        ) : (
          selectedModels.map((key) => {
            const m = MODELS.find((x) => x.key === key);
            if (!m) return null;
            return (
              <span
                key={key}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "#f3ecdb",
                  border: "1px solid #e6dcc7",
                  borderRadius: 20,
                  padding: "5px 8px 5px 10px",
                  fontSize: 12,
                  color: "#4a4337",
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: m.dot }} />
                {m.label}
                <button
                  onClick={() => onRemove(key)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#a2967f",
                    fontSize: 13,
                    lineHeight: 1,
                    cursor: "pointer",
                    padding: 0,
                    marginLeft: 1,
                  }}
                >
                  ×
                </button>
              </span>
            );
          })
        )}
      </div>

      <div style={{ marginTop: "auto" }} />

      {/* generate button */}
      <button
        onClick={onGenerate}
        disabled={disabled}
        style={{
          width: "100%",
          border: "none",
          borderRadius: 9,
          padding: 13,
          fontSize: 14,
          fontWeight: 600,
          color: "#fff",
          background: generating ? "#a89478" : accent,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.55 : 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 9,
        }}
      >
        {generating && (
          <span
            style={{
              width: 13,
              height: 13,
              border: "2px solid rgba(255,255,255,.4)",
              borderTopColor: "#fff",
              borderRadius: "50%",
              display: "inline-block",
              animation: "spin .7s linear infinite",
            }}
          />
        )}
        <span>{genLabel}</span>
      </button>

      <div style={{ marginTop: 9, fontSize: 11, color: "#a2967f", textAlign: "center", lineHeight: 1.5 }}>
        {hint}
      </div>
    </div>
  );
}
