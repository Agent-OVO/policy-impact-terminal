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

create index if not exists user_events_user_id_idx on public.user_events (user_id, occurred_at desc);
create index if not exists user_events_session_id_idx on public.user_events (session_id, occurred_at desc);
create index if not exists user_events_policy_ref_idx on public.user_events (policy_ref, occurred_at desc);
create index if not exists user_events_event_type_idx on public.user_events (event_type, occurred_at desc);
create index if not exists user_events_module_id_idx on public.user_events (module_id, occurred_at desc);

alter table public.user_events enable row level security;

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

grant select, insert, delete on public.user_events to authenticated;

comment on table public.user_events is 'Per-user frontend behavior events for policy report usage analytics. Normal users can insert and read their own events; admins can query all events.';
