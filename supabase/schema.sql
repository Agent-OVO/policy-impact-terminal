-- Supabase schema draft for the Policy Impact Terminal.
-- Run this file in the Supabase SQL Editor or through the Supabase CLI.

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  role text not null default 'user'
    check (role in ('user', 'analyst', 'admin')),
  status text not null default 'active'
    check (status in ('active', 'invited', 'suspended', 'deleted')),
  subscription_tier text not null default 'free'
    check (subscription_tier in ('free', 'pro', 'team', 'enterprise')),
  subscription_status text not null default 'trialing'
    check (subscription_status in ('trialing', 'active', 'past_due', 'canceled', 'none')),
  organization_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', new.email)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and status = 'active'
  );
$$;

create or replace function public.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_admin() then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.try_uuid(input_text text)
returns uuid
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
begin
  if input_text is null or btrim(input_text) = '' then
    return null;
  end if;

  return input_text::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

create schema if not exists analytics_private;

revoke all on schema analytics_private from public;
revoke all on schema analytics_private from anon;
revoke all on schema analytics_private from authenticated;

create or replace function public.protect_profile_system_fields()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' and auth.uid() = new.id then
    if new.role <> 'user'
      or new.status <> 'active'
      or new.subscription_tier <> 'free'
      or new.subscription_status <> 'trialing'
    then
      raise exception 'profile system fields are managed by server-side code';
    end if;
  end if;

  if tg_op = 'UPDATE' and auth.uid() = old.id and not public.is_admin() then
    if new.role is distinct from old.role
      or new.status is distinct from old.status
      or new.subscription_tier is distinct from old.subscription_tier
      or new.subscription_status is distinct from old.subscription_status
    then
      raise exception 'profile system fields are managed by server-side code';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_system_fields on public.profiles;
create trigger protect_profile_system_fields
  before insert or update on public.profiles
  for each row execute function public.protect_profile_system_fields();

create table if not exists public.policy_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text,
  name text not null,
  source_type text not null default 'official'
    check (source_type in ('official', 'media', 'research', 'exchange', 'company', 'other')),
  authority_level text not null default 'primary'
    check (authority_level in ('primary', 'secondary', 'tertiary')),
  homepage_url text,
  list_url text,
  jurisdiction text,
  publisher text,
  reliability_score numeric(5,2) not null default 80
    check (reliability_score >= 0 and reliability_score <= 100),
  crawl_priority integer not null default 50,
  dedupe_priority integer not null default 50,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'blocked')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.policy_sources
  add column if not exists source_key text,
  add column if not exists list_url text,
  add column if not exists crawl_priority integer not null default 50,
  add column if not exists dedupe_priority integer not null default 50;

create table if not exists public.policies (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  source_id uuid references public.policy_sources(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  title text not null,
  status text not null default 'draft'
    check (status in ('draft', 'reviewing', 'published', 'archived', 'failed')),
  visibility text not null default 'authenticated'
    check (visibility in ('private', 'authenticated', 'organization', 'public')),
  required_role text not null default 'user',
  required_subscription_tier text not null default 'free',
  issuer text,
  publish_date date,
  effective_date date,
  category text,
  policy_level text,
  jurisdiction text,
  source_url text,
  source_name text,
  canonical_source_url text,
  policy_no text,
  dedupe_key text,
  content_hash text,
  duplicate_of_policy_id uuid references public.policies(id) on delete set null,
  summary text,
  full_text text,
  confidence numeric(5,2) check (confidence >= 0 and confidence <= 100),
  tags text[] not null default '{}'::text[],
  analysis_version text not null default 'v0',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector(
      'simple',
      coalesce(title, '') || ' ' ||
      coalesce(issuer, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      coalesce(summary, '')
    )
  ) stored
);

alter table public.policies
  add column if not exists external_id text,
  add column if not exists canonical_source_url text,
  add column if not exists policy_no text,
  add column if not exists dedupe_key text,
  add column if not exists content_hash text,
  add column if not exists full_text text,
  add column if not exists duplicate_of_policy_id uuid references public.policies(id) on delete set null;

alter table public.policies
  drop constraint if exists policies_status_check;

alter table public.policies
  add constraint policies_status_check
  check (status in ('draft', 'reviewing', 'published', 'archived', 'failed'));

create table if not exists public.policy_actions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  action_key text,
  title text not null,
  body text,
  signal text not null default 'pending'
    check (signal in ('positive', 'constraint', 'risk', 'pending', 'neutral')),
  confidence numeric(5,2) check (confidence >= 0 and confidence <= 100),
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_id, action_key)
);

create table if not exists public.policy_clauses (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  clause_key text,
  clause_no text,
  title text,
  clause_group text,
  tone text,
  excerpt text,
  full_text text,
  confidence numeric(5,2) check (confidence >= 0 and confidence <= 100),
  keywords text[] not null default '{}'::text[],
  industries text[] not null default '{}'::text[],
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_id, clause_key)
);

create table if not exists public.industry_nodes (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  node_key text not null,
  title text not null,
  subtitle text,
  section text not null
    check (section in ('upstream', 'midstream', 'downstream', 'support')),
  relation text not null default 'pending'
    check (relation in ('direct', 'indirect', 'beneficiary', 'constraint_risk', 'pending')),
  evidence_level text not null default 'pending'
    check (evidence_level in ('strong', 'indirect', 'pending')),
  confidence numeric(5,2) check (confidence >= 0 and confidence <= 100),
  description text,
  clause_refs jsonb not null default '[]'::jsonb,
  company_refs jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_id, id),
  unique (policy_id, node_key)
);

create table if not exists public.industry_edges (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  from_node_id uuid not null,
  to_node_id uuid not null,
  edge_type text not null default 'medium'
    check (edge_type in ('strong', 'medium', 'weak', 'risk')),
  confidence numeric(5,2) check (confidence >= 0 and confidence <= 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint industry_edges_different_nodes check (from_node_id <> to_node_id),
  constraint industry_edges_from_node_fk
    foreign key (policy_id, from_node_id)
    references public.industry_nodes(policy_id, id)
    on delete cascade,
  constraint industry_edges_to_node_fk
    foreign key (policy_id, to_node_id)
    references public.industry_nodes(policy_id, id)
    on delete cascade,
  unique (policy_id, from_node_id, to_node_id, edge_type)
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  company_key text,
  name text not null,
  ticker text,
  exchange text,
  platform text,
  status text,
  section text check (section in ('upstream', 'midstream', 'downstream', 'support')),
  relation text not null default 'pending'
    check (relation in ('direct', 'indirect', 'beneficiary', 'constraint_risk', 'pending')),
  evidence_level text not null default 'pending'
    check (evidence_level in ('strong', 'indirect', 'pending')),
  confidence numeric(5,2) check (confidence >= 0 and confidence <= 100),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  products text[] not null default '{}'::text[],
  reason text,
  uncertainty text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_id, company_key)
);

