import { getModel, VERDICT_STYLES, deriveVerdict, type Run, type RunResult } from "@/lib/models";

interface Props {
  run: Run;
  activeResultId: string | null;
  accent: string;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

const fmt = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US");

function bestMetrics(results: RunResult[]) {
  const done = results.filter((r) => r.status === "done" && r.grade);
  if (done.length < 2) return { score: null, latency: null, total: null };
  return {
    score:   Math.max(...done.map((r) => r.grade!.score)),
    latency: Math.min(...done.map((r) => r.grade!.latency)),
    total:   Math.min(...done.map((r) => r.grade!.usage.total_tokens ?? Infinity)),
  };
}

interface MetricCellProps {
  label: string;
  value: string;
  isBest: boolean;
  accent: string;
}

function MetricCell({ label, value, isBest, accent }: MetricCellProps) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: ".04em",
          color: "#a2967f",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 13.5,
          marginTop: 2,
          color: isBest ? accent : "#2c2620",
          fontWeight: isBest ? 600 : 400,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {value}
        {isBest && (
          <span style={{ fontSize: 8.5, color: accent }}>★</span>
        )}
      </div>
    </div>
  );
}

export default function ResultCards({ run, activeResultId, accent, onSelect, onRemove }: Props) {
  const best = bestMetrics(run.results);
  const doneCount = run.results.filter((r) => r.status === "done").length;
  const showBestHint = doneCount >= 2;

  return (
    <div style={{ marginBottom: 18 }}>
      {/* label row */}
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: ".1em",
          color: "#a2967f",
          marginBottom: 9,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {showBestHint ? "RANGKUMAN PERBANDINGAN" : "HASIL MODEL"}
        {showBestHint && (
          <span
            style={{
              fontSize: 10,
              color: "#bdb09a",
              fontFamily: "var(--font-sans)",
              letterSpacing: 0,
            }}
          >
            nilai terbaik ditandai
          </span>
        )}
      </div>

      {/* cards row */}
      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4 }}>
        {run.results.map((r: RunResult) => {
          const model = getModel(r.modelKey);
          const isActive = r.id === activeResultId;
          const isDone = r.status === "done" && !!r.grade;
          const vk = isDone ? deriveVerdict(r.grade!.score) : null;
          const vs = vk ? VERDICT_STYLES[vk] : null;

          return (
            <div
              key={r.id}
              onClick={() => onSelect(r.id)}
              style={{
                flexShrink: 0,
                minWidth: 236,
                cursor: "pointer",
                borderRadius: 11,
                padding: "14px 15px",
                background: "#fffdf7",
                border: isActive ? `1.5px solid ${accent}` : "1.5px solid #e6dcc7",
                boxShadow: isActive ? "0 2px 8px rgba(120,80,40,.08)" : "none",
              }}
            >
              {/* card header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: 11,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: model?.dot,
                    }}
                  />
                  <span style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" }}>
                    {model?.label}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  {vs && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: "2px 7px",
                        borderRadius: 20,
                        background: vs.bg,
                        color: vs.fg,
                        fontWeight: 500,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {vs.label}
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(r.id); }}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "#b3a690",
                      fontSize: 14,
                      lineHeight: 1,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* pending */}
              {r.status === "pending" && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "8px 0 6px",
                    color: "#a2967f",
                  }}
                >
                  <span
                    style={{
                      width: 13,
                      height: 13,
                      border: "2px solid #e0d5be",
                      borderTopColor: "#b3a690",
                      borderRadius: "50%",
                      display: "inline-block",
                      animation: "spin .7s linear infinite",
                    }}
                  />
                  <span style={{ fontSize: 12 }}>menganalisis lembar…</span>
                </div>
              )}

              {/* done: 5-metric grid */}
              {isDone && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: "10px 8px",
                  }}
                >
                  <MetricCell
                    label="SKOR"
                    value={String(r.grade!.score)}
                    isBest={best.score !== null && r.grade!.score === best.score}
                    accent={accent}
                  />
                  <MetricCell
                    label="LATENSI"
                    value={`${r.grade!.latency.toFixed(1)}s`}
                    isBest={best.latency !== null && r.grade!.latency === best.latency}
                    accent={accent}
                  />
                  <MetricCell
                    label="TOTAL TOKEN"
                    value={fmt(r.grade!.usage.total_tokens)}
                    isBest={
                      best.total !== null &&
                      r.grade!.usage.total_tokens !== null &&
                      r.grade!.usage.total_tokens === best.total
                    }
                    accent={accent}
                  />
                  <MetricCell
                    label="TOKEN MASUK"
                    value={fmt(r.grade!.usage.prompt_tokens)}
                    isBest={false}
                    accent={accent}
                  />
                  <MetricCell
                    label="TOKEN KELUAR"
                    value={fmt(r.grade!.usage.completion_tokens)}
                    isBest={false}
                    accent={accent}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
