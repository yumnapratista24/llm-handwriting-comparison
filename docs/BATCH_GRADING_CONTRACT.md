# Batch grading contract (v1)

Grade **1 essay question** against **up to 50 student answers** (typed text,
images, or PDF) with **N selected models**. One job = one `(answer × model)`
pair = one LLM call.

## Repos

- **App (producer + UI)** — `prototype-llm-comparison`
  Next.js 16.2.9 App Router, pnpm, TypeScript. UI in Bahasa Indonesia.
- **Worker (consumer)** — `binderlab-grade-submission`
  Cloudflare Worker + Cloudflare Queues, wrangler.

## Supabase schema

Existing tables: `grading_runs`, `grading_results`, `grading_rubric`,
`grading_rubric_levels`, `grading_rubric_scores` — permissive anon RLS, no auth.

### New tables

`grading_answers`

| column          | type                                                        |
| --------------- | ----------------------------------------------------------- |
| id              | uuid pk default gen_random_uuid()                           |
| run_id          | uuid not null → grading_runs(id) on delete cascade          |
| position        | int not null                                                |
| student_label   | text not null                                               |
| kind            | text not null check (kind in ('text','images','pdf'))       |
| answer_text     | text                                                        |
| extraction_note | text                                                        |
| is_scanned      | boolean not null default false                              |
| status          | text not null default 'ready' check (in ('ready','error'))  |
| error           | text                                                        |
| created_at      | timestamptz not null default now()                          |

`grading_answer_files`

| column       | type                                                  |
| ------------ | ----------------------------------------------------- |
| id           | uuid pk default gen_random_uuid()                     |
| answer_id    | uuid not null → grading_answers(id) on delete cascade |
| position     | int not null default 0                                |
| storage_path | text not null                                         |
| mime_type    | text                                                  |
| size_bytes   | bigint                                                |
| created_at   | timestamptz not null default now()                    |

### Altered tables

`grading_results` — add: `answer_id uuid null → grading_answers(id) on delete cascade`,
`status text not null default 'done' check (in ('queued','running','done','error'))`,
`attempts int not null default 0`, `claimed_at timestamptz`, `error text`,
`request_payload jsonb`, `job_meta jsonb`, `rubric_breakdown jsonb`,
`citations jsonb`. Legacy rows keep `answer_id` null / `status` `'done'`.

`grading_runs` — add: `answer_count int not null default 1`.

### RLS

Permissive anon policies identical in spirit to the existing tables
(`for all to anon using (true) with check (true)`).

### Storage

PRIVATE bucket `grading-uploads`. Object paths:

```
runs/{run_id}/answers/{answer_id}/{uuid}-{sanitized-filename}
```

Permissive anon policies on `storage.objects` scoped to this bucket
(select / insert / update / delete).

Migration: `supabase/migrations/20260824_batch_grading.sql` (idempotent, safe to
paste into the SQL editor). `supabase/schema.sql` reflects the full schema for
fresh installs.

## Job model

The app creates one `grading_results` row per `(answer × model)` with
`status='queued'` and:

- **`request_payload`** — the EXACT OpenRouter `POST /chat/completions` body
  (`model`, `messages`, `tools`, `tool_choice`, and `plugins` when a PDF file
  part is present), except binary refs use the placeholder scheme
  `storage://grading-uploads/<object-path>`:
  - image part:
    `{ "type": "image_url", "image_url": { "url": "storage://grading-uploads/..." } }`
  - PDF part:
    `{ "type": "file", "file": { "filename": "<name>.pdf", "file_data": "storage://grading-uploads/..." } }`
    plus request-root
    `"plugins": [{ "id": "file-parser", "pdf": { "engine": "mistral-ocr" } }]`
- **`job_meta`** — `{ "score_max": <number> }` — clamp bound (rubric max when a
  rubric is present, else 100).

### Answer-kind payload rules

| kind     | is_scanned | payload                                             |
| -------- | ---------- | --------------------------------------------------- |
| `text`   | —          | `answer_text` as a text part                        |
| `images` | —          | `storage://` image parts                            |
| `pdf`    | `false`    | extracted `answer_text` as text (NO file part)      |
| `pdf`    | `true`     | PDF file part + `file-parser` plugin                |