create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  source_id uuid references public.policy_sources(id) on delete set null,
  clause_id uuid references public.policy_clauses(id) on delete set null,
  industry_node_id uuid references public.industry_nodes(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  title text not null,
  source_name text,
  evidence_type text,
  published_at date,
  url text,
  excerpt text,
  confidence numeric(5,2) check (confidence >= 0 and confidence <= 100),
  raw_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid references public.policies(id) on delete set null,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '未命名政策',
  source_url text,
  source_name text,
  job_type text not null default 'policy_impact_analysis',
  status text not null default 'queued'
    check (status in ('queued', 'fetching', 'extracting', 'analyzing', 'published', 'failed')),
  priority integer not null default 0,
  progress numeric(5,2) not null default 0
    check (progress >= 0 and progress <= 100),
  current_step text not null default '等待处理',
  requested_role text not null default 'user',
  requested_subscription_tier text not null default 'free',
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id text not null,
  event_type text not null
    check (event_type in (
      'app_open',
      'policy_list_view',
      'policy_open',
      'policy_view',
      'policy_view_duration',
      'module_click',
      'module_view',
      'module_view_duration',
      'industry_node_select',
      'company_select',
      'navigate_back_to_list',
      'logout'
    )),
  policy_ref text,
  module_id text,
  target_type text,
  target_id text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  route_path text,
  viewport jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create or replace function public.can_read_policy(target_policy_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.policies p
    where p.id = target_policy_id
      and (
        public.is_admin()
        or (
          p.status = 'published'
          and p.analysis_version = 'codex-manual-v1'
          and p.publish_date >= date '2026-05-01'
        )
      )
  );
$$;

create or replace function public.can_manage_policy(target_policy_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.policies p
    where p.id = target_policy_id
      and (
        public.is_admin()
      )
  );
$$;

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_status_idx on public.profiles (status);
create index if not exists profiles_subscription_idx on public.profiles (subscription_tier, subscription_status);

drop index if exists public.policy_sources_source_key_uidx;
create unique index if not exists policy_sources_source_key_uidx on public.policy_sources (source_key);
create index if not exists policy_sources_status_idx on public.policy_sources (status);
create index if not exists policy_sources_type_idx on public.policy_sources (source_type, authority_level);
create index if not exists policy_sources_homepage_url_idx on public.policy_sources (homepage_url);

create unique index if not exists policies_external_id_uidx on public.policies (external_id)
  where external_id is not null;
create unique index if not exists policies_dedupe_key_uidx on public.policies (dedupe_key)
  where dedupe_key is not null and duplicate_of_policy_id is null;
create index if not exists policies_source_id_idx on public.policies (source_id);
create index if not exists policies_owner_id_idx on public.policies (owner_id);
create index if not exists policies_source_url_idx on public.policies (source_url);
create index if not exists policies_canonical_source_url_idx on public.policies (canonical_source_url);
create index if not exists policies_policy_no_idx on public.policies (policy_no);
create index if not exists policies_content_hash_idx on public.policies (content_hash);
create index if not exists policies_duplicate_of_policy_id_idx on public.policies (duplicate_of_policy_id);
create index if not exists policies_status_publish_date_idx on public.policies (status, publish_date desc);
create index if not exists policies_category_idx on public.policies (category);
create index if not exists policies_tags_idx on public.policies using gin (tags);
create index if not exists policies_search_idx on public.policies using gin (search_vector);

create index if not exists policy_actions_policy_id_idx on public.policy_actions (policy_id);
create index if not exists policy_actions_signal_idx on public.policy_actions (signal);

create index if not exists policy_clauses_policy_id_idx on public.policy_clauses (policy_id);
create index if not exists policy_clauses_group_idx on public.policy_clauses (policy_id, clause_group);
create index if not exists policy_clauses_keywords_idx on public.policy_clauses using gin (keywords);
create index if not exists policy_clauses_industries_idx on public.policy_clauses using gin (industries);

create index if not exists industry_nodes_policy_id_idx on public.industry_nodes (policy_id);
create index if not exists industry_nodes_section_idx on public.industry_nodes (policy_id, section);
create index if not exists industry_nodes_relation_idx on public.industry_nodes (policy_id, relation);

create index if not exists industry_edges_policy_id_idx on public.industry_edges (policy_id);
create index if not exists industry_edges_from_node_idx on public.industry_edges (from_node_id);
create index if not exists industry_edges_to_node_idx on public.industry_edges (to_node_id);

create index if not exists companies_policy_id_idx on public.companies (policy_id);
create index if not exists companies_ticker_idx on public.companies (ticker);
create index if not exists companies_relation_idx on public.companies (policy_id, relation);
create index if not exists companies_products_idx on public.companies using gin (products);

create index if not exists evidence_policy_id_idx on public.evidence (policy_id);
create index if not exists evidence_source_id_idx on public.evidence (source_id);
create index if not exists evidence_clause_id_idx on public.evidence (clause_id);
create index if not exists evidence_company_id_idx on public.evidence (company_id);
create index if not exists evidence_type_idx on public.evidence (evidence_type);

create index if not exists analysis_jobs_owner_id_idx on public.analysis_jobs (owner_id);
create index if not exists analysis_jobs_policy_id_idx on public.analysis_jobs (policy_id);
create index if not exists analysis_jobs_status_idx on public.analysis_jobs (status, created_at desc);

create index if not exists user_events_user_id_idx on public.user_events (user_id, occurred_at desc);
create index if not exists user_events_session_id_idx on public.user_events (session_id, occurred_at desc);
create index if not exists user_events_policy_ref_idx on public.user_events (policy_ref, occurred_at desc);
create index if not exists user_events_event_type_idx on public.user_events (event_type, occurred_at desc);
create index if not exists user_events_module_id_idx on public.user_events (module_id, occurred_at desc);
create index if not exists user_events_occurred_at_idx on public.user_events (occurred_at desc);
create index if not exists user_events_user_session_occurred_at_idx on public.user_events (user_id, session_id, occurred_at desc);
create index if not exists user_events_user_event_type_occurred_at_idx on public.user_events (user_id, event_type, occurred_at desc);

create or replace view analytics_private.user_event_enriched as
select
  e.id as event_id,
  e.user_id,
  pr.display_name,
  au.email,
  pr.role,
  pr.status as profile_status,
  pr.subscription_tier,
  pr.subscription_status,
  e.session_id,
  e.event_type,
  e.policy_ref,
  e.policy_ref_uuid,
  p.id as policy_id,
  p.external_id as policy_external_id,
  p.title as policy_title,
  p.category as policy_category,
  p.issuer as policy_issuer,
  p.publish_date as policy_publish_date,
  e.module_id,
  e.target_type,
  e.target_id,
  e.duration_ms,
  e.route_path,
  e.viewport,
  e.metadata,
  e.occurred_at,
  e.created_at
from (
  select
    ue.*,
    public.try_uuid(ue.policy_ref) as policy_ref_uuid
  from public.user_events ue
) e
left join public.profiles pr
  on pr.id = e.user_id
left join auth.users au
  on au.id = e.user_id
left join lateral (
  select
    pol.id,
    pol.external_id,
    pol.title,
    pol.category,
    pol.issuer,
    pol.publish_date,
    pol.created_at
  from public.policies pol
  where pol.id = e.policy_ref_uuid
     or pol.external_id = e.policy_ref
  order by
    case when pol.id = e.policy_ref_uuid then 0 else 1 end,
    pol.created_at desc
  limit 1
) p on true;

create or replace view analytics_private.user_session_rollups as
select
  e.user_id,
  e.display_name,
  e.email,
  e.role,
  e.profile_status,
  e.subscription_tier,
  e.subscription_status,
  e.session_id,
  min(e.occurred_at) as first_seen,
  max(e.occurred_at) as last_seen,
  count(*)::bigint as event_count,
  count(distinct e.policy_ref) filter (where e.policy_ref is not null) as policy_count,
  count(distinct e.module_id) filter (where e.module_id is not null) as module_count,
  coalesce(sum(e.duration_ms), 0)::bigint as total_duration_ms,
  greatest((extract(epoch from (max(e.occurred_at) - min(e.occurred_at))) * 1000)::bigint, 0) as elapsed_ms,
  (array_agg(e.route_path order by e.occurred_at asc) filter (where e.route_path is not null))[1] as entry_route_path,
  (array_agg(e.route_path order by e.occurred_at desc) filter (where e.route_path is not null))[1] as exit_route_path
from analytics_private.user_event_enriched e
group by
  e.user_id,
  e.display_name,
  e.email,
  e.role,
  e.profile_status,
  e.subscription_tier,
  e.subscription_status,
  e.session_id;

create or replace view analytics_private.user_daily_rollups as
select
  date_trunc('day', e.occurred_at)::date as event_date,
  e.user_id,
  e.display_name,
  e.email,
  count(*)::bigint as event_count,
  count(distinct e.session_id)::bigint as session_count,
  count(distinct e.policy_ref) filter (where e.policy_ref is not null) as policy_count,
  count(distinct e.module_id) filter (where e.module_id is not null) as module_count,
  coalesce(sum(e.duration_ms), 0)::bigint as total_duration_ms
from analytics_private.user_event_enriched e
group by
  date_trunc('day', e.occurred_at)::date,
  e.user_id,
  e.display_name,
  e.email;

create or replace function public.admin_get_user_behavior_overview(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, analytics_private
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_result jsonb;
begin
  perform public.assert_admin();

  v_from := coalesce(p_from, now() - interval '30 days');
  v_to := coalesce(p_to, now());

  if v_from >= v_to then
    raise exception 'p_from must be before p_to'
      using errcode = '22023';
  end if;

  with filtered_events as (
    select *
    from analytics_private.user_event_enriched e
    where e.occurred_at >= v_from
      and e.occurred_at < v_to
  ),
  filtered_sessions as (
    select *
    from analytics_private.user_session_rollups s
    where s.last_seen >= v_from
      and s.first_seen < v_to
  )
  select jsonb_build_object(
    'range', jsonb_build_object(
      'from', v_from,
      'to', v_to
    ),
    'totals', (
      select jsonb_build_object(
        'eventCount', count(*)::bigint,
        'activeUsers', count(distinct user_id)::bigint,
        'sessionCount', count(distinct session_id)::bigint,
        'policyCount', count(distinct policy_ref) filter (where policy_ref is not null),
        'moduleCount', count(distinct module_id) filter (where module_id is not null),
        'durationMs', coalesce(sum(duration_ms), 0)::bigint
      )
      from filtered_events
    ),
    'sessionStats', (
      select jsonb_build_object(
        'avgElapsedMs', coalesce(round(avg(elapsed_ms))::bigint, 0),
        'avgDurationMs', coalesce(round(avg(total_duration_ms))::bigint, 0),
        'maxElapsedMs', coalesce(max(elapsed_ms), 0)::bigint
      )
      from filtered_sessions
    ),
    'eventsByDay', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', d.event_date,
          'eventCount', d.event_count,
          'activeUsers', d.active_users,
          'sessionCount', d.session_count,
          'durationMs', d.duration_ms
        )
        order by d.event_date
      )
      from (
        select
          date_trunc('day', occurred_at)::date as event_date,
          count(*)::bigint as event_count,
          count(distinct user_id)::bigint as active_users,
          count(distinct session_id)::bigint as session_count,
          coalesce(sum(duration_ms), 0)::bigint as duration_ms
        from filtered_events
        group by date_trunc('day', occurred_at)::date
      ) d
    ), '[]'::jsonb),
    'eventsByType', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'eventType', t.event_type,
          'eventCount', t.event_count,
          'activeUsers', t.active_users
        )
        order by t.event_count desc, t.event_type
      )
      from (
        select
          event_type,
          count(*)::bigint as event_count,
          count(distinct user_id)::bigint as active_users
        from filtered_events
        group by event_type
        order by count(*) desc, event_type
        limit 20
      ) t
    ), '[]'::jsonb),
    'topPolicies', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'policyRef', p.policy_ref,
          'policyId', p.policy_id,
          'externalId', p.policy_external_id,
          'title', p.policy_title,
          'eventCount', p.event_count,
          'activeUsers', p.active_users,
          'durationMs', p.duration_ms
        )
        order by p.event_count desc, p.policy_ref
      )
      from (
        select
          policy_ref,
          (array_agg(policy_id order by occurred_at desc) filter (where policy_id is not null))[1] as policy_id,
          (array_agg(policy_external_id order by occurred_at desc) filter (where policy_external_id is not null))[1] as policy_external_id,
          (array_agg(policy_title order by occurred_at desc) filter (where policy_title is not null))[1] as policy_title,
          count(*)::bigint as event_count,
          count(distinct user_id)::bigint as active_users,
          coalesce(sum(duration_ms), 0)::bigint as duration_ms
        from filtered_events
        where policy_ref is not null
        group by policy_ref
        order by count(*) desc, policy_ref
        limit 10
      ) p
    ), '[]'::jsonb),
    'topModules', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'moduleId', m.module_id,
          'eventCount', m.event_count,
          'activeUsers', m.active_users,
          'durationMs', m.duration_ms
        )
        order by m.event_count desc, m.module_id
      )
      from (
        select
          module_id,
          count(*)::bigint as event_count,
          count(distinct user_id)::bigint as active_users,
          coalesce(sum(duration_ms), 0)::bigint as duration_ms
        from filtered_events
        where module_id is not null
        group by module_id
        order by count(*) desc, module_id
        limit 10
      ) m
    ), '[]'::jsonb),
    'topUsers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'userId', u.user_id,
          'displayName', u.display_name,
          'email', u.email,
          'eventCount', u.event_count,
          'sessionCount', u.session_count,
          'policyCount', u.policy_count,
          'lastSeen', u.last_seen
        )
        order by u.event_count desc, u.last_seen desc
      )
      from (
        select
          user_id,
          (array_agg(display_name order by occurred_at desc) filter (where display_name is not null))[1] as display_name,
          (array_agg(email order by occurred_at desc) filter (where email is not null))[1] as email,
          count(*)::bigint as event_count,
          count(distinct session_id)::bigint as session_count,
          count(distinct policy_ref) filter (where policy_ref is not null) as policy_count,
          max(occurred_at) as last_seen
        from filtered_events
        group by user_id
        order by count(*) desc, max(occurred_at) desc
        limit 10
      ) u
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function public.admin_list_user_behavior(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_user_id uuid default null,
  p_search text default null,
  p_event_type text default null,
  p_policy_ref text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, analytics_private
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_search text;
  v_event_type text;
  v_policy_ref text;
  v_limit integer;
  v_offset integer;
  v_result jsonb;
begin
  perform public.assert_admin();

  v_from := coalesce(p_from, now() - interval '30 days');
  v_to := coalesce(p_to, now());
  v_search := nullif(btrim(p_search), '');
  v_event_type := nullif(btrim(p_event_type), '');
  v_policy_ref := nullif(btrim(p_policy_ref), '');
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  if v_from >= v_to then
    raise exception 'p_from must be before p_to'
      using errcode = '22023';
  end if;

  with filtered_events as (
    select *
    from analytics_private.user_event_enriched e
    where e.occurred_at >= v_from
      and e.occurred_at < v_to
      and (p_user_id is null or e.user_id = p_user_id)
      and (
        v_search is null
        or e.user_id::text ilike '%' || v_search || '%'
        or coalesce(e.display_name, '') ilike '%' || v_search || '%'
        or coalesce(e.email, '') ilike '%' || v_search || '%'
      )
      and (v_event_type is null or e.event_type = v_event_type)
      and (
        v_policy_ref is null
        or e.policy_ref = v_policy_ref
        or e.policy_external_id = v_policy_ref
        or e.policy_id = public.try_uuid(v_policy_ref)
      )
  ),
  user_rows as (
    select
      user_id,
      (array_agg(display_name order by occurred_at desc) filter (where display_name is not null))[1] as display_name,
      (array_agg(email order by occurred_at desc) filter (where email is not null))[1] as email,
      (array_agg(role order by occurred_at desc) filter (where role is not null))[1] as role,
      (array_agg(profile_status order by occurred_at desc) filter (where profile_status is not null))[1] as profile_status,
      (array_agg(subscription_tier order by occurred_at desc) filter (where subscription_tier is not null))[1] as subscription_tier,
      (array_agg(subscription_status order by occurred_at desc) filter (where subscription_status is not null))[1] as subscription_status,
      count(*)::bigint as event_count,
      count(distinct session_id)::bigint as session_count,
      count(distinct policy_ref) filter (where policy_ref is not null) as policy_count,
      count(distinct module_id) filter (where module_id is not null) as module_count,
      coalesce(sum(duration_ms), 0)::bigint as duration_ms,
      min(occurred_at) as first_seen,
      max(occurred_at) as last_seen,
      (array_agg(event_type order by occurred_at desc))[1] as last_event_type,
      (array_agg(route_path order by occurred_at desc) filter (where route_path is not null))[1] as last_route_path
    from filtered_events
    group by user_id
  ),
  total as (
    select count(*)::bigint as total_rows
    from user_rows
  ),
  paged as (
    select *
    from user_rows
    order by last_seen desc, event_count desc, user_id
    limit v_limit
    offset v_offset
  )
  select jsonb_build_object(
    'range', jsonb_build_object(
      'from', v_from,
      'to', v_to
    ),
    'pagination', jsonb_build_object(
      'total', (select total_rows from total),
      'limit', v_limit,
      'offset', v_offset
    ),
    'users', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'userId', p.user_id,
          'displayName', p.display_name,
          'email', p.email,
          'role', p.role,
          'status', p.profile_status,
          'subscriptionTier', p.subscription_tier,
          'subscriptionStatus', p.subscription_status,
          'eventCount', p.event_count,
          'sessionCount', p.session_count,
          'policyCount', p.policy_count,
          'moduleCount', p.module_count,
          'durationMs', p.duration_ms,
          'firstSeen', p.first_seen,
          'lastSeen', p.last_seen,
          'lastEventType', p.last_event_type,
          'lastRoutePath', p.last_route_path,
          'topEventTypes', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'eventType', t.event_type,
                'eventCount', t.event_count
              )
              order by t.event_count desc, t.event_type
            )
            from (
              select event_type, count(*)::bigint as event_count
              from filtered_events fe
              where fe.user_id = p.user_id
              group by event_type
              order by count(*) desc, event_type
              limit 5
            ) t
          ), '[]'::jsonb),
          'topPolicies', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'policyRef', t.policy_ref,
                'policyId', t.policy_id,
                'externalId', t.policy_external_id,
                'title', t.policy_title,
                'eventCount', t.event_count
              )
              order by t.event_count desc, t.policy_ref
            )
            from (
              select
                policy_ref,
                (array_agg(policy_id order by occurred_at desc) filter (where policy_id is not null))[1] as policy_id,
                (array_agg(policy_external_id order by occurred_at desc) filter (where policy_external_id is not null))[1] as policy_external_id,
                (array_agg(policy_title order by occurred_at desc) filter (where policy_title is not null))[1] as policy_title,
                count(*)::bigint as event_count
              from filtered_events fe
              where fe.user_id = p.user_id
                and fe.policy_ref is not null
              group by policy_ref
              order by count(*) desc, policy_ref
              limit 5
            ) t
          ), '[]'::jsonb)
        )
        order by p.last_seen desc, p.event_count desc, p.user_id
      )
      from paged p
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function public.admin_get_user_behavior_detail(
  p_user_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, analytics_private
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_limit integer;
  v_offset integer;
  v_result jsonb;
begin
  perform public.assert_admin();

  if p_user_id is null then
    raise exception 'p_user_id is required'
      using errcode = '22023';
  end if;

  v_from := coalesce(p_from, now() - interval '30 days');
  v_to := coalesce(p_to, now());
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  if v_from >= v_to then
    raise exception 'p_from must be before p_to'
      using errcode = '22023';
  end if;

  with profile as (
    select
      pr.id as user_id,
      pr.display_name,
      au.email,
      pr.role,
      pr.status as profile_status,
      pr.subscription_tier,
      pr.subscription_status,
      pr.created_at,
      pr.updated_at
    from public.profiles pr
    left join auth.users au
      on au.id = pr.id
    where pr.id = p_user_id
  ),
  filtered_events as (
    select *
    from analytics_private.user_event_enriched e
    where e.user_id = p_user_id
      and e.occurred_at >= v_from
      and e.occurred_at < v_to
  ),
  session_rows as (
    select
      session_id,
      min(occurred_at) as first_seen,
      max(occurred_at) as last_seen,
      count(*)::bigint as event_count,
      count(distinct policy_ref) filter (where policy_ref is not null) as policy_count,
      count(distinct module_id) filter (where module_id is not null) as module_count,
      coalesce(sum(duration_ms), 0)::bigint as duration_ms,
      greatest((extract(epoch from (max(occurred_at) - min(occurred_at))) * 1000)::bigint, 0) as elapsed_ms,
      (array_agg(route_path order by occurred_at asc) filter (where route_path is not null))[1] as entry_route_path,
      (array_agg(route_path order by occurred_at desc) filter (where route_path is not null))[1] as exit_route_path
    from filtered_events
    group by session_id
  ),
  events_page as (
    select *
    from filtered_events
    order by occurred_at desc, event_id desc
    limit v_limit
    offset v_offset
  )
  select jsonb_build_object(
    'user', coalesce((
      select jsonb_build_object(
        'userId', p.user_id,
        'displayName', p.display_name,
        'email', p.email,
        'role', p.role,
        'status', p.profile_status,
        'subscriptionTier', p.subscription_tier,
        'subscriptionStatus', p.subscription_status,
        'createdAt', p.created_at,
        'updatedAt', p.updated_at
      )
      from profile p
    ), jsonb_build_object('userId', p_user_id)),
    'range', jsonb_build_object(
      'from', v_from,
      'to', v_to
    ),
    'summary', (
      select jsonb_build_object(
        'eventCount', count(*)::bigint,
        'sessionCount', count(distinct session_id)::bigint,
        'policyCount', count(distinct policy_ref) filter (where policy_ref is not null),
        'moduleCount', count(distinct module_id) filter (where module_id is not null),
        'durationMs', coalesce(sum(duration_ms), 0)::bigint,
        'firstSeen', min(occurred_at),
        'lastSeen', max(occurred_at)
      )
      from filtered_events
    ),
    'topEventTypes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'eventType', t.event_type,
          'eventCount', t.event_count
        )
        order by t.event_count desc, t.event_type
      )
      from (
        select event_type, count(*)::bigint as event_count
        from filtered_events
        group by event_type
        order by count(*) desc, event_type
        limit 10
      ) t
    ), '[]'::jsonb),
    'topPolicies', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'policyRef', t.policy_ref,
          'policyId', t.policy_id,
          'externalId', t.policy_external_id,
          'title', t.policy_title,
          'eventCount', t.event_count,
          'durationMs', t.duration_ms
        )
        order by t.event_count desc, t.policy_ref
      )
      from (
        select
          policy_ref,
          (array_agg(policy_id order by occurred_at desc) filter (where policy_id is not null))[1] as policy_id,
          (array_agg(policy_external_id order by occurred_at desc) filter (where policy_external_id is not null))[1] as policy_external_id,
          (array_agg(policy_title order by occurred_at desc) filter (where policy_title is not null))[1] as policy_title,
          count(*)::bigint as event_count,
          coalesce(sum(duration_ms), 0)::bigint as duration_ms
        from filtered_events
        where policy_ref is not null
        group by policy_ref
        order by count(*) desc, policy_ref
        limit 10
      ) t
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'sessionId', s.session_id,
          'firstSeen', s.first_seen,
          'lastSeen', s.last_seen,
          'eventCount', s.event_count,
          'policyCount', s.policy_count,
          'moduleCount', s.module_count,
          'durationMs', s.duration_ms,
          'elapsedMs', s.elapsed_ms,
          'entryRoutePath', s.entry_route_path,
          'exitRoutePath', s.exit_route_path,
          'eventTypes', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'eventType', et.event_type,
                'eventCount', et.event_count
              )
              order by et.event_count desc, et.event_type
            )
            from (
              select event_type, count(*)::bigint as event_count
              from filtered_events fe
              where fe.session_id = s.session_id
              group by event_type
              order by count(*) desc, event_type
            ) et
          ), '[]'::jsonb)
        )
        order by s.last_seen desc, s.session_id
      )
      from (
        select *
        from session_rows
        order by last_seen desc, session_id
        limit 25
      ) s
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'eventId', e.event_id,
          'sessionId', e.session_id,
          'eventType', e.event_type,
          'policyRef', e.policy_ref,
          'policyId', e.policy_id,
          'externalId', e.policy_external_id,
          'policyTitle', e.policy_title,
          'moduleId', e.module_id,
          'targetType', e.target_type,
          'targetId', e.target_id,
          'durationMs', e.duration_ms,
          'routePath', e.route_path,
          'viewport', e.viewport,
          'metadata', jsonb_strip_nulls(jsonb_build_object(
            'source', e.metadata->>'source',
            'previousModule', coalesce(e.metadata->>'previousModule', e.metadata->>'previous_module'),
            'title', e.metadata->>'title'
          )),
          'occurredAt', e.occurred_at,
          'createdAt', e.created_at
        )
        order by e.occurred_at desc, e.event_id desc
      )
      from events_page e
    ), '[]'::jsonb),
    'pagination', jsonb_build_object(
      'totalEvents', (select count(*)::bigint from filtered_events),
      'limit', v_limit,
      'offset', v_offset
    )
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function public.admin_behavior_overview(
  start_date timestamptz default null,
  end_date timestamptz default null,
  granularity text default 'day',
  search_text text default null,
  event_types text[] default null,
  module_ids text[] default null,
  policy_ref text default null,
  user_id uuid default null,
  session_id text default null,
  source text default null,
  limit_count integer default null,
  offset_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, analytics_private
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_granularity text;
  v_search text;
  v_event_types text[];
  v_module_ids text[];
  v_policy_ref text;
  v_policy_uuid uuid;
  v_user_id uuid;
  v_session_id text;
  v_source text;
  v_rank_limit integer;
  v_rank_offset integer;
  v_result jsonb;
begin
  perform public.assert_admin();

  v_from := coalesce(admin_behavior_overview.start_date, now() - interval '30 days');
  v_to := coalesce(admin_behavior_overview.end_date, now());
  v_granularity := case lower(coalesce(nullif(btrim(admin_behavior_overview.granularity), ''), 'day'))
    when 'hour' then 'hour'
    when 'week' then 'week'
    when 'month' then 'month'
    else 'day'
  end;
  v_search := nullif(btrim(admin_behavior_overview.search_text), '');
  v_event_types := case
    when coalesce(cardinality(array_remove(admin_behavior_overview.event_types, '')), 0) = 0 then null
    else array_remove(admin_behavior_overview.event_types, '')
  end;
  v_module_ids := case
    when coalesce(cardinality(array_remove(admin_behavior_overview.module_ids, '')), 0) = 0 then null
    else array_remove(admin_behavior_overview.module_ids, '')
  end;
  v_policy_ref := nullif(btrim(admin_behavior_overview.policy_ref), '');
  v_policy_uuid := public.try_uuid(v_policy_ref);
  v_user_id := admin_behavior_overview.user_id;
  v_session_id := nullif(btrim(admin_behavior_overview.session_id), '');
  v_source := nullif(btrim(admin_behavior_overview.source), '');
  v_rank_limit := least(greatest(coalesce(admin_behavior_overview.limit_count, 10), 1), 100);
  v_rank_offset := greatest(coalesce(admin_behavior_overview.offset_count, 0), 0);

  if v_from >= v_to then
    raise exception 'start_date must be before end_date'
      using errcode = '22023';
  end if;

  with filtered_events as (
    select *
    from analytics_private.user_event_enriched e
    where e.occurred_at >= v_from
      and e.occurred_at < v_to
      and (v_search is null
        or e.user_id::text ilike '%' || v_search || '%'
        or coalesce(e.display_name, '') ilike '%' || v_search || '%'
        or coalesce(e.email, '') ilike '%' || v_search || '%'
        or coalesce(e.session_id, '') ilike '%' || v_search || '%'
        or coalesce(e.event_type, '') ilike '%' || v_search || '%'
        or coalesce(e.policy_ref, '') ilike '%' || v_search || '%'
        or coalesce(e.policy_external_id, '') ilike '%' || v_search || '%'
        or coalesce(e.policy_title, '') ilike '%' || v_search || '%'
        or coalesce(e.module_id, '') ilike '%' || v_search || '%'
        or coalesce(e.route_path, '') ilike '%' || v_search || '%'
        or coalesce(e.metadata->>'title', '') ilike '%' || v_search || '%')
      and (v_event_types is null or e.event_type = any(v_event_types))
      and (v_module_ids is null or e.module_id = any(v_module_ids))
      and (v_policy_ref is null
        or e.policy_ref = v_policy_ref
        or e.policy_external_id = v_policy_ref
        or e.policy_id = v_policy_uuid)
      and (v_user_id is null or e.user_id = v_user_id)
      and (v_session_id is null or e.session_id = v_session_id)
      and (v_source is null or coalesce(nullif(e.metadata->>'source', ''), 'other') = v_source)
  ),
  per_user as (
    select
      user_id,
      count(*)::bigint as event_count,
      count(distinct session_id)::bigint as session_count
    from filtered_events
    group by user_id
  ),
  event_summary as (
    select
      count(*)::bigint as total_events,
      count(distinct user_id)::bigint as unique_users,
      count(distinct session_id)::bigint as total_sessions,
      count(distinct policy_ref) filter (where policy_ref is not null) as active_policies,
      count(*) filter (where event_type = 'policy_view') as policy_view_events,
      count(*) filter (where event_type = 'policy_open') as policy_open_events,
      coalesce(round(avg(duration_ms) filter (
        where event_type in ('policy_view', 'policy_view_duration') and duration_ms is not null
      ))::bigint, 0) as avg_policy_view_ms,
      coalesce(round(avg(duration_ms) filter (where duration_ms is not null))::bigint, 0) as avg_duration_ms,
      coalesce(sum(duration_ms), 0)::bigint as total_duration_ms,
      count(distinct user_id) filter (
        where occurred_at >= date_trunc('day', now()) and occurred_at < now()
      ) as today_active_users,
      count(distinct user_id) filter (
        where occurred_at >= now() - interval '7 days' and occurred_at < now()
      ) as last_7d_active_users
    from filtered_events
  )
  select jsonb_build_object(
    'summary', (
      select jsonb_build_object(
        'totalUsers', s.unique_users,
        'todayActiveUsers', s.today_active_users,
        'last7dActiveUsers', s.last_7d_active_users,
        'totalEvents', s.total_events,
        'uniqueUsers', s.unique_users,
        'totalSessions', s.total_sessions,
        'activePolicies', s.active_policies,
        'policyViewEvents', s.policy_view_events,
        'policyOpenEvents', s.policy_open_events,
        'avgPolicyViewMs', s.avg_policy_view_ms,
        'avgDurationMs', s.avg_duration_ms,
        'totalDurationMs', s.total_duration_ms,
        'avgEventsPerUser', coalesce(round(s.total_events::numeric / nullif(s.unique_users, 0), 2), 0),
        'returningUsers', coalesce((select count(*)::bigint from per_user u where u.session_count > 1), 0),
        'bounceUsers', coalesce((select count(*)::bigint from per_user u where u.event_count = 1), 0)
      )
      from event_summary s
    ),
    'series', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'bucket', series.bucket,
          'label', case v_granularity
            when 'hour' then to_char(series.bucket, 'YYYY-MM-DD HH24:00')
            when 'week' then to_char(series.bucket, 'IYYY-"W"IW')
            when 'month' then to_char(series.bucket, 'YYYY-MM')
            else to_char(series.bucket, 'YYYY-MM-DD')
          end,
          'eventCount', series.event_count,
          'uniqueUsers', series.unique_users,
          'sessionCount', series.session_count,
          'durationMs', series.duration_ms
        )
        order by series.bucket
      )
      from (
        select
          date_trunc(v_granularity, occurred_at) as bucket,
          count(*)::bigint as event_count,
          count(distinct user_id)::bigint as unique_users,
          count(distinct session_id)::bigint as session_count,
          coalesce(sum(duration_ms), 0)::bigint as duration_ms
        from filtered_events
        group by date_trunc(v_granularity, occurred_at)
      ) series
    ), '[]'::jsonb),
    'topPolicies', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'policyRef', p.policy_ref,
          'policyId', p.policy_id,
          'externalId', p.policy_external_id,
          'title', coalesce(p.policy_title, p.policy_ref),
          'source', p.policy_source,
          'eventCount', p.event_count,
          'uniqueUsers', p.unique_users,
          'sessionCount', p.session_count,
          'avgDurationMs', p.avg_duration_ms,
          'lastSeenAt', p.last_seen_at
        )
        order by p.event_count desc, p.last_seen_at desc, p.policy_ref
      )
      from (
        select
          policy_ref,
          (array_agg(policy_id order by occurred_at desc) filter (where policy_id is not null))[1] as policy_id,
          (array_agg(policy_external_id order by occurred_at desc) filter (where policy_external_id is not null))[1] as policy_external_id,
          (array_agg(policy_title order by occurred_at desc) filter (where policy_title is not null))[1] as policy_title,
          (array_agg(policy_issuer order by occurred_at desc) filter (where policy_issuer is not null))[1] as policy_source,
          count(*)::bigint as event_count,
          count(distinct user_id)::bigint as unique_users,
          count(distinct session_id)::bigint as session_count,
          coalesce(round(avg(duration_ms) filter (where duration_ms is not null))::bigint, 0) as avg_duration_ms,
          max(occurred_at) as last_seen_at
        from filtered_events
        where policy_ref is not null
        group by policy_ref
        order by count(*) desc, max(occurred_at) desc, policy_ref
        limit v_rank_limit
        offset v_rank_offset
      ) p
    ), '[]'::jsonb),
    'topModules', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'moduleId', m.module_id,
          'eventCount', m.event_count,
          'uniqueUsers', m.unique_users,
          'sessionCount', m.session_count,
          'avgDurationMs', m.avg_duration_ms,
          'lastSeenAt', m.last_seen_at
        )
        order by m.event_count desc, m.last_seen_at desc, m.module_id
      )
      from (
        select
          module_id,
          count(*)::bigint as event_count,
          count(distinct user_id)::bigint as unique_users,
          count(distinct session_id)::bigint as session_count,
          coalesce(round(avg(duration_ms) filter (where duration_ms is not null))::bigint, 0) as avg_duration_ms,
          max(occurred_at) as last_seen_at
        from filtered_events
        where module_id is not null
        group by module_id
        order by count(*) desc, max(occurred_at) desc, module_id
        limit v_rank_limit
        offset v_rank_offset
      ) m
    ), '[]'::jsonb),
    'topSources', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'source', s.source,
          'eventCount', s.event_count,
          'uniqueUsers', s.unique_users,
          'sessionCount', s.session_count
        )
        order by s.event_count desc, s.source
      )
      from (
        select
          coalesce(nullif(metadata->>'source', ''), 'other') as source,
          count(*)::bigint as event_count,
          count(distinct user_id)::bigint as unique_users,
          count(distinct session_id)::bigint as session_count
        from filtered_events
        group by coalesce(nullif(metadata->>'source', ''), 'other')
        order by count(*) desc, coalesce(nullif(metadata->>'source', ''), 'other')
        limit v_rank_limit
        offset v_rank_offset
      ) s
    ), '[]'::jsonb),
    'eventBreakdown', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'eventType', t.event_type,
          'eventCount', t.event_count,
          'uniqueUsers', t.unique_users,
          'sessionCount', t.session_count
        )
        order by t.event_count desc, t.event_type
      )
      from (
        select
          event_type,
          count(*)::bigint as event_count,
          count(distinct user_id)::bigint as unique_users,
          count(distinct session_id)::bigint as session_count
        from filtered_events
        group by event_type
        order by count(*) desc, event_type
        limit v_rank_limit
        offset v_rank_offset
      ) t
    ), '[]'::jsonb),
    'updatedAt', now()
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function public.admin_behavior_list(
  start_date timestamptz default null,
  end_date timestamptz default null,
  granularity text default 'day',
  search_text text default null,
  event_types text[] default null,
  module_ids text[] default null,
  policy_ref text default null,
  user_id uuid default null,
  session_id text default null,
  source text default null,
  limit_count integer default null,
  offset_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, analytics_private
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_search text;
  v_event_types text[];
  v_module_ids text[];
  v_policy_ref text;
  v_policy_uuid uuid;
  v_user_id uuid;
  v_session_id text;
  v_source text;
  v_limit integer;
  v_offset integer;
  v_result jsonb;
begin
  perform public.assert_admin();

  v_from := coalesce(admin_behavior_list.start_date, now() - interval '30 days');
  v_to := coalesce(admin_behavior_list.end_date, now());
  v_search := nullif(btrim(admin_behavior_list.search_text), '');
  v_event_types := case
    when coalesce(cardinality(array_remove(admin_behavior_list.event_types, '')), 0) = 0 then null
    else array_remove(admin_behavior_list.event_types, '')
  end;
  v_module_ids := case
    when coalesce(cardinality(array_remove(admin_behavior_list.module_ids, '')), 0) = 0 then null
    else array_remove(admin_behavior_list.module_ids, '')
  end;
  v_policy_ref := nullif(btrim(admin_behavior_list.policy_ref), '');
  v_policy_uuid := public.try_uuid(v_policy_ref);
  v_user_id := admin_behavior_list.user_id;
  v_session_id := nullif(btrim(admin_behavior_list.session_id), '');
  v_source := nullif(btrim(admin_behavior_list.source), '');
  v_limit := least(greatest(coalesce(admin_behavior_list.limit_count, 50), 1), 200);
  v_offset := greatest(coalesce(admin_behavior_list.offset_count, 0), 0);

  if v_from >= v_to then
    raise exception 'start_date must be before end_date'
      using errcode = '22023';
  end if;

  with filtered_events as (
    select *
    from analytics_private.user_event_enriched e
    where e.occurred_at >= v_from
      and e.occurred_at < v_to
      and (v_search is null
        or e.user_id::text ilike '%' || v_search || '%'
        or coalesce(e.display_name, '') ilike '%' || v_search || '%'
        or coalesce(e.email, '') ilike '%' || v_search || '%'
        or coalesce(e.session_id, '') ilike '%' || v_search || '%'
        or coalesce(e.event_type, '') ilike '%' || v_search || '%'
        or coalesce(e.policy_ref, '') ilike '%' || v_search || '%'
        or coalesce(e.policy_external_id, '') ilike '%' || v_search || '%'
        or coalesce(e.policy_title, '') ilike '%' || v_search || '%'
        or coalesce(e.module_id, '') ilike '%' || v_search || '%'
        or coalesce(e.route_path, '') ilike '%' || v_search || '%'
        or coalesce(e.metadata->>'title', '') ilike '%' || v_search || '%')
      and (v_event_types is null or e.event_type = any(v_event_types))
      and (v_module_ids is null or e.module_id = any(v_module_ids))
      and (v_policy_ref is null
        or e.policy_ref = v_policy_ref
        or e.policy_external_id = v_policy_ref
        or e.policy_id = v_policy_uuid)
      and (v_user_id is null or e.user_id = v_user_id)
      and (v_session_id is null or e.session_id = v_session_id)
      and (v_source is null or coalesce(nullif(e.metadata->>'source', ''), 'other') = v_source)
  ),
  user_rows as (
    select
      user_id,
      (array_agg(display_name order by occurred_at desc) filter (where display_name is not null))[1] as display_name,
      (array_agg(email order by occurred_at desc) filter (where email is not null))[1] as email,
      (array_agg(role order by occurred_at desc) filter (where role is not null))[1] as role,
      (array_agg(profile_status order by occurred_at desc) filter (where profile_status is not null))[1] as profile_status,
      count(*)::bigint as event_count,
      count(distinct session_id)::bigint as session_count,
      count(distinct policy_ref) filter (where policy_ref is not null) as policy_count,
      count(distinct module_id) filter (where module_id is not null) as module_count,
      coalesce(sum(duration_ms), 0)::bigint as total_duration_ms,
      coalesce(round(avg(duration_ms) filter (where duration_ms is not null))::bigint, 0) as avg_duration_ms,
      min(occurred_at) as first_seen_at,
      max(occurred_at) as last_seen_at
    from filtered_events
    group by user_id
  ),
  total as (
    select count(*)::bigint as total_rows
    from user_rows
  ),
  paged as (
    select *
    from user_rows
    order by last_seen_at desc, event_count desc, user_id
    limit v_limit
    offset v_offset
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'userId', p.user_id,
          'displayName', p.display_name,
          'email', p.email,
          'role', p.role,
          'status', p.profile_status,
          'eventCount', p.event_count,
          'sessionCount', p.session_count,
          'policyCount', p.policy_count,
          'moduleCount', p.module_count,
          'totalDurationMs', p.total_duration_ms,
          'durationMs', p.total_duration_ms,
          'avgDurationMs', p.avg_duration_ms,
          'firstSeenAt', p.first_seen_at,
          'lastSeenAt', p.last_seen_at
        )
        order by p.last_seen_at desc, p.event_count desc, p.user_id
      )
      from paged p
    ), '[]'::jsonb),
    'total', coalesce((select total_rows from total), 0),
    'limit', v_limit,
    'offset', v_offset
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function public.admin_behavior_detail(
  start_date timestamptz default null,
  end_date timestamptz default null,
  granularity text default 'day',
  search_text text default null,
  event_types text[] default null,
  module_ids text[] default null,
  policy_ref text default null,
  user_id uuid default null,
  session_id text default null,
  source text default null,
  limit_count integer default null,
  offset_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, analytics_private
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_granularity text;
  v_search text;
  v_event_types text[];
  v_module_ids text[];
  v_policy_ref text;
  v_policy_uuid uuid;
  v_user_id uuid;
  v_session_id text;
  v_source text;
  v_limit integer;
  v_offset integer;
  v_result jsonb;
begin
  perform public.assert_admin();

  v_from := coalesce(admin_behavior_detail.start_date, now() - interval '30 days');
  v_to := coalesce(admin_behavior_detail.end_date, now());
  v_granularity := case lower(coalesce(nullif(btrim(admin_behavior_detail.granularity), ''), 'day'))
    when 'hour' then 'hour'
    when 'week' then 'week'
    when 'month' then 'month'
    else 'day'
  end;
  v_search := nullif(btrim(admin_behavior_detail.search_text), '');
  v_event_types := case
    when coalesce(cardinality(array_remove(admin_behavior_detail.event_types, '')), 0) = 0 then null
    else array_remove(admin_behavior_detail.event_types, '')
  end;
  v_module_ids := case
    when coalesce(cardinality(array_remove(admin_behavior_detail.module_ids, '')), 0) = 0 then null
    else array_remove(admin_behavior_detail.module_ids, '')
  end;
  v_policy_ref := nullif(btrim(admin_behavior_detail.policy_ref), '');
  v_policy_uuid := public.try_uuid(v_policy_ref);
  v_user_id := admin_behavior_detail.user_id;
  v_session_id := nullif(btrim(admin_behavior_detail.session_id), '');
  v_source := nullif(btrim(admin_behavior_detail.source), '');
  v_limit := least(greatest(coalesce(admin_behavior_detail.limit_count, 100), 1), 500);
  v_offset := greatest(coalesce(admin_behavior_detail.offset_count, 0), 0);

  if v_from >= v_to then
    raise exception 'start_date must be before end_date'
      using errcode = '22023';
  end if;

  with profile as (
    select
      pr.id as user_id,
      pr.display_name,
      au.email,
      pr.role,
      pr.status as profile_status
    from public.profiles pr
    left join auth.users au
      on au.id = pr.id
    where pr.id = v_user_id
  ),
  filtered_events as (
    select *
    from analytics_private.user_event_enriched e
    where v_user_id is not null
      and e.user_id = v_user_id
      and e.occurred_at >= v_from
      and e.occurred_at < v_to
      and (v_search is null
        or e.user_id::text ilike '%' || v_search || '%'
        or coalesce(e.display_name, '') ilike '%' || v_search || '%'
        or coalesce(e.email, '') ilike '%' || v_search || '%'
        or coalesce(e.session_id, '') ilike '%' || v_search || '%'
        or coalesce(e.event_type, '') ilike '%' || v_search || '%'
        or coalesce(e.policy_ref, '') ilike '%' || v_search || '%'
        or coalesce(e.policy_external_id, '') ilike '%' || v_search || '%'
        or coalesce(e.policy_title, '') ilike '%' || v_search || '%'
        or coalesce(e.module_id, '') ilike '%' || v_search || '%'
        or coalesce(e.route_path, '') ilike '%' || v_search || '%'
        or coalesce(e.metadata->>'title', '') ilike '%' || v_search || '%')
      and (v_event_types is null or e.event_type = any(v_event_types))
      and (v_module_ids is null or e.module_id = any(v_module_ids))
      and (v_policy_ref is null
        or e.policy_ref = v_policy_ref
        or e.policy_external_id = v_policy_ref
        or e.policy_id = v_policy_uuid)
      and (v_session_id is null or e.session_id = v_session_id)
      and (v_source is null or coalesce(nullif(e.metadata->>'source', ''), 'other') = v_source)
  ),
  per_user as (
    select
      user_id,
      count(*)::bigint as event_count,
      count(distinct session_id)::bigint as session_count
    from filtered_events
    group by user_id
  ),
  event_summary as (
    select
      count(*)::bigint as total_events,
      count(distinct user_id)::bigint as unique_users,
      count(distinct session_id)::bigint as total_sessions,
      count(distinct policy_ref) filter (where policy_ref is not null) as active_policies,
      count(*) filter (where event_type = 'policy_view') as policy_view_events,
      count(*) filter (where event_type = 'policy_open') as policy_open_events,
      coalesce(round(avg(duration_ms) filter (
        where event_type in ('policy_view', 'policy_view_duration') and duration_ms is not null
      ))::bigint, 0) as avg_policy_view_ms,
      coalesce(round(avg(duration_ms) filter (where duration_ms is not null))::bigint, 0) as avg_duration_ms,
      coalesce(sum(duration_ms), 0)::bigint as total_duration_ms,
      count(distinct user_id) filter (
        where occurred_at >= date_trunc('day', now()) and occurred_at < now()
      ) as today_active_users,
      count(distinct user_id) filter (
        where occurred_at >= now() - interval '7 days' and occurred_at < now()
      ) as last_7d_active_users
    from filtered_events
  ),
  user_metrics as (
    select
      count(*)::bigint as event_count,
      count(distinct session_id)::bigint as session_count,
      count(distinct policy_ref) filter (where policy_ref is not null) as policy_count,
      count(distinct module_id) filter (where module_id is not null) as module_count,
      coalesce(sum(duration_ms), 0)::bigint as total_duration_ms,
      coalesce(round(avg(duration_ms) filter (where duration_ms is not null))::bigint, 0) as avg_duration_ms,
      min(occurred_at) as first_seen_at,
      max(occurred_at) as last_seen_at
    from filtered_events
  ),
  timeline_page as (
    select *
    from filtered_events
    order by occurred_at desc, event_id desc
    limit v_limit
    offset v_offset
  )
  select jsonb_build_object(
    'user', case
      when v_user_id is null then null
      else (
        select jsonb_build_object(
          'userId', v_user_id,
          'displayName', coalesce(p.display_name, p.email),
          'email', p.email,
          'role', p.role,
          'status', p.profile_status,
          'eventCount', m.event_count,
          'sessionCount', m.session_count,
          'policyCount', m.policy_count,
          'moduleCount', m.module_count,
          'totalDurationMs', m.total_duration_ms,
          'durationMs', m.total_duration_ms,
          'avgDurationMs', m.avg_duration_ms,
          'firstSeenAt', m.first_seen_at,
          'lastSeenAt', m.last_seen_at
        )
        from user_metrics m
        left join profile p on true
      )
    end,
    'summary', (
      select jsonb_build_object(
        'totalUsers', s.unique_users,
        'todayActiveUsers', s.today_active_users,
        'last7dActiveUsers', s.last_7d_active_users,
        'totalEvents', s.total_events,
        'uniqueUsers', s.unique_users,
        'totalSessions', s.total_sessions,
        'activePolicies', s.active_policies,
        'policyViewEvents', s.policy_view_events,
        'policyOpenEvents', s.policy_open_events,
        'avgPolicyViewMs', s.avg_policy_view_ms,
        'avgDurationMs', s.avg_duration_ms,
        'totalDurationMs', s.total_duration_ms,
        'avgEventsPerUser', coalesce(round(s.total_events::numeric / nullif(s.unique_users, 0), 2), 0),
        'returningUsers', coalesce((select count(*)::bigint from per_user u where u.session_count > 1), 0),
        'bounceUsers', coalesce((select count(*)::bigint from per_user u where u.event_count = 1), 0)
      )
      from event_summary s
    ),
    'series', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'bucket', series.bucket,
          'label', case v_granularity
            when 'hour' then to_char(series.bucket, 'YYYY-MM-DD HH24:00')
            when 'week' then to_char(series.bucket, 'IYYY-"W"IW')
            when 'month' then to_char(series.bucket, 'YYYY-MM')
            else to_char(series.bucket, 'YYYY-MM-DD')
          end,
          'eventCount', series.event_count,
          'uniqueUsers', series.unique_users,
          'sessionCount', series.session_count,
          'durationMs', series.duration_ms
        )
        order by series.bucket
      )
      from (
        select
          date_trunc(v_granularity, occurred_at) as bucket,
          count(*)::bigint as event_count,
          count(distinct user_id)::bigint as unique_users,
          count(distinct session_id)::bigint as session_count,
          coalesce(sum(duration_ms), 0)::bigint as duration_ms
        from filtered_events
        group by date_trunc(v_granularity, occurred_at)
      ) series
    ), '[]'::jsonb),
    'topPolicies', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'policyRef', p.policy_ref,
          'policyId', p.policy_id,
          'externalId', p.policy_external_id,
          'title', coalesce(p.policy_title, p.policy_ref),
          'source', p.policy_source,
          'eventCount', p.event_count,
          'uniqueUsers', p.unique_users,
          'sessionCount', p.session_count,
          'avgDurationMs', p.avg_duration_ms,
          'lastSeenAt', p.last_seen_at
        )
        order by p.event_count desc, p.last_seen_at desc, p.policy_ref
      )
      from (
        select
          policy_ref,
          (array_agg(policy_id order by occurred_at desc) filter (where policy_id is not null))[1] as policy_id,
          (array_agg(policy_external_id order by occurred_at desc) filter (where policy_external_id is not null))[1] as policy_external_id,
          (array_agg(policy_title order by occurred_at desc) filter (where policy_title is not null))[1] as policy_title,
          (array_agg(policy_issuer order by occurred_at desc) filter (where policy_issuer is not null))[1] as policy_source,
          count(*)::bigint as event_count,
          count(distinct user_id)::bigint as unique_users,
          count(distinct session_id)::bigint as session_count,
          coalesce(round(avg(duration_ms) filter (where duration_ms is not null))::bigint, 0) as avg_duration_ms,
          max(occurred_at) as last_seen_at
        from filtered_events
        where policy_ref is not null
        group by policy_ref
        order by count(*) desc, max(occurred_at) desc, policy_ref
        limit 10
      ) p
    ), '[]'::jsonb),
    'topModules', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'moduleId', m.module_id,
          'eventCount', m.event_count,
          'uniqueUsers', m.unique_users,
          'sessionCount', m.session_count,
          'avgDurationMs', m.avg_duration_ms,
          'lastSeenAt', m.last_seen_at
        )
        order by m.event_count desc, m.last_seen_at desc, m.module_id
      )
      from (
        select
          module_id,
          count(*)::bigint as event_count,
          count(distinct user_id)::bigint as unique_users,
          count(distinct session_id)::bigint as session_count,
          coalesce(round(avg(duration_ms) filter (where duration_ms is not null))::bigint, 0) as avg_duration_ms,
          max(occurred_at) as last_seen_at
        from filtered_events
        where module_id is not null
        group by module_id
        order by count(*) desc, max(occurred_at) desc, module_id
        limit 10
      ) m
    ), '[]'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', e.event_id,
          'eventId', e.event_id,
          'occurredAt', e.occurred_at,
          'createdAt', e.created_at,
          'userId', e.user_id,
          'displayName', e.display_name,
          'email', e.email,
          'sessionId', e.session_id,
          'eventType', e.event_type,
          'policyRef', e.policy_ref,
          'policyId', e.policy_id,
          'externalId', e.policy_external_id,
          'policyTitle', e.policy_title,
          'moduleId', e.module_id,
          'targetType', e.target_type,
          'targetId', e.target_id,
          'source', coalesce(nullif(e.metadata->>'source', ''), 'other'),
          'durationMs', e.duration_ms,
          'routePath', e.route_path,
          'metadata', jsonb_strip_nulls(jsonb_build_object(
            'source', e.metadata->>'source',
            'previousModule', coalesce(e.metadata->>'previousModule', e.metadata->>'previous_module'),
            'title', e.metadata->>'title'
          ))
        )
        order by e.occurred_at desc, e.event_id desc
      )
      from timeline_page e
    ), '[]'::jsonb),
    'total', (select count(*)::bigint from filtered_events),
    'limit', v_limit,
    'offset', v_offset,
    'updatedAt', now()
  )
  into v_result;

  return v_result;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_policy_sources_updated_at on public.policy_sources;
