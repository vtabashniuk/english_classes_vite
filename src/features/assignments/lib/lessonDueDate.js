// Use the teacher's configured schedule timezone instead of the browser timezone.
// The corresponding database trigger enforces the same calendar date.
export const getLessonDueDate = (startsAt, timezone = "Europe/Kyiv") => {
  if (!startsAt) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(startsAt));
  const value = (name) => parts.find((part) => part.type === name)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
};
