"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACCENTS,
  rubricMaxScore,
  type AnswerEntry,
  type AttachedDocument,
  type Run,
  type RubricDef,
  type RunResult,
} from "@/lib/models";
import { DEFAULT_PROMPT, type RubricCriterion } from "@/lib/prompt";
import {
  createDraftRun,
  deleteResult,
  deleteRun,
  fetchBatchResults,
  getRun,
  listAnswersWithFiles,
  loadBatchHistory,
  loadLegacyRubricBreakdown,
  loadRubricForRun,
  saveRubric,
  updateAnswer,
  updateRunQuestion,
  updateRunSystemPrompt,
  updateRunTitle,
  type BatchRunSummary,
} from "@/lib/db";
import QuestionInput from "@/components/QuestionInput";
import RubricBuilder from "@/components/RubricBuilder";
import AnswersManager, {
  type AnswerEntryState,
  type AnswerFileState,
} from "@/components/AnswersManager";
import ModelPicker from "@/components/ModelPicker";
import ResultCards from "@/components/ResultCards";
import ResultDetail from "@/components/ResultDetail";
import ChatLauncher from "@/components/ChatLauncher";
import PromptDrawer from "@/components/PromptDrawer";
import HistoryDrawer from "@/components/HistoryDrawer";
import BatchResultsDialog from "@/components/BatchResultsDialog";

const ACCENT = ACCENTS.Terracotta;

const DEFAULT_QUESTION =
  "Jelaskan bagaimana KPI mempengaruhi kinerja seseorang di sebuah organisasi? Jelaskan menggunakan metode SMART (Specific, Measurable, Achievable, Relevant, Time-bound).";

const DEFAULT_MODELS = ["gpt4o", "gemini25"];

// Batch results are a dialog over compose (BatchResultsDialog), not a mode —
// only single-answer runs still swap the page view.
type ViewMode = "compose" | "single";

// A storage object path is `.../{uuid}-{sanitized-filename}` — strip the
// leading uuid so the entry card shows a readable original-ish filename.
function fileDisplayName(storagePath: string): string {
  const base = storagePath.split("/").pop() ?? storagePath;
  const uuidPrefix = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;
  return base.replace(uuidPrefix, "") || base;
}

function toAnswerEntryState(a: AnswerEntry): AnswerEntryState {
  const files: AnswerFileState[] = a.files.map((f) => ({
    id: f.id,
    name: fileDisplayName(f.storagePath),
    storagePath: f.storagePath,
    mimeType: f.mimeType,
    uploadStatus: "done",
  }));
  return {
    id: a.id,
    position: a.position,
    studentLabel: a.studentLabel,
    kind: a.kind,
    answerText: a.answerText ?? "",
    extractionNote: a.extractionNote,
    isScanned: a.isScanned,
    status: a.status,
    error: a.error,
    extracting: false,
    files,
  };
}