create trigger set_policy_sources_updated_at
  before update on public.policy_sources
  for each row execute function public.set_updated_at();

drop trigger if exists set_policies_updated_at on public.policies;
create trigger set_policies_updated_at
  before update on public.policies
  for each row execute function public.set_updated_at();

drop trigger if exists set_policy_actions_updated_at on public.policy_actions;
create trigger set_policy_actions_updated_at
  before update on public.policy_actions
  for each row execute function public.set_updated_at();

drop trigger if exists set_policy_clauses_updated_at on public.policy_clauses;
create trigger set_policy_clauses_updated_at
  before update on public.policy_clauses
  for each row execute function public.set_updated_at();

drop trigger if exists set_industry_nodes_updated_at on public.industry_nodes;
create trigger set_industry_nodes_updated_at
  before update on public.industry_nodes
  for each row execute function public.set_updated_at();

drop trigger if exists set_industry_edges_updated_at on public.industry_edges;
create trigger set_industry_edges_updated_at
  before update on public.industry_edges
  for each row execute function public.set_updated_at();

drop trigger if exists set_companies_updated_at on public.companies;
create trigger set_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

drop trigger if exists set_evidence_updated_at on public.evidence;
create trigger set_evidence_updated_at
  before update on public.evidence
  for each row execute function public.set_updated_at();

