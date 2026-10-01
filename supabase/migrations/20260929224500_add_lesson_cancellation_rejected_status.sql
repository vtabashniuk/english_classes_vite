-- Cancellation-request rejection support.
-- Enum values are committed in a separate migration before functions use them.

alter type public.lesson_cancellation_request_status
  add value if not exists 'rejected';

alter type public.notification_type
  add value if not exists 'lesson_cancellation_rejected';
