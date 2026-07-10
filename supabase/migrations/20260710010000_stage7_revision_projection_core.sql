-- Stage 7: immutable policy source documents, report revisions, rebuildable projections,
-- reusable company evidence cards, model usage ledger, and versioned non-secret config.
-- This migration is additive. It does not migrate or overwrite the current legacy report payload path.

create table if not exists public.policy_source_documents (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  parent_document_id uuid,
  source_url text,
  normalized_text text not null,
  source_document_hash text not null check (source_document_hash ~ '^[0-9a-f]{64}$'),
  parser_version text not null,
  fetched_at timestamptz,
  official_published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (policy_id, id),
  unique (policy_id, source_document_hash),
  constraint policy_source_documents_parent_fk
    foreign key (policy_id, parent_document_id)
    references public.policy_source_documents(policy_id, id)
    deferrable initially deferred
);

create table if not exists public.policy_source_segments (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null,
  source_document_id uuid not null,
  segment_key text not null,
  sort_order integer not null check (sort_order > 0),
  heading_level integer check (heading_level is null or heading_level between 1 and 9),
  heading_path text[] not null default '{}'::text[],
  page_number integer check (page_number is null or page_number > 0),
  source_locator jsonb not null default '{}'::jsonb,
  segment_text text not null,
  segment_hash text not null check (segment_hash ~ '^[0-9a-f]{64}$'),
  search_vector tsvector generated always as (to_tsvector('simple', segment_text)) stored,
  created_at timestamptz not null default now(),
  constraint policy_source_segments_document_fk
    foreign key (policy_id, source_document_id)
    references public.policy_source_documents(policy_id, id)
    on delete cascade,
  unique (source_document_id, segment_key),
  unique (source_document_id, sort_order)
);

create table if not exists public.report_revisions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  parent_revision_id uuid,
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved', 'published', 'superseded', 'rejected')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  schema_version text not null,
  analysis_version text not null,
  projection_version text not null,
  source_document_hash text not null check (source_document_hash ~ '^[0-9a-f]{64}$'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  projection_hash text check (projection_hash is null or projection_hash ~ '^[0-9a-f]{64}$'),
  change_summary text,
  change_reason text,
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  published_at timestamptz,
  unique (policy_id, id),
  unique (policy_id, id, projection_version),
  unique (policy_id, content_hash),
  constraint report_revisions_parent_fk
    foreign key (policy_id, parent_revision_id)
    references public.report_revisions(policy_id, id)
    deferrable initially deferred,
  constraint report_revisions_source_document_fk
    foreign key (policy_id, source_document_hash)
    references public.policy_source_documents(policy_id, source_document_hash)
    deferrable initially deferred,
  constraint report_revisions_review_fields_check
    check (
      status not in ('approved', 'published', 'superseded')
      or (reviewed_by is not null and reviewed_at is not null)
    ),
  constraint report_revisions_publish_fields_check
    check (
      status not in ('published', 'superseded')
      or (published_at is not null and projection_hash is not null)
    )
);

create table if not exists public.report_projection_runs (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null,
  revision_id uuid not null,
  projection_version text not null,
  attempt_no integer not null default 1 check (attempt_no > 0),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed')),
  projection_hash text check (projection_hash is null or projection_hash ~ '^[0-9a-f]{64}$'),
  row_counts jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_projection_runs_revision_fk
    foreign key (policy_id, revision_id, projection_version)
    references public.report_revisions(policy_id, id, projection_version)
    on delete cascade,
  unique (revision_id, projection_version, attempt_no),
  constraint report_projection_runs_running_check
    check (status <> 'running' or started_at is not null),
  constraint report_projection_runs_terminal_check
    check (status not in ('succeeded', 'failed') or finished_at is not null),
  constraint report_projection_runs_failed_check
    check (status <> 'failed' or nullif(btrim(error_message), '') is not null),
  constraint report_projection_runs_success_check
    check (
      status <> 'succeeded'
      or (projection_hash is not null and finished_at is not null and error_message is null)
    )
);

create table if not exists public.report_policy_actions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null,
  revision_id uuid not null,
  projection_version text not null,
  action_key text not null,
  title text not null,
  body text,
  signal text not null default 'pending'
    check (signal in ('positive', 'constraint', 'risk', 'pending', 'neutral')),
  action_type text,
  evidence_level text not null default 'pending'
    check (evidence_level in ('strong', 'indirect', 'pending')),
  implementation_dependency text,
  confidence numeric(5,2) check (confidence is null or confidence between 0 and 100),
  clause_keys text[] not null default '{}'::text[],
  sort_order integer not null default 0,
  payload_fragment jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint report_policy_actions_revision_fk
    foreign key (policy_id, revision_id, projection_version)
    references public.report_revisions(policy_id, id, projection_version)
    on delete cascade,
  unique (revision_id, action_key)
);

create table if not exists public.report_industry_nodes (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null,
  revision_id uuid not null,
  projection_version text not null,
  node_key text not null,
  title text not null,
  subtitle text,
  section text not null
    check (section in ('upstream', 'midstream', 'downstream', 'support')),
  relation text not null default 'pending'
    check (relation in ('direct', 'indirect', 'beneficiary', 'constraint_risk', 'pending')),
  evidence_level text not null default 'pending'
    check (evidence_level in ('strong', 'indirect', 'pending')),
  confidence numeric(5,2) check (confidence is null or confidence between 0 and 100),
  description text,
  clause_keys text[] not null default '{}'::text[],
  company_keys text[] not null default '{}'::text[],
  verification_signals text[] not null default '{}'::text[],
  sort_order integer not null default 0,
  payload_fragment jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint report_industry_nodes_revision_fk
    foreign key (policy_id, revision_id, projection_version)
    references public.report_revisions(policy_id, id, projection_version)
    on delete cascade,
  unique (revision_id, node_key)
);