drop trigger if exists set_analysis_jobs_updated_at on public.analysis_jobs;
create trigger set_analysis_jobs_updated_at
  before update on public.analysis_jobs
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.policy_sources enable row level security;
alter table public.policies enable row level security;
alter table public.policy_actions enable row level security;
alter table public.policy_clauses enable row level security;
alter table public.industry_nodes enable row level security;
alter table public.industry_edges enable row level security;
alter table public.companies enable row level security;
alter table public.evidence enable row level security;
alter table public.analysis_jobs enable row level security;
alter table public.user_events enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "policy_sources_read_for_published_policies" on public.policy_sources;
create policy "policy_sources_read_for_published_policies"
  on public.policy_sources
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.policies p
      where p.source_id = policy_sources.id
        and public.can_read_policy(p.id)
    )
  );

drop policy if exists "policy_sources_admin_all" on public.policy_sources;
create policy "policy_sources_admin_all"
  on public.policy_sources
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "policies_select_readable" on public.policies;
create policy "policies_select_readable"
  on public.policies
  for select
  to authenticated
  using (public.can_read_policy(id));

drop policy if exists "policies_insert_owned" on public.policies;
create policy "policies_insert_owned"
  on public.policies
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "policies_update_manageable" on public.policies;
create policy "policies_update_manageable"
  on public.policies
  for update
  to authenticated
  using (public.can_manage_policy(id))
  with check (public.is_admin());

