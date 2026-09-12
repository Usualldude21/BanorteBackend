begin;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
set local role authenticated;

do $$
declare v_intent uuid; first_result record; second_result record; v_count bigint; v_balance numeric;
begin
  select id into v_intent from public.create_payment_intent(
    '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
    1500,'MXN','Pago de demostración','42000000-0000-4000-8000-000000000001');
  select * into first_result from public.confirm_payment(v_intent,'43000000-0000-4000-8000-000000000001');
  select * into second_result from public.confirm_payment(v_intent,'43000000-0000-4000-8000-000000000002');
  if first_result.payment_id<>second_result.payment_id or first_result.receipt_number<>second_result.receipt_number then
    raise exception 'Confirmación duplicada no fue idempotente';
  end if;
  select count(*) into v_count from public.payments where payment_intent_id=v_intent;
  if v_count<>1 then raise exception 'Se generaron % pagos',v_count; end if;
  select count(*) into v_count from public.transactions where reference_id='PAY-'||v_intent::text;
  if v_count<>1 then raise exception 'Se generaron % movimientos',v_count; end if;
  select balance into v_balance from public.accounts where id='20000000-0000-4000-8000-000000000001';
  if v_balance<>21000 then raise exception 'Saldo posterior inesperado: %',v_balance; end if;
end $$;

do $$ begin
  begin
    perform public.create_payment_intent('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',999999,'MXN','Fondos insuficientes','42000000-0000-4000-8000-000000000002');
    raise exception 'La preparación debió rechazar fondos insuficientes';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%insufficient funds%' then raise; end if;
  end;
end $$;

do $$ begin
  begin
    perform public.create_payment_intent('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',100,'USD','Moneda incorrecta','42000000-0000-4000-8000-000000000003');
    raise exception 'La moneda incorrecta debió fallar';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.create_payment_intent('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-999999999999',100,'MXN','Beneficiario inexistente','42000000-0000-4000-8000-000000000004');
    raise exception 'El beneficiario inexistente debió fallar';
  exception when sqlstate 'P0002' then null; end;
  begin
    perform public.confirm_payment('40000000-0000-4000-8000-000000000001');
    raise exception 'El intent expirado debió fallar';
  exception when sqlstate 'P0001' then null; end;
end $$;

do $$ begin
  begin
    perform public.create_payment_intent(
      '20000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000011',
      100,'MXN','Intento desde cuenta ajena','42000000-0000-4000-8000-000000000008');
    raise exception 'Usuario A pudo pagar desde la cuenta de Usuario B';
  exception when sqlstate 'P0002' then
    if sqlerrm not like '%source account not found%' then raise; end if;
  end;
  begin
    perform public.create_payment_intent(
      '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000011',
      100,'MXN','Intento con beneficiario ajeno','42000000-0000-4000-8000-000000000009');
    raise exception 'Usuario A pudo utilizar un beneficiario de Usuario B';
  exception when sqlstate 'P0002' then
    if sqlerrm not like '%beneficiary not found%' then raise; end if;
  end;
end $$;

do $$
declare v_cancel uuid;
begin
  select id into v_cancel from public.create_payment_intent(
    '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
    100,'MXN','Cancelar','42000000-0000-4000-8000-000000000006');
  perform public.cancel_payment_intent(v_cancel);
  if (select status from public.payment_intents where id=v_cancel)<>'cancelled' then
    raise exception 'No canceló el intent';
  end if;
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$
declare v_count bigint;
begin
  select count(*) into v_count from public.accounts where user_id='10000000-0000-4000-8000-000000000001';
  if v_count<>0 then raise exception 'RLS expuso cuentas de Usuario A a Usuario B'; end if;
  select count(*) into v_count from public.transactions where user_id='10000000-0000-4000-8000-000000000001';
  if v_count<>0 then raise exception 'RLS expuso movimientos de Usuario A a Usuario B'; end if;
  select count(*) into v_count from public.beneficiaries where user_id='10000000-0000-4000-8000-000000000001';
  if v_count<>0 then raise exception 'RLS expuso beneficiarios de Usuario A a Usuario B'; end if;
  begin
    perform public.confirm_payment('40000000-0000-4000-8000-000000000001');
    raise exception 'Usuario B pudo confirmar intent de A';
  exception when sqlstate 'P0002' then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);

reset role;
create function public.test_force_payment_failure() returns trigger language plpgsql as $$
begin
  raise exception 'forced rollback test';
end $$;
create trigger test_force_payment_failure before insert on public.payments
for each row execute function public.test_force_payment_failure();
set local role authenticated;

do $$
declare v_intent uuid; v_before numeric; v_after numeric;
begin
  select balance into v_before from public.accounts where id='20000000-0000-4000-8000-000000000001';
  select id into v_intent from public.create_payment_intent(
    '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
    200,'MXN','Rollback forzado','42000000-0000-4000-8000-000000000007');
  begin
    perform public.confirm_payment(v_intent);
    raise exception 'No se disparó el fallo forzado';
  exception when others then
    if sqlerrm='No se disparó el fallo forzado' then raise; end if;
  end;
  select balance into v_after from public.accounts where id='20000000-0000-4000-8000-000000000001';
  if v_after<>v_before then raise exception 'El balance no hizo rollback: % -> %',v_before,v_after; end if;
  if exists(select 1 from public.transactions where reference_id='PAY-'||v_intent::text) then
    raise exception 'Quedó un movimiento parcial';
  end if;
end $$;

rollback;
