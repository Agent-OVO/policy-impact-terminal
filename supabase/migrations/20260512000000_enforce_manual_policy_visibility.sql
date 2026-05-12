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
