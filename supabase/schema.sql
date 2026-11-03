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

-- Socratic tutor: one session per grading result (state = runtime gap state
-- machine, version = optimistic lock) plus its ordered message log. Topics and
-- checkpoints are AI-derived once per run; tutor_session_gaps / tutor_attempts
-- mirror the runtime state for analysis.
create table if not exists tutor_sessions (
  id                uuid primary key default gen_random_uuid(),
  grading_result_id uuid not null references grading_results(id) on delete cascade,
  model_key         text not null,
  policy_version    text not null,
  status            text not null default 'active' check (status in ('active','completed')),
  state             jsonb not null,
  version           int not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists tutor_sessions_grading_result_id_uidx
  on tutor_sessions (grading_result_id);

create table if not exists tutor_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references tutor_sessions(id) on delete cascade,
  seq        int not null,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  meta       jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, seq)
);

create table if not exists tutor_topics (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references grading_runs(id) on delete cascade,
  label             text not null,
  description       text,
  order_index       int not null,
  derivation_model  text not null,
  derivation_run_id uuid not null,
  created_at        timestamptz not null default now(),
  unique (run_id, order_index)
);

create table if not exists tutor_checkpoints (
  id                  uuid primary key default gen_random_uuid(),
  topic_id            uuid not null references tutor_topics(id) on delete cascade,
  label               text not null,
  descriptor          text not null,
  order_index         int not null,
  source_question_ids jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  unique (topic_id, order_index)
);

create table if not exists tutor_session_gaps (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references tutor_sessions(id) on delete cascade,
  checkpoint_id     uuid not null references tutor_checkpoints(id) on delete cascade,
  status            text not null,
  student_status    text check (student_status in ('gap','mastered')),
  initial_ratio     double precision,
  turn_no           int not null default 0,
  attempts          int not null default 0,
  awaiting_evidence boolean not null default false,
  last_verdict      text check (last_verdict in ('pass','fail')),
  closing_turn      int,
  independent       boolean,
  turn3_fails       int not null default 0,
  session_version   int not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (session_id, checkpoint_id)
);

create index if not exists tutor_session_gaps_checkpoint_id_idx
  on tutor_session_gaps (checkpoint_id);

create table if not exists tutor_attempts (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references tutor_sessions(id) on delete cascade,
  checkpoint_id      uuid references tutor_checkpoints(id) on delete cascade,
  student_message_id uuid references tutor_messages(id) on delete set null,
  student_seq        int not null,
  turn_no            int not null,
  attempt_no         int not null,
  verdict            text check (verdict in ('pass','fail')),
  missing_elements   jsonb not null default '[]'::jsonb,
  confidence         double precision,
  downgraded         boolean,
  contaminated       boolean not null default false,
  judge_model        text,
  judge_error        text,
  applied            boolean not null default false,
  created_at         timestamptz not null default now()
);

create index if not exists tutor_attempts_session_id_created_at_idx
  on tutor_attempts (session_id, created_at);
create index if not exists tutor_attempts_checkpoint_id_idx
  on tutor_attempts (checkpoint_id);
create index if not exists tutor_attempts_student_message_id_idx
  on tutor_attempts (student_message_id);

create or replace function tutor_save_derived_topics(
  p_run_id uuid,
  p_derivation_model text,
  p_derivation_run_id uuid,
  p_topics jsonb
) returns boolean
language plpgsql
as $$
declare
  t jsonb;
  c jsonb;
  v_topic_id uuid;
  ci int;
begin
  for t in select value from jsonb_array_elements(p_topics) loop
    insert into tutor_topics (run_id, label, description, order_index, derivation_model, derivation_run_id)
    values (p_run_id, t->>'label', t->>'description', (t->>'order_index')::int, p_derivation_model, p_derivation_run_id)
    returning id into v_topic_id;
    ci := 0;
    for c in select value from jsonb_array_elements(t->'checkpoints') loop
      insert into tutor_checkpoints (topic_id, label, descriptor, order_index, source_question_ids)
      values (v_topic_id, c->>'label', c->>'descriptor', ci, coalesce(c->'source_question_ids', '[]'::jsonb));
      ci := ci + 1;
    end loop;
  end loop;
  return true;
exception when unique_violation then
  return false;
end;
$$;

grant execute on function tutor_save_derived_topics(uuid, text, uuid, jsonb) to anon;

alter table grading_runs enable row level security;
alter table grading_results enable row level security;
alter table grading_answers enable row level security;
alter table grading_answer_files enable row level security;
alter table grading_rubric enable row level security;
alter table grading_rubric_levels enable row level security;
alter table grading_rubric_scores enable row level security;
alter table tutor_sessions enable row level security;
alter table tutor_messages enable row level security;
alter table tutor_topics enable row level security;
alter table tutor_checkpoints enable row level security;
alter table tutor_session_gaps enable row level security;
alter table tutor_attempts enable row level security;

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

create policy anon_all_tutor_sessions on tutor_sessions
  for all to anon using (true) with check (true);

create policy anon_all_tutor_messages on tutor_messages
  for all to anon using (true) with check (true);

create policy anon_all_tutor_topics on tutor_topics
  for all to anon using (true) with check (true);

create policy anon_all_tutor_checkpoints on tutor_checkpoints
  for all to anon using (true) with check (true);

create policy anon_all_tutor_session_gaps on tutor_session_gaps
  for all to anon using (true) with check (true);

create policy anon_all_tutor_attempts on tutor_attempts
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
