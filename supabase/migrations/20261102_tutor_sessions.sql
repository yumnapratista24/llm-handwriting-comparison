-- Socratic tutor: AI-derived topics/checkpoints per grading run, one tutoring
-- session per grading result with its message log, plus per-checkpoint session
-- state and judged attempts for analysis. Idempotent: re-running is a no-op.

begin;

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

alter table tutor_sessions enable row level security;
alter table tutor_messages enable row level security;
alter table tutor_topics enable row level security;
alter table tutor_checkpoints enable row level security;
alter table tutor_session_gaps enable row level security;
alter table tutor_attempts enable row level security;

drop policy if exists anon_all_tutor_sessions on tutor_sessions;
create policy anon_all_tutor_sessions on tutor_sessions
  for all to anon using (true) with check (true);

drop policy if exists anon_all_tutor_messages on tutor_messages;
create policy anon_all_tutor_messages on tutor_messages
  for all to anon using (true) with check (true);

drop policy if exists anon_all_tutor_topics on tutor_topics;
create policy anon_all_tutor_topics on tutor_topics
  for all to anon using (true) with check (true);

drop policy if exists anon_all_tutor_checkpoints on tutor_checkpoints;
create policy anon_all_tutor_checkpoints on tutor_checkpoints
  for all to anon using (true) with check (true);

drop policy if exists anon_all_tutor_session_gaps on tutor_session_gaps;
create policy anon_all_tutor_session_gaps on tutor_session_gaps
  for all to anon using (true) with check (true);

drop policy if exists anon_all_tutor_attempts on tutor_attempts;
create policy anon_all_tutor_attempts on tutor_attempts
  for all to anon using (true) with check (true);

commit;

-- Make PostgREST pick up the new tables immediately.
notify pgrst, 'reload schema';
