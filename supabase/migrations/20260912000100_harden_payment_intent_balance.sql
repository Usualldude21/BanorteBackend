-- B4: valida fondos también al preparar el pago. confirm_payment conserva su
-- segunda validación bajo bloqueo para cubrir cambios de saldo concurrentes.
-- Rollback: restaurar create_payment_intent desde 20260911000300 sin esta
-- validación; no se recomienda porque permitiría intents imposibles.
create or replace function public.create_payment_intent(
  p_source_account_id uuid,
  p_beneficiary_id uuid,
  p_amount numeric,
  p_currency text,
  p_concept text,
  p_idempotency_key uuid
) returns table (
  id uuid, source_account_id uuid, beneficiary_id uuid, amount numeric, currency text,
  concept text, fee numeric, estimated_balance_after numeric, status text,
  idempotency_key uuid, expires_at timestamptz
) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_account public.accounts%rowtype;
  v_beneficiary public.beneficiaries%rowtype;
  v_intent public.payment_intents%rowtype;
  v_fee numeric(18,2) := 0.00;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'invalid amount' using errcode = '22023'; end if;
  if p_currency !~ '^[A-Z]{3}$' then raise exception 'invalid currency' using errcode = '22023'; end if;

  select * into v_intent from public.payment_intents pi
  where pi.idempotency_key = p_idempotency_key and pi.user_id = v_user;
  if found then
    return query select v_intent.id, v_intent.source_account_id, v_intent.beneficiary_id,
      v_intent.amount, v_intent.currency::text, v_intent.concept, v_intent.fee,
      v_intent.estimated_balance_after, v_intent.status, v_intent.idempotency_key, v_intent.expires_at;
    return;
  end if;

  select * into v_account from public.accounts a where a.id = p_source_account_id and a.user_id = v_user;
  if not found then raise exception 'source account not found' using errcode = 'P0002'; end if;
  if v_account.status <> 'active' then raise exception 'source account is not active' using errcode = 'P0001'; end if;
  if v_account.currency <> p_currency then raise exception 'currency mismatch' using errcode = '22023'; end if;
  if v_account.balance < p_amount + v_fee then raise exception 'insufficient funds' using errcode = 'P0001'; end if;

  select * into v_beneficiary from public.beneficiaries b where b.id = p_beneficiary_id and b.user_id = v_user;
  if not found then raise exception 'beneficiary not found' using errcode = 'P0002'; end if;
  if v_beneficiary.status <> 'active' then raise exception 'beneficiary is not active' using errcode = 'P0001'; end if;
  if v_beneficiary.currency <> p_currency then raise exception 'currency mismatch' using errcode = '22023'; end if;

  insert into public.payment_intents (
    id, user_id, source_account_id, beneficiary_id, amount, currency, concept, fee,
    estimated_balance_after, status, idempotency_key, expires_at
  ) values (
    gen_random_uuid(), v_user, p_source_account_id, p_beneficiary_id, p_amount, p_currency,
    nullif(trim(p_concept), ''), v_fee, v_account.balance - p_amount - v_fee,
    'awaiting_confirmation', p_idempotency_key, now() + interval '10 minutes'
  ) returning * into v_intent;

  insert into public.payment_audit_log(payment_intent_id, user_id, event_type, next_status)
  values (v_intent.id, v_user, 'intent_created', 'awaiting_confirmation');

  return query select v_intent.id, v_intent.source_account_id, v_intent.beneficiary_id,
    v_intent.amount, v_intent.currency::text, v_intent.concept, v_intent.fee,
    v_intent.estimated_balance_after, v_intent.status, v_intent.idempotency_key, v_intent.expires_at;
end $$;
