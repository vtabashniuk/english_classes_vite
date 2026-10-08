-- Learning-pause end/resume notification type. Kept separate so PostgreSQL
-- commits the enum value before the following migration references it.

alter type public.notification_type
  add value if not exists 'learning_pause_ended';
