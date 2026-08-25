// Typed, client-usable Supabase helpers for the batch-grading flow. These are
// what the UI consumes to manage draft runs, answers, files, and to poll
// results. They sit on top of the browser Supabase singleton (lib/supabase.ts)
// and speak the batch schema (grading_answers / grading_answer_files plus the
// extended grading_results columns).
//
// The legacy sync helpers still live inline in app/page.tsx; this module does
// not replace them. It only adds the new batch surface.
import { getSupabase } from "@/lib/supabase";
import {
  deriveVerdict,
  type AnswerEntry,
  type AnswerFileRef,
  type AnswerKind,
  type AnswerStatus,
  type Citation,
  type GradeResponse,
  type ResultStatus,
  type RubricDef,
  type RunResult,
} from "@/lib/models";

// ── raw row shapes ───────────────────────────────────────────────────────────

interface RunRow {
  id: string;
  created_at: string | null;
  question: string | null;
  image_count: number | null;
  system_prompt: string | null;
  title: string | null;
  answer_count: number | null;
}

interface AnswerRow {
  id: string;
  run_id: string;
  position: number;
  student_label: string;
  kind: AnswerKind;
  answer_text: string | null;
  extraction_note: string | null;
  is_scanned: boolean;
  status: AnswerStatus;
  error: string | null;
  created_at: string | null;
}

interface AnswerFileRow {
  id: string;
  answer_id: string;
  position: number;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string | null;
}

interface ResultRow {
  id: string;
  run_id: string;
  answer_id: string | null;
  model_key: string;
  score: number | null;
  extracted_text: string | null;
  extraction_note: string | null;
  feedback_text: string | null;
  strengths: string[] | null;
  improvements: string[] | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  latency: number | null;
  status: ResultStatus | null;
  attempts: number | null;
  error: string | null;
  rubric_breakdown: GradeResponse["rubric_breakdown"] | null;
  citations: Citation[] | null;
  created_at: string | null;
  claimed_at: string | null;
}

// Everything mapResult needs — deliberately NOT "*": request_payload/job_meta
// are fat jsonb blobs the UI never reads, and fetchBatchResults is polled every
// ~3s while a batch is grading.
const RESULT_COLUMNS =
  "id, run_id, answer_id, model_key, score, extracted_text, extraction_note, " +
  "feedback_text, strengths, improvements, prompt_tokens, completion_tokens, " +
  "total_tokens, latency, status, attempts, error, rubric_breakdown, citations, " +
  "created_at, claimed_at";

// ── mappers ──────────────────────────────────────────────────────────────────

function mapFile(row: AnswerFileRow): AnswerFileRef {
  return {
    id: row.id,
    answerId: row.answer_id,
    position: row.position,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
  };
}

function mapAnswer(row: AnswerRow, files: AnswerFileRow[]): AnswerEntry {
  return {
    id: row.id,
    runId: row.run_id,
    position: row.position,
    studentLabel: row.student_label,
    kind: row.kind,
    answerText: row.answer_text,
    extractionNote: row.extraction_note,
    isScanned: row.is_scanned,
    status: row.status,
    error: row.error,
    files: files
      .filter((f) => f.answer_id === row.id)
      .sort((a, b) => a.position - b.position)
      .map(mapFile),
  };
}

function gradeFromRow(row: ResultRow): GradeResponse {
  return {
    score: row.score ?? 0,
    extracted_text: row.extracted_text ?? "",
    extraction_note: row.extraction_note ?? "",
    feedback_text: row.feedback_text ?? "",
    strengths: row.strengths ?? [],
    improvements: row.improvements ?? [],
    usage: {
      prompt_tokens: row.prompt_tokens,
      completion_tokens: row.completion_tokens,
      total_tokens: row.total_tokens,
    },
    latency: row.latency ?? 0,
    rubric_breakdown: row.rubric_breakdown ?? undefined,
    citations: row.citations ?? undefined,
  };
}

