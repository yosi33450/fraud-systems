create table if not exists public.shield_ledger_state (
  id text primary key,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  updated_at timestamptz not null default now()
);

alter table public.shield_ledger_state enable row level security;

revoke all on table public.shield_ledger_state from anon, authenticated;

comment on table public.shield_ledger_state is
  'Encrypted pilot state for Shield Ledger. Accessible only through the server-side service role.';
