-- Stage 8: transactional, idempotent publish and rollback lifecycle.
-- This migration depends on 20260710010000_stage7_revision_projection_core.sql.

create table if not exists public.report_revision_commands (
  id uuid primary key default gen_random_uuid(),
  command_key text not null unique
    check (char_length(btrim(command_key)) between 16 and 200),
  command_type text not null
    check (command_type in ('publish', 'rollback')),
  policy_id uuid not null references public.policies(id) on delete restrict,
  target_revision_id uuid not null,
  expected_current_revision_id uuid,
  actor_id uuid not null references auth.users(id) on delete restrict,
  result_payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint report_revision_commands_target_fk
    foreign key (policy_id, target_revision_id)
    references public.report_revisions(policy_id, id)
    on delete restrict,
  constraint report_revision_commands_expected_current_fk
    foreign key (policy_id, expected_current_revision_id)
    references public.report_revisions(policy_id, id)
    on delete restrict
);

create table if not exists public.report_revision_events (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique references public.report_revision_commands(id) on delete restrict,
  policy_id uuid not null references public.policies(id) on delete restrict,
  event_type text not null
    check (event_type in ('published', 'publish_noop', 'rolled_back')),
  previous_revision_id uuid,
  target_revision_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint report_revision_events_previous_fk
    foreign key (policy_id, previous_revision_id)
    references public.report_revisions(policy_id, id)
    on delete restrict,
  constraint report_revision_events_target_fk
    foreign key (policy_id, target_revision_id)
    references public.report_revisions(policy_id, id)
    on delete restrict
);

create index if not exists report_revision_commands_policy_created_idx
  on public.report_revision_commands(policy_id, created_at desc);
create index if not exists report_revision_commands_target_idx
  on public.report_revision_commands(target_revision_id);
create index if not exists report_revision_events_policy_created_idx
  on public.report_revision_events(policy_id, created_at desc);
create index if not exists report_revision_events_target_idx
  on public.report_revision_events(target_revision_id);

create or replace function public.protect_revision_command_event_history()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception '% rows are immutable', tg_table_name
    using errcode = '23514';
end;
$$;

drop trigger if exists protect_report_revision_commands_update on public.report_revision_commands;
create trigger protect_report_revision_commands_update
  before update or delete on public.report_revision_commands
  for each row execute function public.protect_revision_command_event_history();

drop trigger if exists protect_report_revision_events_update on public.report_revision_events;
create trigger protect_report_revision_events_update
  before update or delete on public.report_revision_events
  for each row execute function public.protect_revision_command_event_history();