Progress source of truth = `grading_results.status`; the UI polls these rows.
`grading_answers.status` only reflects upload/extraction failures.

## Queue (Cloudflare)

- Queue `prototype-answer-grading`, DLQ `prototype-answer-grading-dlq`.
- Message body: `{ "type": "prototype-answer-grading", "resultId": "<grading_results.id>" }`

## Worker HTTP enqueue endpoint

`POST {worker}/enqueue-prototype-answer-grading`

- auth: identical to existing routes (`apikey` or `Authorization: Bearer` vs `CLIENT_API_KEY`).
- request: `{ "jobs": [ { "resultId": "..." } ] }` — enqueue via producer binding,
  `sendBatch` chunked at ≤ 100.
- response: `{ "enqueued": <int> }`

## Worker job processing (per message)

1. Load `grading_results` by `resultId` from the PROTOTYPE Supabase
   (`PROTOTYPE_SUPABASE_URL` + `PROTOTYPE_SUPABASE_SERVICE_ROLE_KEY`, distinct
   from the worker's existing `SUPABASE_*`). Missing row → ack (permanent).
   `status` already `'done'` → ack (idempotent redelivery).
2. Claim: `status='running'`, `claimed_at=now()`, `attempts=attempts+1`.
3. Resolve `storage://` refs: image parts → 1h signed URL from bucket
   `grading-uploads`; PDF `file_data` → download object + base64 →
   `data:application/pdf;base64,...`.
4. POST `request_payload` verbatim (after ref resolution) to OpenRouter with the
   existing `OPENROUTER_API_KEY`; measure latency in seconds.
5. Parse the forced `grade_answer` tool-call arguments:
   `{ extracted_text, extraction_note, score, feedback_text, strengths[], improvements[], rubric_breakdown[], citations[] }`.
   Clamp `score` to `[0, job_meta.score_max]`.
6. Write back: `score`, `extracted_text`, `extraction_note`, `feedback_text`,
   `strengths`, `improvements`, `rubric_breakdown`, `citations`,
   `prompt_tokens`, `completion_tokens`, `total_tokens`, `latency`,
   `status='done'`, `error=null`.
7. Error classification (mirrors the existing `GradingError` pattern):
   - bad payload / missing data / unparseable tool call → **permanent**:
     `status='error'` + error message, ack.
   - 429 / 402 / 5xx / network → **transient**: `status` back to `'queued'` with
     error noted, `message.retry()` (DLQ after max retries).

## App API routes

### `POST /api/batch-grade`

Body: `{ runId, modelKeys: string[], documentIds?: string[], retry?: boolean }`.

- Loads run / answers / files / rubric from Supabase.
- RAG retrieval via `lib/rag.ts` when `documentIds` present (memoized per
  distinct retrieval key; answers with known text retrieve on that text, others
  on the question only).
- Creates missing `(answer × model)` queued rows with `request_payload` /
  `job_meta`.
- When `retry=true`, also resets rows in `'error'` or stuck `'queued'`/`'running'`
  older than 10 minutes and re-enqueues them.
- Rejects `> 50` answers.
- POSTs `resultId`s to the worker enqueue endpoint using
  `GRADER_WORKER_URL` + `GRADER_WORKER_API_KEY` (server-only).
- Response: `{ created, enqueued }`.

### `POST /api/answers/extract`

Body: `{ answerId }`.

- Downloads the answer PDF from storage, extracts text with `unpdf`, writes
  `answer_text` + `is_scanned` (scanned when average `< ~40` chars/page).
- Response: `{ answerText, isScanned }`.

### `POST /api/grade` (existing single sync grading)

Kept working with identical behavior, refactored onto the shared grading core
(`lib/grading.ts`).

## Env additions (NAMES only)

- App: `GRADER_WORKER_URL`, `GRADER_WORKER_API_KEY` (server-side only, no
  `NEXT_PUBLIC` prefix).
- Worker secrets: `PROTOTYPE_SUPABASE_URL`, `PROTOTYPE_SUPABASE_SERVICE_ROLE_KEY`.

## Concrete payload examples

### `job_meta`

```json
{ "score_max": 12 }
```

`score_max` is the sum of each rubric criterion's highest level (12 above); when
no rubric is attached it is `100`.

### `request_payload` — `kind='text'` (or `kind='pdf'`, `is_scanned=false`)

```json
{
  "model": "openai/gpt-4o",
  "messages": [
    { "role": "system", "content": "You are an expert academic grader. ...\n\nIMPORTANT:\n1. ..." },
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Question: Jelaskan ...\n\nStudent answer (already provided as text — no transcription needed):\nKPI adalah ...\n\nGrade the answer above." }
      ]
    }
  ],
  "tools": [ { "type": "function", "function": { "name": "grade_answer", "description": "...", "parameters": { "type": "object", "properties": { "...": "..." }, "required": ["extracted_text", "extraction_note", "score", "feedback_text", "strengths", "improvements"] } } } ],
  "tool_choice": { "type": "function", "function": { "name": "grade_answer" } }
}
```

### `request_payload` — `kind='images'`

```json
{
  "model": "google/gemini-2.5-flash",
  "messages": [
    { "role": "system", "content": "..." },
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Question: ...\n\nThe student has submitted handwritten answer(s). Please extract the text and grade it." },
        { "type": "image_url", "image_url": { "url": "storage://grading-uploads/runs/1f.../answers/9a.../c0ffee-page-1.jpg" } },
        { "type": "image_url", "image_url": { "url": "storage://grading-uploads/runs/1f.../answers/9a.../d00d-page-2.jpg" } }
      ]
    }
  ],
  "tools": [ { "type": "function", "function": { "name": "grade_answer", "...": "..." } } ],
  "tool_choice": { "type": "function", "function": { "name": "grade_answer" } }
}
```

### `request_payload` — `kind='pdf'`, `is_scanned=true`

```json
{
  "model": "google/gemini-2.5-pro",
  "messages": [
    { "role": "system", "content": "..." },
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Question: ...\n\nThe student has submitted handwritten answer(s). Please extract the text and grade it." },
        { "type": "file", "file": { "filename": "scan-lembar-jawaban.pdf", "file_data": "storage://grading-uploads/runs/1f.../answers/9a.../beef-scan-lembar-jawaban.pdf" } }
      ]
    }
  ],
  "tools": [ { "type": "function", "function": { "name": "grade_answer", "...": "..." } } ],
  "tool_choice": { "type": "function", "function": { "name": "grade_answer" } },
  "plugins": [ { "id": "file-parser", "pdf": { "engine": "mistral-ocr" } } ]
}
```

### With source material (RAG)

When `documentIds` are supplied, a `MATERI SUMBER` text part is prepended to the
user content (ahead of the question), the `grade_answer` tool gains a required
`citations` field, and the worker resolves no extra refs for it (it is inline
text):

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "=== MATERI SUMBER (rujukan penilaian) ===\n[chunk:doc#0 · materi.pdf]\n...\n=== AKHIR MATERI SUMBER ===" },
    { "type": "text", "text": "Question: ..." }
  ]
}
```

### Worker `grade_answer` tool-call arguments (input to step 5)

```json
{
  "extracted_text": "KPI adalah ...",
  "extraction_note": "Semua teks terbaca jelas.",
  "score": 11,
  "feedback_text": "Jawabanmu sudah ...",
  "strengths": ["Menjelaskan Specific dengan contoh konkret"],
  "improvements": ["Tambahkan komponen Time-bound"],
  "rubric_breakdown": [
    { "criterion": "Kelengkapan SMART", "max": 3, "awarded": 2, "reason": "Empat dari lima komponen dijelaskan." }
  ],
  "citations": [
    { "chunk_id": "doc#0", "document": "materi.pdf", "snippet": "KPI yang efektif bersifat terukur" }
  ]
}
```

## Hard rules

- Do NOT `git commit`/`push`. Do NOT modify `.env.local` / `.dev.vars`. Do NOT
  print secret values. Do NOT run DB migrations against live Supabase.
