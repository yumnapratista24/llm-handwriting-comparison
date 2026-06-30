import type { RubricCriterion } from "@/lib/prompt";

interface Props {
  rubric: RubricCriterion[];
  onChange: (rubric: RubricCriterion[]) => void;
  accent: string;
}

export default function RubricBuilder({ rubric, onChange, accent }: Props) {
  const total = rubric.reduce((s, r) => s + (r.max || 0), 0);

  const totalColor =
    total > 100 ? "#c0392b" : total === 100 ? "#3f6b4a" : "#9a661f";
  const totalLabel =
    total > 100
      ? `${total} / 100 — total melebihi 100`
      : total === 100
        ? `${total} / 100 ✓`
        : total === 0
          ? "0 / 100"
          : `${total} / 100 — sisa poin dinilai secara proporsional`;

  function updateCriterion(
    i: number,
    field: keyof RubricCriterion,
    value: string | number,
  ) {
    const next = rubric.map((r, idx) =>
      idx === i ? { ...r, [field]: value } : r,
    );
    onChange(next);
  }

  function addRow() {
    onChange([...rubric, { criterion: "", max: 0 }]);
  }

  function removeRow(i: number) {
    onChange(rubric.filter((_, idx) => idx !== i));
  }

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
      {/* header */}
      <div
        style={{
          padding: "11px 15px",
          borderBottom: rubric.length > 0 ? "1px solid #efe7d6" : undefined,
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
            RUBRIK PENILAIAN
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
          onClick={addRow}
          style={{
            border: "1px solid #e3d9c5",
            background: "#fffdf7",
            borderRadius: 7,
            padding: "5px 11px",
            fontSize: 12,
            color: "#5a5142",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          + Tambah Kriteria
        </button>
      </div>

      {/* rows */}
      {rubric.length > 0 && (
        <>
          <div style={{ padding: "10px 15px 4px" }}>
            {rubric.map((row, i) => {
              const nameEmpty = row.criterion.trim() === "";
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <input
                    type="text"
                    placeholder="Nama kriteria"
                    value={row.criterion}
                    onChange={(e) =>
                      updateCriterion(i, "criterion", e.target.value)
                    }
                    style={{
                      flex: 1,
                      border: `1px solid ${nameEmpty ? "#e07060" : "#e3d9c5"}`,
                      borderRadius: 7,
                      padding: "7px 10px",
                      fontSize: 12.5,
                      color: "#7a6f5e",
                      background: "#fffdf7",
                      fontFamily: "var(--font-sans)",
                      outline: "none",
                    }}
                  />
                  <div
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="number"
                      min={1}
                      max={100}
                      placeholder="0"
                      value={row.max || ""}
                      onChange={(e) =>
                        updateCriterion(
                          i,
                          "max",
                          Math.max(0, Math.min(100, Number(e.target.value))),
                        )
                      }
                      style={{
                        width: 90,
                        border: "1px solid #e3d9c5",
                        borderRadius: 7,
                        padding: "7px 34px 7px 10px",
                        fontSize: 12.5,
                        color: "#2c2620",
                        background: "#fffdf7",
                        fontFamily: "var(--font-mono)",
                        outline: "none",
                        textAlign: "right",
                      }}
                    />
                    <span
                      style={{
                        position: "absolute",
                        right: 8,
                        fontSize: 11,
                        color: "#a2967f",
                        pointerEvents: "none",
                      }}
                    >
                      pts
                    </span>
                  </div>
                  <button
                    onClick={() => removeRow(i)}
                    title="Hapus kriteria"
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "#c0a080",
                      fontSize: 16,
                      cursor: "pointer",
                      lineHeight: 1,
                      padding: "4px 2px",
                      flexShrink: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {/* total */}
          <div
            style={{
              padding: "8px 15px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 11.5, color: "#a2967f" }}>Total:</span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                fontWeight: 600,
                color: totalColor,
              }}
            >
              {totalLabel}
            </span>
          </div>
        </>
      )}

      {rubric.length === 0 && (
        <div
          style={{
            padding: "14px 15px",
            fontSize: 12,
            color: "#c4b89f",
            fontStyle: "italic",
          }}
        >
          Belum ada kriteria. Tambahkan untuk menggunakan rubrik spesifik.
        </div>
      )}
    </div>
  );
}

export type { RubricCriterion };