drop policy if exists "policies_delete_manageable" on public.policies;
create policy "policies_delete_manageable"
  on public.policies
  for delete
  to authenticated
  using (public.can_manage_policy(id));

drop policy if exists "policy_actions_select_published_related" on public.policy_actions;
create policy "policy_actions_select_published_related"
  on public.policy_actions
  for select
  to authenticated
  using (public.can_read_policy(policy_id));

drop policy if exists "policy_actions_manage_policy" on public.policy_actions;
create policy "policy_actions_manage_policy"
  on public.policy_actions
  for all
  to authenticated
  using (public.can_manage_policy(policy_id))
  with check (public.can_manage_policy(policy_id));

drop policy if exists "policy_clauses_select_published_related" on public.policy_clauses;
create policy "policy_clauses_select_published_related"
  on public.policy_clauses
  for select
  to authenticated
  using (public.can_read_policy(policy_id));

drop policy if exists "policy_clauses_manage_policy" on public.policy_clauses;
create policy "policy_clauses_manage_policy"
  on public.policy_clauses
  for all
  to authenticated
  using (public.can_manage_policy(policy_id))
  with check (public.can_manage_policy(policy_id));

drop policy if exists "industry_nodes_select_published_related" on public.industry_nodes;
create policy "industry_nodes_select_published_related"
  on public.industry_nodes
  for select
  to authenticated
  using (public.can_read_policy(policy_id));

