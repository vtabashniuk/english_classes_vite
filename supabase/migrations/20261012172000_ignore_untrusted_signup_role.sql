-- CRM OAuth stage 1.6.1a / Gate 2a: eliminate untrusted role assignment.
-- User metadata is writable by clients and must not determine a teacher role.
-- Existing profiles are not changed. Server-side teacher provisioning is a
-- separate, explicitly authorized operation (not part of this migration).
-- Email invitations continue to create student profiles as before.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.profiles (
    id, email, full_name, role
  ) values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'student'::public.user_role
  );
  return new;
end;
$function$;

-- Defense in depth: trigger helper must never be callable from browser roles.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role;
