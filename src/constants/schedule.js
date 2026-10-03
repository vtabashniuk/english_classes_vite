export const DEFAULT_SCHEDULE_SETTINGS = {
  timezone: "Europe/Kyiv",
  workdayStart: "09:00",
  workdayEnd: "19:00",
  lessonDurationMinutes: 50,
  slotIntervalMinutes: 30,
  reschedulePricePolicy: "keep_original",
  allowOpenEndedRecurringLessons: true,
  recurringGenerationHorizonWeeks: 8,
};

export const WEEKDAYS = [
  { value: 1, key: "monday" },
  { value: 2, key: "tuesday" },
  { value: 3, key: "wednesday" },
  { value: 4, key: "thursday" },
  { value: 5, key: "friday" },
  { value: 6, key: "saturday" },
  { value: 7, key: "sunday" },
];

export const createDefaultWorkingHours = () =>
  WEEKDAYS.map(({ value: weekday }) => ({
    weekday,
    isWorking: weekday <= 5,
    workdayStart: DEFAULT_SCHEDULE_SETTINGS.workdayStart,
    workdayEnd: DEFAULT_SCHEDULE_SETTINGS.workdayEnd,
  }));

export const MIN_LESSON_DURATION = 30;
export const MAX_LESSON_DURATION = 120;

export const LESSON_DURATION_STEP = 5;

export const MIN_RECURRING_GENERATION_HORIZON_WEEKS = 1;
export const MAX_RECURRING_GENERATION_HORIZON_WEEKS = 52;
