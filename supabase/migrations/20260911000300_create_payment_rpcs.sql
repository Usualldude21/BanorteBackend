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

create or replace function public.confirm_payment(p_payment_intent_id uuid, p_correlation_id uuid default null)
returns table (
  payment_id uuid, payment_intent_id uuid, status text, receipt_number text,
  amount numeric, currency text, fee numeric, balance_before numeric,
  balance_after numeric, executed_at timestamptz
) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_intent public.payment_intents%rowtype;
  v_account public.accounts%rowtype;
  v_payment public.payments%rowtype;
  v_transaction_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into v_intent from public.payment_intents pi
    where pi.id = p_payment_intent_id and pi.user_id = v_user for update;
  if not found then raise exception 'payment intent not found' using errcode = 'P0002'; end if;

  if v_intent.status = 'succeeded' then
    select * into strict v_payment from public.payments p where p.payment_intent_id = v_intent.id;
    return query select v_payment.id, v_payment.payment_intent_id, v_payment.status,
      v_payment.receipt_number, v_payment.amount, v_payment.currency::text, v_payment.fee,
      v_payment.balance_before, v_payment.balance_after, v_payment.executed_at;
    return;
  end if;
  if v_intent.status <> 'awaiting_confirmation' then raise exception 'intent cannot be confirmed from status %', v_intent.status using errcode = 'P0001'; end if;
  if v_intent.expires_at <= v_now then raise exception 'payment intent expired' using errcode = 'P0001'; end if;

  select * into v_account from public.accounts a
    where a.id = v_intent.source_account_id and a.user_id = v_user for update;
  if not found or v_account.status <> 'active' then raise exception 'source account unavailable' using errcode = 'P0001'; end if;
  if v_account.currency <> v_intent.currency then raise exception 'currency mismatch' using errcode = '22023'; end if;
  if not exists (select 1 from public.beneficiaries b where b.id = v_intent.beneficiary_id and b.user_id = v_user and b.status = 'active' and b.currency = v_intent.currency) then
    raise exception 'beneficiary unavailable' using errcode = 'P0001';
  end if;
  if v_account.balance < v_intent.amount + v_intent.fee then raise exception 'insufficient funds' using errcode = 'P0001'; end if;

  update public.payment_intents set status = 'executing', updated_at = v_now where payment_intents.id = v_intent.id;
  update public.accounts set balance = balance - v_intent.amount - v_intent.fee, updated_at = v_now where accounts.id = v_account.id;
  insert into public.transactions(id, account_id, user_id, type, amount, currency, description, category, reference_id, transaction_date, created_at)
  values (v_transaction_id, v_account.id, v_user, 'payment', v_intent.amount + v_intent.fee,
    v_intent.currency, coalesce(v_intent.concept, 'Pago a beneficiario'), 'transfers',
    'PAY-' || v_intent.id::text, (v_now at time zone 'UTC')::date, v_now);

  insert into public.payments(id, user_id, payment_intent_id, source_account_id, beneficiary_id,
    transaction_id, amount, currency, fee, status, receipt_number, balance_before, balance_after, executed_at, created_at)
  values (gen_random_uuid(), v_user, v_intent.id, v_account.id, v_intent.beneficiary_id,
    v_transaction_id, v_intent.amount, v_intent.currency, v_intent.fee, 'succeeded',
    'MOC-' || upper(substr(replace(v_intent.id::text, '-', ''), 1, 16)),
    v_account.balance, v_account.balance - v_intent.amount - v_intent.fee, v_now, v_now)
  returning * into v_payment;

  update public.payment_intents set status = 'succeeded', updated_at = v_now where payment_intents.id = v_intent.id;
  insert into public.payment_audit_log(payment_intent_id, payment_id, user_id, event_type,
    previous_status, next_status, correlation_id, metadata)
  values (v_intent.id, v_payment.id, v_user, 'payment_succeeded', 'awaiting_confirmation',
    'succeeded', p_correlation_id, jsonb_build_object('transaction_id', v_transaction_id));

  return query select v_payment.id, v_payment.payment_intent_id, v_payment.status,
    v_payment.receipt_number, v_payment.amount, v_payment.currency::text, v_payment.fee,
    v_payment.balance_before, v_payment.balance_after, v_payment.executed_at;
end $$;

create or replace function public.cancel_payment_intent(p_payment_intent_id uuid)
returns table (id uuid, status text, updated_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); v_intent public.payment_intents%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  update public.payment_intents pi set status = 'cancelled', updated_at = clock_timestamp()
  where pi.id = p_payment_intent_id and pi.user_id = v_user
    and pi.status = 'awaiting_confirmation' and pi.expires_at > now()
  returning pi.* into v_intent;
  if not found then raise exception 'payment intent cannot be cancelled' using errcode = 'P0001'; end if;
  insert into public.payment_audit_log(payment_intent_id, user_id, event_type, previous_status, next_status)
  values (v_intent.id, v_user, 'intent_cancelled', 'awaiting_confirmation', 'cancelled');
  return query select v_intent.id, v_intent.status, v_intent.updated_at;
end $$;

create or replace function public.get_payment_status(p_payment_intent_id uuid)
returns table (payment_intent_id uuid, status text, receipt_number text, amount numeric, currency text, balance_after numeric, executed_at timestamptz)
language sql security definer set search_path = public, pg_temp stable as $$
  select pi.id, case when pi.status = 'awaiting_confirmation' and pi.expires_at <= now() then 'expired' else pi.status end,
    p.receipt_number, pi.amount, pi.currency::text, p.balance_after, p.executed_at
  from public.payment_intents pi left join public.payments p on p.payment_intent_id = pi.id
  where auth.uid() is not null and pi.user_id = auth.uid() and pi.id = p_payment_intent_id;
$$;