drop policy if exists "industry_nodes_manage_policy" on public.industry_nodes;
create policy "industry_nodes_manage_policy"
  on public.industry_nodes
  for all
  to authenticated
  using (public.can_manage_policy(policy_id))
  with check (public.can_manage_policy(policy_id));

drop policy if exists "industry_edges_select_published_related" on public.industry_edges;
create policy "industry_edges_select_published_related"
  on public.industry_edges
  for select
  to authenticated
  using (public.can_read_policy(policy_id));

drop policy if exists "industry_edges_manage_policy" on public.industry_edges;
create policy "industry_edges_manage_policy"
  on public.industry_edges
  for all
  to authenticated
  using (public.can_manage_policy(policy_id))
  with check (public.can_manage_policy(policy_id));

drop policy if exists "companies_select_published_related" on public.companies;
create policy "companies_select_published_related"
  on public.companies
  for select
  to authenticated
  using (public.can_read_policy(policy_id));

drop policy if exists "companies_manage_policy" on public.companies;
create policy "companies_manage_policy"
  on public.companies
  for all
  to authenticated
  using (public.can_manage_policy(policy_id))
  with check (public.can_manage_policy(policy_id));

drop policy if exists "evidence_select_published_related" on public.evidence;
create policy "evidence_select_published_related"
  on public.evidence
  for select
  to authenticated
  using (public.can_read_policy(policy_id));

