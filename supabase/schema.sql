-- Run this once in the Supabase SQL editor for the prototype-llm-comparison project.
-- No auth / user_id. Permissive RLS so the anon key can read and write freely.
--
-- Source material (RAG) is NOT persisted here: documents live in Pinecone + client
-- session state. No documents/document_chunks/grading_run_documents tables.
--
-- Uploaded student answers (images / PDFs) live in the PRIVATE storage bucket
-- 'grading-uploads' (defined at the bottom of this file), not in Postgres.

create table if not exists grading_runs (
  id uuid primary key,
  created_at timestamptz default now(),
  question text,
  image_count int,
  system_prompt text,
  title text,
  -- Number of student answers in a batch run. Legacy sync runs default to 1.
  answer_count int not null default 1
);

-- Run this if the table already exists:
-- alter table grading_runs add column if not exists title text;
-- alter table grading_runs add column if not exists answer_count int not null default 1;

-- Student answers for a batch run. One row per submitted answer; the binary
-- files (images / PDF) are referenced by grading_answer_files below.
-- Defined before grading_results because that table's answer_id FK points here.
create table if not exists grading_answers (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references grading_runs(id) on delete cascade,
  position        int not null,
  student_label   text not null,
  kind            text not null check (kind in ('text','images','pdf')),
  answer_text     text,
  extraction_note text,
  is_scanned      boolean not null default false,
  status          text not null default 'ready' check (status in ('ready','error')),
  error           text,
  created_at      timestamptz not null default now()
);

create index if not exists grading_answers_run_id_idx on grading_answers (run_id);

-- Uploaded files backing an answer (image parts, or a PDF). storage_path points
-- into the 'grading-uploads' bucket.
create table if not exists grading_answer_files (
  id           uuid primary key default gen_random_uuid(),
  answer_id    uuid not null references grading_answers(id) on delete cascade,
  position     int not null default 0,
  storage_path text not null,
  mime_type    text,
  size_bytes   bigint,
  created_at   timestamptz not null default now()
);

create index if not exists grading_answer_files_answer_id_idx
  on grading_answer_files (answer_id);

-- One row per (answer x model) grading job.
-- Legacy sync rows keep answer_id NULL and status 'done'. Batch rows carry the
-- full job lifecycle (queued → running → done/error) plus the OpenRouter request
-- payload and per-job metadata used by the Cloudflare worker.
create table if not exists grading_results (
  id uuid primary key,
  run_id uuid references grading_runs(id) on delete cascade,
  answer_id uuid references grading_answers(id) on delete cascade,
  model_key text,
  score int,
  extracted_text text,
  extraction_note text,
  feedback_text text,
  strengths jsonb,
  improvements jsonb,
  prompt_tokens int,
  completion_tokens int,
  total_tokens int,
  latency numeric,
  -- Batch job lifecycle + worker plumbing.
  status text not null default 'done' check (status in ('queued','running','done','error')),
  attempts int not null default 0,
  claimed_at timestamptz,
  error text,
  request_payload jsonb,
  job_meta jsonb,
  rubric_breakdown jsonb,
  citations jsonb,
  created_at timestamptz default now()
);

-- Run these if the table already exists (pre-batch schema) — or use
-- supabase/migrations/20260824_batch_grading.sql:
-- alter table grading_results add column if not exists answer_id uuid references grading_answers(id) on delete cascade;
-- alter table grading_results add column if not exists status text not null default 'done';
-- alter table grading_results add column if not exists attempts int not null default 0;
-- alter table grading_results add column if not exists claimed_at timestamptz;
-- alter table grading_results add column if not exists error text;
-- alter table grading_results add column if not exists request_payload jsonb;
-- alter table grading_results add column if not exists job_meta jsonb;
-- alter table grading_results add column if not exists rubric_breakdown jsonb;
-- alter table grading_results add column if not exists citations jsonb;

create index if not exists grading_results_run_id_idx on grading_results (run_id);
create index if not exists grading_results_answer_id_idx on grading_results (answer_id);
create index if not exists grading_results_status_idx on grading_results (status);

-- One job row per (answer × model); retry resets the row in place. Legacy sync
-- rows keep answer_id NULL, which never conflicts (NULLs are distinct).
create unique index if not exists grading_results_answer_model_uidx
  on grading_results (answer_id, model_key);

-- Rubric definition: one row per criterion, shared across all models in a run.
-- NOTE: as of the analytic-rubric-matrix change, `max_score` is gone — a criterion's
-- max is now derived from its highest level in grading_rubric_levels. Old rubric
-- rows saved before this change have no levels and are NOT migrated (breaking change).
create table if not exists grading_rubric (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid references grading_runs(id) on delete cascade,
  position   int,
  criterion  text,
  description text,
  created_at timestamptz default now()
);

-- Run these if the table already exists (pre-matrix-rubric schema):
-- alter table grading_rubric add column if not exists description text;
-- alter table grading_rubric drop column if exists max_score;

-- Score-level definitions for a rubric criterion: one row per (criterion, level).
-- All criteria in a rubric are expected to share the same set of level_value's,
-- enforced by the app UI, not by this schema.
create table if not exists grading_rubric_levels (
  id          uuid primary key default gen_random_uuid(),
  rubric_id   uuid references grading_rubric(id) on delete cascade,
  level_value int,
  description text,
  created_at  timestamptz default now()
);

-- Per-model rubric scores: awarded level value + reason for each rubric criterion.
create table if not exists grading_rubric_scores (
  id            uuid primary key default gen_random_uuid(),
  rubric_id     uuid references grading_rubric(id) on delete cascade,
  result_id     uuid references grading_results(id) on delete cascade,
  awarded_score int,
  reason        text,
  created_at    timestamptz default now()
);

alter table grading_runs enable row level security;
alter table grading_results enable row level security;
alter table grading_answers enable row level security;
alter table grading_answer_files enable row level security;
alter table grading_rubric enable row level security;
alter table grading_rubric_levels enable row level security;
alter table grading_rubric_scores enable row level security;

create policy anon_all_runs on grading_runs
  for all to anon using (true) with check (true);

create policy anon_all_results on grading_results
  for all to anon using (true) with check (true);

create policy anon_all_answers on grading_answers
  for all to anon using (true) with check (true);

create policy anon_all_answer_files on grading_answer_files
  for all to anon using (true) with check (true);

create policy anon_all_rubric on grading_rubric
  for all to anon using (true) with check (true);

create policy anon_all_rubric_levels on grading_rubric_levels
  for all to anon using (true) with check (true);

create policy anon_all_rubric_scores on grading_rubric_scores
  for all to anon using (true) with check (true);

-- ── Storage: PRIVATE 'grading-uploads' bucket + permissive anon policies ─────
-- Object paths: runs/{run_id}/answers/{answer_id}/{uuid}-{sanitized-filename}

insert into storage.buckets (id, name, public)
  values ('grading-uploads', 'grading-uploads', false)
  on conflict (id) do nothing;

create policy anon_grading_uploads_select on storage.objects
  for select to anon using (bucket_id = 'grading-uploads');

create policy anon_grading_uploads_insert on storage.objects
  for insert to anon with check (bucket_id = 'grading-uploads');

create policy anon_grading_uploads_update on storage.objects
  for update to anon using (bucket_id = 'grading-uploads')
  with check (bucket_id = 'grading-uploads');

create policy anon_grading_uploads_delete on storage.objects
  for delete to anon using (bucket_id = 'grading-uploads');
