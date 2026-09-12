create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 100),
  locale text not null default 'es-MX',
  preferred_currency char(3) not null default 'MXN' check (preferred_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('checking', 'savings', 'credit_card')),
  status text not null check (status in ('active', 'blocked', 'closed')),
  name text not null check (length(trim(name)) between 1 and 100),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  balance numeric(18,2) not null,
  masked_identifier text check (masked_identifier is null or masked_identifier ~ '^\*{4,}[0-9]{4}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, currency)
);

create table if not exists public.transactions (
  id uuid primary key,
  account_id uuid not null,
  user_id uuid not null,
  type text not null check (type in ('income', 'expense', 'transfer', 'payment')),
  amount numeric(18,2) not null check (amount > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  description text not null check (length(trim(description)) between 1 and 255),
  category text not null check (category in ('income','housing','transport','groceries','restaurants','entertainment','health','education','subscriptions','transfers','other')),
  reference_id text unique,
  transaction_date date not null,
  created_at timestamptz not null default now(),
  foreign key (account_id, user_id) references public.accounts(id, user_id),
  foreign key (account_id, currency) references public.accounts(id, currency)
);

create table if not exists public.beneficiaries (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  institution text,
  account_type text,
  masked_account text not null check (masked_account ~ '^\*{4,}[0-9]{4}$'),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('active', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.payment_intents (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_account_id uuid not null,
  beneficiary_id uuid not null,
  amount numeric(18,2) not null check (amount > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  concept text check (concept is null or length(concept) <= 140),
  fee numeric(18,2) not null default 0 check (fee >= 0),
  estimated_balance_after numeric(18,2) not null,
  status text not null check (status in ('draft','awaiting_confirmation','executing','succeeded','failed','expired','cancelled')),
  idempotency_key uuid not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (source_account_id, user_id) references public.accounts(id, user_id),
  foreign key (beneficiary_id, user_id) references public.beneficiaries(id, user_id),
  unique (id, user_id)
);

create table if not exists public.payments (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_intent_id uuid not null unique,
  source_account_id uuid not null,
  beneficiary_id uuid not null,
  transaction_id uuid not null unique references public.transactions(id),
  amount numeric(18,2) not null check (amount > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  fee numeric(18,2) not null check (fee >= 0),
  status text not null check (status in ('succeeded', 'failed')),
  receipt_number text not null unique,
  balance_before numeric(18,2) not null,
  balance_after numeric(18,2) not null,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (payment_intent_id, user_id) references public.payment_intents(id, user_id),
  foreign key (source_account_id, user_id) references public.accounts(id, user_id),
  foreign key (beneficiary_id, user_id) references public.beneficiaries(id, user_id),
  check (balance_after = balance_before - amount - fee)
);

create table if not exists public.payment_audit_log (
  id bigint generated always as identity primary key,
  payment_intent_id uuid references public.payment_intents(id),
  payment_id uuid references public.payments(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  previous_status text,
  next_status text,
  correlation_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object'),
  check (metadata::text !~* '"(token|secret|password|account_number|prompt)"\s*:')
);

create index if not exists accounts_user_status_idx on public.accounts(user_id, status);
create index if not exists transactions_user_date_idx on public.transactions(user_id, transaction_date desc);
create index if not exists transactions_account_date_idx on public.transactions(account_id, transaction_date desc);
create index if not exists transactions_analytics_idx on public.transactions(user_id, currency, type, category, transaction_date);
create index if not exists beneficiaries_user_status_idx on public.beneficiaries(user_id, status);
create index if not exists payment_intents_user_status_idx on public.payment_intents(user_id, status, expires_at);
create index if not exists payments_user_created_idx on public.payments(user_id, created_at desc);
create index if not exists payment_audit_intent_idx on public.payment_audit_log(payment_intent_id, created_at);

comment on column public.transactions.transaction_date is 'Fecha contable en UTC, inclusiva en filtros; DATE para coincidir con @banorte/contracts.';
comment on column public.payment_audit_log.metadata is 'Sólo metadatos técnicos; nunca tokens, cuentas completas ni prompts.';
