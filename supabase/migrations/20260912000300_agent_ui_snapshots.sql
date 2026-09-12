-- I8: additive persistence, no changes to existing RPC signatures.
alter table public.agent_sessions
  add column snapshot_data jsonb,
  add column snapshot_invalidated_keys jsonb,
  add column snapshot_interface_revision bigint,
  add column snapshot_data_revision bigint,
  add column snapshot_session_version bigint;

create function public.complete_agent_session_snapshot(
  p_session_id uuid, p_correlation_id uuid, p_interface_revision bigint,
  p_data_revision bigint, p_data_keys jsonb, p_specification jsonb,
  p_turns jsonb, p_interaction_state jsonb, p_financial_constraints jsonb,
  p_pending_payment_intent_id uuid, p_data_registry jsonb, p_invalidated_keys jsonb
)
returns table(result_code text)
language plpgsql security definer set search_path = '' as $$
declare v_code text; v_keys jsonb;
begin
  if auth.uid() is null then return query select 'session_forbidden'; return; end if;
  if p_data_registry is null or jsonb_typeof(p_data_registry) <> 'object'
    or p_invalidated_keys is null or jsonb_typeof(p_invalidated_keys) <> 'array' then
    raise exception using errcode = '22023', message = 'Snapshot inválido';
  end if;
  select coalesce(jsonb_agg(k order by k), '[]'::jsonb) into v_keys
    from jsonb_object_keys(p_data_registry) as keys(k);
  if v_keys is distinct from (
    select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
    from jsonb_array_elements_text(p_data_keys) as keys(k)
  ) or exists (
    select 1 from jsonb_array_elements_text(p_invalidated_keys) as keys(k)
    where not (p_data_registry ? k)
  ) then raise exception using errcode = '22023', message = 'Snapshot incompleto'; end if;

  select r.result_code into v_code from public.complete_agent_session(
    p_session_id, p_correlation_id, p_interface_revision, p_data_revision,
    p_data_keys, p_specification, p_turns, p_interaction_state,
    p_financial_constraints, p_pending_payment_intent_id
  ) as r;
  if v_code <> 'success' then return query select v_code; return; end if;
  -- Same transaction and row lock as the existing session completion.
  update public.agent_sessions set snapshot_data = p_data_registry,
    snapshot_invalidated_keys = p_invalidated_keys,
    snapshot_interface_revision = p_interface_revision,
    snapshot_data_revision = p_data_revision,
    snapshot_session_version = version
    where session_id = p_session_id and user_id = auth.uid();
  return query select 'success';
end;
$$;

create function public.read_agent_session_snapshot(p_session_id uuid, p_correlation_id uuid default null)
returns table(result_code text, snapshot jsonb)
language plpgsql security definer set search_path = '' as $$
declare v_session public.agent_sessions%rowtype;
begin
  if auth.uid() is null then return query select 'session_forbidden', null::jsonb; return; end if;
  select s.* into v_session from public.agent_sessions as s
    where s.session_id = p_session_id and s.user_id = auth.uid();
  if v_session.session_id is null or v_session.expires_at <= now() then
    return query select 'session_not_found', null::jsonb; return;
  end if;
  if v_session.active_correlation_id is not null and v_session.lock_expires_at > now()
    and v_session.active_correlation_id is distinct from p_correlation_id then
    return query select 'session_busy', null::jsonb; return;
  end if;
  if v_session.specification is null or v_session.snapshot_data is null
    or v_session.snapshot_interface_revision is distinct from v_session.interface_revision
    or v_session.snapshot_data_revision is distinct from v_session.data_revision
    or v_session.snapshot_session_version is distinct from v_session.version then
    return query select 'snapshot_unavailable', null::jsonb; return;
  end if;
  return query select 'success', jsonb_build_object(
    'version', '1', 'sessionId', v_session.session_id,
    'interfaceRevision', v_session.interface_revision, 'dataRevision', v_session.data_revision,
    'dataKeys', v_session.data_keys, 'specification', v_session.specification,
    'data', v_session.snapshot_data, 'invalidatedKeys', v_session.snapshot_invalidated_keys
  );
end;
$$;

revoke all on function public.complete_agent_session_snapshot(uuid, uuid, bigint, bigint, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, jsonb, jsonb) from public;
revoke all on function public.read_agent_session_snapshot(uuid, uuid) from public;
grant execute on function public.complete_agent_session_snapshot(uuid, uuid, bigint, bigint, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.read_agent_session_snapshot(uuid, uuid) to authenticated;
