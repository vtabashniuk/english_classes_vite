-- Lesson lifecycle automation: enum values must be committed before functions
-- in the following migration can reference them.

alter type public.lesson_cancellation_request_status
  add value if not exists 'expired';

alter type public.notification_type
  add value if not exists 'lesson_outcome_required';

alter type public.notification_type
  add value if not exists 'lesson_auto_missed';

alter type public.notification_type
  add value if not exists 'lesson_cancellation_expired';
