-- Stage 9: limited collection and deterministic manual-analysis queue.
-- L0 is excluded before ingest. L1 may be archived without an analysis job.
-- Only explicit L2/L3 records, plus legacy unclassified records, appear in the review queue.

create or replace function public.list_pending_policy_analysis(limit_count integer default 8)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
with args as (
  select least(greatest(coalesce(limit_count, 8), 1), 8) as v_limit
),
normalized as (
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
    p.updated_at,
    coalesce(
      nullif(p.metadata ->> 'analysisDepth', ''),
      nullif(p.metadata ->> 'analysis_depth', '')
    ) as analysis_depth,
    coalesce(
      nullif(p.metadata ->> 'requiresManualAnalysis', ''),
      nullif(p.metadata ->> 'requires_manual_analysis', '')
    ) as requires_manual_analysis,
    case
      when coalesce(
        nullif(p.metadata ->> 'reviewPriority', ''),
        nullif(p.metadata ->> 'review_priority', '')
      ) ~ '^\d{1,3}$'
      then least(
        100,
        greatest(
          0,
          coalesce(
            nullif(p.metadata ->> 'reviewPriority', ''),
            nullif(p.metadata ->> 'review_priority', '')
          )::integer
        )
      )
      else 0
    end as review_priority,
    coalesce(
      p.metadata -> 'triageReasons',
      p.metadata -> 'triage_reasons',
      '[]'::jsonb
    ) as triage_reasons
  from public.policies p
  where p.duplicate_of_policy_id is null
    and p.publish_date >= date '2026-05-01'
    and p.status <> 'archived'
    and (p.status is distinct from 'published' or p.analysis_version is distinct from 'codex-manual-v1')
),
pending as (
  select *
  from normalized n
  where coalesce(n.requires_manual_analysis, 'true') <> 'false'
    and coalesce(n.analysis_depth, 'L2') in ('L2', 'L3')
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
    p.updated_at::text as "updatedAt",
    coalesce(p.analysis_depth, 'legacy') as "analysisDepth",
    p.review_priority as "reviewPriority",
    p.triage_reasons as "triageReasons",
    true as "requiresManualAnalysis"
  from pending p
  order by p.review_priority desc, p.publish_date desc nulls last, p.created_at desc
  limit (select v_limit from args)
)
select jsonb_build_object(
  'total', (select total from counted),
  'queueLimit', (select v_limit from args),
  'rows', coalesce(
    jsonb_agg(
      to_jsonb(l)
      order by l."reviewPriority" desc, l."publishDate" desc nulls last, l."createdAt" desc
    ),
    jsonb_build_array()
  )
)
from limited l;
$$;

revoke all on function public.list_pending_policy_analysis(integer) from public;
grant execute on function public.list_pending_policy_analysis(integer) to authenticated;

comment on function public.list_pending_policy_analysis(integer) is
  'Returns at most eight L2/L3 or legacy unclassified policies awaiting manual review, ordered by deterministic review priority.';

notify pgrst, 'reload schema';