drop policy if exists "evidence_manage_policy" on public.evidence;
create policy "evidence_manage_policy"
  on public.evidence
  for all
  to authenticated
  using (public.can_manage_policy(policy_id))
  with check (public.can_manage_policy(policy_id));

drop policy if exists "analysis_jobs_select_owner_or_admin" on public.analysis_jobs;
create policy "analysis_jobs_select_owner_or_admin"
  on public.analysis_jobs
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "analysis_jobs_insert_owner_or_admin" on public.analysis_jobs;
create policy "analysis_jobs_insert_owner_or_admin"
  on public.analysis_jobs
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "analysis_jobs_update_owner_or_admin" on public.analysis_jobs;
create policy "analysis_jobs_update_owner_or_admin"
  on public.analysis_jobs
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "analysis_jobs_delete_admin" on public.analysis_jobs;
create policy "analysis_jobs_delete_admin"
  on public.analysis_jobs
  for delete
  to authenticated
  using (public.is_admin());

drop policy if exists "user_events_insert_own" on public.user_events;
create policy "user_events_insert_own"
  on public.user_events
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_events_select_own_or_admin" on public.user_events;
drop policy if exists "user_events_delete_admin" on public.user_events;
drop policy if exists "user_events_update_admin" on public.user_events;

grant usage on schema public to authenticated;

grant select, insert, update on public.profiles to authenticated;

grant select on public.policy_sources to authenticated;
grant all on public.policies to authenticated;
grant all on public.policy_actions to authenticated;
grant all on public.policy_clauses to authenticated;
grant all on public.industry_nodes to authenticated;
grant all on public.industry_edges to authenticated;
grant all on public.companies to authenticated;
grant all on public.evidence to authenticated;
grant all on public.analysis_jobs to authenticated;
revoke select, update, delete on public.user_events from public;
revoke select, update, delete on public.user_events from anon;
revoke select, update, delete on public.user_events from authenticated;
revoke insert on public.user_events from public;
revoke insert on public.user_events from anon;
grant insert on public.user_events to authenticated;

