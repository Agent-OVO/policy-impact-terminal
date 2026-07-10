-- Stage 8: recoverable, idempotent account hard-deletion workflow.
-- Depends on 20260710022000_stage8_invite_account_governance.sql.

alter table public.account_lifecycle_events
  drop constraint if exists account_lifecycle_events_action_check;

alter table public.account_lifecycle_events
  add constraint account_lifecycle_events_action_check
  check (action in (
    'suspended',
    'reactivated',
    'events_purged',
    'deletion_prepared',
    'deleted',
    'deletion_failed'
  ));

alter table public.account_lifecycle_events
  drop constraint if exists account_lifecycle_real_change_check;

alter table public.account_lifecycle_events
  add constraint account_lifecycle_real_change_check
  check (
    action in ('events_purged', 'deletion_prepared', 'deleted', 'deletion_failed')
    or previous_status is distinct from new_status
  );

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique
    check (char_length(btrim(request_key)) between 16 and 200),
  target_user_id uuid references auth.users(id) on delete set null,
  target_user_id_snapshot text not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_id_snapshot text not null,
  previous_profile_status text not null,
  status text not null default 'prepared'
    check (status in ('prepared', 'completed', 'failed')),
  reason text not null,
  result_payload jsonb not null default '{}'::jsonb,
  prepared_at timestamptz not null default now(),
  finalized_at timestamptz,
  error_message text,
  updated_at timestamptz not null default now(),
  constraint account_deletion_terminal_check
    check (
      (status = 'prepared' and finalized_at is null)
      or (status in ('completed', 'failed') and finalized_at is not null)
    )
);

create index if not exists account_deletion_requests_target_idx
  on public.account_deletion_requests(target_user_id, prepared_at desc);
create index if not exists account_deletion_requests_actor_idx
  on public.account_deletion_requests(actor_id, prepared_at desc);
create index if not exists account_deletion_requests_status_idx
  on public.account_deletion_requests(status, prepared_at desc);

drop trigger if exists set_account_deletion_requests_updated_at on public.account_deletion_requests;
create trigger set_account_deletion_requests_updated_at
  before update on public.account_deletion_requests
  for each row execute function public.set_updated_at();

create or replace function public.protect_account_deletion_request_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
    and pg_trigger_depth() > 1
    and old.actor_id is not null
    and new.actor_id is null
    and row(new.request_key, new.target_user_id_snapshot, new.actor_id_snapshot,
            new.previous_profile_status, new.reason, new.prepared_at)
      is not distinct from
      row(old.request_key, old.target_user_id_snapshot, old.actor_id_snapshot,
          old.previous_profile_status, old.reason, old.prepared_at)
  then
    return new;
  end if;

  if row(new.request_key, new.target_user_id_snapshot, new.actor_id,
         new.actor_id_snapshot, new.previous_profile_status, new.reason, new.prepared_at)
     is distinct from
     row(old.request_key, old.target_user_id_snapshot, old.actor_id,
         old.actor_id_snapshot, old.previous_profile_status, old.reason, old.prepared_at)
  then
    raise exception 'account deletion request identity is immutable'
      using errcode = '23514';
  end if;

  if old.status <> new.status and not (
    old.status = 'prepared' and new.status in ('completed', 'failed')
  ) then
    raise exception 'invalid account deletion request transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  if old.status <> 'prepared'
    and row(new.status, new.result_payload, new.finalized_at, new.error_message)
      is distinct from
      row(old.status, old.result_payload, old.finalized_at, old.error_message)
  then
    raise exception 'terminal account deletion requests are immutable'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_account_deletion_request_identity on public.account_deletion_requests;
create trigger protect_account_deletion_request_identity
  before update on public.account_deletion_requests
  for each row execute function public.protect_account_deletion_request_identity();

create or replace function public.prepare_account_deletion(
  target_user_id uuid,
  request_key text,
  actor_id uuid,
  reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_key text := btrim(request_key);
  normalized_reason text := btrim(reason);
  existing_request public.account_deletion_requests%rowtype;
  profile_row public.profiles%rowtype;
  request_id uuid;
  result jsonb;
begin
  perform public.assert_active_admin_actor(actor_id);

  if char_length(normalized_key) < 16 or char_length(normalized_key) > 200 then
    raise exception 'request_key length must be between 16 and 200'
      using errcode = '22023';
  end if;
  if nullif(normalized_reason, '') is null then
    raise exception 'reason is required'
      using errcode = '22023';
  end if;
  if target_user_id = actor_id then
    raise exception 'an administrator cannot delete their own account'
      using errcode = '23514';
  end if;

  select * into existing_request
  from public.account_deletion_requests d
  where d.request_key = normalized_key;

  if found then
    if existing_request.target_user_id_snapshot <> target_user_id::text
      or existing_request.actor_id <> actor_id
      or existing_request.reason <> normalized_reason
    then
      raise exception 'request key was already used for a different account deletion'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'requestId', existing_request.id,
      'targetUserId', existing_request.target_user_id_snapshot,
      'previousStatus', existing_request.previous_profile_status,
      'status', existing_request.status,
      'idempotentReplay', true,
      'result', existing_request.result_payload,
      'errorMessage', existing_request.error_message
    );
  end if;

  select * into profile_row
  from public.profiles p
  where p.id = target_user_id
  for update;

  if not found then
    raise exception 'target profile not found'
      using errcode = 'P0002';
  end if;

  if profile_row.role = 'admin'
    and profile_row.status = 'active'
    and (
      select count(*)
      from public.profiles p
      where p.role = 'admin'
        and p.status = 'active'
    ) <= 1
  then
    raise exception 'the last active administrator cannot be deleted'
      using errcode = '23514';
  end if;

  if profile_row.status = 'deleted' then
    raise exception 'target profile is already marked deleted'
      using errcode = '23514';
  end if;

  insert into public.account_deletion_requests (
    request_key,
    target_user_id,
    target_user_id_snapshot,
    actor_id,
    actor_id_snapshot,
    previous_profile_status,
    status,
    reason,
    result_payload
  ) values (
    normalized_key,
    target_user_id,
    target_user_id::text,
    actor_id,
    actor_id::text,
    profile_row.status,
    'prepared',
    normalized_reason,
    jsonb_build_object(
      'targetUserId', target_user_id,
      'previousStatus', profile_row.status,
      'prepared', true
    )
  ) returning id into request_id;

  update public.profiles
    set status = 'deleted'
    where id = target_user_id;

  result := jsonb_build_object(
    'requestId', request_id,
    'targetUserId', target_user_id,
    'previousStatus', profile_row.status,
    'status', 'prepared',
    'idempotentReplay', false
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
    'deletion_prepared',
    profile_row.status,
    'deleted',
    actor_id,
    actor_id::text,
    normalized_reason,
    result
  );

  return result;
