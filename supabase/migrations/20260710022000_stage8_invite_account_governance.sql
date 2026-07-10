-- Stage 8: invite-only account status enforcement and user-event retention.
-- Depends on Stage 7 system config and Stage 8 assert_active_admin_actor().

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
  );
$$;

create or replace function public.can_read_policy(target_policy_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.policies p
    where p.id = target_policy_id
      and exists (
        select 1
        from public.profiles current_profile
        where current_profile.id = auth.uid()
          and current_profile.status = 'active'
      )
      and (
        exists (
          select 1
          from public.profiles admin_profile
          where admin_profile.id = auth.uid()
            and admin_profile.role = 'admin'
            and admin_profile.status = 'active'
        )
        or (
          p.status = 'published'
          and p.analysis_version = 'codex-manual-v1'
          and p.publish_date >= date '2026-05-01'
        )
      )
  );
$$;

create table if not exists public.account_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid references auth.users(id) on delete set null,
  target_user_id_snapshot text not null,
  action text not null
    check (action in ('suspended', 'reactivated', 'events_purged')),
  previous_status text,
  new_status text,
  actor_id uuid references auth.users(id) on delete set null,
  actor_id_snapshot text not null,
  reason text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint account_lifecycle_real_change_check
    check (
      action = 'events_purged'
      or previous_status is distinct from new_status
    )
);

create index if not exists account_lifecycle_events_target_idx
  on public.account_lifecycle_events(target_user_id, created_at desc);
create index if not exists account_lifecycle_events_actor_idx
  on public.account_lifecycle_events(actor_id, created_at desc);
create index if not exists account_lifecycle_events_action_idx
  on public.account_lifecycle_events(action, created_at desc);

create or replace function public.protect_account_lifecycle_events()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
    and pg_trigger_depth() > 1
    and (
      new.target_user_id is not distinct from old.target_user_id
      or (old.target_user_id is not null and new.target_user_id is null)
    )
    and (
      new.actor_id is not distinct from old.actor_id
      or (old.actor_id is not null and new.actor_id is null)
    )
    and row(
      new.target_user_id_snapshot,
      new.actor_id_snapshot,
      new.action,
      new.previous_status,
      new.new_status,
      new.reason,
      new.event_payload,
      new.created_at
    ) is not distinct from row(
      old.target_user_id_snapshot,
      old.actor_id_snapshot,
      old.action,
      old.previous_status,
      old.new_status,
      old.reason,
      old.event_payload,
      old.created_at
    )
  then
    return new;
  end if;

  raise exception 'account lifecycle audit rows are immutable'
    using errcode = '23514';
end;
$$;

drop trigger if exists protect_account_lifecycle_events on public.account_lifecycle_events;
create trigger protect_account_lifecycle_events
  before update or delete on public.account_lifecycle_events
  for each row execute function public.protect_account_lifecycle_events();

