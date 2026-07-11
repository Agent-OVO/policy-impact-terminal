-- Stage 10 local candidate: current cross-policy read models and guarded RPCs.
-- Depends on Stage 7 revision projections and Stage 8 revision lifecycle/account governance.
-- This migration intentionally creates no tables. Local JSON remains the sole source for
-- industry aliases, uncertain timeline events, relationship calibration events, and watchlists.

create schema if not exists research_private;
revoke all on schema research_private from public, anon, authenticated;

create or replace view research_private.current_company_relations as
select
  c.id as relation_id,
  c.policy_id,
  p.title as policy_title,
  p.publish_date as policy_publish_date,
  c.revision_id,
  r.schema_version,
  r.analysis_version,
  r.projection_version,
  c.relation_key,
  c.company_key,
  c.company_name,
  c.ticker,
  c.chain_node_key,
  c.relationship,
  c.policy_evidence,
  c.regulatory_role,
  c.business_exposure,
  c.investment_use,
  c.watch_signals,
  c.key_risks,
  c.do_not_overread,
  case
    when company_evidence.evidence_count = 0 then 'not_available'
    when company_evidence.strong_count > 0 then 'strong'
    when company_evidence.indirect_count > 0 then 'indirect'
    else 'pending'
  end as business_evidence_state,
  company_evidence.evidence_count as business_evidence_count,
  c.payload_fragment
from public.policies p
join public.report_revisions r
  on r.id = p.current_published_revision_id
 and r.policy_id = p.id
join public.report_company_relations c
  on c.revision_id = r.id
 and c.policy_id = p.id
left join lateral (
  select
    count(*)::integer as evidence_count,
    count(*) filter (where card.evidence_level = 'strong')::integer as strong_count,
    count(*) filter (where card.evidence_level = 'indirect')::integer as indirect_count
  from public.report_company_evidence_refs ref
  join public.company_evidence_cards card
    on card.id = ref.company_evidence_card_id
   and card.status = 'active'
  where ref.revision_id = c.revision_id
    and ref.relation_key = c.relation_key
) company_evidence on true;

create or replace view research_private.current_industry_nodes as
select
  n.id as node_id,
  n.policy_id,
  p.title as policy_title,
  p.publish_date as policy_publish_date,
  n.revision_id,
  r.schema_version,
  r.analysis_version,
  r.projection_version,
  n.node_key,
  n.title as industry_title,
  n.subtitle,
  n.section,
  n.relation,
  n.evidence_level,
  n.confidence,
  n.description,
  n.company_keys,
  n.verification_signals,
  coalesce(policy_tools.action_types, '{}'::text[]) as policy_action_types,
  n.payload_fragment
from public.policies p
join public.report_revisions r
  on r.id = p.current_published_revision_id
 and r.policy_id = p.id
join public.report_industry_nodes n
  on n.revision_id = r.id
 and n.policy_id = p.id
left join lateral (
  select array_agg(distinct a.action_type order by a.action_type)
    filter (where a.action_type is not null) as action_types
  from public.report_policy_actions a
  where a.revision_id = n.revision_id
) policy_tools on true;

create or replace view research_private.current_policy_tools as
select
  a.id as action_id,
  a.policy_id,
  p.title as policy_title,
  p.publish_date as policy_publish_date,
  a.revision_id,
  a.action_key,
  a.title as action_title,
  a.action_type,
  a.signal,
  a.evidence_level,
  a.implementation_dependency,
  a.confidence
from public.policies p
join public.report_revisions r
  on r.id = p.current_published_revision_id
 and r.policy_id = p.id
join public.report_policy_actions a
  on a.revision_id = r.id
 and a.policy_id = p.id;