end;
$$;

create or replace function public.finalize_account_deletion(
  target_request_id uuid,
  succeeded boolean,
  actor_id uuid,
  deletion_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_row public.account_deletion_requests%rowtype;
  result jsonb;
  event_action text;
  final_status text;
  profile_restored boolean := false;
  restored_count integer := 0;
begin
  perform public.assert_active_admin_actor(actor_id);

  select * into request_row
  from public.account_deletion_requests d
  where d.id = target_request_id
  for update;

  if not found then
    raise exception 'account deletion request not found'
      using errcode = 'P0002';
  end if;
  if request_row.actor_id <> actor_id then
    raise exception 'only the preparing administrator may finalize this deletion'
      using errcode = '42501';
  end if;

  if request_row.status <> 'prepared' then
    if request_row.status = (case when succeeded then 'completed' else 'failed' end) then
      return jsonb_build_object(
        'requestId', request_row.id,
        'targetUserId', request_row.target_user_id_snapshot,
        'status', request_row.status,
        'idempotentReplay', true,
        'result', request_row.result_payload,
        'errorMessage', request_row.error_message
      );
    end if;
    raise exception 'account deletion request already has a conflicting terminal result'
      using errcode = '23505';
  end if;

  if succeeded and request_row.target_user_id is not null then
    raise exception 'Auth user still exists; successful deletion cannot be finalized'
      using errcode = '23514';
  end if;

  if not succeeded and nullif(btrim(deletion_error_message), '') is null then
    raise exception 'failed deletion finalization requires error_message'
      using errcode = '22023';
  end if;

  if not succeeded and request_row.target_user_id is null then
    raise exception 'failed deletion cannot be recovered because the Auth user is already absent'
      using errcode = '23514';
  end if;

  if succeeded = false and request_row.target_user_id is not null then
    update public.profiles
      set status = request_row.previous_profile_status
      where id = request_row.target_user_id;
    get diagnostics restored_count = row_count;
    if restored_count <> 1 then
      raise exception 'target profile is missing while recovering failed Auth deletion'
        using errcode = 'P0002';
    end if;
    profile_restored := true;
  end if;

  final_status := case when succeeded then 'completed' else 'failed' end;
  event_action := case when succeeded then 'deleted' else 'deletion_failed' end;
  result := jsonb_build_object(
    'requestId', request_row.id,
    'targetUserId', request_row.target_user_id_snapshot,
    'status', final_status,
    'authUserDeleted', succeeded,
    'profileRestored', profile_restored
  );

  update public.account_deletion_requests
    set status = final_status,
        result_payload = result,
        finalized_at = now(),
        error_message = case when succeeded then null else btrim(deletion_error_message) end
    where id = request_row.id;

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
    case when succeeded then null else request_row.target_user_id end,
    request_row.target_user_id_snapshot,
    event_action,
    'deleted',
    case when succeeded then null else request_row.previous_profile_status end,
    actor_id,
    actor_id::text,
    request_row.reason,
    result || case
      when succeeded then '{}'::jsonb
      else jsonb_build_object('errorMessage', btrim(deletion_error_message))
    end
  );

  return result;
end;
$$;

alter table public.account_deletion_requests enable row level security;

revoke all on public.account_deletion_requests from public, anon, authenticated;
revoke all on function public.prepare_account_deletion(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.finalize_account_deletion(uuid, boolean, uuid, text) from public, anon, authenticated;

grant execute on function public.prepare_account_deletion(uuid, text, uuid, text) to service_role;
grant execute on function public.finalize_account_deletion(uuid, boolean, uuid, text) to service_role;

comment on table public.account_deletion_requests is
  'Two-phase idempotent account hard-deletion requests with recoverable failed finalization.';
comment on function public.prepare_account_deletion(uuid, text, uuid, text) is
  'Service-role-only phase one: lock profile, prevent self/last-admin deletion, mark profile deleted and create audit.';
comment on function public.finalize_account_deletion(uuid, boolean, uuid, text) is
  'Service-role-only phase two: record Auth deletion success or restore prior profile status after failure.';

notify pgrst, 'reload schema';
