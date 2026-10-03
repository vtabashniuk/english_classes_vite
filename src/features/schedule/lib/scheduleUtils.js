export const PIXELS_PER_MINUTE = 1.15;
export const CALENDAR_TOP_PADDING = 18;
export const CALENDAR_BOTTOM_PADDING = 18;

export const pad = (value) => String(value).padStart(2, "0");

export const timeToMinutes = (value) => {
  const [hours, minutes] = value.split(":").map(Number);

  return hours * 60 + minutes;
};

export const minutesToTime = (minutes) => {
  const hours = Math.floor(minutes / 60);

  const mins = minutes % 60;

  return `${pad(hours)}:${pad(mins)}`;
};

export const createTimeSlots = (
  workdayStart,
  workdayEnd,
  lessonDurationMinutes,
  slotIntervalMinutes,
) => {
  const start = timeToMinutes(workdayStart);

  const end = timeToMinutes(workdayEnd);

  const lastStart = end - lessonDurationMinutes;

  const slots = [];

  for (
    let current = start;
    current <= lastStart;
    current += slotIntervalMinutes
  ) {
    slots.push(minutesToTime(current));
  }

  return slots;
};

export const createDisplayTimeSlots = (
  workdayStart,
  workdayEnd,
  slotIntervalMinutes,
) => {
  const start = timeToMinutes(workdayStart);

  const end = timeToMinutes(workdayEnd);

  const slots = [];

  for (let current = start; current < end; current += slotIntervalMinutes) {
    slots.push(minutesToTime(current));
  }

  return slots;
};

export const getMonday = (date) => {
  const result = new Date(date);

  result.setHours(12, 0, 0, 0);

  const day = result.getDay();

  const difference = day === 0 ? -6 : 1 - day;

  result.setDate(result.getDate() + difference);

  return result;
};

export const addDays = (date, amount) => {
  const result = new Date(date);

  result.setDate(result.getDate() + amount);

  return result;
};

export const startOfDay = (date) => {
  const result = new Date(date);

  result.setHours(0, 0, 0, 0);

  return result;
};

export const parseInputDate = (value) => {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

export const formatDateForInput = (date) => {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
};

export const formatZonedDateForInput = (value, timezone) => {
  const parts = getDatePartsInTimezone(value, timezone);

  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
};


export const formatWeekRange = (weekStart, locale) => {
  const weekEnd = addDays(weekStart, 6);

  const startText = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
  }).format(weekStart);

  const endText = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(weekEnd);

  return `${startText} — ${endText}`;
};

export const isSameCalendarDate = (first, second) => {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
};

export const getDatePartsInTimezone = (value, timezone) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,

    year: "numeric",
    month: "2-digit",
    day: "2-digit",

    hour: "2-digit",
    minute: "2-digit",

    hour12: false,
  }).formatToParts(new Date(value));

  const result = {};

  parts.forEach((part) => {
    if (part.type !== "literal") {
      result[part.type] = Number(part.value);
    }
  });

  return result;
};

export const getLessonPosition = (lesson, timezone, workdayStartMinutes) => {
  const start = getDatePartsInTimezone(lesson.starts_at, timezone);

  const end = getDatePartsInTimezone(lesson.ends_at, timezone);

  const startMinutes = start.hour * 60 + start.minute;

  const endMinutes = end.hour * 60 + end.minute;

  return {
    top:
      CALENDAR_TOP_PADDING +
      (startMinutes - workdayStartMinutes) * PIXELS_PER_MINUTE,

    height: (endMinutes - startMinutes) * PIXELS_PER_MINUTE,
  };
};

export const isSlotBlockedByLesson = (
  date,
  slot,
  lessons,
  timezone,
  lessonDurationMinutes,
) => {
  const slotStart = timeToMinutes(slot);

  const slotEnd = slotStart + lessonDurationMinutes;

  return lessons.some((lesson) => {
    if (lesson.status === "cancelled") {
      return false;
    }

    const lessonStart = getDatePartsInTimezone(lesson.starts_at, timezone);

    const lessonEnd = getDatePartsInTimezone(lesson.ends_at, timezone);

    const lessonDate = `${lessonStart.year}-${pad(lessonStart.month)}-${pad(
      lessonStart.day,
    )}`;

    if (lessonDate !== formatDateForInput(date)) {
      return false;
    }

    const lessonStartMinutes = lessonStart.hour * 60 + lessonStart.minute;

    const lessonEndMinutes = lessonEnd.hour * 60 + lessonEnd.minute;

    return slotStart < lessonEndMinutes && slotEnd > lessonStartMinutes;
  });
};

export const formatLessonTime = (value, locale, timezone) => {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
};

export const formatFullDate = (value, locale, timezone) => {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
};

export const isLessonStarted = (lesson) => {
  return new Date(lesson.starts_at).getTime() <= Date.now();
};
