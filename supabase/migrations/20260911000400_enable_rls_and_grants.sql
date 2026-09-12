alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.beneficiaries enable row level security;
alter table public.payment_intents enable row level security;
alter table public.payments enable row level security;
alter table public.payment_audit_log enable row level security;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists accounts_select_own on public.accounts;
drop policy if exists transactions_select_own on public.transactions;
drop policy if exists beneficiaries_select_active_own on public.beneficiaries;
drop policy if exists payment_intents_select_own on public.payment_intents;
drop policy if exists payments_select_own on public.payments;

create policy profiles_select_own on public.profiles for select to authenticated using (user_id = auth.uid());
create policy accounts_select_own on public.accounts for select to authenticated using (user_id = auth.uid());
create policy transactions_select_own on public.transactions for select to authenticated using (user_id = auth.uid());
create policy beneficiaries_select_active_own on public.beneficiaries for select to authenticated using (user_id = auth.uid() and status = 'active');
create policy payment_intents_select_own on public.payment_intents for select to authenticated using (user_id = auth.uid());
create policy payments_select_own on public.payments for select to authenticated using (user_id = auth.uid());

revoke all on public.profiles, public.accounts, public.transactions, public.beneficiaries,
  public.payment_intents, public.payments, public.payment_audit_log from anon, authenticated;
grant select on public.profiles, public.accounts, public.transactions, public.beneficiaries,
  public.payment_intents, public.payments to authenticated;
revoke all on function public.get_financial_summary(uuid,date,date,text),
  public.get_spending_by_category(uuid,date,date,text), public.get_cashflow(uuid,date,date,text,text),
  public.create_payment_intent(uuid,uuid,numeric,text,text,uuid), public.confirm_payment(uuid,uuid),
  public.cancel_payment_intent(uuid), public.get_payment_status(uuid) from public;
grant execute on function public.get_financial_summary(uuid,date,date,text),
  public.get_spending_by_category(uuid,date,date,text), public.get_cashflow(uuid,date,date,text,text),
  public.create_payment_intent(uuid,uuid,numeric,text,text,uuid), public.confirm_payment(uuid,uuid),
  public.cancel_payment_intent(uuid), public.get_payment_status(uuid) to authenticated;
