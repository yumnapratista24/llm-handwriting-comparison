"use client";

// Batch grading progress + results dashboard for runs with >1 student answer.
// Polls grading_results (the progress source of truth per the contract) every
// ~3s while any row is queued/running, renders a per-student × per-model
// table, an aggregate footer, and a "Coba Lagi" retry action. Clicking a row
// opens the existing ResultDetail/ChatPanel scoped to that answer.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { fetchBatchResults, listAnswersWithFiles } from "@/lib/db";
import {
  getModel,
  rubricMaxScore,
  type AnswerEntry,
  type ResultStatus,
  type RubricDef,
  type RunResult,
} from "@/lib/models";
import ResultDetail from "@/components/ResultDetail";
import ChatLauncher from "@/components/ChatLauncher";

const POLL_MS = 3000;
// Mirrors the server's stuck-guard in /api/batch-grade: only queued/running
// rows older than this are eligible for reset, so surfacing the retry button
// earlier would produce a no-op click.
const STUCK_MS = 10 * 60 * 1000;

type AggStatus = "queued" | "running" | "done" | "error";

const STATUS_STYLES: Record<AggStatus, { bg: string; fg: string; dot: string; label: string }> = {
  queued: { bg: "#f3ecdb", fg: "#8a7d65", dot: "#c4b89f", label: "Menunggu" },
  running: { bg: "#f6ecd5", fg: "#8a661f", dot: "#c79a3a", label: "Berjalan" },
  done: { bg: "#e7f0e8", fg: "#3f6b4a", dot: "#5b9268", label: "Selesai" },
  error: { bg: "#f4e2dc", fg: "#9a4632", dot: "#c26a52", label: "Gagal" },
};

function aggregateStatus(rowResults: RunResult[]): AggStatus {
  if (!rowResults.length) return "queued";
  if (rowResults.some((r) => r.status === "error")) return "error";
  if (rowResults.some((r) => r.status === "running")) return "running";
  if (rowResults.some((r) => r.status === "queued" || r.status === "pending")) return "queued";
  return "done";
}

const fmtNum = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

interface Props {
  runId: string;
  question: string;
  rubric?: RubricDef[];
  documentIds?: string[];
  accent: string;
  onClose: () => void;
}

