begin;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $$
declare
  v_session uuid := '80000000-0000-4000-8000-000000000001';
  v_first record;
  v_recovered record;
  v_busy record;
  v_conflict record;
begin
  select * into v_first from public.begin_agent_session(
    v_session, '80000000-0000-4000-8000-000000000002', false, null, null, null
  );
  if v_first.result_code <> 'success' then
    raise exception 'No se creó la sesión: %', v_first.result_code;
  end if;

  perform public.complete_agent_session(
    v_session,
    '80000000-0000-4000-8000-000000000002',
    3,
    2,
    '["source_1"]'::jsonb,
    null,
    '[{"user":"¿En qué estoy gastando más?","assistant":"Restaurantes"}]'::jsonb,
    '{}'::jsonb,
    '{"revision":0,"protectedExpenseCategories":[]}'::jsonb,
    null
  );

  select * into v_recovered from public.begin_agent_session(
    v_session, '80000000-0000-4000-8000-000000000003', true,
    3, 2, '["source_1"]'::jsonb
  );
  if v_recovered.result_code <> 'success'
    or v_recovered.turns->0->>'user' <> '¿En qué estoy gastando más?' then
    raise exception 'No se recuperó la conversación';
  end if;

  select * into v_busy from public.begin_agent_session(
    v_session, '80000000-0000-4000-8000-000000000004', true,
    3, 2, '["source_1"]'::jsonb
  );
  if v_busy.result_code <> 'session_busy' then
    raise exception 'No se protegió la sesión concurrente: %', v_busy.result_code;
  end if;

  perform public.release_agent_session(
    v_session, '80000000-0000-4000-8000-000000000003'
  );

  select * into v_conflict from public.begin_agent_session(
    v_session, '80000000-0000-4000-8000-000000000005', true,
    2, 2, '["source_1"]'::jsonb
  );
  if v_conflict.result_code <> 'session_revision_conflict' then
    raise exception 'No se rechazó la revisión obsoleta: %', v_conflict.result_code;
  end if;
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

do $$
declare
  v_cross_user record;
begin
  select * into v_cross_user from public.begin_agent_session(
    '80000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000006',
    false,
    null,
    null,
    null
  );
  if v_cross_user.result_code <> 'session_forbidden' then
    raise exception 'No se bloqueó el acceso cruzado: %', v_cross_user.result_code;
  end if;
end $$;

rollback;
