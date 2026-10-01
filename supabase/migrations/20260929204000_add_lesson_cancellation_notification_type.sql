-- Finance Step 9 / cancellation workflow: notification enum value.
-- Kept separate so PostgreSQL commits the enum addition before it is used
-- by functions in the following migration.

alter type public.notification_type
  add value if not exists 'lesson_cancellation_requested';
