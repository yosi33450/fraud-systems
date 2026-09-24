-- PostgreSQL schema for the production multi-tenant boundary.
create extension if not exists pgcrypto;
create extension if not exists citext;

create type user_role as enum ('platform_owner', 'tenant_owner', 'tenant_admin', 'analyst', 'viewer');
create type store_status as enum ('draft', 'connecting', 'syncing', 'active', 'degraded', 'token_expired', 'disabled');
create type case_status as enum ('new', 'review', 'action', 'fraud', 'false-positive', 'resolved');

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext unique not null,
  password_hash text not null,
  force_password_reset boolean not null default true,
  two_factor_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table memberships (
  user_id uuid not null references users(id) on delete cascade,
  tenant_id uuid references tenants(id) on delete cascade,
  role user_role not null,
  primary key (user_id, tenant_id)
);

create table store_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  shop_domain text unique not null,
  encrypted_access_token bytea not null,
  encrypted_webhook_secret bytea not null,
  status store_status not null default 'draft',
  last_event_at timestamptz,
  created_at timestamptz not null default now()
);

create table order_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  store_id uuid not null references store_connections(id) on delete cascade,
  shopify_order_gid text not null,
  order_number text not null,
  encrypted_customer_payload bytea not null,
  total numeric(14,2) not null,
  currency char(3) not null,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  unique (store_id, shopify_order_gid)
);

create table monitored_employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email citext not null,
  name text not null,
  department text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create table risk_rules (
  id text not null,
  tenant_id uuid not null references tenants(id) on delete cascade,
  enabled boolean not null default true,
  match_logic text not null default 'all' check (match_logic in ('all', 'any')),
  conditions jsonb not null default '[]',
  action jsonb not null default '{"openCase": true, "emailOwner": true, "severity": "high"}',
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

create table notification_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  enabled boolean not null default true,
  recipients jsonb not null default '[]',
  severities jsonb not null default '["critical", "high"]',
  reminder_minutes integer not null default 30 check (reminder_minutes between 5 and 1440),
  updated_at timestamptz not null default now()
);

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  store_id uuid not null references store_connections(id) on delete cascade,
  shopify_webhook_id text not null,
  topic text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (store_id, shopify_webhook_id)
);

create table alert_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  store_id uuid not null references store_connections(id) on delete cascade,
  order_id uuid not null references order_snapshots(id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  severity text not null,
  status case_status not null default 'new',
  engine_version text not null,
  assignee_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  case_id uuid not null references alert_cases(id) on delete cascade,
  recipient citext not null,
  status text not null check (status in ('queued', 'sent', 'failed', 'simulated')),
  provider_id text,
  created_at timestamptz not null default now()
);

create table evidence_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  case_id uuid not null references alert_cases(id) on delete cascade,
  rule_id text not null,
  label text not null,
  description text not null,
  score_delta smallint not null,
  facts jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table global_match_keys (
  id uuid primary key default gen_random_uuid(),
  key_type text not null check (key_type in ('email', 'phone', 'address')),
  hmac_digest bytea not null,
  active_reports integer not null default 1,
  first_reported_at timestamptz not null default now(),
  last_reported_at timestamptz not null default now(),
  unique (key_type, hmac_digest)
);

create table blacklist_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  case_id uuid not null references alert_cases(id),
  match_key_id uuid not null references global_match_keys(id),
  reason text not null,
  status text not null default 'active',
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index one_active_report_per_case_key
  on blacklist_reports (tenant_id, case_id, match_key_id)
  where status = 'active';

create table audit_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  actor_id uuid references users(id),
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table store_connections enable row level security;
alter table order_snapshots enable row level security;
alter table monitored_employees enable row level security;
alter table risk_rules enable row level security;
alter table notification_settings enable row level security;
alter table notification_deliveries enable row level security;
alter table webhook_events enable row level security;
alter table alert_cases enable row level security;
alter table evidence_items enable row level security;
alter table blacklist_reports enable row level security;
alter table audit_entries enable row level security;

create policy tenant_store_isolation on store_connections
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy tenant_order_isolation on order_snapshots
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy tenant_employee_isolation on monitored_employees
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy tenant_rule_isolation on risk_rules
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy tenant_notification_settings_isolation on notification_settings
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy tenant_notification_delivery_isolation on notification_deliveries
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy tenant_event_isolation on webhook_events
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy tenant_case_isolation on alert_cases
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy tenant_evidence_isolation on evidence_items
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy tenant_report_isolation on blacklist_reports
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy tenant_audit_isolation on audit_entries
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
