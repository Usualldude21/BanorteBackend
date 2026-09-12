create or replace function public.get_financial_summary(
  p_user_id uuid,
  p_start_date date,
  p_end_date date,
  p_currency text default null
) returns table (
  currency text,
  total_income numeric,
  total_expenses numeric,
  net_cash_flow numeric,
  savings_rate numeric,
  transaction_count bigint,
  largest_expense numeric,
  largest_income numeric
) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or p_user_id <> auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_start_date > p_end_date then raise exception 'invalid date range' using errcode = '22007'; end if;
  return query
  with totals as (
    select t.currency,
      coalesce(sum(t.amount) filter (where t.type = 'income'), 0)::numeric as income,
      coalesce(sum(t.amount) filter (where t.type in ('expense','payment')), 0)::numeric as expenses,
      count(*)::bigint as tx_count,
      max(t.amount) filter (where t.type in ('expense','payment')) as max_expense,
      max(t.amount) filter (where t.type = 'income') as max_income
    from public.transactions t
    where t.user_id = auth.uid() and t.transaction_date between p_start_date and p_end_date
      and (p_currency is null or t.currency = upper(p_currency))
    group by t.currency
  )
  select x.currency::text, x.income, x.expenses, x.income-x.expenses,
    case when x.income=0 then null else round(100*(x.income-x.expenses)/x.income,2) end,
    x.tx_count,x.max_expense,x.max_income
  from totals x order by x.currency;
end $$;

create or replace function public.get_spending_by_category(
  p_user_id uuid, p_start_date date, p_end_date date, p_currency text default null
) returns table (currency text, category text, amount numeric, percentage numeric, transaction_count bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or p_user_id <> auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  with grouped as (
    select t.currency, t.category, sum(t.amount) amount, count(*) tx_count
    from public.transactions t
    where t.user_id = auth.uid() and t.type in ('expense','payment')
      and t.transaction_date between p_start_date and p_end_date
      and (p_currency is null or t.currency = upper(p_currency))
    group by t.currency, t.category
  )
  select g.currency::text, g.category, g.amount,
    round(100 * g.amount / nullif(sum(g.amount) over (partition by g.currency), 0), 2), g.tx_count
  from grouped g order by g.currency, g.amount desc, g.category;
end $$;

create or replace function public.get_cashflow(
  p_user_id uuid, p_start_date date, p_end_date date, p_currency text default null,
  p_granularity text default 'month'
) returns table (period_start date, currency text, income numeric, expenses numeric, net_cash_flow numeric, transaction_count bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_part text;
begin
  if auth.uid() is null or p_user_id <> auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_granularity not in ('day','week','month') then raise exception 'invalid granularity' using errcode = '22023'; end if;
  v_part := p_granularity;
  return query
  select date_trunc(v_part, t.transaction_date)::date, t.currency::text,
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0)::numeric,
    coalesce(sum(t.amount) filter (where t.type in ('expense','payment')), 0)::numeric,
    (coalesce(sum(t.amount) filter (where t.type = 'income'), 0) - coalesce(sum(t.amount) filter (where t.type in ('expense','payment')), 0))::numeric,
    count(*)::bigint
  from public.transactions t
  where t.user_id = auth.uid() and t.transaction_date between p_start_date and p_end_date
    and (p_currency is null or t.currency = upper(p_currency))
  group by 1, t.currency order by 1, t.currency;
end $$;