create table if not exists public.report_industry_edges (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null,
  revision_id uuid not null,
  projection_version text not null,
  edge_key text not null,
  from_node_key text not null,
  to_node_key text not null,
  edge_type text not null default 'medium'
    check (edge_type in ('strong', 'medium', 'weak', 'risk')),
  confidence numeric(5,2) check (confidence is null or confidence between 0 and 100),
  description text,
  sort_order integer not null default 0,
  payload_fragment jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint report_industry_edges_revision_fk
    foreign key (policy_id, revision_id, projection_version)
    references public.report_revisions(policy_id, id, projection_version)
    on delete cascade,
  constraint report_industry_edges_from_node_fk
    foreign key (revision_id, from_node_key)
    references public.report_industry_nodes(revision_id, node_key)
    on delete cascade,
  constraint report_industry_edges_to_node_fk
    foreign key (revision_id, to_node_key)
    references public.report_industry_nodes(revision_id, node_key)
    on delete cascade,
  constraint report_industry_edges_different_nodes_check
    check (from_node_key <> to_node_key),
  unique (revision_id, edge_key),
  unique (revision_id, from_node_key, to_node_key, edge_type)
);

create table if not exists public.report_company_relations (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null,
  revision_id uuid not null,
  projection_version text not null,
  relation_key text not null,
  company_key text not null,
  source_company_id text,
  company_name text not null,
  ticker text,
  chain_node_key text,
  relationship text not null
    check (relationship in ('policy_named', 'direct_industry', 'indirect_industry', 'thematic_only', 'watch_only')),
  policy_evidence text not null default 'pending'
    check (policy_evidence in ('strong', 'indirect', 'pending')),
  regulatory_role text not null default 'not_applicable'
    check (regulatory_role in ('constraint_exposed', 'compliance_provider', 'mixed', 'not_applicable')),
  business_exposure text,
  investment_use text,
  watch_signals text[] not null default '{}'::text[],
  key_risks text[] not null default '{}'::text[],
  do_not_overread text[] not null default '{}'::text[],
  sort_order integer not null default 0,
  payload_fragment jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint report_company_relations_revision_fk
    foreign key (policy_id, revision_id, projection_version)
    references public.report_revisions(policy_id, id, projection_version)
    on delete cascade,
  constraint report_company_relations_node_fk
    foreign key (revision_id, chain_node_key)
    references public.report_industry_nodes(revision_id, node_key)
    deferrable initially deferred,
  unique (revision_id, relation_key)
);

create table if not exists public.report_policy_network_relations (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null,
  revision_id uuid not null,
  projection_version text not null,
  relation_key text not null,
  related_policy_key text,
  related_policy_title text not null,
  relationship text not null
    check (relationship in ('upstream_guidance', 'downstream_implementation', 'supporting_rule', 'prior_policy', 'follow_up_catalyst', 'local_rollout', 'contrast_policy')),
  meaning text,
  evidence_level text not null default 'pending'
    check (evidence_level in ('strong', 'indirect', 'pending')),
  source_date date,
  source_url text,
  watch_signals text[] not null default '{}'::text[],
  sort_order integer not null default 0,
  payload_fragment jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint report_policy_network_relations_revision_fk
    foreign key (policy_id, revision_id, projection_version)
    references public.report_revisions(policy_id, id, projection_version)
    on delete cascade,
  unique (revision_id, relation_key)
);

create table if not exists public.report_evidence_refs (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null,
  revision_id uuid not null,
  projection_version text not null,
  evidence_key text not null,
  title text not null,
  source_name text,
  evidence_type text,
  evidence_object text,
  published_at date,
  source_url text,
  excerpt text,
  interpretation text,
  source_location text,
  confidence numeric(5,2) check (confidence is null or confidence between 0 and 100),
  linked_clause_keys text[] not null default '{}'::text[],
  linked_node_keys text[] not null default '{}'::text[],
  linked_company_keys text[] not null default '{}'::text[],
  sort_order integer not null default 0,
  payload_fragment jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint report_evidence_refs_revision_fk
    foreign key (policy_id, revision_id, projection_version)
    references public.report_revisions(policy_id, id, projection_version)
    on delete cascade,
  unique (revision_id, evidence_key)
);

create table if not exists public.report_signals (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null,
  revision_id uuid not null,
  projection_version text not null,
  signal_key text not null,
  signal_type text not null,
  subject_type text not null
    check (subject_type in ('policy', 'industry', 'company', 'evidence')),
  subject_key text not null,
  signal_value text not null,
  direction text not null default 'pending'
    check (direction in ('positive', 'constraint', 'risk', 'mixed', 'pending', 'neutral')),
  strength text not null default 'pending'
    check (strength in ('high', 'medium', 'low', 'pending')),
  time_horizon text not null default 'uncertain'
    check (time_horizon in ('short_term', 'medium_term', 'long_term', 'uncertain')),
  summary text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint report_signals_revision_fk
    foreign key (policy_id, revision_id, projection_version)
    references public.report_revisions(policy_id, id, projection_version)
    on delete cascade,
  unique (revision_id, signal_key)
);

create table if not exists public.company_evidence_cards (
  id uuid primary key default gen_random_uuid(),
  company_key text not null,
  company_name text not null,
  ticker text,
  fact_type text not null,
  source_name text not null,
  source_url text not null,
  source_date date,
  excerpt text not null,
  interpretation text,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  evidence_level text not null default 'pending'
    check (evidence_level in ('strong', 'indirect', 'pending')),
  status text not null default 'active'
    check (status in ('active', 'superseded', 'invalidated')),
  valid_from date,
  expires_at date,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_key, content_hash),
  constraint company_evidence_cards_validity_check
    check (expires_at is null or valid_from is null or expires_at >= valid_from)
);

