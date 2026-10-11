-- Enum change is isolated: PostgreSQL requires the new value to be committed before use.
alter type public.notification_type add value if not exists 'assignment_overdue_reminder';