// scoreMax lets the caller pass the run's rubric max so the verdict color is
// right; defaults to the 0–100 scale used when there is no rubric.
function mapResult(row: ResultRow, scoreMax = 100): RunResult {
  const status: ResultStatus = row.status ?? "done";
  const done = status === "done";
  return {
    id: row.id,
    runId: row.run_id,
    answerId: row.answer_id,
    modelKey: row.model_key,
    status,
    error: row.error,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    grade: done ? gradeFromRow(row) : undefined,
    verdictKind: done ? deriveVerdict(row.score ?? 0, scoreMax) : undefined,
  };
}

// ── runs ─────────────────────────────────────────────────────────────────────

export interface CreateDraftRunInput {
  question?: string;
  title?: string;
  systemPrompt?: string;
}

// Create an empty draft run and return its id. answer_count starts at 0 and is
// kept truthful by createAnswer/deleteAnswer.
export async function createDraftRun(
  input: CreateDraftRunInput = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await getSupabase()
    .from("grading_runs")
    .insert({
      id,
      question: input.question ?? null,
      title: input.title ?? null,
      system_prompt: input.systemPrompt ?? null,
      image_count: 0,
      answer_count: 0,
    });
  if (error) throw new Error(error.message);
  return id;
}

export async function updateRunQuestion(
  runId: string,
  question: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from("grading_runs")
    .update({ question })
    .eq("id", runId);
  if (error) throw new Error(error.message);
}

export async function updateRunTitle(
  runId: string,
  title: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from("grading_runs")
    .update({ title: title.trim() || null })
    .eq("id", runId);
  if (error) throw new Error(error.message);
}

export async function updateRunSystemPrompt(
  runId: string,
  systemPrompt: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from("grading_runs")
    .update({ system_prompt: systemPrompt })
    .eq("id", runId);
  if (error) throw new Error(error.message);
}

export interface RunSummaryRow {
  id: string;
  ts: number;
  question: string;
  systemPrompt: string;
  title?: string;
  answerCount: number;
}

// Fetch one run's own fields (not its results) — used when resuming a draft or
// opening a run's detail view from history.
export async function getRun(runId: string): Promise<RunSummaryRow | null> {
  const { data, error } = await getSupabase()
    .from("grading_runs")
    .select("id, created_at, question, system_prompt, title, answer_count")
    .eq("id", runId)
    .maybeSingle<RunRow>();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    ts: data.created_at ? new Date(data.created_at).getTime() : Date.now(),
    question: data.question ?? "",
    systemPrompt: data.system_prompt ?? "",
    title: data.title ?? undefined,
    answerCount: data.answer_count ?? 0,
  };
}

export async function deleteRun(runId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("grading_runs")
    .delete()
    .eq("id", runId);
  if (error) throw new Error(error.message);
}

// Recount answers for a run and write grading_runs.answer_count. Called after
// createAnswer/deleteAnswer so the history summary stays accurate.
async function syncAnswerCount(runId: string): Promise<void> {
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("grading_answers")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId);
  if (error) return; // best-effort — do not block the primary mutation
  await supabase
    .from("grading_runs")
    .update({ answer_count: count ?? 0 })
    .eq("id", runId);
}

// ── answers ──────────────────────────────────────────────────────────────────

export interface CreateAnswerInput {
  // Caller-supplied id lets bulk upload reserve stable entry ids synchronously
  // and insert the rows concurrently afterwards. Generated when omitted.
  id?: string;
  runId: string;
  position: number;
  studentLabel: string;
  kind: AnswerKind;
  answerText?: string | null;
  extractionNote?: string | null;
  isScanned?: boolean;
  status?: AnswerStatus;
  error?: string | null;
}

export async function createAnswer(input: CreateAnswerInput): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  const { error } = await getSupabase()
    .from("grading_answers")
    .insert({
      id,
      run_id: input.runId,
      position: input.position,
      student_label: input.studentLabel,
      kind: input.kind,
      answer_text: input.answerText ?? null,
      extraction_note: input.extractionNote ?? null,
      is_scanned: input.isScanned ?? false,
      status: input.status ?? "ready",
      error: input.error ?? null,
    });
  if (error) throw new Error(error.message);
  await syncAnswerCount(input.runId);
  return id;
}