create table if not exists public.report_company_evidence_refs (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null,
  revision_id uuid not null,
  relation_key text not null,
  company_evidence_card_id uuid not null references public.company_evidence_cards(id) on delete restrict,
  use_type text not null default 'business_fact'
    check (use_type in ('business_fact', 'project_fact', 'order_fact', 'financial_fact', 'counter_evidence', 'other')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint report_company_evidence_refs_revision_fk
    foreign key (policy_id, revision_id)
    references public.report_revisions(policy_id, id)
    on delete cascade,
  constraint report_company_evidence_refs_relation_fk
    foreign key (revision_id, relation_key)
    references public.report_company_relations(revision_id, relation_key)
    on delete cascade,
  unique (revision_id, relation_key, company_evidence_card_id, use_type)
);

create table if not exists public.model_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid references public.policies(id) on delete set null,
  revision_id uuid,
  operation_type text not null,
  provider text,
  model text not null,
  prompt_version text,
  request_hash text check (request_hash is null or request_hash ~ '^[0-9a-f]{64}$'),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cached_tokens integer not null default 0 check (cached_tokens >= 0 and cached_tokens <= input_tokens),
  effective_tokens integer generated always as (greatest(input_tokens + output_tokens - cached_tokens, 0)) stored,
  budget_class text not null
    check (budget_class in ('L0', 'L1', 'L2', 'L3', 'exception')),
  trigger_reason text not null,
  status text not null default 'planned'
    check (status in ('planned', 'succeeded', 'failed', 'blocked')),
  exception_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint model_usage_ledger_revision_requires_policy_check
    check (revision_id is null or policy_id is not null),
  constraint model_usage_ledger_revision_fk
    foreign key (policy_id, revision_id)
    references public.report_revisions(policy_id, id)
    on delete set null,
  constraint model_usage_ledger_exception_check
    check (budget_class <> 'exception' or nullif(btrim(exception_reason), '') is not null)
);

create table if not exists public.system_config_versions (
  id uuid primary key default gen_random_uuid(),
  config_key text not null,
  version_no integer not null check (version_no > 0),
  config_value jsonb not null,
  visibility text not null default 'internal'
    check (visibility in ('internal', 'client')),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  effective_at timestamptz,
  supersedes_id uuid references public.system_config_versions(id) on delete set null,
  change_reason text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (config_key, version_no),
  constraint system_config_versions_active_check
    check (status <> 'active' or effective_at is not null)
);

alter table public.policies
  add column if not exists current_source_document_id uuid,
  add column if not exists current_published_revision_id uuid,
  add column if not exists current_draft_revision_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'policies_current_source_document_fk') then
    alter table public.policies
      add constraint policies_current_source_document_fk
      foreign key (id, current_source_document_id)
      references public.policy_source_documents(policy_id, id)
      deferrable initially deferred;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'policies_current_published_revision_fk') then
    alter table public.policies
      add constraint policies_current_published_revision_fk
      foreign key (id, current_published_revision_id)
      references public.report_revisions(policy_id, id)
      deferrable initially deferred;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'policies_current_draft_revision_fk') then
    alter table public.policies
      add constraint policies_current_draft_revision_fk
      foreign key (id, current_draft_revision_id)
      references public.report_revisions(policy_id, id)
      deferrable initially deferred;
  end if;
end;
$$;

create unique index if not exists report_revisions_one_published_per_policy_idx
  on public.report_revisions(policy_id)
  where status = 'published';
create unique index if not exists system_config_versions_one_active_key_idx
  on public.system_config_versions(config_key)
  where status = 'active';
create index if not exists policy_source_documents_policy_created_idx
  on public.policy_source_documents(policy_id, created_at desc);
create index if not exists policy_source_documents_hash_idx
  on public.policy_source_documents(source_document_hash);
create index if not exists policy_source_segments_document_order_idx
  on public.policy_source_segments(source_document_id, sort_order);
create index if not exists policy_source_segments_hash_idx
  on public.policy_source_segments(segment_hash);
create index if not exists policy_source_segments_search_idx
  on public.policy_source_segments using gin(search_vector);
create index if not exists report_revisions_policy_created_idx
  on public.report_revisions(policy_id, created_at desc);
create index if not exists report_revisions_status_idx
  on public.report_revisions(status, created_at desc);
create index if not exists report_revisions_source_hash_idx
  on public.report_revisions(source_document_hash);
create index if not exists report_projection_runs_revision_idx
  on public.report_projection_runs(revision_id, created_at desc);
create index if not exists report_projection_runs_status_idx
  on public.report_projection_runs(status, created_at desc);
create index if not exists report_policy_actions_policy_idx
  on public.report_policy_actions(policy_id, revision_id, sort_order);
create index if not exists report_industry_nodes_policy_idx
  on public.report_industry_nodes(policy_id, revision_id, section, sort_order);
create index if not exists report_industry_edges_policy_idx
  on public.report_industry_edges(policy_id, revision_id, sort_order);
create index if not exists report_company_relations_policy_idx
  on public.report_company_relations(policy_id, revision_id, sort_order);
create index if not exists report_company_relations_company_key_idx
  on public.report_company_relations(company_key, policy_id);
create index if not exists report_company_relations_ticker_idx
  on public.report_company_relations(ticker, policy_id)
  where ticker is not null;
create index if not exists report_policy_network_policy_idx
  on public.report_policy_network_relations(policy_id, revision_id, sort_order);
create index if not exists report_evidence_refs_policy_idx
  on public.report_evidence_refs(policy_id, revision_id, sort_order);
create index if not exists report_signals_policy_idx
  on public.report_signals(policy_id, revision_id, signal_type, sort_order);
create index if not exists report_signals_subject_idx
  on public.report_signals(subject_type, subject_key, signal_type);
create index if not exists company_evidence_cards_company_idx
  on public.company_evidence_cards(company_key, status, source_date desc);
create index if not exists company_evidence_cards_ticker_idx
  on public.company_evidence_cards(ticker, status, source_date desc)
  where ticker is not null;
create index if not exists report_company_evidence_refs_revision_idx
  on public.report_company_evidence_refs(revision_id, relation_key);