create or replace function public.set_user_account_status(
  target_user_id uuid,
  target_status text,
  actor_id uuid,
  reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  profile_row public.profiles%rowtype;
  normalized_reason text := btrim(reason);
  event_action text;
  result jsonb;
begin
  perform public.assert_active_admin_actor(actor_id);

  if target_status not in ('active', 'suspended') then
    raise exception 'target_status must be active or suspended'
      using errcode = '22023';
  end if;
  if nullif(normalized_reason, '') is null then
    raise exception 'reason is required'
      using errcode = '22023';
  end if;

  select * into profile_row
  from public.profiles p
  where p.id = target_user_id
  for update;

  if not found then
    raise exception 'target profile not found'
      using errcode = 'P0002';
  end if;

  if target_user_id = actor_id and target_status = 'suspended' then
    raise exception 'an administrator cannot suspend their own account'
      using errcode = '23514';
  end if;

  if profile_row.role = 'admin'
    and profile_row.status = 'active'
    and target_status = 'suspended'
    and (
      select count(*)
      from public.profiles p
      where p.role = 'admin'
        and p.status = 'active'
    ) <= 1
  then
    raise exception 'the last active administrator cannot be suspended'
      using errcode = '23514';
  end if;

  if profile_row.status = target_status then
    return jsonb_build_object(
      'targetUserId', target_user_id,
      'previousStatus', profile_row.status,
      'currentStatus', target_status,
      'changed', false
    );
  end if;

  if profile_row.status not in ('active', 'suspended', 'invited') then
    raise exception 'profile status % cannot transition through this RPC', profile_row.status
      using errcode = '23514';
  end if;

  update public.profiles
    set status = target_status
    where id = target_user_id;

  event_action := case target_status
    when 'active' then 'reactivated'
    else 'suspended'
  end;

  result := jsonb_build_object(
    'targetUserId', target_user_id,
    'previousStatus', profile_row.status,
    'currentStatus', target_status,
    'changed', true
  );

  insert into public.account_lifecycle_events (
    target_user_id,
    target_user_id_snapshot,
    action,
    previous_status,
    new_status,
    actor_id,
    actor_id_snapshot,
    reason,
    event_payload
  ) values (
    target_user_id,
    target_user_id::text,
    event_action,
    profile_row.status,
    target_status,
    actor_id,
    actor_id::text,
    normalized_reason,
    result
  );

  return result;
end;
$$;

create or replace function public.purge_expired_user_events(
  actor_id uuid,
  reference_time timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  config jsonb;
  retention_days integer;
  cutoff timestamptz;
  deleted_count integer;
  result jsonb;
begin
  perform public.assert_active_admin_actor(actor_id);

  select c.config_value into config
  from public.system_config_versions c
  where c.config_key = 'user_data.retention'
    and c.status = 'active'
  order by c.version_no desc
  limit 1;

  retention_days := coalesce((config ->> 'userEventRetentionDays')::integer, 90);
  if retention_days < 7 or retention_days > 3650 then
    raise exception 'configured user event retention must be between 7 and 3650 days'
      using errcode = '23514';
  end if;

  cutoff := reference_time - make_interval(days => retention_days);

  delete from public.user_events e
  where e.occurred_at < cutoff;
  get diagnostics deleted_count = row_count;

  result := jsonb_build_object(
    'retentionDays', retention_days,
    'referenceTime', reference_time,
    'cutoff', cutoff,
    'deletedCount', deleted_count
  );

  insert into public.account_lifecycle_events (
    target_user_id,
    target_user_id_snapshot,
    action,
    previous_status,
    new_status,
    actor_id,
    actor_id_snapshot,
    reason,
    event_payload
  ) values (
    null,
    'aggregate:user_events',
    'events_purged',
    null,
    null,
    actor_id,
    actor_id::text,
    'scheduled user event retention purge',
    result
  );

  return result;
end;
$$;

alter table public.account_lifecycle_events enable row level security;

revoke all on public.account_lifecycle_events from public, anon, authenticated;
revoke all on function public.is_active_user() from public, anon, authenticated;
revoke all on function public.set_user_account_status(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.purge_expired_user_events(uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.is_active_user() to authenticated;
grant execute on function public.set_user_account_status(uuid, text, uuid, text) to service_role;
grant execute on function public.purge_expired_user_events(uuid, timestamptz) to service_role;

update public.system_config_versions
set status = 'retired'
where config_key = 'product.access_boundary'
  and status = 'active';

insert into public.system_config_versions (
  config_key,
  version_no,
  config_value,
  visibility,
  status,
  effective_at,
  supersedes_id,
  change_reason
)
select
  'product.access_boundary',
  coalesce(max(c.version_no), 0) + 1,
  jsonb_build_object(
    'registrationMode', 'invite_only',
    'publicSignupEnabled', false,
    'anonymousSignInEnabled', false,
    'primaryUse', 'internal_investment_research',
    'publicReadMode', false,
    'collaborationScope', 'small_team'
  ),
  'internal',
  'active',
  now(),
  (
    select prior.id
    from public.system_config_versions prior
    where prior.config_key = 'product.access_boundary'
    order by prior.version_no desc
    limit 1
  ),
  'Stage 8 enforces invite-only signup and active-profile access.'
from public.system_config_versions c
where c.config_key = 'product.access_boundary'
on conflict (config_key, version_no) do nothing;

insert into public.system_config_versions (
  config_key,
  version_no,
  config_value,
  visibility,
  status,
  effective_at,
  change_reason
) values (
  'user_data.retention',
  1,
  jsonb_build_object(
    'userEventRetentionDays', 90,
    'accountLifecycleAuditRetention', 'indefinite_until_governance_review',
    'ordinaryUserCanDeleteOwnAccount', false,
    'adminDeletionWorkflowRequired', true
  ),
  'internal',
  'active',
  now(),
  'Stage 8 initial internal data retention policy.'
)
on conflict (config_key, version_no) do nothing;

comment on function public.is_active_user() is
  'Returns true only for the current authenticated user with an active profile.';
comment on function public.set_user_account_status(uuid, text, uuid, text) is
  'Service-role-only audited suspension/reactivation with self-lockout and last-admin protection.';
comment on function public.purge_expired_user_events(uuid, timestamptz) is
  'Service-role-only retention purge using active user_data.retention configuration.';
comment on table public.account_lifecycle_events is
  'Immutable audit for account suspension/reactivation and aggregate user-event retention purges.';

notify pgrst, 'reload schema';
