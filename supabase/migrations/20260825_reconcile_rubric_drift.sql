-- Reconcile live databases created BEFORE the matrix-rubric change (df1ba17,
-- 2026-07-20) with the current schema. Such databases still have
-- grading_rubric.max_score, lack grading_rubric.description, and are missing
-- the grading_rubric_levels table entirely — which surfaces as:
--   "Could not find the 'description' column of 'grading_rubric' in the schema cache"
--
-- Idempotent: re-running is a no-op. Databases created from the current
-- schema.sql are unaffected.
--
-- NOTE: dropping max_score loses the max values of pre-July rubrics; those rows
-- were already declared unmigrated/broken by the matrix-rubric change itself.

begin;

alter table grading_rubric add column if not exists description text;
alter table grading_rubric drop column if exists max_score;

create table if not exists grading_rubric_levels (
  id          uuid primary key default gen_random_uuid(),
  rubric_id   uuid references grading_rubric(id) on delete cascade,
  level_value int,
  description text,
  created_at  timestamptz default now()
);

alter table grading_rubric_levels enable row level security;

drop policy if exists anon_all_rubric_levels on grading_rubric_levels;
create policy anon_all_rubric_levels on grading_rubric_levels
  for all to anon using (true) with check (true);

commit;

-- Make PostgREST pick up the new columns/table immediately.
notify pgrst, 'reload schema';
