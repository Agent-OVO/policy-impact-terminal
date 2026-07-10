-- Stage 8: model-call budget reservation and finalization.
-- Depends on Stage 7 model_usage_ledger and Stage 8 assert_active_admin_actor().

alter table public.model_usage_ledger
  add column if not exists reservation_tokens integer not null default 0
    check (reservation_tokens >= 0),
  add column if not exists budget_period_start date,
  add column if not exists reservation_released_at timestamptz;

create unique index if not exists model_usage_ledger_request_hash_uidx
  on public.model_usage_ledger(request_hash)
  where request_hash is not null;

create table if not exists public.model_budget_periods (
  period_start date primary key,
  effective_token_budget integer not null
    check (effective_token_budget > 0),
  reserved_effective_tokens integer not null default 0
    check (reserved_effective_tokens >= 0),
  consumed_effective_tokens integer not null default 0
    check (consumed_effective_tokens >= 0),
  blocked_request_count integer not null default 0
    check (blocked_request_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists model_budget_periods_updated_idx
  on public.model_budget_periods(updated_at desc);

drop trigger if exists set_model_budget_periods_updated_at on public.model_budget_periods;
create trigger set_model_budget_periods_updated_at
  before update on public.model_budget_periods
  for each row execute function public.set_updated_at();

create or replace function public.protect_model_usage_ledger_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if row(new.policy_id, new.revision_id, new.operation_type, new.provider, new.model,
         new.prompt_version, new.request_hash, new.budget_class, new.trigger_reason,
         new.exception_reason, new.created_by, new.created_at,
         new.reservation_tokens, new.budget_period_start)
     is distinct from
     row(old.policy_id, old.revision_id, old.operation_type, old.provider, old.model,
         old.prompt_version, old.request_hash, old.budget_class, old.trigger_reason,
         old.exception_reason, old.created_by, old.created_at,
         old.reservation_tokens, old.budget_period_start)
  then
    raise exception 'model usage ledger identity and reservation fields are immutable'
      using errcode = '23514';
  end if;

  if old.status <> new.status and not (
    old.status = 'planned' and new.status in ('succeeded', 'failed', 'blocked')
  ) then
    raise exception 'invalid model usage status transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  if old.status <> 'planned'
    and row(new.input_tokens, new.output_tokens, new.cached_tokens, new.metadata,
            new.reservation_released_at)
      is distinct from
      row(old.input_tokens, old.output_tokens, old.cached_tokens, old.metadata,
          old.reservation_released_at)
  then
    raise exception 'terminal model usage ledger rows are immutable'
      using errcode = '23514';
  end if;

  if old.status = 'planned' and new.status = 'planned'
    and row(new.input_tokens, new.output_tokens, new.cached_tokens, new.metadata,
            new.reservation_released_at)
      is distinct from
      row(old.input_tokens, old.output_tokens, old.cached_tokens, old.metadata,
          old.reservation_released_at)
  then
    raise exception 'token results may only be finalized with a terminal status'
      using errcode = '23514';
  end if;

  if old.status = 'planned' and new.status <> 'planned'
    and old.reservation_tokens > 0
    and new.reservation_released_at is null
  then
    raise exception 'reservation_released_at is required when finalizing a reserved model call'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.current_model_budget_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  config jsonb;
begin
  select c.config_value into config
  from public.system_config_versions c
  where c.config_key = 'model.token_budget'
    and c.status = 'active'
  order by c.version_no desc
  limit 1;

  return coalesce(config, jsonb_build_object(
    'L2', jsonb_build_object('hardLimit', 12000),
    'L3', jsonb_build_object('hardLimit', 30000),
    'monthlyEffectiveTokenLimit', 300000
  ));
end;
$$;

create or replace function public.reserve_model_usage(
  target_policy_id uuid,
  target_revision_id uuid,
  target_operation_type text,
  target_provider text,
  target_model text,
  target_prompt_version text,
  target_request_hash text,
  target_budget_class text,
  target_trigger_reason text,
  planned_input_tokens integer,
  planned_output_tokens integer,
  actor_id uuid,
  target_exception_reason text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_hash text := lower(btrim(target_request_hash));
  budget_config jsonb;
  hard_limit integer;
  monthly_limit integer;
  requested_tokens integer;
  period_start_value date;
  existing_usage public.model_usage_ledger%rowtype;
  period_row public.model_budget_periods%rowtype;
  usage_id uuid;
  blocked_reason text;
  result jsonb;
begin
  perform public.assert_active_admin_actor(actor_id);

  if normalized_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'target_request_hash must be a lowercase SHA-256 hex string'
      using errcode = '22023';
  end if;
  if nullif(btrim(target_operation_type), '') is null
    or nullif(btrim(target_model), '') is null
    or nullif(btrim(target_trigger_reason), '') is null
  then
    raise exception 'operation_type, model and trigger_reason are required'
      using errcode = '22023';
  end if;
  if coalesce(planned_input_tokens, -1) < 0 or coalesce(planned_output_tokens, -1) < 0 then
    raise exception 'planned token values must be non-negative'
      using errcode = '22023';
  end if;
  if target_budget_class not in ('L0', 'L1', 'L2', 'L3', 'exception') then
    raise exception 'unsupported budget class: %', target_budget_class
      using errcode = '22023';
  end if;
  if target_budget_class = 'exception'
    and nullif(btrim(target_exception_reason), '') is null
  then
    raise exception 'exception budget class requires exception_reason'
      using errcode = '22023';
  end if;
  if target_revision_id is not null and target_policy_id is null then
    raise exception 'revision_id requires policy_id'
      using errcode = '23514';
  end if;
  if target_policy_id is not null and not exists (
    select 1 from public.policies p where p.id = target_policy_id
  ) then
    raise exception 'policy not found'
      using errcode = 'P0002';
  end if;
  if target_revision_id is not null and not exists (
    select 1
    from public.report_revisions r
    where r.id = target_revision_id
      and r.policy_id = target_policy_id
  ) then
    raise exception 'revision not found for policy'
      using errcode = 'P0002';
  end if;

  select * into existing_usage
  from public.model_usage_ledger l
  where l.request_hash = normalized_hash;

  if found then
    if existing_usage.policy_id is distinct from target_policy_id
      or existing_usage.revision_id is distinct from target_revision_id
      or existing_usage.operation_type <> btrim(target_operation_type)
      or existing_usage.model <> btrim(target_model)
      or existing_usage.budget_class <> target_budget_class
      or existing_usage.created_by <> actor_id
    then
      raise exception 'request hash was already used for a different model operation'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'usageId', existing_usage.id,
      'allowed', existing_usage.status = 'planned',
      'status', existing_usage.status,
      'reservationTokens', existing_usage.reservation_tokens,
      'budgetPeriodStart', existing_usage.budget_period_start,
      'idempotentReplay', true
    );
  end if;

  budget_config := public.current_model_budget_config();
  hard_limit := case target_budget_class
    when 'L2' then coalesce((budget_config #>> '{L2,hardLimit}')::integer, 12000)
    when 'L3' then coalesce((budget_config #>> '{L3,hardLimit}')::integer, 30000)
    else null
  end;
  monthly_limit := coalesce((budget_config ->> 'monthlyEffectiveTokenLimit')::integer, 300000);
  requested_tokens := planned_input_tokens + planned_output_tokens;
  period_start_value := date_trunc('month', now() at time zone 'Asia/Shanghai')::date;

  if target_budget_class in ('L0', 'L1') then
    blocked_reason := 'zero_token_budget_class';
  elsif target_budget_class in ('L2', 'L3') and requested_tokens > hard_limit then
    blocked_reason := 'per_call_hard_limit_exceeded';
  end if;

  insert into public.model_budget_periods (
    period_start, effective_token_budget
  ) values (
    period_start_value, monthly_limit
  ) on conflict (period_start) do nothing;

  select * into period_row
  from public.model_budget_periods p
  where p.period_start = period_start_value
  for update;

  if blocked_reason is null
    and target_budget_class <> 'exception'
    and period_row.consumed_effective_tokens
      + period_row.reserved_effective_tokens
      + requested_tokens
      > period_row.effective_token_budget
  then
    blocked_reason := 'monthly_hard_limit_exceeded';
  end if;

  if blocked_reason is not null then
    update public.model_budget_periods
      set blocked_request_count = blocked_request_count + 1
      where period_start = period_start_value;

    insert into public.model_usage_ledger (
      policy_id, revision_id, operation_type, provider, model, prompt_version,
      request_hash, input_tokens, output_tokens, cached_tokens, budget_class,
      trigger_reason, status, exception_reason, metadata, created_by,
      reservation_tokens, budget_period_start, reservation_released_at
    ) values (
      target_policy_id, target_revision_id, btrim(target_operation_type), nullif(btrim(target_provider), ''),
      btrim(target_model), nullif(btrim(target_prompt_version), ''), normalized_hash,
      0, 0, 0, target_budget_class, btrim(target_trigger_reason), 'blocked',
      nullif(btrim(target_exception_reason), ''),
      coalesce(target_metadata, '{}'::jsonb) || jsonb_build_object(
        'blockedReason', blocked_reason,
        'plannedInputTokens', planned_input_tokens,
        'plannedOutputTokens', planned_output_tokens,
        'requestedTokens', requested_tokens,
        'hardLimit', hard_limit,
        'monthlyBudget', period_row.effective_token_budget,
        'monthlyReserved', period_row.reserved_effective_tokens,
        'monthlyConsumed', period_row.consumed_effective_tokens
      ),
      actor_id, 0, period_start_value, now()
    ) returning id into usage_id;

    return jsonb_build_object(
      'usageId', usage_id,
      'allowed', false,
      'status', 'blocked',
      'blockedReason', blocked_reason,
      'reservationTokens', 0,
      'budgetPeriodStart', period_start_value,
      'idempotentReplay', false
    );
  end if;

  if target_budget_class <> 'exception' then
    update public.model_budget_periods
      set reserved_effective_tokens = reserved_effective_tokens + requested_tokens
      where period_start = period_start_value;
  end if;

  insert into public.model_usage_ledger (
    policy_id, revision_id, operation_type, provider, model, prompt_version,
    request_hash, input_tokens, output_tokens, cached_tokens, budget_class,
    trigger_reason, status, exception_reason, metadata, created_by,
    reservation_tokens, budget_period_start
  ) values (
    target_policy_id, target_revision_id, btrim(target_operation_type), nullif(btrim(target_provider), ''),
    btrim(target_model), nullif(btrim(target_prompt_version), ''), normalized_hash,
    0, 0, 0, target_budget_class, btrim(target_trigger_reason), 'planned',
    nullif(btrim(target_exception_reason), ''),
    coalesce(target_metadata, '{}'::jsonb) || jsonb_build_object(
      'plannedInputTokens', planned_input_tokens,
      'plannedOutputTokens', planned_output_tokens,
      'requestedTokens', requested_tokens,
      'hardLimit', hard_limit,
      'monthlyBudget', period_row.effective_token_budget
    ),
    actor_id,
    case when target_budget_class = 'exception' then 0 else requested_tokens end,
    period_start_value
  ) returning id into usage_id;

  result := jsonb_build_object(
    'usageId', usage_id,
    'allowed', true,
    'status', 'planned',
    'reservationTokens', case when target_budget_class = 'exception' then 0 else requested_tokens end,
    'budgetPeriodStart', period_start_value,
    'idempotentReplay', false
  );
  return result;
end;
$$;

create or replace function public.finalize_model_usage(
  target_usage_id uuid,
  actual_input_tokens integer,
  actual_output_tokens integer,
  actual_cached_tokens integer,
  target_status text,
  actor_id uuid,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  usage_row public.model_usage_ledger%rowtype;
  budget_config jsonb;
  hard_limit integer;
  actual_effective_tokens integer;
  final_status text;
  budget_violation boolean := false;
  result jsonb;
begin
  perform public.assert_active_admin_actor(actor_id);

  if target_status not in ('succeeded', 'failed') then
    raise exception 'target_status must be succeeded or failed'
      using errcode = '22023';
  end if;
  if coalesce(actual_input_tokens, -1) < 0
    or coalesce(actual_output_tokens, -1) < 0
    or coalesce(actual_cached_tokens, -1) < 0
    or actual_cached_tokens > actual_input_tokens
  then
    raise exception 'actual token values are invalid'
      using errcode = '22023';
  end if;

  select * into usage_row
  from public.model_usage_ledger l
  where l.id = target_usage_id
  for update;

  if not found then
    raise exception 'model usage ledger row not found'
      using errcode = 'P0002';
  end if;

  if usage_row.created_by <> actor_id then
    raise exception 'only the reserving admin may finalize this model usage row'
      using errcode = '42501';
  end if;

  if usage_row.status <> 'planned' then
    if usage_row.input_tokens <> actual_input_tokens
      or usage_row.output_tokens <> actual_output_tokens
      or usage_row.cached_tokens <> actual_cached_tokens
      or coalesce(usage_row.metadata ->> 'requestedTerminalStatus', usage_row.status) <> target_status
    then
      raise exception 'model usage finalization conflicts with an existing terminal result'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'usageId', usage_row.id,
      'status', usage_row.status,
      'effectiveTokens', usage_row.effective_tokens,
      'idempotentReplay', true
    );
  end if;

  actual_effective_tokens := greatest(
    actual_input_tokens + actual_output_tokens - actual_cached_tokens,
    0
  );
  budget_config := public.current_model_budget_config();
  hard_limit := case usage_row.budget_class
    when 'L2' then coalesce((budget_config #>> '{L2,hardLimit}')::integer, 12000)
    when 'L3' then coalesce((budget_config #>> '{L3,hardLimit}')::integer, 30000)
    else null
  end;
  budget_violation := usage_row.budget_class in ('L2', 'L3')
    and actual_input_tokens + actual_output_tokens > hard_limit;
  final_status := case when budget_violation then 'failed' else target_status end;

  if usage_row.reservation_tokens > 0 then
    update public.model_budget_periods
      set reserved_effective_tokens = greatest(
            reserved_effective_tokens - usage_row.reservation_tokens,
            0
          ),
          consumed_effective_tokens = consumed_effective_tokens + actual_effective_tokens
      where period_start = usage_row.budget_period_start;
  elsif usage_row.budget_class = 'exception' then
    update public.model_budget_periods
      set consumed_effective_tokens = consumed_effective_tokens + actual_effective_tokens
      where period_start = usage_row.budget_period_start;
  end if;

  update public.model_usage_ledger
    set input_tokens = actual_input_tokens,
        output_tokens = actual_output_tokens,
        cached_tokens = actual_cached_tokens,
        status = final_status,
        reservation_released_at = now(),
        metadata = coalesce(usage_row.metadata, '{}'::jsonb)
          || coalesce(target_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'budgetViolation', budget_violation,
            'requestedTerminalStatus', target_status,
            'hardLimit', hard_limit
          )
    where id = usage_row.id;

  result := jsonb_build_object(
    'usageId', usage_row.id,
    'status', final_status,
    'effectiveTokens', actual_effective_tokens,
    'budgetViolation', budget_violation,
    'idempotentReplay', false
  );
  return result;
end;
$$;

alter table public.model_budget_periods enable row level security;

revoke all on public.model_budget_periods from public, anon, authenticated;
revoke all on function public.current_model_budget_config() from public, anon, authenticated;
revoke all on function public.reserve_model_usage(uuid, uuid, text, text, text, text, text, text, text, integer, integer, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_model_usage(uuid, integer, integer, integer, text, uuid, jsonb) from public, anon, authenticated;

grant execute on function public.reserve_model_usage(uuid, uuid, text, text, text, text, text, text, text, integer, integer, uuid, text, jsonb) to service_role;
grant execute on function public.finalize_model_usage(uuid, integer, integer, integer, text, uuid, jsonb) to service_role;

comment on table public.model_budget_periods is
  'Operational monthly model-token reservation and consumption counters; not exposed to browser clients.';
comment on function public.reserve_model_usage(uuid, uuid, text, text, text, text, text, text, text, integer, integer, uuid, text, jsonb) is
  'Service-role-only preflight that blocks zero-token classes, per-call overruns and monthly budget overruns before a model call.';
comment on function public.finalize_model_usage(uuid, integer, integer, integer, text, uuid, jsonb) is
  'Service-role-only finalization that releases reservation, records actual tokens and flags hard-limit violations.';

notify pgrst, 'reload schema';
