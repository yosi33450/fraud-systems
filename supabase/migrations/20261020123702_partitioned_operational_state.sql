-- No new service, credentials, plaintext customer data or destructive migration.
-- The original global record is retained as an immutable cutover backup.
begin;

create or replace function public.shopshield_read_parts(known jsonb default '{}'::jsonb)
returns setof public.shield_ledger_state
language sql stable security invoker set search_path = '' as $$
  select s.* from public.shield_ledger_state s
  where s.id like 'op2-%' and (known->>s.id is distinct from s.iv)
  order by s.id;
$$;

create or replace function public.shopshield_read_dirty_parts(ids text[])
returns setof public.shield_ledger_state
language sql stable security invoker set search_path = '' as $$
  select s.* from public.shield_ledger_state s
  where s.id = any(ids) and s.id like 'op2-%' and s.id <> 'op2-ready'
  order by s.id;
$$;

create or replace function public.shopshield_commit_parts(changes jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare item jsonb; current_iv text;
begin
  if jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) > 200
    or exists(select 1 from jsonb_array_elements(changes) x where x->>'id' not like 'op2-%' or x->>'id' = 'op2-ready' or x->>'id' is null)
    or (select count(distinct x->>'id') from jsonb_array_elements(changes) x) <> jsonb_array_length(changes)
  then raise exception 'INVALID_PARTITION_BATCH'; end if;
  if not exists(select 1 from public.shield_ledger_state where id='op2-ready') then
    raise exception 'PARTITIONS_NOT_READY';
  end if;
  -- Deterministic lock order, then validate the entire batch before any write.
  for item in select x from jsonb_array_elements(changes) x order by x->>'id' loop
    select iv into current_iv from public.shield_ledger_state where id=item->>'id' for update;
    if not found or current_iv is distinct from item->>'expected_iv' then return false; end if;
  end loop;
  for item in select x from jsonb_array_elements(changes) x loop
    update public.shield_ledger_state set ciphertext=item->>'ciphertext',
      iv=item->>'iv', auth_tag=item->>'auth_tag', updated_at=clock_timestamp()
    where id=item->>'id';
  end loop;
  return true;
end;
$$;

create or replace function public.shopshield_initialize_parts(expected_iv text, parts jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare current_iv text;
begin
  select iv into current_iv from public.shield_ledger_state where id='global' for update;
  if not found then raise exception 'SOURCE_STATE_MISSING'; end if;
  if exists(select 1 from public.shield_ledger_state where id='op2-ready') then
    raise exception 'ALREADY_MIGRATED';
  end if;
  if current_iv is distinct from expected_iv then return false; end if;
  if jsonb_typeof(parts) <> 'array'
     or (select count(*) from jsonb_array_elements(parts) x where x->>'id'='op2-ready') <> 1
     or (select count(*) from jsonb_array_elements(parts) x where x->>'id' ~ '^op2-orders-[0-9]{3}$') <> 128
     or (select count(*) from jsonb_array_elements(parts) x where x->>'id' ~ '^op2-webhooks-[0-9]{3}$') <> 32
     or exists(select 1 from jsonb_array_elements(parts) x where x->>'id' not like 'op2-%' or x->>'id' is null)
  then raise exception 'INVALID_INITIAL_PARTITIONS'; end if;
  insert into public.shield_ledger_state(id,ciphertext,iv,auth_tag,updated_at)
  select x->>'id',x->>'ciphertext',x->>'iv',x->>'auth_tag',clock_timestamp()
  from jsonb_array_elements(parts) x;
  return true;
end;
$$;

create or replace function public.shopshield_guard_legacy_state()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.id='global' and exists(select 1 from public.shield_ledger_state where id='op2-ready') then
    raise exception 'LEGACY_STATE_FROZEN_USE_PARTITIONS';
  end if;
  return new;
end;
$$;
create trigger shopshield_freeze_legacy_state before update or delete
on public.shield_ledger_state for each row
when (old.id='global') execute function public.shopshield_guard_legacy_state();

revoke all on function public.shopshield_read_parts(jsonb) from public, anon, authenticated;
revoke all on function public.shopshield_read_dirty_parts(text[]) from public, anon, authenticated;
revoke all on function public.shopshield_commit_parts(jsonb) from public, anon, authenticated;
revoke all on function public.shopshield_initialize_parts(text,jsonb) from public, anon, authenticated;
revoke all on function public.shopshield_guard_legacy_state() from public, anon, authenticated;
grant execute on function public.shopshield_read_parts(jsonb),
  public.shopshield_read_dirty_parts(text[]),
  public.shopshield_commit_parts(jsonb),
  public.shopshield_initialize_parts(text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
