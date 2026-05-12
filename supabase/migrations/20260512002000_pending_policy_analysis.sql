-- Safe homepage summary for crawled policies that still need manual Codex analysis.
-- The function returns only list-safe fields and keeps raw policy text behind RLS.

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

comment on function public.list_pending_policy_analysis(integer) is
  'Returns a safe homepage list of crawled policies after 2026-05-01 that have not completed codex-manual-v1 publication.';

notify pgrst, 'reload schema';
