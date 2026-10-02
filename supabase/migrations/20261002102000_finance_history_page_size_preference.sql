begin;

alter table public.teacher_settings
  add column if not exists finance_history_page_size smallint not null default 20;

alter table public.teacher_settings
  drop constraint if exists teacher_settings_finance_history_page_size_check;

alter table public.teacher_settings
  add constraint teacher_settings_finance_history_page_size_check
  check (finance_history_page_size in (10, 20, 50, 100));

comment on column public.teacher_settings.finance_history_page_size is
  'Number of student finance history transactions shown per page. Allowed values: 10, 20, 50, 100.';

create or replace function public.update_my_finance_preferences(
  p_low_balance_threshold_lessons smallint,
  p_free_cancellation_hours smallint,
  p_finance_history_page_size smallint
)
returns public.teacher_settings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result public.teacher_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_teacher() then
    raise exception 'TEACHER_REQUIRED';
  end if;

  if p_low_balance_threshold_lessons is null
     or p_low_balance_threshold_lessons < 1
     or p_low_balance_threshold_lessons > 20 then
    raise exception 'INVALID_LOW_BALANCE_THRESHOLD';
  end if;

  if p_free_cancellation_hours is null
     or p_free_cancellation_hours < 1
     or p_free_cancellation_hours > 168 then
    raise exception 'INVALID_FREE_CANCELLATION_HOURS';
  end if;

  if p_finance_history_page_size is null
     or p_finance_history_page_size not in (10, 20, 50, 100) then
    raise exception 'INVALID_FINANCE_HISTORY_PAGE_SIZE';
  end if;

  update public.teacher_settings
  set
    low_balance_threshold_lessons = p_low_balance_threshold_lessons,
    free_cancellation_hours = p_free_cancellation_hours,
    finance_history_page_size = p_finance_history_page_size,
    updated_at = now()
  where teacher_id = auth.uid()
  returning * into v_result;

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;

  return v_result;
end;
$function$;

revoke all on function public.update_my_finance_preferences(smallint, smallint, smallint)
  from public, anon;
grant execute on function public.update_my_finance_preferences(smallint, smallint, smallint)
  to authenticated, service_role;

commit;
