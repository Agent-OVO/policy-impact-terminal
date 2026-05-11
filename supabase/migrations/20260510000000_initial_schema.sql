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
        p.status = 'published'
        or public.is_admin()
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
create policy "user_events_select_own_or_admin"
  on public.user_events
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "user_events_delete_admin" on public.user_events;
create policy "user_events_delete_admin"
  on public.user_events
  for delete
  to authenticated
  using (public.is_admin());

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
grant select, insert, delete on public.user_events to authenticated;

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
comment on table public.user_events is 'Per-user frontend behavior events for policy report usage analytics. Normal users can insert and read their own events; admins can query all events.';
comment on column public.analysis_jobs.input_payload is 'Original user request for Edge Functions. ingest writes sourceUrl/title/sourceName and later functions may append normalized inputs.';
comment on column public.analysis_jobs.output_payload is 'Machine-readable outputs from analysis stages. The baseline analyzer writes a rules-based report payload before deeper model extraction is added.';
comment on column public.analysis_jobs.current_step is 'Human-readable progress message shown by the frontend job list.';
comment on column public.analysis_jobs.status is 'Pipeline state used by ingest/analyze/publish functions: queued -> fetching/extracting/analyzing -> published or failed.';
