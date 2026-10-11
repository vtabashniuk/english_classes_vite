// A due date includes the whole date in the CRM business timezone.
export const kyivBusinessDate = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(({ type, value: item }) => [type, item]));
  return `${value.year}-${value.month}-${value.day}`;
};
export const isAssignmentOverdue = (assignment, today = kyivBusinessDate()) =>
  assignment.status !== "completed" && Boolean(assignment.due_date)
  && assignment.due_date < today;
export const splitAssignmentsByCompletion = (items) => ({
  pending: items.filter((item) => item.status !== "completed"),
  completed: items.filter((item) => item.status === "completed"),
});
