// Edge Function success can also mean an existing teacher/student link.
// Neither of those idempotent paths sends a new invitation email.
export const getInviteSuccessMessageKey = (data) => {
  if (data?.alreadyLinked) return "teacherStudents.invite.alreadyLinked";
  if (data?.relationshipRestored) return "teacherStudents.invite.relationshipRestored";
  return "teacherStudents.invite.success";
};

export const getInviteErrorMessage = (error, t) => {
  const message = String(error?.message ?? "").trim();
  if (/\b(?:email[\s_-]*)?rate[\s_-]*limit\b|\btoo many (?:emails|requests)\b/i.test(message)) {
    return t("teacherStudents.invite.emailRateLimit");
  }
  return message || t("teacherStudents.errors.invite");
};
