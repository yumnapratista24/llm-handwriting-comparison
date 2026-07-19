-- Run this once in the Supabase SQL editor for the prototype-llm-comparison project.
-- No auth / user_id. Permissive RLS so the anon key can read and write freely.
--
-- Source material (RAG) is NOT persisted here: documents live in Pinecone + client
-- session state. No documents/document_chunks/grading_run_documents tables.

create table if not exists grading_runs (
  id uuid primary key,
  created_at timestamptz default now(),
  question text,
  image_count int,
  system_prompt text,
  title text
);

-- Run this if the table already exists:
-- alter table grading_runs add column if not exists title text;

create table if not exists grading_results (
  id uuid primary key,
  run_id uuid references grading_runs(id) on delete cascade,
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
  created_at timestamptz default now()
);

-- Rubric definition: one row per criterion, shared across all models in a run.
create table if not exists grading_rubric (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid references grading_runs(id) on delete cascade,
  position   int,
  criterion  text,
  max_score  int,
  created_at timestamptz default now()
);

-- Per-model rubric scores: awarded score + reason for each rubric criterion.
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
alter table grading_rubric enable row level security;
alter table grading_rubric_scores enable row level security;

create policy anon_all_runs on grading_runs
  for all to anon using (true) with check (true);

create policy anon_all_results on grading_results
  for all to anon using (true) with check (true);

create policy anon_all_rubric on grading_rubric
  for all to anon using (true) with check (true);

create policy anon_all_rubric_scores on grading_rubric_scores
  for all to anon using (true) with check (true);
