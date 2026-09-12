begin;

do $$
declare v_count bigint; v_value numeric;
begin
  select count(*) into v_count from public.transactions where amount <> round(amount,2);
  if v_count <> 0 then raise exception 'Hay importes con más de dos decimales'; end if;
  select count(*) into v_count from public.accounts where currency !~ '^[A-Z]{3}$';
  if v_count <> 0 then raise exception 'Hay monedas inválidas'; end if;
  select count(*) into v_count from public.transactions t join public.accounts a on a.id=t.account_id
    where t.user_id<>a.user_id or t.currency<>a.currency;
  if v_count <> 0 then raise exception 'Cuenta y movimiento son incompatibles'; end if;
  select count(*) into v_count from public.beneficiaries where masked_account !~ '^\*{4,}[0-9]{4}$';
  if v_count <> 0 then raise exception 'Hay beneficiarios sin enmascarar'; end if;
  select count(*) into v_count from public.transactions where transaction_date not between '2026-06-01' and '2026-08-31';
  if v_count <> 0 then raise exception 'Calendario inesperado: % filas fuera del historial base', v_count; end if;
  select count(*) into v_count from public.payment_intents group by idempotency_key having count(*)>1;
  if found then raise exception 'Hay idempotency keys duplicadas'; end if;
  select count(*) into v_count from public.payments group by receipt_number having count(*)>1;
  if found then raise exception 'Hay comprobantes duplicados'; end if;
  select count(*) into v_count from public.payments p left join public.transactions t on t.id=p.transaction_id
    where t.id is null or t.reference_id <> 'PAY-'||p.payment_intent_id::text;
  if v_count <> 0 then raise exception 'Pago sin movimiento compatible'; end if;
  select count(*) into v_count from public.payments where balance_after <> balance_before-amount-fee;
  if v_count <> 0 then raise exception 'Saldo posterior inconsistente'; end if;
  select count(*) into v_count from public.transactions where user_id='10000000-0000-4000-8000-000000000001'
    and transaction_date between '2026-08-01' and '2026-08-31';
  if v_count <> 26 then raise exception 'Usuario A debe tener 26 movimientos en agosto; obtuvo %',v_count; end if;
  select count(*) into v_count from public.transactions where user_id='10000000-0000-4000-8000-000000000001'
    and type='transfer' and description='Transferencia recurrente a ahorro'
    and transaction_date between '2026-06-01' and '2026-08-31';
  if v_count <> 3 then raise exception 'El seed debe contener tres transferencias recurrentes; obtuvo %',v_count; end if;
  select sum(amount) into v_value from public.transactions where user_id='10000000-0000-4000-8000-000000000001'
    and type='income' and transaction_date between '2026-08-01' and '2026-08-31';
  if v_value <> 30000 then raise exception 'Ingreso de agosto inesperado: %',v_value; end if;
  select sum(amount) into v_value from public.transactions where user_id='10000000-0000-4000-8000-000000000001'
    and type in ('expense','payment') and transaction_date between '2026-08-01' and '2026-08-31';
  if v_value <> 27600 then raise exception 'Gasto de agosto inesperado: %',v_value; end if;
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
set local role authenticated;

do $$
declare s record; v_count bigint; v_percentage numeric;
begin
  select * into s from public.get_financial_summary(
    '10000000-0000-4000-8000-000000000001','2026-08-01','2026-08-31','MXN');
  if s.total_income<>30000 or s.total_expenses<>27600 or s.net_cash_flow<>2400 or s.savings_rate<>8.00
    or s.transaction_count<>26 or s.largest_expense<>8500 or s.largest_income<>15000 then
    raise exception 'Fixture del resumen no coincide: %',row_to_json(s);
  end if;
  select sum(percentage),sum(transaction_count) into v_percentage,v_count
    from public.get_spending_by_category('10000000-0000-4000-8000-000000000001','2026-08-01','2026-08-31','MXN');
  if abs(v_percentage-100)>0.05 or v_count<>23 then raise exception 'Categorías incoherentes: %, %',v_percentage,v_count; end if;
  select count(*) into v_count from public.accounts where user_id='10000000-0000-4000-8000-000000000002';
  if v_count<>0 then raise exception 'RLS expuso cuentas de Usuario B'; end if;
  select count(*) into v_count from public.transactions where user_id='10000000-0000-4000-8000-000000000002';
  if v_count<>0 then raise exception 'RLS expuso movimientos de Usuario B'; end if;
  select count(*) into v_count from public.beneficiaries where user_id='10000000-0000-4000-8000-000000000002';
  if v_count<>0 then raise exception 'RLS expuso beneficiarios de Usuario B'; end if;
  begin
    perform public.get_financial_summary(
      '10000000-0000-4000-8000-000000000002','2026-08-01','2026-08-31','MXN');
    raise exception 'Usuario A pudo consultar analítica de Usuario B';
  exception when sqlstate '42501' then null; end;
  if has_table_privilege('authenticated','public.accounts','UPDATE') then raise exception 'authenticated puede editar balances'; end if;
  if has_table_privilege('authenticated','public.payment_audit_log','SELECT') then raise exception 'authenticated puede leer auditoría'; end if;
end $$;

rollback;
