const SUPPORT_LINE =
  "penjelasan · penjelasan + diagram · matematika · matematika + penjelasan";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export default function QuestionInput({ value, onChange }: Props) {
  return (
    <div style={{ padding: "18px 18px 16px", borderRight: "1px solid #efe7d6" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 9,
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
          SOAL ESAI
        </span>
        <span
          style={{
            fontSize: 10.5,
            color: "#b09c45",
            background: "#f6efd9",
            padding: "2px 8px",
            borderRadius: 20,
          }}
        >
          tipe terdeteksi otomatis
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        style={{
          width: "100%",
          border: "1px solid #e3d9c5",
          borderRadius: 8,
          background: "#fbf7ee",
          padding: "11px 12px",
          fontSize: 13.5,
          lineHeight: 1.5,
          color: "#2c2620",
          resize: "vertical",
          minHeight: 88,
        }}
      />
      <div style={{ marginTop: 9, fontSize: 11, color: "#9a8e79", lineHeight: 1.5 }}>
        Mendukung: {SUPPORT_LINE}
      </div>
    </div>
  );
}
