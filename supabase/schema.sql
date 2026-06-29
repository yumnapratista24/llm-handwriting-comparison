-- Run this once in the Supabase SQL editor for the prototype-llm-comparison project.
-- No auth / user_id. Permissive RLS so the anon key can read and write freely.

create table if not exists grading_runs (
  id uuid primary key,
  created_at timestamptz default now(),
  question text,
  image_count int,
  system_prompt text
);

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

alter table grading_runs enable row level security;
alter table grading_results enable row level security;

create policy anon_all_runs on grading_runs
  for all to anon using (true) with check (true);

create policy anon_all_results on grading_results
  for all to anon using (true) with check (true);
