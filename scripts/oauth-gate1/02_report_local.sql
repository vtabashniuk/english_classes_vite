-- LOCAL ONLY: run in http://127.0.0.1:54323 (local Studio SQL Editor).
-- Share these non-secret result fields, not connection credentials or JWTs.
select
  id,
  observed_at,
  prospective_user_id,
  provider,
  providers,
  requested_role,
  has_invited_at,
  has_email_confirmed_at,
  user_metadata_keys,
  user_keys,
  metadata_keys
from oauth_gate1.hook_observations
order by id;

select
  count(*) as total_events,
  count(*) filter (where requested_role = 'student') as student_requested_events,
  count(*) filter (where requested_role = 'teacher') as teacher_requested_events
from oauth_gate1.hook_observations;