create index if not exists model_usage_ledger_created_idx
  on public.model_usage_ledger(created_at desc);
create index if not exists model_usage_ledger_policy_idx
  on public.model_usage_ledger(policy_id, created_at desc);
create index if not exists model_usage_ledger_revision_idx
  on public.model_usage_ledger(revision_id, created_at desc);
create index if not exists model_usage_ledger_budget_idx
  on public.model_usage_ledger(budget_class, status, created_at desc);
create index if not exists system_config_versions_key_idx
  on public.system_config_versions(config_key, version_no desc);

create or replace function public.protect_policy_source_document_content()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.policy_id is distinct from old.policy_id
    or new.parent_document_id is distinct from old.parent_document_id
    or new.source_url is distinct from old.source_url
    or new.normalized_text is distinct from old.normalized_text
    or new.source_document_hash is distinct from old.source_document_hash
    or new.parser_version is distinct from old.parser_version
    or new.fetched_at is distinct from old.fetched_at
    or new.official_published_at is distinct from old.official_published_at
    or new.metadata is distinct from old.metadata
    or new.created_at is distinct from old.created_at
  then
    raise exception 'policy source documents are immutable; create a new document version'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.protect_policy_source_segment_content()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if row(new.policy_id, new.source_document_id, new.segment_key, new.sort_order, new.heading_level,
         new.heading_path, new.page_number, new.source_locator, new.segment_text, new.segment_hash, new.created_at)
     is distinct from
     row(old.policy_id, old.source_document_id, old.segment_key, old.sort_order, old.heading_level,
         old.heading_path, old.page_number, old.source_locator, old.segment_text, old.segment_hash, old.created_at)
  then
    raise exception 'policy source segments are immutable; create a new source document version'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.protect_report_revision_content()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if row(new.policy_id, new.parent_revision_id, new.payload, new.schema_version, new.analysis_version,
         new.projection_version, new.source_document_hash, new.content_hash, new.change_summary,
         new.change_reason, new.created_by, new.created_at)
     is distinct from
     row(old.policy_id, old.parent_revision_id, old.payload, old.schema_version, old.analysis_version,
         old.projection_version, old.source_document_hash, old.content_hash, old.change_summary,
         old.change_reason, old.created_by, old.created_at)
  then
    raise exception 'report revision content is immutable; create a child revision'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.validate_report_revision_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and old.status in ('published', 'superseded')
    and row(new.reviewed_by, new.reviewed_at, new.published_at, new.projection_hash)
      is distinct from row(old.reviewed_by, old.reviewed_at, old.published_at, old.projection_hash)
  then
    raise exception 'published report revision lifecycle fields are immutable'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status in ('in_review', 'rejected'))
      or (old.status = 'in_review' and new.status in ('draft', 'approved', 'rejected'))
      or (old.status = 'approved' and new.status in ('in_review', 'published', 'rejected'))
      or (old.status = 'published' and new.status = 'superseded')
      or (old.status = 'superseded' and new.status = 'published')
    ) then
      raise exception 'invalid report revision status transition: % -> %', old.status, new.status
        using errcode = '23514';
    end if;
  end if;

  if new.status in ('approved', 'published', 'superseded')
    and (new.reviewed_by is null or new.reviewed_at is null)
  then
    raise exception 'reviewed_by and reviewed_at are required for approved or published revisions'
      using errcode = '23514';
  end if;

  if new.status in ('published', 'superseded')
    and (new.published_at is null or new.projection_hash is null)
  then
    raise exception 'published_at and projection_hash are required for published revisions'
      using errcode = '23514';
  end if;

  if new.status in ('published', 'superseded') and not exists (
    select 1
    from public.report_projection_runs pr
    where pr.revision_id = new.id
      and pr.policy_id = new.policy_id
      and pr.projection_version = new.projection_version
      and pr.status = 'succeeded'
      and pr.projection_hash = new.projection_hash
  ) then
    raise exception 'published revisions require a successful matching projection run'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.validate_projection_run_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and row(new.policy_id, new.revision_id, new.projection_version, new.attempt_no, new.created_at)
    is distinct from row(old.policy_id, old.revision_id, old.projection_version, old.attempt_no, old.created_at)
  then
    raise exception 'projection run identity fields are immutable'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.status <> new.status and not (
    (old.status = 'pending' and new.status in ('running', 'failed'))
    or (old.status = 'running' and new.status in ('succeeded', 'failed'))
  ) then
    raise exception 'invalid projection run status transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.status in ('succeeded', 'failed')
    and row(new.status, new.projection_hash, new.row_counts, new.error_message,
            new.started_at, new.finished_at, new.updated_at)
      is distinct from
        row(old.status, old.projection_hash, old.row_counts, old.error_message,
            old.started_at, old.finished_at, old.updated_at)
  then
    raise exception 'terminal projection runs are immutable'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.protect_published_revision_projection()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  target_revision_id uuid;
  target_status text;