revoke all on all tables in schema analytics_private from public;
revoke all on all tables in schema analytics_private from anon;
revoke all on all tables in schema analytics_private from authenticated;

revoke all on function public.assert_admin() from public;
revoke all on function public.assert_admin() from anon;
revoke all on function public.assert_admin() from authenticated;
grant execute on function public.assert_admin() to authenticated;

revoke all on function public.admin_get_user_behavior_overview(timestamptz, timestamptz) from public;
revoke all on function public.admin_get_user_behavior_overview(timestamptz, timestamptz) from anon;
revoke all on function public.admin_get_user_behavior_overview(timestamptz, timestamptz) from authenticated;
grant execute on function public.admin_get_user_behavior_overview(timestamptz, timestamptz) to authenticated;

revoke all on function public.admin_list_user_behavior(timestamptz, timestamptz, uuid, text, text, text, integer, integer) from public;
revoke all on function public.admin_list_user_behavior(timestamptz, timestamptz, uuid, text, text, text, integer, integer) from anon;
revoke all on function public.admin_list_user_behavior(timestamptz, timestamptz, uuid, text, text, text, integer, integer) from authenticated;
grant execute on function public.admin_list_user_behavior(timestamptz, timestamptz, uuid, text, text, text, integer, integer) to authenticated;

revoke all on function public.admin_get_user_behavior_detail(uuid, timestamptz, timestamptz, integer, integer) from public;
revoke all on function public.admin_get_user_behavior_detail(uuid, timestamptz, timestamptz, integer, integer) from anon;
revoke all on function public.admin_get_user_behavior_detail(uuid, timestamptz, timestamptz, integer, integer) from authenticated;
grant execute on function public.admin_get_user_behavior_detail(uuid, timestamptz, timestamptz, integer, integer) to authenticated;

revoke all on function public.admin_behavior_overview(timestamptz, timestamptz, text, text, text[], text[], text, uuid, text, text, integer, integer) from public;
revoke all on function public.admin_behavior_overview(timestamptz, timestamptz, text, text, text[], text[], text, uuid, text, text, integer, integer) from anon;
revoke all on function public.admin_behavior_overview(timestamptz, timestamptz, text, text, text[], text[], text, uuid, text, text, integer, integer) from authenticated;
grant execute on function public.admin_behavior_overview(timestamptz, timestamptz, text, text, text[], text[], text, uuid, text, text, integer, integer) to authenticated;

revoke all on function public.admin_behavior_list(timestamptz, timestamptz, text, text, text[], text[], text, uuid, text, text, integer, integer) from public;
revoke all on function public.admin_behavior_list(timestamptz, timestamptz, text, text, text[], text[], text, uuid, text, text, integer, integer) from anon;
revoke all on function public.admin_behavior_list(timestamptz, timestamptz, text, text, text[], text[], text, uuid, text, text, integer, integer) from authenticated;
grant execute on function public.admin_behavior_list(timestamptz, timestamptz, text, text, text[], text[], text, uuid, text, text, integer, integer) to authenticated;

revoke all on function public.admin_behavior_detail(timestamptz, timestamptz, text, text, text[], text[], text, uuid, text, text, integer, integer) from public;
revoke all on function public.admin_behavior_detail(timestamptz, timestamptz, text, text, text[], text[], text, uuid, text, text, integer, integer) from anon;
revoke all on function public.admin_behavior_detail(timestamptz, timestamptz, text, text, text[], text[], text, uuid, text, text, integer, integer) from authenticated;
grant execute on function public.admin_behavior_detail(timestamptz, timestamptz, text, text, text[], text[], text, uuid, text, text, integer, integer) to authenticated;

comment on schema analytics_private is 'Internal analytics views for admin-only user behavior RPCs.';
comment on table public.policies is 'Policy documents and top-level report metadata. Published rows are readable by authenticated users.';
comment on column public.policies.external_id is 'Optional stable business identifier for imported reports or shareable routes. Frontend getPolicyReport can load by UUID id or external_id.';
comment on column public.policies.dedupe_key is 'Stable duplicate-detection key, usually built from policy_no or normalized issuer/title/publish_date. Unique for canonical policies.';
comment on column public.policies.content_hash is 'Optional normalized full-text hash used to catch cross-site reposts with different URLs or titles.';
comment on column public.policies.duplicate_of_policy_id is 'When a source reposts an already known policy, this row may point to the canonical policy instead of being analyzed separately.';
comment on column public.policies.metadata is 'JSON extension point for list counts and hydrated reports. listPolicyReports reads industryCount/industry_count, companyCount/company_count, evidenceCount/evidence_count, and primarySignal/primary_signal from this object or nested counts/report_counts. getPolicyReport reads a full report payload from reportPayload/report_payload/policyReport/policy_report/report/payload or nested payload equivalents.';
comment on table public.policy_actions is 'Extracted policy actions/signals shown in the brief panel.';
comment on table public.policy_clauses is 'Clause-level extraction for policy analysis.';
comment on table public.industry_nodes is 'Industry-chain impact nodes generated from policy clauses and evidence.';
comment on table public.industry_edges is 'Relationships between industry-chain impact nodes.';
comment on table public.companies is 'Policy-specific company impact analysis records.';
comment on table public.evidence is 'Evidence snippets linked to policies, clauses, industry nodes, or companies.';
comment on table public.analysis_jobs is 'Async analysis job queue. Currently visible only to owner or admin.';
comment on table public.user_events is 'Per-user frontend behavior events for policy report usage analytics. Authenticated users can insert their own events; admin reads are exposed only through admin RPCs.';
comment on function public.assert_admin() is 'Raises SQLSTATE 42501 unless the current authenticated user has an active admin profile.';
comment on function public.try_uuid(text) is 'Safely casts text to uuid, returning null for blank or invalid input.';
comment on view analytics_private.user_event_enriched is 'Internal enriched user events joined to profiles, auth users, and policies.';
comment on view analytics_private.user_session_rollups is 'Internal per-user per-session behavior rollups.';
comment on view analytics_private.user_daily_rollups is 'Internal per-user daily behavior rollups.';
comment on function public.admin_get_user_behavior_overview(timestamptz, timestamptz) is 'Admin-only JSON overview of user behavior analytics.';
comment on function public.admin_list_user_behavior(timestamptz, timestamptz, uuid, text, text, text, integer, integer) is 'Admin-only JSON list of user behavior summaries with filters and pagination.';
comment on function public.admin_get_user_behavior_detail(uuid, timestamptz, timestamptz, integer, integer) is 'Admin-only JSON behavior detail for one user.';
comment on function public.admin_behavior_overview(timestamptz, timestamptz, text, text, text[], text[], text, uuid, text, text, integer, integer) is 'Admin-only frontend wrapper returning user behavior overview JSON with filterable summary, series, rankings, and breakdowns.';
comment on function public.admin_behavior_list(timestamptz, timestamptz, text, text, text[], text[], text, uuid, text, text, integer, integer) is 'Admin-only frontend wrapper returning paginated user behavior rows with filters.';
comment on function public.admin_behavior_detail(timestamptz, timestamptz, text, text, text[], text[], text, uuid, text, text, integer, integer) is 'Admin-only frontend wrapper returning one user behavior detail; null user_id returns an empty detail payload.';
comment on column public.analysis_jobs.input_payload is 'Original user request for Edge Functions. ingest writes sourceUrl/title/sourceName and later functions may append normalized inputs.';
comment on column public.analysis_jobs.output_payload is 'Machine-readable outputs from analysis stages. The baseline analyzer writes a rules-based report payload before deeper model extraction is added.';
comment on column public.analysis_jobs.current_step is 'Human-readable progress message shown by the frontend job list.';
comment on column public.analysis_jobs.status is 'Pipeline state used by ingest/analyze/publish functions: queued -> fetching/extracting/analyzing -> published or failed.';

create or replace function public.list_pending_policy_analysis(limit_count integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
with args as (
  select least(greatest(coalesce(limit_count, 20), 1), 50) as v_limit
),
pending as (
  select
    p.id,
    p.external_id,
    p.title,
    p.issuer,
    p.source_name,
    p.source_url,
    p.publish_date,
    p.status,
    p.analysis_version,
    p.created_at,
    p.updated_at
  from public.policies p
  where p.duplicate_of_policy_id is null
    and p.publish_date >= date '2026-05-01'
    and p.status <> 'archived'
    and (p.status is distinct from 'published' or p.analysis_version is distinct from 'codex-manual-v1')
),
counted as (
  select count(*)::bigint as total from pending
),
limited as (
  select
    coalesce(p.external_id, p.id::text) as id,
    p.title,
    p.issuer,
    p.source_name as "sourceName",
    p.source_url as "sourceUrl",
    p.publish_date::text as "publishDate",
    p.status,
    p.analysis_version as "analysisVersion",
    p.created_at::text as "createdAt",
    p.updated_at::text as "updatedAt"
  from pending p
  order by p.publish_date desc nulls last, p.created_at desc
  limit (select v_limit from args)
)
select jsonb_build_object(
  'total', (select total from counted),
  'rows', coalesce(
    jsonb_agg(to_jsonb(l) order by l."publishDate" desc nulls last, l."createdAt" desc),
    jsonb_build_array()
  )
)
from limited l;
$$;

revoke all on function public.list_pending_policy_analysis(integer) from public;
grant execute on function public.list_pending_policy_analysis(integer) to authenticated;

comment on function public.list_pending_policy_analysis(integer) is 'Returns a safe homepage list of crawled policies after 2026-05-01 that have not completed codex-manual-v1 publication.';
