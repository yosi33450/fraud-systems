create table if not exists public.shield_ledger_state (
  id text primary key,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  updated_at timestamptz not null default now()
);

alter table public.shield_ledger_state enable row level security;

revoke all on table public.shield_ledger_state from anon, authenticated;

-- Production deployments normally use a service-role key. If a dedicated
-- server access key is used instead, replace the placeholder below with the
-- SHA-256 digest of that key and grant only the required operations to anon.
-- The plaintext key stays exclusively in the server environment.
--
-- grant select, insert, update on public.shield_ledger_state to anon;
-- create policy shield_ledger_server_select on public.shield_ledger_state
--   for select to anon using (
--     encode(digest(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-shield-key', ''), 'sha256'), 'hex') = '__PERSISTENCE_KEY_SHA256__'
--   );

comment on table public.shield_ledger_state is
  'Encrypted pilot state for Shield Ledger. Accessible only through the server-side service role.';
