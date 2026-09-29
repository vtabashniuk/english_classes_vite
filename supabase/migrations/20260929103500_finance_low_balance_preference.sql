-- Teacher-specific finance preference for low-balance alerts.
-- The threshold is stored as a number of lessons and is intentionally
-- independent from lesson price/currency.

begin;

alter table public.teacher_settings
  add column if not exists low_balance_threshold_lessons smallint not null default 2;

alter table public.teacher_settings
  drop constraint if exists teacher_settings_low_balance_threshold_lessons_check;

alter table public.teacher_settings
  add constraint teacher_settings_low_balance_threshold_lessons_check
  check (low_balance_threshold_lessons between 1 and 20);

comment on column public.teacher_settings.low_balance_threshold_lessons is
  'Teacher-specific threshold for the Finance low-balance list, expressed as the maximum number of lessons the remaining balance can cover. Default: 2.';

create or replace function public.update_my_finance_preferences(
  p_low_balance_threshold_lessons smallint
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

  update public.teacher_settings
  set
    low_balance_threshold_lessons = p_low_balance_threshold_lessons,
    updated_at = now()
  where teacher_id = auth.uid()
  returning * into v_result;

  if not found then
    raise exception 'TEACHER_SETTINGS_NOT_FOUND';
  end if;

  return v_result;
end;
$function$;

revoke all on function public.update_my_finance_preferences(smallint)
  from public, anon;
grant execute on function public.update_my_finance_preferences(smallint)
  to authenticated, service_role;

commit;