begin
  target_revision_id := case when tg_op = 'DELETE' then old.revision_id else new.revision_id end;
  select status into target_status from public.report_revisions where id = target_revision_id;
  if target_status in ('published', 'superseded') and pg_trigger_depth() <= 1 then
    raise exception 'projection rows for published revisions are immutable'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.validate_policy_version_pointers()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.current_published_revision_id is not null and not exists (
    select 1 from public.report_revisions r
    where r.id = new.current_published_revision_id
      and r.policy_id = new.id
      and r.status = 'published'
  ) then
    raise exception 'current_published_revision_id must point to a published revision for the same policy'
      using errcode = '23514';
  end if;

  if new.current_draft_revision_id is not null and not exists (
    select 1 from public.report_revisions r
    where r.id = new.current_draft_revision_id
      and r.policy_id = new.id
      and r.status in ('draft', 'in_review', 'approved')
  ) then
    raise exception 'current_draft_revision_id must point to an unpublished revision for the same policy'
      using errcode = '23514';
  end if;

  if new.current_source_document_id is not null and not exists (
    select 1 from public.policy_source_documents d
    where d.id = new.current_source_document_id
      and d.policy_id = new.id
  ) then
    raise exception 'current_source_document_id must point to a source document for the same policy'
      using errcode = '23514';
  end if;

  if new.current_published_revision_id is not null
    and new.current_published_revision_id = new.current_draft_revision_id
  then
    raise exception 'published and draft revision pointers must be different'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.protect_company_evidence_card_content()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if row(new.company_key, new.company_name, new.ticker, new.fact_type, new.source_name,
         new.source_url, new.source_date, new.excerpt, new.interpretation, new.content_hash,
         new.evidence_level, new.valid_from, new.metadata, new.created_by, new.created_at)
     is distinct from
     row(old.company_key, old.company_name, old.ticker, old.fact_type, old.source_name,
         old.source_url, old.source_date, old.excerpt, old.interpretation, old.content_hash,
         old.evidence_level, old.valid_from, old.metadata, old.created_by, old.created_at)
  then
    raise exception 'company evidence card content is immutable; create a new card'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.validate_company_evidence_card_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status <> new.status and not (
      old.status = 'active' and new.status in ('superseded', 'invalidated')
    ) then
      raise exception 'invalid company evidence card status transition: % -> %', old.status, new.status
        using errcode = '23514';
    end if;

    if old.status <> 'active'
      and (new.expires_at is distinct from old.expires_at or new.status is distinct from old.status)
    then
      raise exception 'terminal company evidence cards cannot be changed'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

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
         new.exception_reason, new.created_by, new.created_at)
     is distinct from
     row(old.policy_id, old.revision_id, old.operation_type, old.provider, old.model,
         old.prompt_version, old.request_hash, old.budget_class, old.trigger_reason,
         old.exception_reason, old.created_by, old.created_at)
  then
    raise exception 'model usage ledger identity fields are immutable'
      using errcode = '23514';
  end if;

  if old.status <> new.status and not (
    old.status = 'planned' and new.status in ('succeeded', 'failed', 'blocked')
  ) then
    raise exception 'invalid model usage status transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  if old.status <> 'planned' and row(new.input_tokens, new.output_tokens, new.cached_tokens, new.metadata)
    is distinct from row(old.input_tokens, old.output_tokens, old.cached_tokens, old.metadata)
  then
    raise exception 'terminal model usage ledger rows are immutable'
      using errcode = '23514';
  end if;

  if old.status = 'planned' and new.status = 'planned'
    and row(new.input_tokens, new.output_tokens, new.cached_tokens, new.metadata)
      is distinct from row(old.input_tokens, old.output_tokens, old.cached_tokens, old.metadata)
  then
    raise exception 'token results may only be finalized with a terminal status'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.protect_immutable_history_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if pg_trigger_depth() <= 1 then
    raise exception '% history rows cannot be deleted directly', tg_table_name
      using errcode = '23514';
  end if;
  return old;
end;
$$;

create or replace function public.protect_published_revision_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status in ('published', 'superseded') and pg_trigger_depth() <= 1 then
    raise exception 'published report revision history cannot be deleted directly'
      using errcode = '23514';
  end if;
  return old;
end;
$$;

create or replace function public.validate_system_config_supersedes()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.supersedes_id is not null and not exists (
    select 1
    from public.system_config_versions prior
    where prior.id = new.supersedes_id
      and prior.config_key = new.config_key
      and prior.version_no < new.version_no
  ) then
    raise exception 'supersedes_id must reference an earlier version of the same config key'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.validate_system_config_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and old.status <> new.status and not (
    (old.status = 'draft' and new.status in ('active', 'retired'))
    or (old.status = 'active' and new.status = 'retired')
  ) then
    raise exception 'invalid system config status transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.status <> 'draft' and new.effective_at is distinct from old.effective_at then
    raise exception 'effective_at is immutable after config activation'
      using errcode = '23514';
  end if;

  if new.status = 'active' and new.effective_at is null then
    raise exception 'active system config requires effective_at'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.protect_system_config_version_content()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if row(new.config_key, new.version_no, new.config_value, new.visibility,
         new.supersedes_id, new.change_reason, new.created_by, new.created_at)
     is distinct from
     row(old.config_key, old.version_no, old.config_value, old.visibility,
         old.supersedes_id, old.change_reason, old.created_by, old.created_at)
  then
    raise exception 'system config versions are immutable; create a new version'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_policy_source_document_content on public.policy_source_documents;
create trigger protect_policy_source_document_content
  before update on public.policy_source_documents
  for each row execute function public.protect_policy_source_document_content();

drop trigger if exists protect_policy_source_document_delete on public.policy_source_documents;
create trigger protect_policy_source_document_delete
  before delete on public.policy_source_documents
  for each row execute function public.protect_immutable_history_delete();

drop trigger if exists protect_policy_source_segment_content on public.policy_source_segments;
create trigger protect_policy_source_segment_content
  before update on public.policy_source_segments
  for each row execute function public.protect_policy_source_segment_content();

drop trigger if exists protect_policy_source_segment_delete on public.policy_source_segments;
create trigger protect_policy_source_segment_delete
  before delete on public.policy_source_segments
  for each row execute function public.protect_immutable_history_delete();

drop trigger if exists protect_report_revision_content on public.report_revisions;
create trigger protect_report_revision_content
  before update on public.report_revisions
  for each row execute function public.protect_report_revision_content();

drop trigger if exists validate_report_revision_lifecycle on public.report_revisions;
create trigger validate_report_revision_lifecycle
  before insert or update on public.report_revisions
  for each row execute function public.validate_report_revision_lifecycle();

drop trigger if exists protect_published_revision_delete on public.report_revisions;
create trigger protect_published_revision_delete
  before delete on public.report_revisions
  for each row execute function public.protect_published_revision_delete();

