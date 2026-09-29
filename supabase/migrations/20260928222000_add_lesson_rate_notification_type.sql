-- Add a dedicated notification type for student lesson-rate changes.
-- Kept in a separate migration because a newly-added PostgreSQL enum value
-- should be committed before it is referenced by functions in the next migration.

alter type public.notification_type
  add value if not exists 'lesson_rate_changed';
