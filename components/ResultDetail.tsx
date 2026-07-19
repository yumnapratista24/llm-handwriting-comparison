import React from "react";
import { getModel, VERDICT_STYLES, deriveVerdict, type RunResult, type RubricDef } from "@/lib/models";

interface Props {
  result: RunResult;
  accent: string;
  rubric?: RubricDef[];
}

const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US"));

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: ".1em",
  color: "#a2967f",
};

function Metric({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 120, background: "#fffdf7", padding: "13px 16px" }}>
      <div style={labelStyle}>{label}</div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 17,
          color: valueColor ?? "#2c2620",
          marginTop: 3,
        }}
      >
        {value}
      </div>
    </div>
  );
}

export default function ResultDetail({ result, accent: _accent, rubric }: Props) {
  const model = getModel(result.modelKey);
  const grade = result.grade!;
  const vk = deriveVerdict(grade.score);
  const vs = VERDICT_STYLES[vk];

  return (
    <div
      style={{
        background: "#fffdf7",
        border: "1px solid #e6dcc7",
        borderRadius: 12,
        overflow: "hidden",
        animation: "pop .25s ease",
      }}
    >
      {/* header */}
      <div
        style={{
          padding: "20px 22px",
          borderBottom: "1px solid #efe7d6",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: model?.dot }} />
            <span style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600 }}>
              {model?.label}
            </span>
            <span style={{ fontSize: 11, color: "#9a8e79" }}>{model?.vendor}</span>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 13px",
              borderRadius: 9,
              background: vs.bg,
              color: vs.fg,
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: vs.dot }} />
            {vs.label}
          </div>
          <div
            style={{
              marginTop: 7,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "#7a6f5e",
            }}
          >
            Skor {grade.score} / 100
          </div>
        </div>
      </div>

      {/* metrics strip */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 1,
          background: "#efe7d6",
          borderBottom: "1px solid #efe7d6",
        }}
      >
        <Metric label="LATENSI" value={`${grade.latency.toFixed(1)} s`} />
        <Metric label="TOKEN MASUK" value={fmt(grade.usage.prompt_tokens)} />
        <Metric label="TOKEN KELUAR" value={fmt(grade.usage.completion_tokens)} />
        <Metric label="TOTAL TOKEN" value={fmt(grade.usage.total_tokens)} />
      </div>

      {/* body: extraction + feedback */}
      <div
        style={{
          padding: "20px 22px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
        }}
      >
        {/* extraction */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ ...labelStyle, fontSize: 10.5 }}>EKSTRAKSI DATA</span>
            <span style={{ fontSize: 10.5, color: "#9a8e79" }}>— yang dibaca model dari gambar</span>
          </div>
          <div
            style={{
              background: "#fbf7ee",
              border: "1px solid #ece2cd",
              borderRadius: 9,
              padding: "14px 15px",
              fontSize: 12.5,
              lineHeight: 1.62,
              color: "#3a342b",
              whiteSpace: "pre-wrap",
              fontFamily: "var(--font-mono)",
              maxHeight: 340,
              overflow: "auto",
            }}
          >
            {grade.extracted_text}
          </div>
          {grade.extraction_note && (
            <div
              style={{
                marginTop: 10,
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                fontSize: 11.5,
                color: "#8a7d65",
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: model?.dot, flexShrink: 0 }}>ⓘ</span>
              <span>{grade.extraction_note}</span>
            </div>
          )}
        </div>

        {/* feedback */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ ...labelStyle, fontSize: 10.5 }}>UMPAN BALIK</span>
            <span style={{ fontSize: 10.5, color: "#9a8e79" }}>— untuk siswa</span>
          </div>
          <p style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.6, color: "#3a342b" }}>
            {grade.feedback_text}
          </p>

          {grade.strengths.length > 0 && (
            <div style={{ marginBottom: 13 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#3f6b4a",
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>✓</span> Kekuatan
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
                {grade.strengths.map((s, i) => (
                  <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5, color: "#4a4337" }}>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {grade.improvements.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#9a6b1f",
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>→</span> Saran perbaikan
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
                {grade.improvements.map((im, i) => (
                  <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5, color: "#4a4337" }}>
                    {im}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* rubric breakdown */}
      {rubric && rubric.length > 0 && grade.rubric_breakdown && grade.rubric_breakdown.length > 0 && (
        <div style={{ borderTop: "1px solid #efe7d6", padding: "16px 22px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ ...labelStyle, fontSize: 10.5 }}>RINCIAN RUBRIK</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                {["Kriteria", "Maks", "Diberikan"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: h === "Kriteria" ? "left" : "right",
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      letterSpacing: ".08em",
                      color: "#a2967f",
                      padding: "5px 8px 8px",
                      borderBottom: "1px solid #efe7d6",
                      fontWeight: 500,
                    }}
                  >
                    {h.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rubric.map((def, i) => {
                const score = grade.rubric_breakdown![i];
                const awarded = score?.awarded ?? null;
                const reason = score?.reason ?? null;
                const awardedColor =
                  awarded == null
                    ? "#9a8e79"
                    : awarded >= def.max * 0.8
                      ? "#3f6b4a"
                      : awarded >= def.max * 0.5
                        ? "#9a661f"
                        : "#c0392b";
                return (
                  <React.Fragment key={i}>
                    <tr style={{ background: i % 2 === 0 ? "#fbf7ee" : "#fffdf7" }}>
                      <td style={{ padding: "7px 8px", color: "#3a342b" }}>{def.criterion}</td>
                      <td
                        style={{
                          padding: "7px 8px",
                          textAlign: "right",
                          fontFamily: "var(--font-mono)",
                          color: "#9a8e79",
                        }}
                      >
                        {def.max}
                      </td>
                      <td
                        style={{
                          padding: "7px 8px",
                          textAlign: "right",
                          fontFamily: "var(--font-mono)",
                          fontWeight: 600,
                          color: awardedColor,
                        }}
                      >
                        {awarded ?? "—"}
                      </td>
                    </tr>
                    {reason && (
                      <tr style={{ background: i % 2 === 0 ? "#fbf7ee" : "#fffdf7" }}>
                        <td
                          colSpan={3}
                          style={{
                            padding: "0 8px 9px 20px",
                            fontSize: 11.5,
                            color: "#9a8e79",
                            fontStyle: "italic",
                            lineHeight: 1.45,
                          }}
                        >
                          {reason}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* citations from source material */}
      {grade.citations && grade.citations.length > 0 && (
        <div style={{ borderTop: "1px solid #efe7d6", padding: "16px 22px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ ...labelStyle, fontSize: 10.5 }}>RUJUKAN MATERI</span>
            <span style={{ fontSize: 10.5, color: "#9a8e79" }}>— dasar dari materi sumber</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {grade.citations.map((c, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 9,
                  alignItems: "flex-start",
                  background: "#fbf7ee",
                  border: "1px solid #ece2cd",
                  borderRadius: 8,
                  padding: "9px 11px",
                }}
              >
                <span style={{ color: model?.dot, fontSize: 12, flexShrink: 0, marginTop: 1 }}>❝</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: "#3a342b", lineHeight: 1.5 }}>{c.snippet}</div>
                  {c.document && (
                    <div
                      style={{
                        marginTop: 3,
                        fontFamily: "var(--font-mono)",
                        fontSize: 10.5,
                        color: "#a2967f",
                      }}
                    >
                      {c.document}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