export default function BatchDashboard({ runId, question, rubric, documentIds, accent, onClose }: Props) {
  const [answers, setAnswers] = useState<AnswerEntry[]>([]);
  const [results, setResults] = useState<RunResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [openAnswerId, setOpenAnswerId] = useState<string | null>(null);
  const [openModelKey, setOpenModelKey] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  // Wall-clock captured at each results fetch — render must stay pure, so
  // staleness below compares against this instead of calling Date.now().
  const [fetchedAt, setFetchedAt] = useState(0);

  const scoreMax = rubric && rubric.length > 0 ? rubricMaxScore(rubric) : 100;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshResults = useCallback(async () => {
    try {
      const rows = await fetchBatchResults(runId, scoreMax);
      setResults(rows);
      setFetchedAt(Date.now());
      return rows;
    } catch (e) {
      console.error("[BatchDashboard] fetchBatchResults:", e);
      return null;
    }
  }, [runId, scoreMax]);

  // Initial load: answers (static) + first results fetch. `loading` starts
  // true (see useState below) — the caller mounts one BatchDashboard per
  // runId (keyed by runId), so a fresh mount is how "loading" resets between
  // runs rather than setting it synchronously here.
  useEffect(() => {
    let cancelled = false;
    Promise.all([listAnswersWithFiles(runId), fetchBatchResults(runId, scoreMax)])
      .then(([a, r]) => {
        if (cancelled) return;
        setAnswers(a);
        setResults(r);
        setFetchedAt(Date.now());
      })
      .catch((e) => console.error("[BatchDashboard] load:", e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Poll while anything is still in flight; stop once every row has settled.
  useEffect(() => {
    const unsettled = results.some((r) => r.status === "queued" || r.status === "running");
    if (!unsettled) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(refreshResults, POLL_MS);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [results, refreshResults]);

  const modelKeys = [...new Set(results.map((r) => r.modelKey))].sort();
  const total = results.length;
  const done = results.filter((r) => r.status === "done").length;
  const errored = results.filter((r) => r.status === "error").length;
  const settled = total > 0 && done + errored === total;
  // Queued/running rows past the server's stuck threshold (e.g. the message
  // dead-lettered after exhausting retries) would otherwise spin forever with
  // no recovery path — count them so "Coba Lagi" appears for them too.
  const stuck = results.filter((r) => {
    if (r.status !== "queued" && r.status !== "running") return false;
    const ref = r.claimedAt ?? r.createdAt;
    return !ref || fetchedAt - new Date(ref).getTime() > STUCK_MS;
  }).length;
  const canRetry = (errored > 0 || stuck > 0) && !retrying;

  async function retry() {
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch("/api/batch-grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          modelKeys,
          documentIds: documentIds?.length ? documentIds : undefined,
          retry: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      await refreshResults();
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : "Gagal mencoba ulang");
    } finally {
      setRetrying(false);
    }
  }

  function openRow(answerId: string) {
    if (openAnswerId === answerId) {
      setOpenAnswerId(null);
      setOpenModelKey(null);
      return;
    }
    const rowResults = results.filter((r) => r.answerId === answerId);
    const preferred =
      rowResults.find((r) => r.status === "done")?.modelKey ?? rowResults[0]?.modelKey ?? null;
    setOpenAnswerId(answerId);
    setOpenModelKey(preferred);
  }

  const openResult =
    openAnswerId && openModelKey
      ? results.find((r) => r.answerId === openAnswerId && r.modelKey === openModelKey) ?? null
      : null;
  const openAnswer = openAnswerId ? answers.find((a) => a.id === openAnswerId) ?? null : null;

  // ── aggregate footer ─────────────────────────────────────────────────────
  const perModelAgg = modelKeys.map((mk) => {
    const rows = results.filter((r) => r.modelKey === mk);
    const doneRows = rows.filter((r) => r.status === "done" && r.grade);
    const avgScore = doneRows.length
      ? doneRows.reduce((s, r) => s + r.grade!.score, 0) / doneRows.length
      : null;
    const totalTokens = rows.reduce((s, r) => s + (r.grade?.usage.total_tokens ?? 0), 0);
    const totalLatency = rows.reduce((s, r) => s + (r.grade?.latency ?? 0), 0);
    return { modelKey: mk, avgScore, totalTokens, totalLatency };
  });

  return (
    <div>
      {/* progress header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 17, color: "#3a342b" }}>
            Hasil Batch
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9a8e79" }}>
            {answers.length} siswa · {modelKeys.length} model
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11.5, color: "#9a8e79" }}>
            {loading
              ? "Memuat…"
              : total === 0
                ? "Belum ada job"
                : settled
                  ? errored > 0
                    ? `Selesai — ${done}/${total} berhasil, ${errored} gagal`
                    : "Selesai"
                  : `Menilai… ${done}/${total} selesai`}
          </span>
          {canRetry && (
            <button
              onClick={retry}
              disabled={retrying}
              style={{
                border: "none",
                borderRadius: 8,
                padding: "7px 13px",
                fontSize: 12,
                fontWeight: 600,
                color: "#fff",
                background: retrying ? "#a89478" : accent,
                cursor: retrying ? "default" : "pointer",
              }}
            >
              {retrying ? "Mencoba ulang…" : "Coba Lagi"}
            </button>
          )}
          <button
            onClick={onClose}
            title="Tutup run ini"
            style={{
              border: "1px solid #e3d9c5",
              background: "#fffdf7",
              borderRadius: 8,
              padding: "7px 11px",
              fontSize: 12,
              color: "#7a6f5e",
              cursor: "pointer",
            }}
          >
            × Tutup
          </button>
        </div>
      </div>

      {retryError && (
        <div style={{ marginBottom: 12, fontSize: 12, color: "#9a4632" }}>{retryError}</div>
      )}

      {/* student table */}
      <div
        style={{
          background: "#fffdf7",
          border: "1px solid #e6dcc7",
          borderRadius: 12,
          overflow: "hidden",
          marginBottom: 16,
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 480 }}>
            <thead>
              <tr>
                <th style={thStyle("left")}>SISWA</th>
                <th style={thStyle("left")}>STATUS</th>
                {modelKeys.map((mk) => {
                  const m = getModel(mk);
                  return (
                    <th key={mk} colSpan={3} style={thStyle("center")}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: m?.dot }} />
                        {m?.label ?? mk}
                      </span>
                    </th>
                  );
                })}
              </tr>
              <tr>
                <th style={thStyle("left")} />
                <th style={thStyle("left")} />
                {modelKeys.map((mk) => (
                  <Fragment key={mk}>
                    <th style={subThStyle}>Skor</th>
                    <th style={subThStyle}>Token</th>
                    <th style={subThStyle}>Latensi</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {answers.map((a, i) => {
                const rowResults = results.filter((r) => r.answerId === a.id);
                const st = aggregateStatus(rowResults);
                const ss = STATUS_STYLES[st];
                const isOpen = openAnswerId === a.id;
                return (
                  <tr
                    key={a.id}
                    onClick={() => openRow(a.id)}
                    style={{
                      cursor: "pointer",
                      background: isOpen ? "#fbf7ee" : i % 2 === 0 ? "#fffdf7" : "#fdfaf2",
                    }}
                  >
                    <td style={tdStyle}>{a.studentLabel}</td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 10.5,
                          padding: "2px 8px",
                          borderRadius: 20,
                          background: ss.bg,
                          color: ss.fg,
                          fontWeight: 500,
                        }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: ss.dot }} />
                        {ss.label}
                      </span>
                    </td>
                    {modelKeys.map((mk) => {
                      const r = rowResults.find((x) => x.modelKey === mk);
                      const cellStatus: ResultStatus = r?.status ?? "queued";
                      return (
                        <Fragment key={mk}>
                          <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--font-mono)" }}>
                            {cellStatus === "done" && r?.grade ? r.grade.score : cellStatus === "error" ? "—" : "…"}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--font-mono)", color: "#9a8e79" }}>
                            {cellStatus === "done" ? fmtNum(r?.grade?.usage.total_tokens) : "—"}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--font-mono)", color: "#9a8e79" }}>
                            {cellStatus === "done" && r?.grade ? `${r.grade.latency.toFixed(1)}s` : "—"}
                          </td>
                        </Fragment>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* aggregate footer */}
      {perModelAgg.length > 0 && (
        <div
          style={{
            background: "#fbf7ee",
            border: "1px solid #e6dcc7",
            borderRadius: 12,
            padding: "14px 16px",
            marginBottom: 16,
            display: "flex",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          {perModelAgg.map(({ modelKey, avgScore, totalTokens, totalLatency }) => {
            const m = getModel(modelKey);
            return (
              <div key={modelKey} style={{ minWidth: 160 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: m?.dot }} />
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "#3a342b" }}>
                    {m?.label ?? modelKey}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#7a6f5e", lineHeight: 1.6 }}>
                  Rata-rata skor: <strong>{avgScore == null ? "—" : avgScore.toFixed(1)}</strong>
                  <br />
                  Total token: <strong>{fmtNum(totalTokens)}</strong>
                  <br />
                  Total latensi: <strong>{totalLatency.toFixed(1)}s</strong>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* opened row detail */}
      {openAnswer && (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 15, color: "#3a342b" }}>
                {openAnswer.studentLabel}
              </span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {modelKeys.map((mk) => {
                  const m = getModel(mk);
                  const active = openModelKey === mk;
                  return (
                    <button
                      key={mk}
                      onClick={() => setOpenModelKey(mk)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        border: active ? `1.5px solid ${accent}` : "1px solid #e6dcc7",
                        background: active ? "#fbf7ee" : "#fffdf7",
                        borderRadius: 20,
                        padding: "4px 10px",
                        fontSize: 11,
                        color: "#4a4337",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: m?.dot }} />
                      {m?.label ?? mk}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              onClick={() => {
                setOpenAnswerId(null);
                setOpenModelKey(null);
              }}
              style={{
                border: "none",
                background: "transparent",
                color: "#b3a690",
                fontSize: 16,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>

          {!openResult || openResult.status === "queued" || openResult.status === "pending" ? (
            <DetailPlaceholder text="Menunggu antrian…" />
          ) : openResult.status === "running" ? (
            <DetailPlaceholder text="Menganalisis lembar…" spin />
          ) : openResult.status === "error" ? (
            <div
              style={{
                background: "#fffdf7",
                border: "1px solid #e6dcc7",
                borderRadius: 12,
                padding: 20,
                fontSize: 13,
                color: "#9a4632",
              }}
            >
              Gagal: {openResult.error ?? "Terjadi kesalahan saat menilai."}
            </div>
          ) : (
            <>
              <ResultDetail result={openResult} accent={accent} rubric={rubric} />
              {openResult.grade && (
                <ChatLauncher
                  key={openResult.id}
                  resultId={openResult.id}
                  modelKey={openResult.modelKey}
                  question={question}
                  grade={openResult.grade}
                  accent={accent}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DetailPlaceholder({ text, spin }: { text: string; spin?: boolean }) {
  return (
    <div
      style={{
        background: "#fffdf7",
        border: "1px solid #e6dcc7",
        borderRadius: 12,
        minHeight: 160,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
      }}
    >
      {spin && (
        <span
          style={{
            width: 22,
            height: 22,
            border: "3px solid #ece2cd",
            borderTopColor: "#c79a3a",
            borderRadius: "50%",
            display: "inline-block",
            animation: "spin .7s linear infinite",
          }}
        />
      )}
      <div style={{ fontSize: 12.5, color: "#9a8e79" }}>{text}</div>
    </div>
  );
}

function thStyle(align: "left" | "center"): React.CSSProperties {
  return {
    textAlign: align,
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    letterSpacing: ".06em",
    color: "#a2967f",
    padding: "9px 10px 6px",
    borderBottom: "1px solid #efe7d6",
    fontWeight: 500,
    whiteSpace: "nowrap",
  };
}

const subThStyle: React.CSSProperties = {
  textAlign: "right",
  fontFamily: "var(--font-mono)",
  fontSize: 9,
  color: "#bdb09a",
  padding: "0 10px 7px",
  borderBottom: "1px solid #efe7d6",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #f3ecdb",
  color: "#3a342b",
  whiteSpace: "nowrap",
};
