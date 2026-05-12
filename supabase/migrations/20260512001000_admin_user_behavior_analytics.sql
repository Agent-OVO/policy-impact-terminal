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

create index if not exists user_events_occurred_at_idx
  on public.user_events (occurred_at desc);
create index if not exists user_events_user_session_occurred_at_idx
  on public.user_events (user_id, session_id, occurred_at desc);
create index if not exists user_events_user_event_type_occurred_at_idx
  on public.user_events (user_id, event_type, occurred_at desc);

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

alter table public.user_events enable row level security;

drop policy if exists "user_events_insert_own" on public.user_events;
create policy "user_events_insert_own"
  on public.user_events
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_events_select_own_or_admin" on public.user_events;
drop policy if exists "user_events_delete_admin" on public.user_events;
drop policy if exists "user_events_update_admin" on public.user_events;

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
comment on table public.user_events is 'Per-user frontend behavior events for policy report usage analytics. Authenticated users can insert their own events; admin reads are exposed only through admin RPCs.';
