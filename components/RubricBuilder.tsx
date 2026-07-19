import type { RubricCriterion } from "@/lib/prompt";

interface Props {
  rubric: RubricCriterion[];
  onChange: (rubric: RubricCriterion[]) => void;
  accent: string;
}

const cellTextareaStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 160,
  minHeight: 64,
  resize: "vertical",
  border: "1px solid #e3d9c5",
  borderRadius: 7,
  padding: "7px 9px",
  fontSize: 12,
  lineHeight: 1.45,
  color: "#4a4337",
  background: "#fffdf7",
  fontFamily: "var(--font-sans)",
  outline: "none",
};

export default function RubricBuilder({
  rubric,
  onChange,
  accent: _accent,
}: Props) {
  const levels = rubric[0]?.cells.map((c) => c.level) ?? [];
  const levelValues = new Set(levels);
  const hasDuplicateLevels = levelValues.size !== levels.length;
  const totalMax = rubric.reduce(
    (sum, r) =>
      sum + (r.cells.length ? Math.max(...r.cells.map((c) => c.level)) : 0),
    0,
  );

  function updateCriterionField(
    rowIndex: number,
    field: "criterion" | "description",
    value: string,
  ) {
    onChange(
      rubric.map((r, idx) => (idx === rowIndex ? { ...r, [field]: value } : r)),
    );
  }

  function updateCellDescription(
    rowIndex: number,
    levelIndex: number,
    value: string,
  ) {
    onChange(
      rubric.map((r, ri) =>
        ri !== rowIndex
          ? r
          : {
              ...r,
              cells: r.cells.map((c, ci) =>
                ci === levelIndex ? { ...c, description: value } : c,
              ),
            },
      ),
    );
  }

  function updateLevelValue(levelIndex: number, value: number) {
    onChange(
      rubric.map((r) => ({
        ...r,
        cells: r.cells.map((c, ci) =>
          ci === levelIndex ? { ...c, level: value } : c,
        ),
      })),
    );
  }

  function addCriterion() {
    const newCells = levels.map((lv) => ({ level: lv, description: "" }));
    onChange([...rubric, { criterion: "", description: "", cells: newCells }]);
  }

  function removeCriterion(rowIndex: number) {
    onChange(rubric.filter((_, idx) => idx !== rowIndex));
  }

  function addLevel() {
    const nextValue = levels.length ? Math.max(...levels) + 1 : 0;
    onChange(
      rubric.map((r) => ({
        ...r,
        cells: [...r.cells, { level: nextValue, description: "" }],
      })),
    );
  }

  function removeLevel(levelIndex: number) {
    onChange(
      rubric.map((r) => ({
        ...r,
        cells: r.cells.filter((_, idx) => idx !== levelIndex),
      })),
    );
  }

  const gridTemplateColumns = `220px repeat(${levels.length}, minmax(160px, 1fr)) 28px`;

  return (
    <div
      style={{
        border: "1px solid #e3d9c5",
        borderRadius: 10,
        overflow: "hidden",
        background: "#fbf7ee",
      }}
    >
      {/* header bar */}
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
        {rubric.length > 0 && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: "#7a6f5e",
            }}
          >
            Skor maksimum: {rubric.length} ×{" "}
            {levels.length ? Math.max(...levels) : 0} = {totalMax}
          </span>
        )}
      </div>

      {rubric.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <div style={{ padding: "12px 15px 4px", minWidth: "fit-content" }}>
            {/* level header row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns,
                gap: 8,
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", minHeight: 34 }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    letterSpacing: ".08em",
                    color: "#a2967f",
                  }}
                >
                  KRITERIA
                </span>
              </div>
              {levels.map((lv, levelIndex) => (
                <div
                  key={levelIndex}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <input
                    type="number"
                    value={lv}
                    onChange={(e) =>
                      updateLevelValue(levelIndex, Number(e.target.value))
                    }
                    style={{
                      width: "100%",
                      border: `1px solid ${hasDuplicateLevels ? "#e07060" : "#e3d9c5"}`,
                      borderRadius: 7,
                      padding: "5px 8px",
                      fontSize: 12.5,
                      fontFamily: "var(--font-mono)",
                      color: "#2c2620",
                      background: "#fffdf7",
                      textAlign: "center",
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={() => removeLevel(levelIndex)}
                    title="Hapus level"
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "#c0a080",
                      fontSize: 14,
                      cursor: "pointer",
                      lineHeight: 1,
                      padding: 0,
                      flexShrink: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <span />
            </div>

            {/* criterion rows */}
            {rubric.map((row, rowIndex) => {
              const nameEmpty = row.criterion.trim() === "";
              return (
                <div
                  key={rowIndex}
                  style={{
                    display: "grid",
                    gridTemplateColumns,
                    gap: 8,
                    alignItems: "start",
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    <input
                      type="text"
                      placeholder="Nama kriteria"
                      value={row.criterion}
                      onChange={(e) =>
                        updateCriterionField(
                          rowIndex,
                          "criterion",
                          e.target.value,
                        )
                      }
                      style={{
                        border: `1px solid ${nameEmpty ? "#e07060" : "#e3d9c5"}`,
                        borderRadius: 7,
                        padding: "7px 9px",
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "#3a342b",
                        background: "#fffdf7",
                        fontFamily: "var(--font-sans)",
                        outline: "none",
                      }}
                    />
                    <textarea
                      placeholder="Deskripsi kriteria (opsional)"
                      value={row.description ?? ""}
                      onChange={(e) =>
                        updateCriterionField(
                          rowIndex,
                          "description",
                          e.target.value,
                        )
                      }
                      rows={2}
                      style={{
                        ...cellTextareaStyle,
                        minHeight: 44,
                        color: "#8a7d65",
                        fontStyle: "italic",
                      }}
                    />
                  </div>

                  {row.cells.map((cell, levelIndex) => (
                    <textarea
                      key={levelIndex}
                      placeholder={`Deskripsi level ${cell.level}`}
                      value={cell.description}
                      onChange={(e) =>
                        updateCellDescription(
                          rowIndex,
                          levelIndex,
                          e.target.value,
                        )
                      }
                      rows={3}
                      style={cellTextareaStyle}
                    />
                  ))}

                  <button
                    onClick={() => removeCriterion(rowIndex)}
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
        </div>
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
          Belum ada kriteria. Tambahkan kriteria untuk menggunakan rubrik
          spesifik.
        </div>
      )}

      {/* footer actions */}
      <div
        style={{
          padding: "10px 15px 13px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          borderTop: rubric.length > 0 ? "1px solid #efe7d6" : undefined,
        }}
      >
        <button
          onClick={addCriterion}
          style={{
            border: "1px solid #e3d9c5",
            background: "#fffdf7",
            borderRadius: 7,
            padding: "5px 11px",
            fontSize: 12,
            color: "#5a5142",
            cursor: "pointer",
          }}
        >
          + Tambah Kriteria
        </button>
        <button
          onClick={addLevel}
          disabled={rubric.length === 0}
          title={
            rubric.length === 0
              ? "Tambahkan kriteria terlebih dahulu"
              : undefined
          }
          style={{
            border: `1px solid ${rubric.length === 0 ? "#efe7d6" : "#e3d9c5"}`,
            background: "#fffdf7",
            borderRadius: 7,
            padding: "5px 11px",
            fontSize: 12,
            color: rubric.length === 0 ? "#c4b89f" : "#5a5142",
            cursor: rubric.length === 0 ? "default" : "pointer",
          }}
        >
          + Tambah Level Skor
        </button>
      </div>

      {rubric.length > 0 && levels.length < 2 && (
        <div style={{ padding: "0 15px 13px", fontSize: 11, color: "#9a661f" }}>
          Tambahkan minimal 2 level skor.
        </div>
      )}
      {hasDuplicateLevels && (
        <div style={{ padding: "0 15px 13px", fontSize: 11, color: "#c0392b" }}>
          Nilai level tidak boleh duplikat.
        </div>
      )}
    </div>
  );
}

export type { RubricCriterion };
