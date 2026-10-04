-- Step 4 enum values are committed separately before the next migration uses them.

alter type public.lesson_request_type
  add value if not exists 'reschedule';

alter type public.lesson_request_status
  add value if not exists 'expired';

alter type public.notification_type
  add value if not exists 'lesson_reschedule_requested';