function timeStr(ts: number) {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function Home() {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT);
  const [rubric, setRubric] = useState<RubricCriterion[]>([]);
  const [documents, setDocuments] = useState<AttachedDocument[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>(DEFAULT_MODELS);
  const [answers, setAnswers] = useState<AnswerEntryState[]>([]);

  const [mode, setMode] = useState<ViewMode>("compose");
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [singleRun, setSingleRun] = useState<Run | null>(null);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);

  const [history, setHistory] = useState<BatchRunSummary[]>([]);
  const [drawer, setDrawer] = useState<"history" | "prompt" | null>(null);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);

  // Draft run creation is deduped across concurrent callers (e.g. dropping 10
  // files at once) by caching the in-flight promise here.
  const draftPromiseRef = useRef<Promise<string> | null>(null);

  // Bumped on every navigation (open/close a run). Each loader captures the
  // sequence number it was called with and checks it's still current right
  // before committing state, so a slow, superseded fetch (e.g. the user
  // clicked a second history row before the first one resolved) can't clobber
  // whatever the user has since navigated to.
  const loadSeqRef = useRef(0);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await loadBatchHistory());
    } catch (e) {
      console.error("[history] load:", e);
    }
  }, []);

  useEffect(() => {
    loadBatchHistory()
      .then(setHistory)
      .catch((e) => console.error("[history] load:", e));
  }, []);

  const ensureDraftRun = useCallback(async (): Promise<string> => {
    if (currentRunId) return currentRunId;
    if (!draftPromiseRef.current) {
      draftPromiseRef.current = createDraftRun({ question, systemPrompt })
        .then((id) => {
          setCurrentRunId(id);
          return id;
        })
        .catch((e) => {
          draftPromiseRef.current = null; // allow retry on the next call
          throw e;
        });
    }
    return draftPromiseRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRunId]);

  const resetToBlankDraft = useCallback(() => {
    loadSeqRef.current += 1; // invalidate any load still in flight
    draftPromiseRef.current = null;
    setCurrentRunId(null);
    setMode("compose");
    setDashboardOpen(false);
    setQuestion(DEFAULT_QUESTION);
    setSystemPrompt(DEFAULT_PROMPT);
    setRubric([]);
    setAnswers([]);
    setDocuments([]);
    setSelectedModels(DEFAULT_MODELS);
    setSingleRun(null);
    setActiveResultId(null);
    setGenerateError(null);
  }, []);

  // ── loading a run's detail view (from history, or right after Generate) ────

  const loadDraftIntoCompose = useCallback(async (runId: string, seq: number) => {
    setLoadingRun(true);
    try {
      const [run, rubricDefs, answerRows] = await Promise.all([
        getRun(runId),
        loadRubricForRun(runId),
        listAnswersWithFiles(runId),
      ]);
      if (loadSeqRef.current !== seq) return; // superseded by a newer navigation
      if (!run) {
        resetToBlankDraft();
        return;
      }
      draftPromiseRef.current = Promise.resolve(runId);
      setCurrentRunId(runId);
      setQuestion(run.question || DEFAULT_QUESTION);
      setSystemPrompt(run.systemPrompt || DEFAULT_PROMPT);
      setRubric(rubricDefs);
      setAnswers(answerRows.map(toAnswerEntryState));
      setDocuments([]);
      setMode("compose");
    } catch (e) {
      console.error("[run] loadDraft:", e);
    } finally {
      if (loadSeqRef.current === seq) setLoadingRun(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSingleRun = useCallback(async (runId: string, answerCountHint: number | undefined, seq: number, keepDocuments = false) => {
    setLoadingRun(true);
    try {
      const [run, rubricDefs, answerRows] = await Promise.all([
        getRun(runId),
        loadRubricForRun(runId),
        listAnswersWithFiles(runId),
      ]);
      if (loadSeqRef.current !== seq) return; // superseded by a newer navigation
      if (!run) {
        resetToBlankDraft();
        return;
      }
      const scoreMax = rubricDefs.length ? rubricMaxScore(rubricDefs) : 100;
      let results: RunResult[] = await fetchBatchResults(runId, scoreMax);

      // Pure legacy rows (pre-batch sync grades) never got rubric_breakdown
      // written to the jsonb column — fall back to the old join table only
      // for those. Batch rows already carry it directly.
      const allLegacy = results.length > 0 && results.every((r) => !r.answerId);
      if (rubricDefs.length && allLegacy) {
        try {
          const legacyMap = await loadLegacyRubricBreakdown(runId, rubricDefs);
          if (legacyMap.size) {
            results = results.map((r) => {
              if (r.grade && !r.grade.rubric_breakdown) {
                const bd = legacyMap.get(r.id);
                if (bd) return { ...r, grade: { ...r.grade, rubric_breakdown: bd } };
              }
              return r;
            });
          }
        } catch (e) {
          console.error("[run] legacyRubricBreakdown:", e);
        }
      }
      if (loadSeqRef.current !== seq) return; // superseded while fetching results

      const totalFiles = answerRows.reduce((sum, a) => sum + a.files.length, 0);
      const built: Run = {
        id: runId,
        ts: run.ts,
        question: run.question,
        imageCount: totalFiles,
        systemPrompt: run.systemPrompt,
        title: run.title,
        rubric: rubricDefs.length ? rubricDefs : undefined,
        results,
        answerCount: answerCountHint ?? run.answerCount,
      };
      draftPromiseRef.current = Promise.resolve(runId);
      setCurrentRunId(runId);
      setQuestion(run.question);
      setSystemPrompt(run.systemPrompt);
      setRubric(rubricDefs);
      if (!keepDocuments) setDocuments([]);
      setSingleRun(built);
      const doneResult = results.find((r) => r.status === "done") ?? results[0] ?? null;
      setActiveResultId(doneResult?.id ?? null);
      setMode("single");
    } catch (e) {
      console.error("[run] loadSingle:", e);
    } finally {
      if (loadSeqRef.current === seq) setLoadingRun(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openRun = useCallback(
    async (runId: string) => {
      setDrawer(null);
      if (runId === currentRunId) {
        resetToBlankDraft();
        return;
      }
      const seq = (loadSeqRef.current += 1);
      setDashboardOpen(false);
      const summary = history.find((h) => h.id === runId);
      if (!summary || summary.resultCount === 0) {
        await loadDraftIntoCompose(runId, seq);
      } else if (summary.answerCount <= 1) {
        await loadSingleRun(runId, summary.answerCount, seq);
      } else {
        // Batch run: hydrate compose with its question/rubric/answers, then
        // open the results table as a dialog on top of it.
        await loadDraftIntoCompose(runId, seq);
        if (loadSeqRef.current === seq) setDashboardOpen(true);
      }
    },
    [currentRunId, history, loadDraftIntoCompose, loadSingleRun, resetToBlankDraft],
  );

  const removeRun = useCallback(
    async (runId: string) => {
      setHistory((prev) => prev.filter((r) => r.id !== runId));
      if (currentRunId === runId) resetToBlankDraft();
      await deleteRun(runId).catch((e) => console.error("[run] delete:", e));
    },
    [currentRunId, resetToBlankDraft],
  );

  const renameRun = useCallback((runId: string, title: string) => {
    setHistory((prev) =>
      prev.map((r) => (r.id === runId ? { ...r, title: title.trim() || undefined } : r)),
    );
    updateRunTitle(runId, title).catch((e) => console.error("[run] rename:", e));
  }, []);

  // ── model selection ─────────────────────────────────────────────────────

  const addModel = (key: string) =>
    setSelectedModels((prev) => (prev.includes(key) ? prev : [...prev, key]));
  const removeModel = (key: string) =>
    setSelectedModels((prev) => prev.filter((k) => k !== key));

  // ── validation ───────────────────────────────────────────────────────────

  const rubricLevels = rubric[0]?.cells.map((c) => c.level) ?? [];
  const rubricLevelsDuplicate = new Set(rubricLevels).size !== rubricLevels.length;
  const rubricInvalid =
    rubric.length > 0 &&
    (rubric.some((r) => r.criterion.trim() === "") ||
      rubricLevels.length < 2 ||
      rubricLevelsDuplicate);

  const answersBusy = answers.some(
    (a) =>
      a.preparing || a.extracting || a.files.some((f) => f.uploadStatus === "uploading"),
  );

  // ── generate (submit the batch) ─────────────────────────────────────────

  const generate = async () => {
    if (!currentRunId || generating) return;
    if (answers.length === 0 || answersBusy || selectedModels.length === 0 || rubricInvalid) return;

    setGenerating(true);
    setGenerateError(null);
    try {
      await updateRunQuestion(currentRunId, question);
      await updateRunSystemPrompt(currentRunId, systemPrompt);
      const activeRubric: RubricDef[] = rubric.length ? rubric : [];
      await saveRubric(currentRunId, activeRubric);
      // Typed answers only persist on textarea blur, and the Generate click's
      // blur commit races this request — flush them all before the server
      // reads grading_answers to build payloads.
      await Promise.all(
        answers
          .filter((a) => a.kind === "text")
          .map((a) => updateAnswer(a.id, { answerText: a.answerText })),
      );

      const documentIds = documents.map((d) => d.id);
      // retry:true so re-generating a run also resets failed/stuck jobs —
      // without it those pairs are skipped and a re-run silently does nothing.
      const res = await fetch("/api/batch-grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: currentRunId,
          modelKeys: selectedModels,
          documentIds: documentIds.length ? documentIds : undefined,
          retry: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);

      await refreshHistory();
      if (answers.length <= 1) {
        const seq = (loadSeqRef.current += 1);
        await loadSingleRun(currentRunId, answers.length, seq, true);
      } else {
        // Compose state already holds this run's question/rubric/documents —
        // just open the results dialog on top of it.
        setDashboardOpen(true);
      }
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Gagal memulai penilaian");
    } finally {
      setGenerating(false);
    }
  };

  // ── single-run (≤1 answer) polling ──────────────────────────────────────
  // Single-answer runs still go through the async queued→running→done/error
  // batch lifecycle (they're graded via the same /api/batch-grade job model),
  // so this view needs the same kind of poll BatchDashboard does — otherwise
  // a freshly-generated result never appears without leaving and reopening.
  useEffect(() => {
    if (mode !== "single" || !singleRun) return;
    const unsettled = singleRun.results.some(
      (r) => r.status === "queued" || r.status === "running",
    );
    if (!unsettled) return;
    const runId = singleRun.id;
    const scoreMax =
      singleRun.rubric && singleRun.rubric.length > 0 ? rubricMaxScore(singleRun.rubric) : 100;
    const id = setInterval(() => {
      fetchBatchResults(runId, scoreMax)
        .then((rows) => {
          setSingleRun((prev) => (prev && prev.id === runId ? { ...prev, results: rows } : prev));
        })
        .catch((e) => console.error("[run] poll single:", e));
    }, 3000);
    return () => clearInterval(id);
  }, [mode, singleRun]);

  // ── single-run (≤1 answer) result management ────────────────────────────

  // The dashboard has "Coba Lagi" for failed jobs; single-answer runs need the
  // same recovery path or an errored model would be stuck with no way to rerun.
  const [singleRetrying, setSingleRetrying] = useState(false);
  const retrySingle = async () => {
    if (!singleRun || singleRetrying) return;
    setSingleRetrying(true);
    try {
      const modelKeys = [...new Set(singleRun.results.map((r) => r.modelKey))];
      const documentIds = documents.map((d) => d.id);
      const res = await fetch("/api/batch-grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: singleRun.id,
          modelKeys,
          documentIds: documentIds.length ? documentIds : undefined,
          retry: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      const scoreMax =
        singleRun.rubric && singleRun.rubric.length > 0 ? rubricMaxScore(singleRun.rubric) : 100;
      const rows = await fetchBatchResults(singleRun.id, scoreMax);
      setSingleRun((prev) => (prev && prev.id === singleRun.id ? { ...prev, results: rows } : prev));
    } catch (e) {
      console.error("[run] retrySingle:", e);
    } finally {
      setSingleRetrying(false);
    }
  };
  const singleHasError = singleRun?.results.some((r) => r.status === "error") ?? false;

  const removeResult = (resultId: string) => {
    deleteResult(resultId).catch((e) => console.error("[result] delete:", e));
    setSingleRun((prev) => {
      if (!prev) return prev;
      const next = prev.results.filter((r) => r.id !== resultId);
      setActiveResultId((active) =>
        active === resultId ? (next.length ? next[next.length - 1].id : null) : active,
      );
      return { ...prev, results: next };
    });
  };

  const activeResult = singleRun?.results.find((r) => r.id === activeResultId) ?? null;
  const activePending =
    activeResult?.status === "pending" ||
    activeResult?.status === "queued" ||
    activeResult?.status === "running";
  const activeError = activeResult?.status === "error";
  const activeDone = activeResult?.status === "done" ? activeResult : null;

  const pendingCount =
    singleRun?.results.filter(
      (r) => r.status === "pending" || r.status === "queued" || r.status === "running",
    ).length ?? 0;
  const totalCount = singleRun?.results.length ?? 0;

  // The current run already has batch results (per the refreshed history) —
  // offer the "Lihat Hasil" shortcut to reopen the results dialog from compose.
  const currentSummary = currentRunId
    ? history.find((h) => h.id === currentRunId)
    : undefined;
  const currentRunHasBatchResults =
    (currentSummary?.resultCount ?? 0) > 0 && (currentSummary?.answerCount ?? 0) > 1;

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f4eee1",
        backgroundImage:
          "radial-gradient(rgba(120,100,70,.045) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
        fontFamily: "var(--font-sans)",
        color: "#2c2620",
        padding: "26px 30px 40px",
      }}
    >
      {/* ── header ── */}
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 24,
          maxWidth: 1320,
          margin: "0 auto 22px",
          paddingBottom: 16,
          borderBottom: "1px solid #e2d8c4",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 7,
                background: ACCENT,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 17,
                lineHeight: 1,
              }}
            >
              G
            </div>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: 25,
                margin: 0,
                letterSpacing: "-.01em",
              }}
            >
              Penilai Esai — Perbandingan LLM
            </h1>
          </div>
          <p
            style={{
              margin: "9px 0 0",
              color: "#7a6f5e",
              fontSize: 13.5,
              maxWidth: 640,
              lineHeight: 1.5,
            }}
          >
            Unggah hingga 50 lembar jawaban siswa (gambar, PDF, atau teks), pilih
            beberapa model, lalu nilai sekaligus untuk membandingkan ekstraksi,
            penilaian, dan latensi.
          </p>
        </div>

        {/* header buttons */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setDrawer("prompt")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              border: "1px solid #e3d9c5",
              background: "#fffdf7",
              borderRadius: 8,
              padding: "9px 13px",
              fontSize: 12.5,
              color: "#5a5142",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            <span style={{ fontSize: 13 }}>⚙</span> System Prompt
          </button>
          <button
            onClick={() => setDrawer("history")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              border: "1px solid #e3d9c5",
              background: "#fffdf7",
              borderRadius: 8,
              padding: "9px 13px",
              fontSize: 12.5,
              color: "#5a5142",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            <span style={{ fontSize: 13 }}>◗</span> Riwayat
            {history.length > 0 && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  background: ACCENT,
                  color: "#fff",
                  borderRadius: 20,
                  padding: "1px 7px",
                  lineHeight: 1.5,
                }}
              >
                {history.length}
              </span>
            )}
          </button>
        </div>
      </header>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 24,
          maxWidth: 1320,
          margin: "0 auto",
        }}
      >
        {loadingRun && (
          <div style={{ fontSize: 12.5, color: "#9a8e79" }}>Memuat run…</div>
        )}

        {mode === "compose" && !loadingRun && (
          <>
            {/* ── reopen batch results ── */}
            {currentRunHasBatchResults && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                  background: "#fffdf7",
                  border: "1px solid #e6dcc7",
                  borderRadius: 12,
                  padding: "11px 16px",
                }}
              >
                <span style={{ fontSize: 12.5, color: "#7a6f5e" }}>
                  Run ini sudah memiliki hasil penilaian batch.
                </span>
                <button
                  onClick={() => setDashboardOpen(true)}
                  style={{
                    border: "none",
                    borderRadius: 8,
                    padding: "7px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#fff",
                    background: ACCENT,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  Lihat Hasil
                </button>
              </div>
            )}

            {/* ── question + model row ── */}
            <section
              style={{
                background: "#fffdf7",
                border: "1px solid #e6dcc7",
                borderRadius: 12,
                boxShadow: "0 1px 2px rgba(80,60,30,.04)",
                display: "grid",
                gridTemplateColumns: "1.7fr 1fr",
                alignItems: "stretch",
              }}
            >
              <QuestionInput
                value={question}
                onChange={setQuestion}
                documents={documents}
                onDocumentsChange={setDocuments}
                accent={ACCENT}
              />
              <ModelPicker
                selectedModels={selectedModels}
                onAdd={addModel}
                onRemove={removeModel}
                onGenerate={generate}
                generating={generating}
                hasImages={answers.length > 0 && !answersBusy}
                rubricInvalid={rubricInvalid}
                accent={ACCENT}
              />
            </section>

            {generateError && (
              <div
                style={{
                  fontSize: 12.5,
                  color: "#9a4632",
                  background: "#f4e2dc",
                  border: "1px solid #e6c2b6",
                  borderRadius: 9,
                  padding: "10px 14px",
                }}
              >
                {generateError}
              </div>
            )}

            {/* ── answers (own full-width section) ── */}
            <section
              style={{
                background: "#fffdf7",
                border: "1px solid #e6dcc7",
                borderRadius: 12,
                boxShadow: "0 1px 2px rgba(80,60,30,.04)",
                padding: 18,
              }}
            >
              <AnswersManager
                answers={answers}
                onAnswersChange={setAnswers}
                ensureRunId={ensureDraftRun}
                runId={currentRunId}
                accent={ACCENT}
              />
            </section>

            {/* ── rubric (own full-width section — needs room to grow) ── */}
            <section>
              <RubricBuilder rubric={rubric} onChange={setRubric} accent={ACCENT} />
            </section>
          </>
        )}

        {mode === "single" && singleRun && !loadingRun && (
          <section>
            {/* run meta */}
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
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 17,
                    color: "#3a342b",
                  }}
                >
                  Hasil run
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11.5,
                    color: "#9a8e79",
                  }}
                >
                  {timeStr(singleRun.ts)} · {singleRun.imageCount} berkas ·{" "}
                  {totalCount} model
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11.5, color: "#9a8e79" }}>
                  {pendingCount > 0
                    ? `Memproses ${pendingCount} dari ${totalCount} model…`
                    : "Selesai"}
                </span>
                {singleHasError && (
                  <button
                    onClick={retrySingle}
                    disabled={singleRetrying}
                    style={{
                      border: "none",
                      borderRadius: 8,
                      padding: "7px 13px",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#fff",
                      background: singleRetrying ? "#a89478" : ACCENT,
                      cursor: singleRetrying ? "default" : "pointer",
                    }}
                  >
                    {singleRetrying ? "Mencoba ulang…" : "Coba Lagi"}
                  </button>
                )}
                <button
                  onClick={resetToBlankDraft}
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

            {/* model cards */}
            <ResultCards
              run={singleRun}
              activeResultId={activeResultId}
              accent={ACCENT}
              onSelect={setActiveResultId}
              onRemove={removeResult}
            />

            {/* active detail */}
            {activePending && (
              <div
                style={{
                  background: "#fffdf7",
                  border: "1px solid #e6dcc7",
                  borderRadius: 12,
                  minHeight: 280,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 14,
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    border: "3px solid #ece2cd",
                    borderTopColor: ACCENT,
                    borderRadius: "50%",
                    display: "inline-block",
                    animation: "spin .7s linear infinite",
                  }}
                />
                <div style={{ fontSize: 13, color: "#9a8e79" }}>
                  Menjalankan {activeResult ? activeResult.modelKey : "model"}…
                </div>
              </div>
            )}

            {activeError && (
              <div
                style={{
                  background: "#fffdf7",
                  border: "1px solid #e6dcc7",
                  borderRadius: 12,
                  minHeight: 160,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 24,
                  textAlign: "center",
                  fontSize: 13,
                  color: "#9a4632",
                }}
              >
                Gagal: {activeResult?.error ?? "Terjadi kesalahan saat menilai."}
              </div>
            )}

            {activeDone && (
              <ResultDetail
                result={activeDone}
                accent={ACCENT}
                rubric={singleRun?.rubric}
              />
            )}

            {activeDone?.grade && (
              <ChatLauncher
                key={activeDone.id}
                resultId={activeDone.id}
                modelKey={activeDone.modelKey}
                question={singleRun.question}
                grade={activeDone.grade}
                accent={ACCENT}
              />
            )}
          </section>
        )}

      </div>

      {/* ── batch results dialog ── */}
      <BatchResultsDialog
        open={dashboardOpen}
        runId={currentRunId}
        question={question}
        rubric={rubric.length ? rubric : undefined}
        documentIds={documents.map((d) => d.id)}
        accent={ACCENT}
        onClose={() => setDashboardOpen(false)}
      />

      {/* ── drawers ── */}
      <PromptDrawer
        open={drawer === "prompt"}
        value={systemPrompt}
        onChange={setSystemPrompt}
        onReset={() => setSystemPrompt(DEFAULT_PROMPT)}
        onClose={() => setDrawer(null)}
        accent={ACCENT}
      />
      <HistoryDrawer
        open={drawer === "history"}
        runs={history}
        currentRunId={currentRunId}
        onOpen={openRun}
        onRemove={removeRun}
        onRename={renameRun}
        onClose={() => setDrawer(null)}
        accent={ACCENT}
      />
    </div>
  );
}
