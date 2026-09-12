create table public.agent_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  schema_version smallint not null default 1 check (schema_version = 1),
  interface_revision bigint not null default 0 check (interface_revision >= 0),
  data_revision bigint not null default 0 check (data_revision >= 0),
  data_keys jsonb not null default '[]'::jsonb
    check (jsonb_typeof(data_keys) = 'array'),
  specification jsonb,
  turns jsonb not null default '[]'::jsonb
    check (jsonb_typeof(turns) = 'array' and jsonb_array_length(turns) <= 6),
  interaction_state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(interaction_state) = 'object'),
  financial_constraints jsonb not null
    default '{"revision":0,"protectedExpenseCategories":[]}'::jsonb
    check (jsonb_typeof(financial_constraints) = 'object'),
  pending_payment_intent_id uuid
    references public.payment_intents(id) on delete set null,
  active_correlation_id uuid,
  lock_expires_at timestamptz,
  version bigint not null default 1 check (version > 0),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agent_sessions_user_id_idx on public.agent_sessions(user_id);
create index agent_sessions_expires_at_idx on public.agent_sessions(expires_at);
create index agent_sessions_pending_payment_idx
  on public.agent_sessions(pending_payment_intent_id)
  where pending_payment_intent_id is not null;

alter table public.agent_sessions enable row level security;
alter table public.agent_sessions force row level security;

create policy agent_sessions_select_own
on public.agent_sessions
for select
to authenticated
using (auth.uid() = user_id);

revoke all on public.agent_sessions from anon, authenticated;

