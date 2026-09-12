-- Run after migration 20260912000300 and demo seed. All test changes roll back.
begin;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
declare
  sid uuid := '81000000-0000-4000-8000-000000000001';
  cid uuid := '81000000-0000-4000-8000-000000000002';
  result record;
begin
  select * into result from public.begin_agent_session(sid, cid, false, null, null, null);
  if result.result_code <> 'success' then raise exception 'begin failed'; end if;
  select * into result from public.complete_agent_session_snapshot(
    sid, cid, 5, 8, '["projection"]',
    '{"version":"1","root":{"type":"text","id":"summary","content":"Simulación"}}',
    '[]', '{}', '{"revision":0,"protectedExpenseCategories":[]}', null,
    '{"projection":{"total":9000}}', '[]'
  );
  if result.result_code <> 'success' then raise exception 'atomic completion failed'; end if;
  select * into result from public.read_agent_session_snapshot(sid);
  if result.result_code <> 'success'
    or result.snapshot->>'interfaceRevision' <> '5'
    or result.snapshot->>'dataRevision' <> '8'
    or result.snapshot->'data'->'projection'->>'total' <> '9000' then
    raise exception 'snapshot recovery failed';
  end if;
  perform public.begin_agent_session(sid, cid, true, 5, 8, '["projection"]');
  select * into result from public.read_agent_session_snapshot(sid);
  if result.result_code <> 'session_busy' then raise exception 'busy read not blocked'; end if;
  perform public.release_agent_session(sid, cid);
  -- Legacy completion cannot make an old snapshot appear current.
  perform public.begin_agent_session(sid, cid, true, 5, 8, '["projection"]');
  perform public.complete_agent_session(sid, cid, 6, 9, '["projection"]',
    '{"version":"1","root":{"type":"text","id":"summary","content":"Nueva vista"}}',
    '[]', '{}', '{"revision":0,"protectedExpenseCategories":[]}', null);
  select * into result from public.read_agent_session_snapshot(sid);
  if result.result_code <> 'snapshot_unavailable' then raise exception 'old snapshot accepted'; end if;
end $$;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
do $$
declare result record;
begin
  select * into result from public.read_agent_session_snapshot('81000000-0000-4000-8000-000000000001');
  if result.result_code <> 'session_not_found' or result.snapshot is not null then
    raise exception 'cross-user snapshot exposed';
  end if;
end $$;
rollback;
