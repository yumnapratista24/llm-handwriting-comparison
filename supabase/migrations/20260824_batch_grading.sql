-- Batch grading (v1) upgrade — safe to paste into the Supabase SQL editor on the
-- existing prototype-llm-comparison project. Idempotent: re-running is a no-op.
--
-- Adds:
--   * grading_answers / grading_answer_files (new tables)
--   * batch columns on grading_results (answer_id, status, attempts, claimed_at,
--     error, request_payload, job_meta, rubric_breakdown, citations)
--   * grading_runs.answer_count
--   * PRIVATE storage bucket 'grading-uploads' + permissive anon policies
--
-- Legacy grading_results rows keep answer_id NULL and status 'done'.

begin;

-- ── new tables ───────────────────────────────────────────────────────────────

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

-- ── grading_runs: answer_count ───────────────────────────────────────────────

alter table grading_runs
  add column if not exists answer_count int not null default 1;

-- ── grading_results: batch columns ───────────────────────────────────────────

alter table grading_results
  add column if not exists answer_id uuid references grading_answers(id) on delete cascade;
alter table grading_results
  add column if not exists status text not null default 'done';
alter table grading_results
  add column if not exists attempts int not null default 0;
alter table grading_results
  add column if not exists claimed_at timestamptz;
alter table grading_results
  add column if not exists error text;
alter table grading_results
  add column if not exists request_payload jsonb;
alter table grading_results
  add column if not exists job_meta jsonb;
alter table grading_results
  add column if not exists rubric_breakdown jsonb;
alter table grading_results
  add column if not exists citations jsonb;

alter table grading_results drop constraint if exists grading_results_status_check;
alter table grading_results
  add constraint grading_results_status_check
  check (status in ('queued','running','done','error'));

create index if not exists grading_results_run_id_idx on grading_results (run_id);
create index if not exists grading_results_answer_id_idx on grading_results (answer_id);
create index if not exists grading_results_status_idx on grading_results (status);

-- One job row per (answer × model); retry resets the row in place. Legacy sync
-- rows keep answer_id NULL, which never conflicts (NULLs are distinct).
create unique index if not exists grading_results_answer_model_uidx
  on grading_results (answer_id, model_key);

-- ── RLS: permissive anon on new tables ───────────────────────────────────────

alter table grading_answers enable row level security;
alter table grading_answer_files enable row level security;

drop policy if exists anon_all_answers on grading_answers;
create policy anon_all_answers on grading_answers
  for all to anon using (true) with check (true);

drop policy if exists anon_all_answer_files on grading_answer_files;
create policy anon_all_answer_files on grading_answer_files
  for all to anon using (true) with check (true);

-- ── storage: private 'grading-uploads' bucket + permissive anon policies ─────

insert into storage.buckets (id, name, public)
  values ('grading-uploads', 'grading-uploads', false)
  on conflict (id) do nothing;

drop policy if exists anon_grading_uploads_select on storage.objects;
create policy anon_grading_uploads_select on storage.objects
  for select to anon using (bucket_id = 'grading-uploads');

drop policy if exists anon_grading_uploads_insert on storage.objects;
create policy anon_grading_uploads_insert on storage.objects
  for insert to anon with check (bucket_id = 'grading-uploads');

drop policy if exists anon_grading_uploads_update on storage.objects;
create policy anon_grading_uploads_update on storage.objects
  for update to anon using (bucket_id = 'grading-uploads')
  with check (bucket_id = 'grading-uploads');

drop policy if exists anon_grading_uploads_delete on storage.objects;
create policy anon_grading_uploads_delete on storage.objects
  for delete to anon using (bucket_id = 'grading-uploads');

commit;
