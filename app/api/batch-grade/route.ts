import { getServerSupabase } from "@/lib/supabase-server";
import { getModel } from "@/lib/models";
import { rubricCriterionMax, type RubricCriterion, type PromptChunk } from "@/lib/prompt";
import { buildGradeRequestPayload, type GradeAnswerContent } from "@/lib/grading";
import { retrieveForGrading, type RetrievedChunk } from "@/lib/rag";
import { GRADING_UPLOADS_BUCKET } from "@/lib/storage";

export const runtime = "nodejs";

const MAX_ANSWERS = 50;
const STUCK_MS = 10 * 60 * 1000; // re-enqueue jobs stuck queued/running past this

interface BatchGradeRequest {
  runId?: string;
  modelKeys?: string[];
  documentIds?: string[];
  retry?: boolean;
}

interface RunRow {
  id: string;
  question: string | null;
  system_prompt: string | null;
}

interface AnswerRow {
  id: string;
  kind: "text" | "images" | "pdf";
  answer_text: string | null;
  is_scanned: boolean;
  status: string;
}

interface AnswerFileRow {
  id: string;
  answer_id: string;
  position: number;
  storage_path: string;
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

interface ExistingResultRow {
  id: string;
  answer_id: string | null;
  model_key: string;
  status: string | null;
  claimed_at: string | null;
  created_at: string | null;
}

function err(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

const toPromptChunk = (c: RetrievedChunk): PromptChunk => ({
  chunkId: c.chunkId,
  document: c.document,
  content: c.content,
});

const storageRef = (path: string) => `storage://${GRADING_UPLOADS_BUCKET}/${path}`;
const pairKey = (answerId: string, modelKey: string) => `${answerId}::${modelKey}`;

export async function POST(request: Request) {
  const workerBase = process.env.GRADER_WORKER_URL;
  const workerKey = process.env.GRADER_WORKER_API_KEY;
  if (!workerBase) return err("GRADER_WORKER_URL belum diset di .env.local", 500);
  if (!workerKey) return err("GRADER_WORKER_API_KEY belum diset di .env.local", 500);

  let body: BatchGradeRequest;
  try {
    body = (await request.json()) as BatchGradeRequest;
  } catch {
    return err("Body permintaan tidak valid", 400);
  }

  const runId = body.runId?.trim();
  const modelKeys = Array.isArray(body.modelKeys) ? [...new Set(body.modelKeys)] : [];
  const documentIds = Array.isArray(body.documentIds) ? body.documentIds : [];
  const retry = body.retry === true;

  if (!runId) return err("runId kosong", 400);
  if (!modelKeys.length) return err("Tidak ada model dipilih", 400);

  // Validate models up front so we never silently drop an unknown key.
  const modelMap = new Map<string, { openrouterId: string }>();
  for (const key of modelKeys) {
    const model = getModel(key);
    if (!model) return err(`Model tidak dikenal: ${key}`, 400);
    modelMap.set(key, { openrouterId: model.openrouterId });
  }

  const supabase = getServerSupabase();

  // ── load run ──────────────────────────────────────────────────────────────
  const { data: run, error: runErr } = await supabase
    .from("grading_runs")
    .select("id, question, system_prompt")
    .eq("id", runId)
    .maybeSingle<RunRow>();
  if (runErr) return err(`Gagal memuat run: ${runErr.message}`, 502);
  if (!run) return err("Run tidak ditemukan", 404);
  const question = run.question?.trim();
  if (!question) return err("Soal esai pada run masih kosong", 400);

  // ── load answers + files ────────────────────────────────────────────────────
  const { data: answersData, error: answersErr } = await supabase
    .from("grading_answers")
    .select("id, kind, answer_text, is_scanned, status")
    .eq("run_id", runId)
    .order("position", { ascending: true });
  if (answersErr) return err(`Gagal memuat jawaban: ${answersErr.message}`, 502);
  const answers = (answersData ?? []) as AnswerRow[];
  if (!answers.length) return err("Run ini belum punya jawaban", 400);
  if (answers.length > MAX_ANSWERS) {
    return err(`Maksimum ${MAX_ANSWERS} jawaban per run (ada ${answers.length})`, 400);
  }

  const { data: filesData, error: filesErr } = await supabase
    .from("grading_answer_files")
    .select("id, answer_id, position, storage_path")
    .in("answer_id", answers.map((a) => a.id));
  if (filesErr) return err(`Gagal memuat berkas: ${filesErr.message}`, 502);
  const files = (filesData ?? []) as AnswerFileRow[];
  const filesFor = (answerId: string) =>
    files.filter((f) => f.answer_id === answerId).sort((a, b) => a.position - b.position);

  // ── load rubric ─────────────────────────────────────────────────────────────
  const { data: rubricDefsData, error: rubricErr } = await supabase
    .from("grading_rubric")
    .select("id, position, criterion, description")
    .eq("run_id", runId)
    .order("position", { ascending: true });
  if (rubricErr) return err(`Gagal memuat rubrik: ${rubricErr.message}`, 502);
  const rubricDefs = (rubricDefsData ?? []) as RubricDefRow[];

  let rubric: RubricCriterion[] = [];
  if (rubricDefs.length) {
    const { data: levelsData, error: levelsErr } = await supabase
      .from("grading_rubric_levels")
      .select("rubric_id, level_value, description")
      .in("rubric_id", rubricDefs.map((r) => r.id));
    if (levelsErr) return err(`Gagal memuat level rubrik: ${levelsErr.message}`, 502);
    const levels = (levelsData ?? []) as RubricLevelRow[];
    rubric = rubricDefs.map((rd) => ({
      criterion: rd.criterion ?? "",
      description: rd.description ?? undefined,
      cells: levels
        .filter((l) => l.rubric_id === rd.id)
        .sort((a, b) => a.level_value - b.level_value)
        .map((l) => ({ level: l.level_value, description: l.description ?? "" })),
    }));
  }
  const rubricMax = rubric.reduce((sum, r) => sum + rubricCriterionMax(r), 0);
  const scoreMax = rubric.length && rubricMax > 0 ? rubricMax : 100;
  const activeRubric = rubric.length ? rubric : undefined;

  // ── existing results (for idempotent create + retry reset) ──────────────────
  const { data: existingData, error: existingErr } = await supabase
    .from("grading_results")
    .select("id, answer_id, model_key, status, claimed_at, created_at")
    .eq("run_id", runId);
  if (existingErr) return err(`Gagal memuat hasil: ${existingErr.message}`, 502);
  const existing = (existingData ?? []) as ExistingResultRow[];
  const existingMap = new Map<string, ExistingResultRow>();
  for (const r of existing) {
    if (r.answer_id) existingMap.set(pairKey(r.answer_id, r.model_key), r);
  }

  const now = Date.now();
  type Action = { kind: "create" } | { kind: "reset"; id: string } | { kind: "skip" };
  function classify(answerId: string, modelKey: string): Action {
    const row = existingMap.get(pairKey(answerId, modelKey));
    if (!row) return { kind: "create" };
    if (!retry) return { kind: "skip" };
    if (row.status === "error") return { kind: "reset", id: row.id };
    if (row.status === "queued" || row.status === "running") {
      const ref = row.claimed_at ?? row.created_at;
      const refMs = ref ? new Date(ref).getTime() : 0;
      if (now - refMs > STUCK_MS) return { kind: "reset", id: row.id };
    }
    return { kind: "skip" };
  }

  // ── material retrieval (RAG), memoized per distinct retrieval key ────────────
  const materialCache = new Map<string, PromptChunk[]>();
  async function materialFor(answerText: string | undefined): Promise<PromptChunk[]> {
    if (!documentIds.length) return [];
    const key = answerText?.trim() || " question-only";
    const cached = materialCache.get(key);
    if (cached) return cached;
    const chunks = (
      await retrieveForGrading(documentIds, question!, answerText?.trim() || undefined)
    ).map(toPromptChunk);
    materialCache.set(key, chunks);
    return chunks;
  }

  function answerContentFor(answer: AnswerRow): GradeAnswerContent {
    if (answer.kind === "text") {
      return { mode: "text", text: answer.answer_text ?? "" };
    }
    if (answer.kind === "images") {
      return {
        mode: "images",
        imageUrls: filesFor(answer.id).map((f) => storageRef(f.storage_path)),
      };
    }
    // pdf
    if (answer.is_scanned) {
      const first = filesFor(answer.id)[0];
      const path = first?.storage_path ?? "";
      const filename = (path.split("/").pop() || "jawaban.pdf").replace(/\.pdf$/i, "") + ".pdf";
      return { mode: "pdf", filename, fileData: storageRef(path) };
    }
    return { mode: "text", text: answer.answer_text ?? "" };
  }

  // ── build create + reset payloads ────────────────────────────────────────────
  interface NewRow {
    id: string;
    run_id: string;
    answer_id: string;
    model_key: string;
    status: "queued";
    attempts: number;
    request_payload: ReturnType<typeof buildGradeRequestPayload>;
    job_meta: { score_max: number };
  }
  const newRows: NewRow[] = [];
  const resetOps: Array<{ id: string; request_payload: ReturnType<typeof buildGradeRequestPayload> }> = [];

  try {
    for (const answer of answers) {
      const pending = modelKeys
        .map((mk) => ({ mk, action: classify(answer.id, mk) }))
        .filter((p) => p.action.kind !== "skip");
      if (!pending.length) continue;

      const content = answerContentFor(answer);
      const hasText =
        answer.kind === "text" || (answer.kind === "pdf" && !answer.is_scanned);
      const material = await materialFor(hasText ? answer.answer_text ?? undefined : undefined);

      for (const { mk, action } of pending) {
        const model = modelMap.get(mk)!;
        const payload = buildGradeRequestPayload({
          openrouterId: model.openrouterId,
          systemPrompt: run.system_prompt ?? undefined,
          question: question!,
          rubric: activeRubric,
          material,
          answer: content,
        });
        if (action.kind === "create") {
          newRows.push({
            id: crypto.randomUUID(),
            run_id: runId,
            answer_id: answer.id,
            model_key: mk,
            status: "queued",
            attempts: 0,
            request_payload: payload,
            job_meta: { score_max: scoreMax },
          });
        } else if (action.kind === "reset") {
          resetOps.push({ id: action.id, request_payload: payload });
        }
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gagal menyiapkan job";
    console.error("[batch-grade] build:", message);
    return err(`Gagal menyiapkan job penilaian: ${message}`, 502);
  }

  // ── persist new + reset rows ─────────────────────────────────────────────────
  if (newRows.length) {
    // Upsert with DO NOTHING on (answer_id, model_key) so a double submit can
    // never create duplicate jobs for the same pair (unique index in schema).
    const { error: insertErr } = await supabase
      .from("grading_results")
      .upsert(newRows, { onConflict: "answer_id,model_key", ignoreDuplicates: true });
    if (insertErr) return err(`Gagal membuat job: ${insertErr.message}`, 502);
  }

  const enqueueIds: string[] = newRows.map((r) => r.id);
  for (const op of resetOps) {
    const { error: resetErr } = await supabase
      .from("grading_results")
      .update({
        status: "queued",
        claimed_at: null,
        error: null,
        request_payload: op.request_payload,
        job_meta: { score_max: scoreMax },
      })
      .eq("id", op.id);
    if (resetErr) {
      console.error("[batch-grade] reset:", resetErr.message);
      continue; // skip enqueue for a row we failed to reset
    }
    enqueueIds.push(op.id);
  }

  // keep the run's answer_count in sync with reality
  await supabase
    .from("grading_runs")
    .update({ answer_count: answers.length })
    .eq("id", runId);

  const created = newRows.length;

  // ── enqueue to the worker ────────────────────────────────────────────────────
  if (!enqueueIds.length) {
    return Response.json({ created, enqueued: 0 });
  }

  const url = `${workerBase.replace(/\/$/, "")}/enqueue-prototype-answer-grading`;

  // The jobs never reached the queue — leaving them 'queued' would hide the
  // failure (no error shown, and the stuck-guard blocks retry for 10 minutes),
  // so mark them 'error' and let "Coba Lagi" reset + re-enqueue immediately.
  async function markEnqueueFailed(reason: string) {
    const { error: markErr } = await supabase
      .from("grading_results")
      .update({ status: "error", error: reason })
      .in("id", enqueueIds)
      .eq("status", "queued");
    if (markErr) console.error("[batch-grade] markEnqueueFailed:", markErr.message);
  }

  let enqueued = 0;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: workerKey,
        Authorization: `Bearer ${workerKey}`,
      },
      body: JSON.stringify({ jobs: enqueueIds.map((id) => ({ resultId: id })) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[batch-grade] worker rejected:", res.status, text);
      await markEnqueueFailed(`Gagal masuk antrian: worker menolak (${res.status})`);
      return Response.json(
        { created, enqueued: 0, error: `Worker menolak (${res.status})` },
        { status: 502 },
      );
    }
    const data = (await res.json().catch(() => ({}))) as { enqueued?: number };
    enqueued = typeof data.enqueued === "number" ? data.enqueued : enqueueIds.length;
  } catch (e) {
    const message = e instanceof Error ? e.message : "gagal";
    console.error("[batch-grade] enqueue:", message);
    await markEnqueueFailed(`Gagal masuk antrian: ${message}`);
    return Response.json(
      { created, enqueued: 0, error: `Gagal menghubungi worker: ${message}` },
      { status: 502 },
    );
  }

  return Response.json({ created, enqueued });
}