export interface UpdateAnswerPatch {
  position?: number;
  studentLabel?: string;
  kind?: AnswerKind;
  answerText?: string | null;
  extractionNote?: string | null;
  isScanned?: boolean;
  status?: AnswerStatus;
  error?: string | null;
}

export async function updateAnswer(
  answerId: string,
  patch: UpdateAnswerPatch,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.position !== undefined) row.position = patch.position;
  if (patch.studentLabel !== undefined) row.student_label = patch.studentLabel;
  if (patch.kind !== undefined) row.kind = patch.kind;
  if (patch.answerText !== undefined) row.answer_text = patch.answerText;
  if (patch.extractionNote !== undefined) row.extraction_note = patch.extractionNote;
  if (patch.isScanned !== undefined) row.is_scanned = patch.isScanned;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.error !== undefined) row.error = patch.error;
  if (Object.keys(row).length === 0) return;

  const { error } = await getSupabase()
    .from("grading_answers")
    .update(row)
    .eq("id", answerId);
  if (error) throw new Error(error.message);
}

// Deletes the answer (cascades to its files and results). Pass runId to keep the
// run's answer_count in sync.
export async function deleteAnswer(
  answerId: string,
  runId?: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from("grading_answers")
    .delete()
    .eq("id", answerId);
  if (error) throw new Error(error.message);
  if (runId) await syncAnswerCount(runId);
}

// ── answer files ─────────────────────────────────────────────────────────────

export interface AddAnswerFileInput {
  answerId: string;
  position?: number;
  storagePath: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
}

export async function addAnswerFile(
  input: AddAnswerFileInput,
): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await getSupabase()
    .from("grading_answer_files")
    .insert({
      id,
      answer_id: input.answerId,
      position: input.position ?? 0,
      storage_path: input.storagePath,
      mime_type: input.mimeType ?? null,
      size_bytes: input.sizeBytes ?? null,
    });
  if (error) throw new Error(error.message);
  return id;
}

export async function deleteAnswerFile(fileId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("grading_answer_files")
    .delete()
    .eq("id", fileId);
  if (error) throw new Error(error.message);
}

// ── results ──────────────────────────────────────────────────────────────────

export async function deleteResult(resultId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("grading_results")
    .delete()
    .eq("id", resultId);
  if (error) throw new Error(error.message);
}

// ── rubric (grading_rubric / grading_rubric_levels) ─────────────────────────
// These back the "matrix" rubric a run is graded against. /api/batch-grade
// reads them directly to build request_payload for every (answer × model) job,
// so they must be persisted before POSTing there.

// Overwrite the run's rubric: clears any previously saved rubric for this run
// (cascades to grading_rubric_levels) and inserts the current one. Safe to call
// repeatedly while a draft run is being composed. Returns the inserted rubric
// row ids in criterion order (rubric[i] ↔ returned[i]).
export async function saveRubric(
  runId: string,
  rubric: RubricDef[],
): Promise<Array<{ id: string; position: number }>> {
  const supabase = getSupabase();
  const { error: delErr } = await supabase
    .from("grading_rubric")
    .delete()
    .eq("run_id", runId);
  if (delErr) throw new Error(delErr.message);
  if (!rubric.length) return [];

  const rows = rubric.map((r, i) => ({
    run_id: runId,
    position: i,
    criterion: r.criterion,
    description: r.description ?? null,
  }));
  const { data, error } = await supabase
    .from("grading_rubric")
    .insert(rows)
    .select("id, position");
  if (error) throw new Error(error.message);

  const rubricRows = ((data ?? []) as Array<{ id: string; position: number }>).sort(
    (a, b) => a.position - b.position,
  );

  const levelRows = rubricRows.flatMap((rr, i) =>
    rubric[i].cells.map((c) => ({
      rubric_id: rr.id,
      level_value: c.level,
      description: c.description,
    })),
  );
  if (levelRows.length) {
    const { error: levelErr } = await supabase
      .from("grading_rubric_levels")
      .insert(levelRows);
    if (levelErr) throw new Error(levelErr.message);
  }

  return rubricRows;
}

