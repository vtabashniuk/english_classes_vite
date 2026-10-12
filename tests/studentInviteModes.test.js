import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveInvitationMethod,
  EMAIL_PASSWORD,
  GOOGLE_NO_EMAIL,
} from "../supabase/functions/invite-student/invitation-mode.mjs";

test("invite-student: omitted mode remains email/password for existing clients", () => {
  assert.equal(resolveInvitationMethod(undefined), EMAIL_PASSWORD);
});

test("invite-student: explicit email/password mode remains valid", () => {
  assert.equal(resolveInvitationMethod("email_password"), EMAIL_PASSWORD);
});

test("invite-student: Google without email is a distinct accepted mode", () => {
  assert.equal(resolveInvitationMethod("google_no_email"), GOOGLE_NO_EMAIL);
});

test("invite-student: misspelled Google mode must not send an email", () => {
  assert.throws(() => resolveInvitationMethod("google"), /UNSUPPORTED_INVITATION_METHOD/);
});

test("invite-student: null is not an omitted mode", () => {
  assert.throws(() => resolveInvitationMethod(null), /UNSUPPORTED_INVITATION_METHOD/);
});

test("invite-student: invalid types and empty strings are rejected", () => {
  for (const value of ["", true, 0, {}, []]) {
    assert.throws(() => resolveInvitationMethod(value), /UNSUPPORTED_INVITATION_METHOD/);
  }
});
