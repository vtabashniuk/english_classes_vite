-- Lesson reschedule notifications: add the enum value in a dedicated migration
-- so PostgreSQL commits it before the next migration references it.

alter type public.notification_type
  add value if not exists 'lesson_rescheduled';