create or replace view research_private.company_relation_revision_changes as
select
  event.id as revision_event_id,
  event.policy_id,
  policy.title as policy_title,
  event.event_type as revision_event_type,
  event.previous_revision_id,
  event.target_revision_id,
  event.created_at as changed_at,
  keys.relation_key,
  previous_relation.id as previous_relation_id,
  target_relation.id as target_relation_id,
  coalesce(target_relation.company_key, previous_relation.company_key) as company_key,
  coalesce(target_relation.company_name, previous_relation.company_name) as company_name,
  coalesce(target_relation.ticker, previous_relation.ticker) as ticker,
  previous_relation.relationship as previous_relationship,
  target_relation.relationship as target_relationship,
  previous_relation.policy_evidence as previous_policy_evidence,
  target_relation.policy_evidence as target_policy_evidence,
  case
    when previous_relation.id is null then 'relationship_added'
    when target_relation.id is null then 'relationship_removed'
    when previous_relation.relationship is distinct from target_relation.relationship then
      case
        when (
          case target_relation.relationship
            when 'policy_named' then 5
            when 'direct_industry' then 4
            when 'indirect_industry' then 3
            when 'thematic_only' then 2
            when 'watch_only' then 1
            else 0
          end
        ) > (
          case previous_relation.relationship
            when 'policy_named' then 5
            when 'direct_industry' then 4
            when 'indirect_industry' then 3
            when 'thematic_only' then 2
            when 'watch_only' then 1
            else 0
          end
        ) then 'relationship_upgrade'
        else 'relationship_downgrade'
      end
    when previous_relation.policy_evidence is distinct from target_relation.policy_evidence then
      case
        when (
          case target_relation.policy_evidence
            when 'strong' then 3
            when 'indirect' then 2
            when 'pending' then 1
            else 0
          end
        ) > (
          case previous_relation.policy_evidence
            when 'strong' then 3
            when 'indirect' then 2
            when 'pending' then 1
            else 0
          end
        ) then 'evidence_upgrade'
        else 'evidence_downgrade'
      end
    else 'unchanged'
  end as change_type,
  target_revision.change_reason,
  target_revision.change_summary,
  coalesce(target_relation.key_risks, previous_relation.key_risks, '{}'::text[]) as key_risks,
  coalesce(target_relation.do_not_overread, previous_relation.do_not_overread, '{}'::text[]) as do_not_overread,
  coalesce(target_evidence.evidence_keys, '{}'::text[]) as target_evidence_keys,
  coalesce(counter_evidence.card_ids, '{}'::uuid[]) as counter_evidence_card_ids
from public.report_revision_events event
join public.policies policy
  on policy.id = event.policy_id
join public.report_revisions target_revision
  on target_revision.id = event.target_revision_id
 and target_revision.policy_id = event.policy_id
cross join lateral (
  select previous_keys.relation_key
  from public.report_company_relations previous_keys
  where previous_keys.revision_id = event.previous_revision_id
  union
  select target_keys.relation_key
  from public.report_company_relations target_keys
  where target_keys.revision_id = event.target_revision_id
) keys
left join public.report_company_relations previous_relation
  on previous_relation.revision_id = event.previous_revision_id
 and previous_relation.relation_key = keys.relation_key
left join public.report_company_relations target_relation
  on target_relation.revision_id = event.target_revision_id
 and target_relation.relation_key = keys.relation_key
left join lateral (
  select array_agg(evidence.evidence_key order by evidence.sort_order, evidence.evidence_key) as evidence_keys
  from public.report_evidence_refs evidence
  where evidence.revision_id = event.target_revision_id
    and coalesce(target_relation.company_key, previous_relation.company_key) = any(evidence.linked_company_keys)
) target_evidence on true
left join lateral (
  select array_agg(ref.company_evidence_card_id order by ref.sort_order, ref.company_evidence_card_id) as card_ids
  from public.report_company_evidence_refs ref
  where ref.revision_id = event.target_revision_id
    and ref.relation_key = keys.relation_key
    and ref.use_type = 'counter_evidence'
) counter_evidence on true
where event.previous_revision_id is not null
  and event.event_type in ('published', 'rolled_back');

revoke all on all tables in schema research_private from public, anon, authenticated;

