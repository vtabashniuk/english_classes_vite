# CRM — 1.6.1a / Gate 2b: Pending Google invitations, database only

## Purpose and boundaries

- **No temporary student**: the pending row is a private invitation, not an `auth.users`, `profiles`, or `teacher_students` row.
- Existing **email + password** invitations (`invite-student` / `inviteUserByEmail`) remain untouched.
- The new table is in `crm_private`, not an exposed PostgREST schema. RLS is on; no `anon` or `authenticated` direct access.
- Only `service_role` can invoke `create_pending_google_invitation`. The eventual Edge Function must authenticate the teacher and pass only their verified `user.id`; never accept an arbitrary teacher UUID from the request body.
- Teachers may use the explicitly scoped `list_my_pending_google_invitations()` and `cancel_my_pending_google_invitation(uuid)` RPCs. Frontend integration is deferred.
- Same teacher + email has at most one open invitation; retry renews the 14-day expiry even after the original invitation expires. Different teachers can have separate pending invitations for the same email. **This does not mean both can automatically claim the student**: eventual activation must respect the existing one-active-teacher rule and require student consent for a change of teacher.
- An account already present in `auth.users` / `profiles` cannot be added through this flow. It needs a separate user-confirmed linking/transfer flow.

## Critical security rule for later gates

**Never authorize an email/password signup solely because a pending Google invitation has the same email.** An unauthenticated actor could attempt to reserve someone else's email. The Before User Created Hook must check the verified OAuth provider and private pending invitation, and consent/identity confirmation must occur before linking; first verify a real Google provider event locally. Supabase's event data for admin email invitations and public email signup were indistinguishable in Gate 1. The production Auth Hook remains disabled.

Do not change `[auth].enable_signup` or `[auth.email].enable_signup` based on assumptions: changing auth signup/provider flags can affect existing email sign-in and Google onboarding. Test such behavior separately first. No Production changes during Gate 2b.

## Test and rollback plan

From the `feature/oauth-google` branch:

```powershell
npx supabase migration list --local
npx supabase migration up --local
npx supabase test db --local
node --test tests/*.test.js
npm run check:architecture
npm run lint
npm run build
```

**Do not use `db reset` or `db push --linked` here.** The migration is additive. Tests are transactional and rolled back. Expect **12 SQL files / 371 SQL tests** (345 existing + 26 new). If test counts differ, stop and inspect the file list.

This stage does not include the Auth Hook, Edge Function changes, Google button, or any Production deployment. Activation in a later gate requires end-to-end verification of verified Google email, single-UUID creation, conflict/expired/revoked invites, idempotency/race conditions, and existing email invitation compatibility.