drop trigger if exists validate_projection_run_lifecycle on public.report_projection_runs;
create trigger validate_projection_run_lifecycle
  before insert or update on public.report_projection_runs
  for each row execute function public.validate_projection_run_lifecycle();

drop trigger if exists set_report_projection_runs_updated_at on public.report_projection_runs;
create trigger set_report_projection_runs_updated_at
  before update on public.report_projection_runs
  for each row execute function public.set_updated_at();

drop trigger if exists protect_projection_run_delete on public.report_projection_runs;
create trigger protect_projection_run_delete
  before delete on public.report_projection_runs
  for each row execute function public.protect_immutable_history_delete();

drop trigger if exists validate_policy_version_pointers on public.policies;
create trigger validate_policy_version_pointers
  before insert or update on public.policies
  for each row execute function public.validate_policy_version_pointers();

drop trigger if exists protect_company_evidence_card_content on public.company_evidence_cards;
create trigger protect_company_evidence_card_content
  before update on public.company_evidence_cards
  for each row execute function public.protect_company_evidence_card_content();

drop trigger if exists validate_company_evidence_card_lifecycle on public.company_evidence_cards;
create trigger validate_company_evidence_card_lifecycle
  before update on public.company_evidence_cards
  for each row execute function public.validate_company_evidence_card_lifecycle();

drop trigger if exists protect_company_evidence_card_delete on public.company_evidence_cards;
create trigger protect_company_evidence_card_delete
  before delete on public.company_evidence_cards
  for each row execute function public.protect_immutable_history_delete();

drop trigger if exists validate_system_config_supersedes on public.system_config_versions;
create trigger validate_system_config_supersedes
  before insert or update on public.system_config_versions
  for each row execute function public.validate_system_config_supersedes();

drop trigger if exists validate_system_config_lifecycle on public.system_config_versions;
create trigger validate_system_config_lifecycle
  before insert or update on public.system_config_versions
  for each row execute function public.validate_system_config_lifecycle();

drop trigger if exists protect_system_config_version_content on public.system_config_versions;
create trigger protect_system_config_version_content
  before update on public.system_config_versions
  for each row execute function public.protect_system_config_version_content();

drop trigger if exists protect_system_config_version_delete on public.system_config_versions;
create trigger protect_system_config_version_delete
  before delete on public.system_config_versions
  for each row execute function public.protect_immutable_history_delete();

drop trigger if exists protect_model_usage_ledger_fields on public.model_usage_ledger;
create trigger protect_model_usage_ledger_fields
  before update on public.model_usage_ledger
  for each row execute function public.protect_model_usage_ledger_fields();

drop trigger if exists protect_model_usage_ledger_delete on public.model_usage_ledger;
create trigger protect_model_usage_ledger_delete
  before delete on public.model_usage_ledger
  for each row execute function public.protect_immutable_history_delete();

do $$
declare
  projection_table text;
begin
  foreach projection_table in array array[
    'report_policy_actions',
    'report_industry_nodes',
    'report_industry_edges',
    'report_company_relations',
    'report_policy_network_relations',
    'report_evidence_refs',
    'report_signals',
    'report_company_evidence_refs'
  ] loop
    execute format('drop trigger if exists protect_published_revision_projection on public.%I', projection_table);
    execute format(
      'create trigger protect_published_revision_projection before insert or update or delete on public.%I for each row execute function public.protect_published_revision_projection()',
      projection_table
    );
  end loop;
end;
$$;

create or replace function public.can_read_report_revision(target_revision_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.report_revisions r
    join public.policies p on p.id = r.policy_id
    where r.id = target_revision_id
      and r.status in ('published', 'superseded')
      and public.can_read_policy(p.id)
  );
$$;

create or replace function public.is_report_revision_source_current(target_revision_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.report_revisions r
    join public.policies p on p.id = r.policy_id
    join public.policy_source_documents d on d.id = p.current_source_document_id
    where r.id = target_revision_id
      and public.can_read_report_revision(r.id)
      and d.policy_id = r.policy_id
      and d.source_document_hash = r.source_document_hash
  );
$$;

create or replace function public.get_current_report_revision(target_policy_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
begin
  if not public.can_read_policy(target_policy_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'policyId', p.id,
    'revisionId', r.id,
    'schemaVersion', r.schema_version,
    'analysisVersion', r.analysis_version,
    'projectionVersion', r.projection_version,
    'sourceDocumentHash', r.source_document_hash,
    'currentSourceDocumentHash', d.source_document_hash,
    'isSourceCurrent', coalesce(d.source_document_hash = r.source_document_hash, false),
    'contentHash', r.content_hash,
    'projectionHash', r.projection_hash,
    'publishedAt', r.published_at,
    'payload', r.payload
  )
  into result
  from public.policies p
  join public.report_revisions r on r.id = p.current_published_revision_id
  left join public.policy_source_documents d on d.id = p.current_source_document_id
  where p.id = target_policy_id
    and r.status = 'published';

  if result is null then
    raise exception 'current published report revision not found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

create or replace function public.get_report_revision(target_revision_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
begin
  if not public.can_read_report_revision(target_revision_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'policyId', r.policy_id,
    'revisionId', r.id,
    'parentRevisionId', r.parent_revision_id,
    'status', r.status,
    'schemaVersion', r.schema_version,
    'analysisVersion', r.analysis_version,
    'projectionVersion', r.projection_version,
    'sourceDocumentHash', r.source_document_hash,
    'currentSourceDocumentHash', d.source_document_hash,
    'isSourceCurrent', coalesce(d.source_document_hash = r.source_document_hash, false),
    'contentHash', r.content_hash,
    'projectionHash', r.projection_hash,
    'changeSummary', r.change_summary,
    'changeReason', r.change_reason,
    'publishedAt', r.published_at,
    'payload', r.payload
  )
  into result
  from public.report_revisions r
  join public.policies p on p.id = r.policy_id
  left join public.policy_source_documents d on d.id = p.current_source_document_id
  where r.id = target_revision_id;

  return result;
end;
$$;

create or replace function public.list_report_revisions(target_policy_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
begin
  if not public.can_read_policy(target_policy_id) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'revisionId', r.id,
        'parentRevisionId', r.parent_revision_id,
        'status', r.status,
        'schemaVersion', r.schema_version,
        'analysisVersion', r.analysis_version,
        'projectionVersion', r.projection_version,
        'sourceDocumentHash', r.source_document_hash,
        'currentSourceDocumentHash', d.source_document_hash,
        'isSourceCurrent', coalesce(d.source_document_hash = r.source_document_hash, false),
        'contentHash', r.content_hash,
        'projectionHash', r.projection_hash,
        'changeSummary', r.change_summary,
        'changeReason', r.change_reason,
        'publishedAt', r.published_at,
        'isCurrent', p.current_published_revision_id = r.id
      )
      order by r.published_at desc nulls last, r.created_at desc
    ),
    '[]'::jsonb
  )
  into result
  from public.policies p
  join public.report_revisions r on r.policy_id = p.id
  left join public.policy_source_documents d on d.id = p.current_source_document_id
  where p.id = target_policy_id
    and r.status in ('published', 'superseded');

  return result;
