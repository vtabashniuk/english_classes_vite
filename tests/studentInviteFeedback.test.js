import assert from "node:assert/strict";
import test from "node:test";

import {
  getInviteErrorMessage,
  getInviteSuccessMessageKey,
} from "../src/features/students/lib/studentInviteFeedback.js";

const translate = (key) => key;

test("new invitation uses the regular success toast", () => {
  assert.equal(getInviteSuccessMessageKey({ success: true }), "teacherStudents.invite.success");
});

test("existing student link never claims an email was sent", () => {
  assert.equal(getInviteSuccessMessageKey({ success: true, alreadyLinked: true }), "teacherStudents.invite.alreadyLinked");
});

test("restored relationship never claims an email was sent", () => {
  assert.equal(getInviteSuccessMessageKey({ success: true, relationshipRestored: true }), "teacherStudents.invite.relationshipRestored");
});

test("email rate limit gets a localized inline error", () => {
  assert.equal(getInviteErrorMessage(new Error("email rate limit exceeded"), translate), "teacherStudents.invite.emailRateLimit");
  assert.equal(getInviteErrorMessage(new Error("Too Many Requests"), translate), "teacherStudents.invite.emailRateLimit");
});

test("other invitation errors remain inline with their original server message", () => {
  assert.equal(getInviteErrorMessage(new Error("Profile conflict"), translate), "Profile conflict");
  assert.equal(getInviteErrorMessage(null, translate), "teacherStudents.errors.invite");
});