interface RubricDefRow {
  id: string;
  position: number;
  criterion: string | null;
  description: string | null;
}

interface RubricLevelRow {
  rubric_id: string;
  level_value: number;
  description: string | null;
}

interface RubricScoreRow {
  rubric_id: string;
  result_id: string;
  awarded_score: number;
  reason: string | null;
}

// Load the rubric matrix saved against a run (empty array when none).
export async function loadRubricForRun(runId: string): Promise<RubricDef[]> {
  const supabase = getSupabase();
  const { data: defsData, error: defsErr } = await supabase
    .from("grading_rubric")
    .select("id, position, criterion, description")
    .eq("run_id", runId)
    .order("position", { ascending: true });
  if (defsErr) throw new Error(defsErr.message);
  const defs = (defsData ?? []) as RubricDefRow[];
  if (!defs.length) return [];

  const { data: levelsData, error: levelsErr } = await supabase
    .from("grading_rubric_levels")
    .select("rubric_id, level_value, description")
    .in("rubric_id", defs.map((d) => d.id));
  if (levelsErr) throw new Error(levelsErr.message);
  const levels = (levelsData ?? []) as RubricLevelRow[];

  return defs.map((d) => ({
    criterion: d.criterion ?? "",
    description: d.description ?? undefined,
    cells: levels
      .filter((l) => l.rubric_id === d.id)
      .sort((a, b) => a.level_value - b.level_value)
      .map((l) => ({ level: l.level_value, description: l.description ?? "" })),
  }));
}

// Legacy sync results (pre-batch, answer_id null) never got a rubric_breakdown
// jsonb column populated — their per-criterion scores live in the older
// grading_rubric_scores join table instead. Batch rows already carry
// rubric_breakdown directly (written by the worker) and never need this.
export async function loadLegacyRubricBreakdown(
  runId: string,
  rubric: RubricDef[],
): Promise<Map<string, NonNullable<GradeResponse["rubric_breakdown"]>>> {
  const empty = new Map<string, NonNullable<GradeResponse["rubric_breakdown"]>>();
  if (!rubric.length) return empty;
  const supabase = getSupabase();

  const { data: defsData, error: defsErr } = await supabase
    .from("grading_rubric")
    .select("id, position, criterion, description")
    .eq("run_id", runId)
    .order("position", { ascending: true });
  if (defsErr) throw new Error(defsErr.message);
  const defs = (defsData ?? []) as RubricDefRow[];
  if (!defs.length) return empty;

  const { data: levelsData, error: levelsErr } = await supabase
    .from("grading_rubric_levels")
    .select("rubric_id, level_value, description")
    .in("rubric_id", defs.map((d) => d.id));
  if (levelsErr) throw new Error(levelsErr.message);
  const levels = (levelsData ?? []) as RubricLevelRow[];
  const maxFor = (rubricId: string) => {
    const own = levels.filter((l) => l.rubric_id === rubricId);
    return own.length ? Math.max(...own.map((l) => l.level_value)) : 0;
  };

  const { data: scoresData, error: scoresErr } = await supabase
    .from("grading_rubric_scores")
    .select("rubric_id, result_id, awarded_score, reason")
    .in("rubric_id", defs.map((d) => d.id));
  if (scoresErr) throw new Error(scoresErr.message);
  const scores = (scoresData ?? []) as RubricScoreRow[];

  const byResult = new Map<string, NonNullable<GradeResponse["rubric_breakdown"]>>();
  for (const def of defs) {
    for (const s of scores.filter((sc) => sc.rubric_id === def.id)) {
      const list = byResult.get(s.result_id) ?? [];
      list.push({
        criterion: def.criterion ?? "",
        max: maxFor(def.id),
        awarded: s.awarded_score,
        reason: s.reason ?? "",
      });
      byResult.set(s.result_id, list);
    }
  }
  return byResult;
}