end;
$$;

create or replace function public.get_active_system_config(target_config_key text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'configKey', c.config_key,
    'version', c.version_no,
    'value', c.config_value,
    'effectiveAt', c.effective_at
  )
  from public.system_config_versions c
  where c.config_key = target_config_key
    and c.status = 'active'
    and (public.is_admin() or c.visibility = 'client')
  order by c.version_no desc
  limit 1;
$$;

alter table public.policy_source_documents enable row level security;
alter table public.policy_source_segments enable row level security;
alter table public.report_revisions enable row level security;
alter table public.report_projection_runs enable row level security;
alter table public.report_policy_actions enable row level security;
alter table public.report_industry_nodes enable row level security;
alter table public.report_industry_edges enable row level security;
alter table public.report_company_relations enable row level security;
alter table public.report_policy_network_relations enable row level security;
alter table public.report_evidence_refs enable row level security;
alter table public.report_signals enable row level security;
alter table public.company_evidence_cards enable row level security;
alter table public.report_company_evidence_refs enable row level security;
alter table public.model_usage_ledger enable row level security;
alter table public.system_config_versions enable row level security;

do $$
declare
  admin_table text;
begin
  foreach admin_table in array array[
    'policy_source_documents',
    'policy_source_segments',
    'report_revisions',
    'report_projection_runs',
    'report_policy_actions',
    'report_industry_nodes',
    'report_industry_edges',
    'report_company_relations',
    'report_policy_network_relations',
    'report_evidence_refs',
    'report_signals',
    'company_evidence_cards',
    'report_company_evidence_refs',
    'model_usage_ledger',
    'system_config_versions'
  ] loop
    execute format('drop policy if exists %I on public.%I', admin_table || '_admin_all', admin_table);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      admin_table || '_admin_all',
      admin_table
    );
  end loop;
end;
$$;

drop policy if exists report_revisions_read_current on public.report_revisions;
drop policy if exists report_revisions_read_published_history on public.report_revisions;
create policy report_revisions_read_published_history
  on public.report_revisions
  for select
  to authenticated
  using (public.can_read_report_revision(id));

do $$
declare
  projection_table text;
begin
  foreach projection_table in array array[
    'report_policy_actions',
    'report_industry_nodes',
    'report_industry_edges',
    'report_company_relations',
    'report_policy_network_relations',
    'report_evidence_refs',
    'report_signals'
  ] loop
    execute format('drop policy if exists %I on public.%I', projection_table || '_read_current', projection_table);
    execute format('drop policy if exists %I on public.%I', projection_table || '_read_published_history', projection_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_read_report_revision(revision_id))',
      projection_table || '_read_published_history',
      projection_table
    );
  end loop;
end;
$$;

drop policy if exists system_config_versions_read_client on public.system_config_versions;
create policy system_config_versions_read_client
  on public.system_config_versions
  for select
  to authenticated
  using (status = 'active' and visibility = 'client');

revoke all on function public.can_read_report_revision(uuid) from public;
revoke all on function public.is_report_revision_source_current(uuid) from public;
revoke all on function public.get_current_report_revision(uuid) from public;
revoke all on function public.get_report_revision(uuid) from public;
revoke all on function public.list_report_revisions(uuid) from public;
revoke all on function public.get_active_system_config(text) from public;
grant execute on function public.can_read_report_revision(uuid) to authenticated;
grant execute on function public.is_report_revision_source_current(uuid) to authenticated;
grant execute on function public.get_current_report_revision(uuid) to authenticated;
grant execute on function public.get_report_revision(uuid) to authenticated;
grant execute on function public.list_report_revisions(uuid) to authenticated;
grant execute on function public.get_active_system_config(text) to authenticated;

revoke all on public.policy_source_documents from public, anon, authenticated;
revoke all on public.policy_source_segments from public, anon, authenticated;
revoke all on public.report_revisions from public, anon, authenticated;
revoke all on public.report_projection_runs from public, anon, authenticated;
revoke all on public.report_policy_actions from public, anon, authenticated;
revoke all on public.report_industry_nodes from public, anon, authenticated;
revoke all on public.report_industry_edges from public, anon, authenticated;
revoke all on public.report_company_relations from public, anon, authenticated;
revoke all on public.report_policy_network_relations from public, anon, authenticated;
revoke all on public.report_evidence_refs from public, anon, authenticated;
revoke all on public.report_signals from public, anon, authenticated;
revoke all on public.company_evidence_cards from public, anon, authenticated;
revoke all on public.report_company_evidence_refs from public, anon, authenticated;
revoke all on public.model_usage_ledger from public, anon, authenticated;
revoke all on public.system_config_versions from public, anon, authenticated;