create or replace function public.assert_active_admin_actor(target_actor_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if target_actor_id is null or not exists (
    select 1
    from public.profiles p
    where p.id = target_actor_id
      and p.role = 'admin'
      and p.status = 'active'
  ) then
    raise exception 'actor must be an active admin profile'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.publish_report_revision(
  target_policy_id uuid,
  target_revision_id uuid,
  idempotency_key text,
  actor_id uuid,
  expected_current_revision_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_key text := btrim(idempotency_key);
  existing_command public.report_revision_commands%rowtype;
  current_revision_id uuid;
  current_revision_status text;
  target_status text;
  target_projection_hash text;
  command_id uuid;
  result jsonb;
begin
  if char_length(normalized_key) < 16 or char_length(normalized_key) > 200 then
    raise exception 'idempotency_key length must be between 16 and 200'
      using errcode = '22023';
  end if;

  perform public.assert_active_admin_actor(actor_id);

  select p.current_published_revision_id
    into current_revision_id
  from public.policies p
  where p.id = target_policy_id
  for update;

  if not found then
    raise exception 'policy not found'
      using errcode = 'P0002';
  end if;

  select * into existing_command
  from public.report_revision_commands c
  where c.command_key = normalized_key;

  if found then
    if existing_command.command_type <> 'publish'
      or existing_command.policy_id <> target_policy_id
      or existing_command.target_revision_id <> target_revision_id
      or existing_command.expected_current_revision_id is distinct from expected_current_revision_id
      or existing_command.actor_id <> actor_id
    then
      raise exception 'idempotency key was already used for a different command'
        using errcode = '23505';
    end if;
    return existing_command.result_payload;
  end if;

  if expected_current_revision_id is not null
    and current_revision_id is distinct from expected_current_revision_id
  then
    raise exception 'current published revision changed'
      using errcode = '40001';
  end if;

  select r.status, r.projection_hash
    into target_status, target_projection_hash
  from public.report_revisions r
  where r.id = target_revision_id
    and r.policy_id = target_policy_id
  for update;

  if not found then
    raise exception 'target revision not found for policy'
      using errcode = 'P0002';
  end if;

  if current_revision_id = target_revision_id and target_status = 'published' then
    result := jsonb_build_object(
      'command', 'publish',
      'policyId', target_policy_id,
      'previousRevisionId', current_revision_id,
      'currentRevisionId', target_revision_id,
      'changed', false,
      'idempotencyKey', normalized_key
    );

    insert into public.report_revision_commands (
      command_key, command_type, policy_id, target_revision_id,
      expected_current_revision_id, actor_id, result_payload
    ) values (
      normalized_key, 'publish', target_policy_id, target_revision_id,
      expected_current_revision_id, actor_id, result
    ) returning id into command_id;

    insert into public.report_revision_events (
      command_id, policy_id, event_type, previous_revision_id,
      target_revision_id, actor_id, event_payload
    ) values (
      command_id, target_policy_id, 'publish_noop', current_revision_id,
      target_revision_id, actor_id, result
    );
    return result;
  end if;

  if target_status <> 'approved' then
    raise exception 'target revision must be approved before publication'
      using errcode = '23514';
  end if;

  if target_projection_hash is null or not exists (
    select 1
    from public.report_projection_runs pr
    where pr.policy_id = target_policy_id
      and pr.revision_id = target_revision_id
      and pr.status = 'succeeded'
      and pr.projection_version = (
        select r.projection_version
        from public.report_revisions r
        where r.id = target_revision_id
      )
      and pr.projection_hash = target_projection_hash
  ) then
    raise exception 'target revision has no successful matching projection run'
      using errcode = '23514';
  end if;

  if current_revision_id is not null then
    select r.status into current_revision_status
    from public.report_revisions r
    where r.id = current_revision_id
      and r.policy_id = target_policy_id
    for update;

    if current_revision_status <> 'published' then
      raise exception 'current revision pointer does not reference a published revision'
        using errcode = '23514';
    end if;

    update public.report_revisions
      set status = 'superseded'
      where id = current_revision_id;
  end if;

  update public.report_revisions
    set status = 'published',
        published_at = coalesce(published_at, now())
    where id = target_revision_id;

  update public.policies
    set current_published_revision_id = target_revision_id,
        current_draft_revision_id = case
          when current_draft_revision_id = target_revision_id then null
          else current_draft_revision_id
        end
    where id = target_policy_id;

  result := jsonb_build_object(
    'command', 'publish',
    'policyId', target_policy_id,
    'previousRevisionId', current_revision_id,
    'currentRevisionId', target_revision_id,
    'changed', true,
    'idempotencyKey', normalized_key
  );

  insert into public.report_revision_commands (
    command_key, command_type, policy_id, target_revision_id,
    expected_current_revision_id, actor_id, result_payload
  ) values (
    normalized_key, 'publish', target_policy_id, target_revision_id,
    expected_current_revision_id, actor_id, result
  ) returning id into command_id;

  insert into public.report_revision_events (
    command_id, policy_id, event_type, previous_revision_id,
    target_revision_id, actor_id, event_payload
  ) values (
    command_id, target_policy_id, 'published', current_revision_id,
    target_revision_id, actor_id, result
  );

  return result;
end;
$$;

create or replace function public.rollback_report_revision(
  target_policy_id uuid,
  target_revision_id uuid,
  idempotency_key text,
  actor_id uuid,
  expected_current_revision_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_key text := btrim(idempotency_key);
  existing_command public.report_revision_commands%rowtype;
  current_revision_id uuid;
  current_revision_status text;
  target_status text;
  command_id uuid;
  result jsonb;
begin
  if char_length(normalized_key) < 16 or char_length(normalized_key) > 200 then
    raise exception 'idempotency_key length must be between 16 and 200'
      using errcode = '22023';
  end if;

  perform public.assert_active_admin_actor(actor_id);

  select p.current_published_revision_id
    into current_revision_id
  from public.policies p
  where p.id = target_policy_id
  for update;

  if not found then
    raise exception 'policy not found'
      using errcode = 'P0002';
  end if;

  select * into existing_command
  from public.report_revision_commands c
  where c.command_key = normalized_key;

  if found then
    if existing_command.command_type <> 'rollback'
      or existing_command.policy_id <> target_policy_id
      or existing_command.target_revision_id <> target_revision_id
      or existing_command.expected_current_revision_id is distinct from expected_current_revision_id
      or existing_command.actor_id <> actor_id
    then
      raise exception 'idempotency key was already used for a different command'
        using errcode = '23505';
    end if;
    return existing_command.result_payload;
  end if;

  if current_revision_id is null then
    raise exception 'policy has no current published revision'
      using errcode = '23514';
  end if;

  if expected_current_revision_id is not null
    and current_revision_id is distinct from expected_current_revision_id
  then
    raise exception 'current published revision changed'
      using errcode = '40001';
  end if;

  if current_revision_id = target_revision_id then
    raise exception 'rollback target is already current'
      using errcode = '23514';
  end if;

  select r.status into current_revision_status
  from public.report_revisions r
  where r.id = current_revision_id
    and r.policy_id = target_policy_id
  for update;

  if current_revision_status <> 'published' then
    raise exception 'current revision pointer does not reference a published revision'
      using errcode = '23514';
  end if;

  select r.status into target_status
  from public.report_revisions r
  where r.id = target_revision_id
    and r.policy_id = target_policy_id
  for update;

  if not found then
    raise exception 'rollback target revision not found for policy'
      using errcode = 'P0002';
  end if;

  if target_status <> 'superseded' then
    raise exception 'rollback target must be a superseded revision'
      using errcode = '23514';
  end if;

  update public.report_revisions
    set status = 'superseded'
    where id = current_revision_id;

  update public.report_revisions
    set status = 'published'
    where id = target_revision_id;

  update public.policies
    set current_published_revision_id = target_revision_id
    where id = target_policy_id;

  result := jsonb_build_object(
    'command', 'rollback',
    'policyId', target_policy_id,
    'previousRevisionId', current_revision_id,
    'currentRevisionId', target_revision_id,
    'changed', true,
    'idempotencyKey', normalized_key
  );

  insert into public.report_revision_commands (
    command_key, command_type, policy_id, target_revision_id,
    expected_current_revision_id, actor_id, result_payload
  ) values (
    normalized_key, 'rollback', target_policy_id, target_revision_id,
    expected_current_revision_id, actor_id, result
  ) returning id into command_id;

  insert into public.report_revision_events (
    command_id, policy_id, event_type, previous_revision_id,
    target_revision_id, actor_id, event_payload
  ) values (
    command_id, target_policy_id, 'rolled_back', current_revision_id,
    target_revision_id, actor_id, result
  );

  return result;
end;
$$;

alter table public.report_revision_commands enable row level security;
alter table public.report_revision_events enable row level security;

revoke all on public.report_revision_commands from public, anon, authenticated;
revoke all on public.report_revision_events from public, anon, authenticated;
revoke all on function public.assert_active_admin_actor(uuid) from public, anon, authenticated;
revoke all on function public.publish_report_revision(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rollback_report_revision(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;

grant execute on function public.publish_report_revision(uuid, uuid, text, uuid, uuid) to service_role;
grant execute on function public.rollback_report_revision(uuid, uuid, text, uuid, uuid) to service_role;

comment on table public.report_revision_commands is
  'Immutable idempotency records for service-side report publish and rollback commands.';
comment on table public.report_revision_events is
  'Immutable audit history for successful report revision lifecycle commands.';
comment on function public.publish_report_revision(uuid, uuid, text, uuid, uuid) is
  'Service-role-only transactional publication with policy row lock, optimistic current pointer and idempotency.';
comment on function public.rollback_report_revision(uuid, uuid, text, uuid, uuid) is
  'Service-role-only transactional rollback to a superseded report revision.';

notify pgrst, 'reload schema';