// ── reads ────────────────────────────────────────────────────────────────────

export async function listAnswersWithFiles(
  runId: string,
): Promise<AnswerEntry[]> {
  const supabase = getSupabase();
  const { data: answers, error: answersErr } = await supabase
    .from("grading_answers")
    .select("*")
    .eq("run_id", runId)
    .order("position", { ascending: true });
  if (answersErr) throw new Error(answersErr.message);

  const answerRows = (answers ?? []) as AnswerRow[];
  if (!answerRows.length) return [];

  const { data: files, error: filesErr } = await supabase
    .from("grading_answer_files")
    .select("*")
    .in(
      "answer_id",
      answerRows.map((a) => a.id),
    );
  if (filesErr) throw new Error(filesErr.message);

  const fileRows = (files ?? []) as AnswerFileRow[];
  return answerRows.map((a) => mapAnswer(a, fileRows));
}

// All grading_results for a run (any status) — the source of truth for progress
// polling. Pass scoreMax to color verdicts against a rubric total.
export async function fetchBatchResults(
  runId: string,
  scoreMax = 100,
): Promise<RunResult[]> {
  const { data, error } = await getSupabase()
    .from("grading_results")
    .select(RESULT_COLUMNS)
    .eq("run_id", runId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ResultRow[]).map((r) => mapResult(r, scoreMax));
}

// ── batch-aware history ──────────────────────────────────────────────────────

export interface BatchRunSummary {
  id: string;
  ts: number;
  question: string;
  title?: string;
  systemPrompt: string;
  answerCount: number;
  // Per-run result aggregate, for progress badges in the history list.
  resultCount: number;
  queuedCount: number;
  runningCount: number;
  doneCount: number;
  errorCount: number;
}

// History list with answer_count and a per-run status aggregate. answerCount
// reflects the real number of grading_answers rows (falling back to the stored
// column) so it is correct even before a run is graded.
export async function loadBatchHistory(): Promise<BatchRunSummary[]> {
  const supabase = getSupabase();

  const { data: runs, error: runsErr } = await supabase
    .from("grading_runs")
    .select("*")
    .order("created_at", { ascending: false });
  if (runsErr) throw new Error(runsErr.message);
  const runRows = (runs ?? []) as RunRow[];
  if (!runRows.length) return [];

  const { data: answers } = await supabase
    .from("grading_answers")
    .select("run_id");
  const { data: results } = await supabase
    .from("grading_results")
    .select("run_id, status");

  const answerCounts = new Map<string, number>();
  for (const a of (answers ?? []) as Array<{ run_id: string }>) {
    answerCounts.set(a.run_id, (answerCounts.get(a.run_id) ?? 0) + 1);
  }

  const agg = new Map<
    string,
    { total: number; queued: number; running: number; done: number; error: number }
  >();
  for (const r of (results ?? []) as Array<{ run_id: string; status: ResultStatus | null }>) {
    const cur =
      agg.get(r.run_id) ?? { total: 0, queued: 0, running: 0, done: 0, error: 0 };
    cur.total += 1;
    if (r.status === "queued") cur.queued += 1;
    else if (r.status === "running") cur.running += 1;
    else if (r.status === "error") cur.error += 1;
    else cur.done += 1; // "done" and legacy null/"pending" count as done
    agg.set(r.run_id, cur);
  }

  return runRows.map((row) => {
    const a = agg.get(row.id) ?? {
      total: 0,
      queued: 0,
      running: 0,
      done: 0,
      error: 0,
    };
    return {
      id: row.id,
      ts: row.created_at ? new Date(row.created_at).getTime() : 0,
      question: row.question ?? "",
      title: row.title ?? undefined,
      systemPrompt: row.system_prompt ?? "",
      answerCount: answerCounts.get(row.id) ?? row.answer_count ?? 0,
      resultCount: a.total,
      queuedCount: a.queued,
      runningCount: a.running,
      doneCount: a.done,
      errorCount: a.error,
    };
  });
}