grant select on public.report_policy_actions to authenticated;
grant select on public.report_industry_nodes to authenticated;
grant select on public.report_industry_edges to authenticated;
grant select on public.report_company_relations to authenticated;
grant select on public.report_policy_network_relations to authenticated;
grant select on public.report_evidence_refs to authenticated;
grant select on public.report_signals to authenticated;
grant select on public.system_config_versions to authenticated;

insert into public.system_config_versions (
  config_key,
  version_no,
  config_value,
  visibility,
  status,
  effective_at,
  change_reason
)
values
  (
    'policy_sources.fixed_whitelist',
    1,
    jsonb_build_object(
      'sourceKeys', jsonb_build_array('gov_zhengce_latest', 'ndrc_policy_documents', 'miit_policy_library', 'nda_policy_release'),
      'allowPermanentExpansion', false,
      'taskEvidenceSourcesAreNotCrawlerSources', true
    ),
    'internal',
    'active',
    now(),
    'Stage 6 ADR-006 accepted fixed official source whitelist.'
  ),
  (
    'policy_collection.schedule_and_limits',
    1,
    jsonb_build_object(
      'timezone', 'Asia/Shanghai',
      'workdayTimes', jsonb_build_array('09:30', '17:30'),
      'weekendScheduled', false,
      'perSourceScanLimit', 60,
      'filteredCandidateLimit', 24,
      'ingestLimitPerRun', 12,
      'analysisQueueDailyLimit', 3,
      'analysisQueueBacklogLimit', 8
    ),
    'internal',
    'active',
    now(),
    'Stage 6 limited collection boundary.'
  ),
  (
    'model_usage.token_budgets',
    1,
    jsonb_build_object(
      'monthlyEffectiveTokenLimit', 300000,
      'warningThresholds', jsonb_build_array(0.7, 0.9, 1.0),
      'L0', jsonb_build_object('hardLimit', 0),
      'L1', jsonb_build_object('hardLimit', 0),
      'classificationException', jsonb_build_object('hardLimit', 2000),
      'L2', jsonb_build_object('softTarget', 8000, 'hardLimit', 12000, 'maxCoreCalls', 1),
      'L3', jsonb_build_object('softTarget', 20000, 'hardLimit', 30000, 'maxCoreCalls', 2, 'secondCallTarget', 8000)
    ),
    'internal',
    'active',
    now(),
    'Stage 6 ADR-007 accepted token governance.'
  ),
  (
    'report_contract.versions',
    1,
    jsonb_build_object(
      'schemaVersion', 'report-schema-v1.1',
      'projectionVersion', 'policy-projection-v1',
      'sourceParserVersion', 'source-segmenter-v1'
    ),
    'client',
    'active',
    now(),
    'Stage 7 immutable revision and projection contract.'
  ),
  (
    'product.access_boundary',
    1,
    jsonb_build_object(
      'registrationMode', 'invite_only',
      'primaryUse', 'internal_investment_research',
      'publicReadMode', false,
      'collaborationScope', 'small_team'
    ),
    'internal',
    'active',
    now(),
    'Stage 6 ADR-001 accepted product boundary; enforcement follows in Stage 8.'
  )
on conflict (config_key, version_no) do nothing;

comment on table public.policy_source_documents is 'Immutable normalized versions of official policy source text.';
comment on table public.policy_source_segments is 'Deterministic paragraph or locator segments for incremental evidence reuse.';
comment on table public.report_revisions is 'Immutable full report JSON revisions; lifecycle fields may change but payload and hashes may not.';
comment on table public.report_projection_runs is 'Auditable attempts to build revision-scoped deterministic projections.';
comment on table public.report_policy_actions is 'Revision-scoped policy action projection generated from report payload.';
comment on table public.report_industry_nodes is 'Revision-scoped industry node projection generated from report payload.';
comment on table public.report_industry_edges is 'Revision-scoped industry relationship projection generated from report payload.';
comment on table public.report_company_relations is 'Authoritative revision-scoped company-policy relationships; legacy compatible companies remain only in payload/evidence links.';
comment on table public.report_policy_network_relations is 'Revision-scoped relationships to upstream, supporting, prior, follow-up, local, or contrast policies.';
comment on table public.report_evidence_refs is 'Revision-scoped report evidence projection; payload remains the complete evidence source.';
comment on table public.report_signals is 'Revision-scoped deterministic observation, catalyst, risk, and boundary signals.';
comment on table public.company_evidence_cards is 'Reusable, immutable company fact evidence cards created only when demanded by reports.';
comment on table public.report_company_evidence_refs is 'Links authoritative company relations to reusable company evidence cards.';
comment on table public.model_usage_ledger is 'Auditable model call and token budget ledger; ordinary online reads never create entries.';
comment on table public.system_config_versions is 'Versioned non-secret architecture and operation configuration.';
comment on column public.policies.current_source_document_id is 'Current immutable official source document version.';
comment on column public.policies.current_published_revision_id is 'Current published immutable report revision.';
comment on column public.policies.current_draft_revision_id is 'Current unpublished immutable revision being reviewed; edits create a child revision.';
comment on function public.can_read_report_revision(uuid) is 'Allows reading published and superseded revision history for a policy the user may read.';
comment on function public.is_report_revision_source_current(uuid) is 'Reports whether a revision was built from the policy current source document hash.';
comment on function public.get_current_report_revision(uuid) is 'Returns the current immutable report payload, hashes, and source-current status for a readable policy.';
comment on function public.get_report_revision(uuid) is 'Returns one readable published or superseded immutable report revision.';
comment on function public.list_report_revisions(uuid) is 'Lists published and superseded revision metadata for a readable policy.';
comment on function public.get_active_system_config(text) is 'Returns an active client-visible config, or any active config to admins.';

notify pgrst, 'reload schema';