create or replace function public.begin_agent_session(
  p_session_id uuid,
  p_correlation_id uuid,
  p_is_continuation boolean,
  p_interface_revision bigint default null,
  p_data_revision bigint default null,
  p_data_keys jsonb default null
)
returns table (
  result_code text,
  user_id uuid,
  session_id uuid,
  interface_revision bigint,
  data_revision bigint,
  data_keys jsonb,
  specification jsonb,
  turns jsonb,
  interaction_state jsonb,
  financial_constraints jsonb,
  pending_payment_intent_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.agent_sessions%rowtype;
begin
  if v_user_id is null then
    return query select 'session_forbidden', null::uuid, null::uuid, null::bigint,
      null::bigint, null::jsonb, null::jsonb, null::jsonb, null::jsonb,
      null::jsonb, null::uuid;
    return;
  end if;

  if jsonb_typeof(coalesce(p_data_keys, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'data_keys debe ser un arreglo';
  end if;

  delete from public.agent_sessions as expired
  where expired.expires_at <= now()
    and (
      expired.active_correlation_id is null
      or expired.lock_expires_at is null
      or expired.lock_expires_at <= now()
    );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_session_id::text, 0)
  );

  select s.* into v_session
  from public.agent_sessions as s
  where s.session_id = p_session_id
  for update;

  if v_session.session_id is not null and v_session.user_id <> v_user_id then
    return query select 'session_forbidden', null::uuid, null::uuid, null::bigint,
      null::bigint, null::jsonb, null::jsonb, null::jsonb, null::jsonb,
      null::jsonb, null::uuid;
    return;
  end if;

  if v_session.session_id is not null and v_session.expires_at <= now() then
    delete from public.agent_sessions as s where s.session_id = p_session_id;
    v_session.session_id := null;
  end if;

  if v_session.session_id is null then
    if p_is_continuation then
      return query select 'session_not_found', null::uuid, null::uuid, null::bigint,
        null::bigint, null::jsonb, null::jsonb, null::jsonb, null::jsonb,
        null::jsonb, null::uuid;
      return;
    end if;
    insert into public.agent_sessions (session_id, user_id)
    values (p_session_id, v_user_id)
    returning * into v_session;
  elsif v_session.active_correlation_id is not null
    and v_session.lock_expires_at > now() then
    return query select 'session_busy', null::uuid, null::uuid, null::bigint,
      null::bigint, null::jsonb, null::jsonb, null::jsonb, null::jsonb,
      null::jsonb, null::uuid;
    return;
  end if;

  if p_is_continuation and (
    v_session.interface_revision <> p_interface_revision
    or v_session.data_revision <> p_data_revision
    or not (
      v_session.data_keys @> coalesce(p_data_keys, '[]'::jsonb)
      and coalesce(p_data_keys, '[]'::jsonb) @> v_session.data_keys
    )
  ) then
    return query select 'session_revision_conflict', null::uuid, null::uuid,
      null::bigint, null::bigint, null::jsonb, null::jsonb, null::jsonb,
      null::jsonb, null::jsonb, null::uuid;
    return;
  end if;

  update public.agent_sessions as s
  set active_correlation_id = p_correlation_id,
      lock_expires_at = now() + interval '2 minutes',
      expires_at = now() + interval '30 minutes',
      updated_at = now()
  where s.session_id = p_session_id
  returning * into v_session;

  return query select 'success', v_session.user_id, v_session.session_id,
    v_session.interface_revision, v_session.data_revision, v_session.data_keys,
    v_session.specification, v_session.turns, v_session.interaction_state,
    v_session.financial_constraints, v_session.pending_payment_intent_id;
end;
$$;

create or replace function public.complete_agent_session(
  p_session_id uuid,
  p_correlation_id uuid,
  p_interface_revision bigint,
  p_data_revision bigint,
  p_data_keys jsonb,
  p_specification jsonb,
  p_turns jsonb,
  p_interaction_state jsonb,
  p_financial_constraints jsonb,
  p_pending_payment_intent_id uuid
)
returns table (result_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.agent_sessions%rowtype;
begin
  if v_user_id is null then return query select 'session_forbidden'; return; end if;
  if jsonb_typeof(p_data_keys) <> 'array'
    or jsonb_typeof(p_turns) <> 'array'
    or jsonb_array_length(p_turns) > 6
    or jsonb_typeof(p_interaction_state) <> 'object'
    or jsonb_typeof(p_financial_constraints) <> 'object' then
    raise exception using errcode = '22023', message = 'Estado de sesión inválido';
  end if;

  select s.* into v_session
  from public.agent_sessions as s
  where s.session_id = p_session_id
  for update;

  if v_session.session_id is null then return query select 'session_not_found'; return; end if;
  if v_session.user_id <> v_user_id then return query select 'session_forbidden'; return; end if;
  if v_session.active_correlation_id is distinct from p_correlation_id then
    return query select 'session_revision_conflict'; return;
  end if;

  update public.agent_sessions as s
  set interface_revision = p_interface_revision,
      data_revision = p_data_revision,
      data_keys = p_data_keys,
      specification = p_specification,
      turns = p_turns,
      interaction_state = p_interaction_state,
      financial_constraints = p_financial_constraints,
      pending_payment_intent_id = p_pending_payment_intent_id,
      active_correlation_id = null,
      lock_expires_at = null,
      version = s.version + 1,
      expires_at = now() + interval '30 minutes',
      updated_at = now()
  where s.session_id = p_session_id;
  return query select 'success';
end;
$$;

create or replace function public.release_agent_session(
  p_session_id uuid,
  p_correlation_id uuid
)
returns table (result_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.agent_sessions%rowtype;
begin
  if v_user_id is null then return query select 'session_forbidden'; return; end if;
  select s.* into v_session
  from public.agent_sessions as s
  where s.session_id = p_session_id
  for update;
  if v_session.session_id is null then return query select 'session_not_found'; return; end if;
  if v_session.user_id <> v_user_id then return query select 'session_forbidden'; return; end if;
  if v_session.active_correlation_id is not null
    and v_session.active_correlation_id <> p_correlation_id then
    return query select 'session_busy'; return;
  end if;
  update public.agent_sessions as s
  set active_correlation_id = null,
      lock_expires_at = null,
      updated_at = now()
  where s.session_id = p_session_id;
  return query select 'success';
end;
$$;

revoke all on function public.begin_agent_session(uuid, uuid, boolean, bigint, bigint, jsonb) from public;
revoke all on function public.complete_agent_session(uuid, uuid, bigint, bigint, jsonb, jsonb, jsonb, jsonb, jsonb, uuid) from public;
revoke all on function public.release_agent_session(uuid, uuid) from public;
grant execute on function public.begin_agent_session(uuid, uuid, boolean, bigint, bigint, jsonb) to authenticated;
grant execute on function public.complete_agent_session(uuid, uuid, bigint, bigint, jsonb, jsonb, jsonb, jsonb, jsonb, uuid) to authenticated;
grant execute on function public.release_agent_session(uuid, uuid) to authenticated;

-- Rollback manual:
-- drop function if exists public.release_agent_session(uuid, uuid);
-- drop function if exists public.complete_agent_session(uuid, uuid, bigint, bigint, jsonb, jsonb, jsonb, jsonb, jsonb, uuid);
-- drop function if exists public.begin_agent_session(uuid, uuid, boolean, bigint, bigint, jsonb);
-- drop table if exists public.agent_sessions;
