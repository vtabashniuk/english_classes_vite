import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStudentInvitationBody,
  isPendingGoogleInviteResult,
} from "../../src/features/students/lib/studentInvitationMethod.js";

test("default invitation preserves legacy email request body", () => {
  assert.deepEqual(buildStudentInvitationBody({ email: "a@example.com", fullName: "A" }),
    { email: "a@example.com", fullName: "A" });
});

test("explicit email_password preserves legacy email request body", () => {
  assert.deepEqual(buildStudentInvitationBody({ email: "a@example.com", fullName: "A", invitationMethod: "email_password" }),
    { email: "a@example.com", fullName: "A" });
});

test("Google mode sends exact server-required discriminator", () => {
  assert.deepEqual(buildStudentInvitationBody({ email: "g@example.com", fullName: "G", invitationMethod: "google_no_email" }),
    { email: "g@example.com", fullName: "G", invitationMethod: "google_no_email" });
});

test("unsupported invitation method fails closed", () => {
  assert.throws(() => buildStudentInvitationBody({ email: "a@example.com", invitationMethod: "googl" }),
    /UNSUPPORTED_INVITATION_METHOD/);
});

test("pending Google response requires all safety markers", () => {
  assert.equal(isPendingGoogleInviteResult({ success: true, invitationId: "test-uuid", invitationMethod: "google_no_email", pendingActivation: true, emailSent: false }), true);
  assert.equal(isPendingGoogleInviteResult({ success: true, invitationId: "test-uuid", invitationMethod: "google_no_email", pendingActivation: false, emailSent: false }), false);
  assert.equal(isPendingGoogleInviteResult({ success: true, invitationId: "test-uuid", invitationMethod: "google_no_email", pendingActivation: true, emailSent: true }), false);
  assert.equal(isPendingGoogleInviteResult({ success: true, invitationId: "test-uuid", invitationMethod: "email_password", pendingActivation: true, emailSent: false }), false);
});
