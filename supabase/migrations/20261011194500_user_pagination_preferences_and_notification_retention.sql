-- User-specific display preferences, separate from application and finance business rules.
create or replace function public.valid_page_preferences(p_preferences jsonb)
returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_preferences) is distinct from 'object' then false
    else not exists (
      select 1 from jsonb_each(p_preferences) as e(key, value)
      where e.key not in (
        'teacherMaterials', 'teacherCollections', 'teacherStudentMaterials',
        'teacherPendingAssignments', 'teacherCompletedAssignments', 'teacherNotifications',
        'studentMaterials', 'studentPendingAssignments', 'studentCompletedAssignments', 'studentNotifications'
      ) or jsonb_typeof(e.value) <> 'number'
        or e.value::text not in ('2', '3', '5', '10', '20', '50')
    ) end
$$;

create table if not exists public.user_page_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  constraint user_page_preferences_valid check (public.valid_page_preferences(preferences))
);
alter table public.user_page_preferences enable row level security;
revoke all on public.user_page_preferences from public, anon;
grant select, insert, update on public.user_page_preferences to authenticated;
create policy "Own pagination preferences read" on public.user_page_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Own pagination preferences insert" on public.user_page_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Own pagination preferences update" on public.user_page_preferences
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Keep only notifications from the rolling last 30 days; business records and
-- assignment reminder deduplication records are intentionally NOT deleted.
create index if not exists notifications_created_at_idx on public.notifications (created_at);
create index if not exists notifications_user_created_id_idx
  on public.notifications (user_id, created_at desc, id desc);
select cron.schedule(
  'purge-expired-notifications', '0 1 * * *',
  $$delete from public.notifications where created_at < now() - interval '30 days'$$
);
