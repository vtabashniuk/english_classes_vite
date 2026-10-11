-- A new notification type, separate from the earlier *overdue* reminder.
-- Enum value must be committed before it is referenced by the next migration.
alter type public.notification_type add value if not exists 'assignment_due_reminder';