create or replace function public.query_cross_policy_company(search_text text default null)
returns table (
  relation_id uuid,
  policy_id uuid,
  policy_title text,
  policy_publish_date date,
  revision_id uuid,
  company_key text,
  company_name text,
  ticker text,
  relationship text,
  policy_evidence text,
  business_evidence_state text,
  business_evidence_count integer,
  chain_node_key text,
  business_exposure text,
  investment_use text,
  watch_signals text[],
  key_risks text[],
  do_not_overread text[]
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, research_private
as $$
begin
  if not public.is_active_user() then
    raise exception 'inactive_user' using errcode = '42501';
  end if;

  return query
  select
    relation.relation_id,
    relation.policy_id,
    relation.policy_title,
    relation.policy_publish_date,
    relation.revision_id,
    relation.company_key,
    relation.company_name,
    relation.ticker,
    relation.relationship,
    relation.policy_evidence,
    relation.business_evidence_state,
    relation.business_evidence_count,
    relation.chain_node_key,
    relation.business_exposure,
    relation.investment_use,
    relation.watch_signals,
    relation.key_risks,
    relation.do_not_overread
  from research_private.current_company_relations relation
  where public.can_read_policy(relation.policy_id)
    and (
      nullif(btrim(search_text), '') is null
      or relation.company_name ilike '%' || search_text || '%'
      or relation.company_key ilike '%' || search_text || '%'
      or coalesce(relation.ticker, '') ilike '%' || search_text || '%'
    )
  order by relation.company_name, relation.policy_publish_date desc nulls last, relation.policy_id;
end;
$$;

create or replace function public.query_cross_policy_industry(search_text text default null)
returns table (
  node_id uuid,
  policy_id uuid,
  policy_title text,
  policy_publish_date date,
  revision_id uuid,
  node_key text,
  industry_title text,
  subtitle text,
  section text,
  relation text,
  evidence_level text,
  confidence numeric,
  description text,
  company_keys text[],
  verification_signals text[],
  policy_action_types text[]
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, research_private
as $$
begin
  if not public.is_active_user() then
    raise exception 'inactive_user' using errcode = '42501';
  end if;

  return query
  select
    node.node_id,
    node.policy_id,
    node.policy_title,
    node.policy_publish_date,
    node.revision_id,
    node.node_key,
    node.industry_title,
    node.subtitle,
    node.section,
    node.relation,
    node.evidence_level,
    node.confidence,
    node.description,
    node.company_keys,
    node.verification_signals,
    node.policy_action_types
  from research_private.current_industry_nodes node
  where public.can_read_policy(node.policy_id)
    and (
      nullif(btrim(search_text), '') is null
      or node.industry_title ilike '%' || search_text || '%'
      or coalesce(node.subtitle, '') ilike '%' || search_text || '%'
      or coalesce(node.description, '') ilike '%' || search_text || '%'
    )
  order by node.industry_title, node.policy_publish_date desc nulls last, node.policy_id, node.node_key;
end;
$$;

create or replace function public.list_company_relation_changes(company_search text default null)
returns table (
  revision_event_id uuid,
  policy_id uuid,
  policy_title text,
  changed_at timestamptz,
  relation_key text,
  company_key text,
  company_name text,
  ticker text,
  change_type text,
  previous_relationship text,
  target_relationship text,
  previous_policy_evidence text,
  target_policy_evidence text,
  change_reason text,
  change_summary text,
  key_risks text[],
  do_not_overread text[],
  target_evidence_keys text[],
  counter_evidence_card_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, research_private
as $$
begin
  if not public.is_active_user() then
    raise exception 'inactive_user' using errcode = '42501';
  end if;

  return query
  select
    change.revision_event_id,
    change.policy_id,
    change.policy_title,
    change.changed_at,
    change.relation_key,
    change.company_key,
    change.company_name,
    change.ticker,
    change.change_type,
    change.previous_relationship,
    change.target_relationship,
    change.previous_policy_evidence,
    change.target_policy_evidence,
    change.change_reason,
    change.change_summary,
    change.key_risks,
    change.do_not_overread,
    change.target_evidence_keys,
    change.counter_evidence_card_ids
  from research_private.company_relation_revision_changes change
  where change.change_type <> 'unchanged'
    and public.can_read_policy(change.policy_id)
    and (
      nullif(btrim(company_search), '') is null
      or change.company_name ilike '%' || company_search || '%'
      or change.company_key ilike '%' || company_search || '%'
      or coalesce(change.ticker, '') ilike '%' || company_search || '%'
    )
  order by change.changed_at desc, change.policy_id, change.relation_key;
end;
$$;

revoke all on function public.query_cross_policy_company(text) from public, anon;
revoke all on function public.query_cross_policy_industry(text) from public, anon;
revoke all on function public.list_company_relation_changes(text) from public, anon;
grant execute on function public.query_cross_policy_company(text) to authenticated;
grant execute on function public.query_cross_policy_industry(text) to authenticated;
grant execute on function public.list_company_relation_changes(text) to authenticated;

comment on schema research_private is
  'Stage 10 private read models over current published Stage 7 projections; clients must use guarded public RPCs.';
comment on view research_private.current_company_relations is
  'Current company-policy relations selected only by policies.current_published_revision_id; no historical double counting.';
comment on view research_private.current_industry_nodes is
  'Current industry nodes with policy action types; offline aliases remain in the local Stage 10 JSON contract.';
comment on view research_private.company_relation_revision_changes is
  'Relationship and evidence changes derived from immutable revision events and stable relation keys; no duplicate state table.';
comment on function public.query_cross_policy_company(text) is
  'Read-only current company-policy lookup for active users with per-policy visibility checks.';
comment on function public.query_cross_policy_industry(text) is
  'Read-only current industry-policy lookup for active users with per-policy visibility checks.';
comment on function public.list_company_relation_changes(text) is
  'Read-only revision-derived relationship change history for active users with per-policy visibility checks.';
