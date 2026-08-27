// In-process fallback executor for batch grading jobs, used when
// GRADER_WORKER_URL is not configured. The Cloudflare worker normally consumes
// these jobs from a queue, but the app must stay usable with only Supabase +
// OPENROUTER_API_KEY set (local dev, quick deployments without the worker).
//
// Same contract as the worker executor (docs/BATCH_GRADING_CONTRACT.md):
// claim a queued grading_results row, resolve storage:// refs, POST the stored
// request_payload verbatim to OpenRouter, parse the forced grade_answer tool
// call, and write the result back. Transient provider errors are retried a
// couple of times inline, then surfaced as status='error' so the UI's
// "Coba Lagi" can re-run them — there is no queue to lean on in this mode.
import { getServerSupabase } from "@/lib/supabase-server";
import { GRADING_UPLOADS_BUCKET } from "@/lib/storage";
import { parseGradeToolResponse } from "@/lib/grading";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const CONCURRENCY = 3;
const TRANSIENT_ATTEMPTS = 2;
const RETRY_DELAY_MS = 2000;
const STORAGE_REF_PREFIX = `storage://${GRADING_UPLOADS_BUCKET}/`;

interface ContentPart {
  type?: string;
  image_url?: { url?: string };
  file?: { filename?: string; file_data?: string };
}

interface RequestPayload {
  model?: string;
  messages?: Array<{ role?: string; content?: string | ContentPart[] }>;
  [k: string]: unknown;
}

interface JobRow {
  id: string;
  status: string | null;
  attempts: number | null;
  request_payload: RequestPayload | null;
  job_meta: { score_max?: number } | null;
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

class JobError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function resolveStorageRefs(payload: RequestPayload): Promise<void> {
  const supabase = getServerSupabase();
  for (const msg of payload.messages ?? []) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (
        part?.type === "image_url" &&
        typeof part.image_url?.url === "string" &&
        part.image_url.url.startsWith(STORAGE_REF_PREFIX)
      ) {
        const path = part.image_url.url.slice(STORAGE_REF_PREFIX.length);
        const { data, error } = await supabase.storage
          .from(GRADING_UPLOADS_BUCKET)
          .createSignedUrl(path, 3600);
        if (error || !data?.signedUrl) {
          throw new JobError(`Gagal menandatangani "${path}": ${error?.message}`, true);
        }
        part.image_url.url = data.signedUrl;
      } else if (
        part?.type === "file" &&
        typeof part.file?.file_data === "string" &&
        part.file.file_data.startsWith(STORAGE_REF_PREFIX)
      ) {
        const path = part.file.file_data.slice(STORAGE_REF_PREFIX.length);
        const { data, error } = await supabase.storage
          .from(GRADING_UPLOADS_BUCKET)
          .download(path);
        if (error || !data) {
          throw new JobError(`Gagal mengunduh PDF "${path}": ${error?.message}`, true);
        }
        const b64 = Buffer.from(await data.arrayBuffer()).toString("base64");
        part.file.file_data = `data:application/pdf;base64,${b64}`;
      }
    }
  }
}

async function callOpenRouter(payload: RequestPayload): Promise<OpenRouterResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new JobError("OPENROUTER_API_KEY belum diset", false);

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new JobError(
      `Panggilan OpenRouter gagal: ${e instanceof Error ? e.message : String(e)}`,
      true,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const transient = res.status === 429 || res.status === 402 || res.status >= 500;
    throw new JobError(`OpenRouter ${res.status}: ${text.slice(0, 300)}`, transient);
  }
  return (await res.json()) as OpenRouterResponse;
}

async function runOne(resultId: string): Promise<void> {
  const supabase = getServerSupabase();

  const { data: row, error: loadErr } = await supabase
    .from("grading_results")
    .select("id, status, attempts, request_payload, job_meta")
    .eq("id", resultId)
    .maybeSingle<JobRow>();
  if (loadErr || !row) return;
  if (row.status !== "queued") return; // done, running elsewhere, or errored

  // Optimistic claim — the status guard makes a double execution a no-op.
  const { data: claimed } = await supabase
    .from("grading_results")
    .update({
      status: "running",
      claimed_at: new Date().toISOString(),
      attempts: (row.attempts ?? 0) + 1,
    })
    .eq("id", resultId)
    .eq("status", "queued")
    .select("id");
  if (!claimed?.length) return;

  try {
    const payload = row.request_payload;
    if (!payload || !Array.isArray(payload.messages)) {
      throw new JobError("request_payload tidak valid", false);
    }
    const scoreMax =
      typeof row.job_meta?.score_max === "number" ? row.job_meta.score_max : 100;

    await resolveStorageRefs(payload);

    let data: OpenRouterResponse | null = null;
    let latency = 0;
    for (let attempt = 1; ; attempt++) {
      const startedAt = Date.now();
      try {
        data = await callOpenRouter(payload);
        latency = +((Date.now() - startedAt) / 1000).toFixed(1);
        break;
      } catch (e) {
        if (e instanceof JobError && e.transient && attempt < TRANSIENT_ATTEMPTS) {
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        throw e;
      }
    }

    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (typeof args !== "string" || !args) {
      throw new JobError("Model tidak mengembalikan tool call grade_answer", false);
    }
    let grade;
    try {
      grade = parseGradeToolResponse(args, { scoreMax });
    } catch {
      throw new JobError("Hasil grade_answer bukan JSON valid", false);
    }

    const usage = data.usage ?? {};
    const { error: writeErr } = await supabase
      .from("grading_results")
      .update({
        score: grade.score,
        extracted_text: grade.extracted_text,
        extraction_note: grade.extraction_note,
        feedback_text: grade.feedback_text,
        strengths: grade.strengths,
        improvements: grade.improvements,
        rubric_breakdown: grade.rubric_breakdown ?? null,
        citations: grade.citations ?? null,
        prompt_tokens: usage.prompt_tokens ?? null,
        completion_tokens: usage.completion_tokens ?? null,
        total_tokens: usage.total_tokens ?? null,
        latency,
        status: "done",
        error: null,
      })
      .eq("id", resultId);
    if (writeErr) throw new JobError(`Gagal menyimpan hasil: ${writeErr.message}`, false);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[job-executor] ${resultId}:`, message);
    await supabase
      .from("grading_results")
      .update({ status: "error", error: message })
      .eq("id", resultId);
  }
}

// Process the given job rows in-process with bounded concurrency. Fire-and-
// forget from the route via after(); each row ends in 'done' or 'error'.
export async function executeQueuedResultsInline(resultIds: string[]): Promise<void> {
  let next = 0;
  const lanes = Array.from(
    { length: Math.min(CONCURRENCY, resultIds.length) },
    async () => {
      while (next < resultIds.length) {
        const i = next++;
        await runOne(resultIds[i]);
      }
    },
  );
  await Promise.all(lanes);
}
