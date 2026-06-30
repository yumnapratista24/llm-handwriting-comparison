"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ACCENTS,
  deriveVerdict,
  type GradeResponse,
  type Run,
  type RubricDef,
  type RunResult,
  type UploadImage,
} from "@/lib/models";
import { DEFAULT_PROMPT, type RubricCriterion } from "@/lib/prompt";
import { getSupabase } from "@/lib/supabase";
import QuestionInput from "@/components/QuestionInput";
import SheetUploader from "@/components/SheetUploader";
import ModelPicker from "@/components/ModelPicker";
import ResultCards from "@/components/ResultCards";
import ResultDetail from "@/components/ResultDetail";
import PromptDrawer from "@/components/PromptDrawer";
import HistoryDrawer from "@/components/HistoryDrawer";

const MAX_IMAGES = 5;
const ACCENT = ACCENTS.Terracotta;

const DEFAULT_QUESTION =
  "Jelaskan bagaimana KPI mempengaruhi kinerja seseorang di sebuah organisasi? Jelaskan menggunakan metode SMART (Specific, Measurable, Achievable, Relevant, Time-bound).";

// ── Supabase helpers ────────────────────────────────────────────────────────

function db() {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

async function dbSaveRun(run: Run) {
  const { error } = await db()!
    .from("grading_runs")
    .insert({
      id: run.id,
      question: run.question,
      image_count: run.imageCount,
      system_prompt: run.systemPrompt,
      title: run.title ?? null,
    });
  if (error) console.error("[db] saveRun:", error.message);
}

async function dbSaveRubric(
  runId: string,
  rubric: RubricDef[],
): Promise<Array<{ id: string; position: number }>> {
  if (!rubric.length) return [];
  const rows = rubric.map((r, i) => ({
    run_id: runId,
    position: i,
    criterion: r.criterion,
    max_score: r.max,
  }));
  const { data, error } = await db()!
    .from("grading_rubric")
    .insert(rows)
    .select("id, position");
  if (error) {
    console.error("[db] saveRubric:", error.message);
    return [];
  }
  return ((data ?? []) as Array<{ id: string; position: number }>).sort(
    (a, b) => a.position - b.position,
  );
}

async function dbSaveRubricScores(
  resultId: string,
  rubricRows: Array<{ id: string; position: number }>,
  breakdown: GradeResponse["rubric_breakdown"],
) {
  if (!breakdown?.length || !rubricRows.length) return;
  const rows = rubricRows.map((rb, i) => ({
    rubric_id: rb.id,
    result_id: resultId,
    awarded_score: breakdown[i]?.awarded ?? 0,
    reason: breakdown[i]?.reason ?? "",
  }));
  const { error } = await db()!.from("grading_rubric_scores").insert(rows);
  if (error) console.error("[db] saveRubricScores:", error.message);
}

async function dbUpdateRunTitle(runId: string, title: string) {
  const { error } = await db()!
    .from("grading_runs")
    .update({ title: title.trim() || null })
    .eq("id", runId);
  if (error) console.error("[db] updateTitle:", error.message);
}

async function dbSaveResult(r: RunResult) {
  if (r.status !== "done" || !r.grade) return;
  const { error } = await db()!.from("grading_results").insert({
    id: r.id,
    run_id: r.runId,
    model_key: r.modelKey,
    score: r.grade.score,
    extracted_text: r.grade.extracted_text,
    extraction_note: r.grade.extraction_note,
    feedback_text: r.grade.feedback_text,
    strengths: r.grade.strengths,
    improvements: r.grade.improvements,
    prompt_tokens: r.grade.usage.prompt_tokens,
    completion_tokens: r.grade.usage.completion_tokens,
    total_tokens: r.grade.usage.total_tokens,
    latency: r.grade.latency,
  });
  if (error) console.error("[db] saveResult:", error.message);
}

async function dbDeleteRun(runId: string) {
  const { error } = await db()!.from("grading_runs").delete().eq("id", runId);
  if (error) console.error("[db] deleteRun:", error.message);
}

async function dbDeleteResult(resultId: string) {
  const { error } = await db()!
    .from("grading_results")
    .delete()
    .eq("id", resultId);
  if (error) console.error("[db] deleteResult:", error.message);
}

async function loadRunsFromDb(): Promise<Run[]> {
  const client = db();
  if (!client) return [];

  const { data: runRows, error: runErr } = await client
    .from("grading_runs")
    .select("*")
    .order("created_at", { ascending: false });
  if (runErr || !runRows) {
    if (runErr) console.error("[db] loadRuns:", runErr.message);
    return [];
  }

  const { data: resultRows, error: resultErr } = await client
    .from("grading_results")
    .select("*");
  if (resultErr) console.error("[db] loadResults:", resultErr.message);

  const { data: rubricDefRows, error: rubricDefErr } = await client
    .from("grading_rubric")
    .select("*");
  if (rubricDefErr) console.error("[db] loadRubric:", rubricDefErr.message);

  const { data: rubricScoreRows, error: rubricScoreErr } = await client
    .from("grading_rubric_scores")
    .select("*");
  if (rubricScoreErr)
    console.error("[db] loadRubricScores:", rubricScoreErr.message);

  return runRows.map((row: Record<string, unknown>) => {
    // Rubric definition for this run, ordered by position
    const rubricDefs = (rubricDefRows ?? [])
      .filter((rd: Record<string, unknown>) => rd.run_id === row.id)
      .sort(
        (a: Record<string, unknown>, b: Record<string, unknown>) =>
          (a.position as number) - (b.position as number),
      );

    const rubric: RubricDef[] = rubricDefs.map(
      (rd: Record<string, unknown>) => ({
        criterion: rd.criterion as string,
        max: rd.max_score as number,
      }),
    );

    const results: RunResult[] = (resultRows ?? [])
      .filter((r: Record<string, unknown>) => r.run_id === row.id)
      .map((r: Record<string, unknown>) => {
        // Join rubric definitions with per-model scores for this result
        const breakdown = rubricDefs
          .map((rd: Record<string, unknown>) => {
            const score = (rubricScoreRows ?? []).find(
              (s: Record<string, unknown>) =>
                s.rubric_id === rd.id && s.result_id === r.id,
            ) as Record<string, unknown> | undefined;
            return score
              ? {
                  criterion: rd.criterion as string,
                  max: rd.max_score as number,
                  awarded: score.awarded_score as number,
                  reason: score.reason as string,
                }
              : null;
          })
          .filter(Boolean) as Array<{
          criterion: string;
          max: number;
          awarded: number;
          reason: string;
        }>;

        return {
          id: r.id as string,
          runId: r.run_id as string,
          modelKey: r.model_key as string,
          status: "done" as const,
          grade: {
            score: r.score as number,
            extracted_text: r.extracted_text as string,
            extraction_note: r.extraction_note as string,
            feedback_text: r.feedback_text as string,
            strengths: (r.strengths as string[]) ?? [],
            improvements: (r.improvements as string[]) ?? [],
            usage: {
              prompt_tokens: r.prompt_tokens as number | null,
              completion_tokens: r.completion_tokens as number | null,
              total_tokens: r.total_tokens as number | null,
            },
            latency: r.latency as number,
            rubric_breakdown: breakdown.length ? breakdown : undefined,
          },
          verdictKind: deriveVerdict(r.score as number),
        };
      });

    return {
      id: row.id as string,
      ts: new Date(row.created_at as string).getTime(),
      question: row.question as string,
      imageCount: row.image_count as number,
      systemPrompt: row.system_prompt as string,
      title: (row.title as string | null) ?? undefined,
      rubric: rubric.length ? rubric : undefined,
      results,
    };
  });
}

// ── Component ───────────────────────────────────────────────────────────────

export default function Home() {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [images, setImages] = useState<UploadImage[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([
    "gpt4o",
    "gemini25",
  ]);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT);
  const [rubric, setRubric] = useState<RubricCriterion[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<"history" | "prompt" | null>(null);

  // Load history on mount
  useEffect(() => {
    loadRunsFromDb().then((loaded) => {
      if (loaded.length > 0) {
        setRuns(loaded);
        const first = loaded[0];
        setCurrentRunId(first.id);
        const firstDone = first.results.find((r) => r.status === "done");
        setActiveResultId(firstDone?.id ?? first.results[0]?.id ?? null);
      }
    });
  }, []);

  // ── image handlers ──────────────────────────────────────────────────────

  const addFiles = useCallback(
    (fileList: FileList | null) => {
      const room = MAX_IMAGES - images.length;
      const files = Array.from(fileList ?? [])
        .filter((f) => f.type.startsWith("image/"))
        .slice(0, Math.max(0, room));
      files.forEach((f) => {
        const reader = new FileReader();
        reader.onload = () => {
          setImages((prev) => [
            ...prev,
            {
              id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              label: f.name,
              src: reader.result as string,
            },
          ]);
        };
        reader.readAsDataURL(f);
      });
    },
    [images.length],
  );

  const removeImage = (id: string) =>
    setImages((prev) => prev.filter((im) => im.id !== id));

  // ── model selection ─────────────────────────────────────────────────────

  const addModel = (key: string) =>
    setSelectedModels((prev) => (prev.includes(key) ? prev : [...prev, key]));

  const removeModel = (key: string) =>
    setSelectedModels((prev) => prev.filter((k) => k !== key));

  // ── generate ────────────────────────────────────────────────────────────

  const currentRun = runs.find((r) => r.id === currentRunId) ?? null;
  const anyPending =
    currentRun?.results.some((r) => r.status === "pending") ?? false;

  const rubricTotal = rubric.reduce((s, r) => s + (r.max || 0), 0);
  const rubricInvalid =
    rubric.length > 0 &&
    (rubricTotal > 100 || rubric.some((r) => r.criterion.trim() === ""));

  const generate = async () => {
    if (
      anyPending ||
      images.length === 0 ||
      selectedModels.length === 0 ||
      rubricInvalid
    )
      return;

    const runId = crypto.randomUUID();
    const pendingResults: RunResult[] = selectedModels.map((key) => ({
      id: crypto.randomUUID(),
      runId,
      modelKey: key,
      status: "pending",
    }));

    const activeRubric: RubricDef[] = rubric.length > 0 ? rubric : [];

    const run: Run = {
      id: runId,
      ts: Date.now(),
      question,
      imageCount: images.length,
      systemPrompt,
      rubric: activeRubric.length ? activeRubric : undefined,
      results: pendingResults,
    };

    setRuns((prev) => [run, ...prev]);
    setCurrentRunId(runId);
    setActiveResultId(pendingResults[0].id);

    await dbSaveRun(run);
    const rubricRows = await dbSaveRubric(runId, activeRubric);

    const imageSrcs = images.map((im) => im.src);

    // Fire all models in parallel
    await Promise.all(
      pendingResults.map(async (pending) => {
        try {
          const res = await fetch("/api/grade", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              modelKey: pending.modelKey,
              question,
              images: imageSrcs,
              systemPrompt,
              rubric: activeRubric.length ? activeRubric : undefined,
            }),
          });
          console.log(res);
          const data = await res.json();
          console.log(data);
          if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);

          const grade = data as GradeResponse;
          const doneResult: RunResult = {
            ...pending,
            status: "done",
            grade,
            verdictKind: deriveVerdict(grade.score),
          };

          setRuns((prev) =>
            prev.map((r) =>
              r.id !== runId
                ? r
                : {
                    ...r,
                    results: r.results.map((x) =>
                      x.id === pending.id ? doneResult : x,
                    ),
                  },
            ),
          );

          await dbSaveResult(doneResult);
          await dbSaveRubricScores(
            doneResult.id,
            rubricRows,
            grade.rubric_breakdown,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Gagal";
          console.error(`[grade] ${pending.modelKey}:`, msg);
          // Mark as done with an error payload so the card stops spinning
          const errResult: RunResult = {
            ...pending,
            status: "done",
            grade: {
              score: 0,
              extracted_text: "",
              extraction_note: `Gagal: ${msg}`,
              feedback_text: "Terjadi kesalahan saat memanggil model.",
              strengths: [],
              improvements: [],
              usage: {
                prompt_tokens: null,
                completion_tokens: null,
                total_tokens: null,
              },
              latency: 0,
            },
            verdictKind: "bad",
          };
          setRuns((prev) =>
            prev.map((r) =>
              r.id !== runId
                ? r
                : {
                    ...r,
                    results: r.results.map((x) =>
                      x.id === pending.id ? errResult : x,
                    ),
                  },
            ),
          );
        }
      }),
    );
  };

  // ── result/run management ────────────────────────────────────────────────

  const removeResult = (resultId: string) => {
    dbDeleteResult(resultId);
    setRuns((prev) =>
      prev.map((run) => {
        if (run.id !== currentRunId) return run;
        const next = run.results.filter((r) => r.id !== resultId);
        setActiveResultId((active) =>
          active === resultId
            ? next.length
              ? next[next.length - 1].id
              : null
            : active,
        );
        return { ...run, results: next };
      }),
    );
  };

  const openRun = (runId: string) => {
    if (runId === currentRunId) {
      setCurrentRunId(null);
      setActiveResultId(null);
      setQuestion(DEFAULT_QUESTION);
      setRubric([]);
      setSelectedModels(["gpt4o", "gemini25"]);
      setDrawer(null);
      return;
    }
    const run = runs.find((r) => r.id === runId);
    if (!run) return;
    const done = run.results.find((r) => r.status === "done") ?? run.results[0];
    setCurrentRunId(runId);
    setActiveResultId(done?.id ?? null);
    setQuestion(run.question);
    setRubric(run.rubric ?? []);
    setSelectedModels([...new Set(run.results.map((r) => r.modelKey))]);
    setDrawer(null);
  };

  const removeRun = (runId: string) => {
    dbDeleteRun(runId);
    setRuns((prev) => {
      const next = prev.filter((r) => r.id !== runId);
      if (currentRunId === runId) {
        const fallback = next[0] ?? null;
        setCurrentRunId(fallback?.id ?? null);
        const done = fallback?.results.find((r) => r.status === "done");
        setActiveResultId(done?.id ?? fallback?.results[0]?.id ?? null);
      }
      return next;
    });
  };

  const renameRun = (runId: string, title: string) => {
    setRuns((prev) =>
      prev.map((r) =>
        r.id === runId ? { ...r, title: title.trim() || undefined } : r,
      ),
    );
    dbUpdateRunTitle(runId, title);
  };

  // ── derived display values ───────────────────────────────────────────────

  const activeResult =
    currentRun?.results.find((r) => r.id === activeResultId) ?? null;
  const activePending = activeResult?.status === "pending";
  const activeDone = activeResult?.status === "done" ? activeResult : null;

  const pendingCount =
    currentRun?.results.filter((r) => r.status === "pending").length ?? 0;
  const totalCount = currentRun?.results.length ?? 0;

  function timeStr(ts: number) {
    const d = new Date(ts);
    const p = (x: number) => String(x).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

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
            Unggah lembar jawaban tulisan tangan, pilih beberapa model, lalu
            jalankan bersamaan untuk membandingkan ekstraksi, penilaian, dan
            latensi.
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
            {runs.length > 0 && (
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
                {runs.length}
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
        {/* ── input row ── */}
        <section
          style={{
            background: "#fffdf7",
            border: "1px solid #e6dcc7",
            borderRadius: 12,
            boxShadow: "0 1px 2px rgba(80,60,30,.04)",
            display: "grid",
            gridTemplateColumns: "1.5fr 1.15fr 1.05fr",
            alignItems: "stretch",
          }}
        >
          <QuestionInput
            value={question}
            onChange={setQuestion}
            rubric={rubric}
            onRubricChange={setRubric}
            accent={ACCENT}
          />
          <SheetUploader
            images={images}
            maxImages={MAX_IMAGES}
            accent={ACCENT}
            onAdd={addFiles}
            onRemove={removeImage}
          />
          <ModelPicker
            selectedModels={selectedModels}
            onAdd={addModel}
            onRemove={removeModel}
            onGenerate={generate}
            generating={anyPending}
            hasImages={images.length > 0}
            rubricInvalid={rubricInvalid}
            accent={ACCENT}
          />
        </section>

        {/* ── results ── */}
        <section>
          {runs.length === 0 ? (
            <div
              style={{
                background: "#fffdf7",
                border: "1px solid #e6dcc7",
                borderRadius: 12,
                minHeight: 300,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                padding: 40,
              }}
            >
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 13,
                  background: "#f1e9d7",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 24,
                  marginBottom: 16,
                }}
              >
                ✎
              </div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 19,
                  color: "#5a5142",
                  marginBottom: 7,
                }}
              >
                Belum ada hasil
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "#9a8e79",
                  maxWidth: 360,
                  lineHeight: 1.55,
                }}
              >
                Pilih satu atau beberapa model lalu klik{" "}
                <strong style={{ color: "#6b6151" }}>Generate</strong>. Setiap
                run tersimpan di{" "}
                <strong style={{ color: "#6b6151" }}>Riwayat</strong> dan dapat
                dibuka kembali.
              </div>
            </div>
          ) : currentRun ? (
            <>
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
                    {timeStr(currentRun.ts)} · {currentRun.imageCount} lembar ·{" "}
                    {totalCount} model
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: "#9a8e79" }}>
                  {pendingCount > 0
                    ? `Memproses ${pendingCount} dari ${totalCount} model…`
                    : "Selesai"}
                </div>
              </div>

              {/* model cards */}
              <ResultCards
                run={currentRun}
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
                    Menjalankan {activeResult ? activeResult.modelKey : "model"}
                    …
                  </div>
                </div>
              )}

              {activeDone && (
                <ResultDetail
                  result={activeDone}
                  accent={ACCENT}
                  rubric={currentRun?.rubric}
                />
              )}
            </>
          ) : null}
        </section>
      </div>

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
        runs={runs}
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
