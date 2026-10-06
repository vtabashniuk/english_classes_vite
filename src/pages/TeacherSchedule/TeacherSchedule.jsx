import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import {
  cancelLesson,
  createLesson,
  getTeacherLessonById,
  listTeacherLessonsForRange,
  setLessonOutcome,
  updateLessonSchedule,
  updateLessonMeetingUrl,
} from "../../features/lessons/api/lessonsApi";
import {
  cancelRecurringSeriesFromLesson,
  createRecurringLessonWithGeneration,
  editRecurringSeriesFromLesson,
  getRecurringLessonById,
  listTeacherProjectedRecurringLessonsForRange,
} from "../../features/lessons/api/recurringLessonsApi";
import { listActiveStudents } from "../../features/profiles/api/profilesApi";
import {
  getMyTeacherScheduleSettings,
  getMyTeacherWorkingHours,
} from "../../features/settings/api/teacherSettingsApi";
import {
  cancelRecurringScheduleBlockSeriesFromBlock,
  createRecurringScheduleBlockWithGeneration,
  createScheduleBlock,
  deleteScheduleBlock,
  editRecurringScheduleBlockSeriesFromBlock,
  getRecurringScheduleBlockSeriesById,
  listMyScheduleBlocksForRange,
  listTeacherProjectedRecurringBlocksForRange,
  updateScheduleBlock,
} from "../../features/schedule/api/scheduleBlocksApi";
import {
  getCancelLessonError,
  getCancelRecurringSeriesError,
  getCreateLessonError,
  getCreateRecurringLessonError,
  getEditRecurringSeriesError,
  getLessonOutcomeError,
  getScheduleBlockError,
  getUpdateLessonScheduleError,
  getUpdateLessonMeetingUrlError,
} from "../../features/schedule/lib/scheduleErrors";
import {
  addDays,
  CALENDAR_BOTTOM_PADDING,
  CALENDAR_TOP_PADDING,
  createDisplayTimeSlots,
  createTimeSlots,
  formatDateForInput,
  formatFullDate,
  formatLessonTime,
  formatWeekRange,
  formatZonedDateForInput,
  getDatePartsInTimezone,
  getLessonPosition,
  getMonday,
  getScheduleBlockPosition,
  isLessonStarted,
  isSameCalendarDate,
  isSlotBlockedByLesson,
  isSlotBlockedByScheduleBlock,
  minutesToTime,
  pad,
  parseInputDate,
  PIXELS_PER_MINUTE,
  startOfDay,
  timeToMinutes,
} from "../../features/schedule/lib/scheduleUtils";

import { getIntlLocale } from "../../utils/getIntlLocale";
import useToast from "../../shared/toast/useToast";

import { getTimezone } from "../../constants/timezones";

import {
  createDefaultWorkingHours,
  DEFAULT_SCHEDULE_SETTINGS,
  WEEKDAYS,
} from "../../constants/schedule";

import Button from "../../components/common/ui/Button/Button";
import LessonDetails from "../../features/lessons/components/LessonDetails/LessonDetails";

import styles from "./TeacherSchedule.module.css";

const DAY_NAMES = WEEKDAYS.map((day) => day.key);

const fetchActiveStudents = async () => {
  const { data, error } = await listActiveStudents({ includeContact: true });

  if (error) {
    throw error;
  }

  return data ?? [];
};

const fetchTeacherScheduleSettings = async () => {
  const [settingsResult, workingHoursResult] = await Promise.all([
    getMyTeacherScheduleSettings(),
    getMyTeacherWorkingHours(),
  ]);

  if (settingsResult.error || workingHoursResult.error) {
    throw settingsResult.error || workingHoursResult.error;
  }

  const data = settingsResult.data;
  const legacyStart =
    data?.workday_start?.slice(0, 5) || DEFAULT_SCHEDULE_SETTINGS.workdayStart;
  const legacyEnd =
    data?.workday_end?.slice(0, 5) || DEFAULT_SCHEDULE_SETTINGS.workdayEnd;

  return {
    timezone: data?.schedule_timezone || DEFAULT_SCHEDULE_SETTINGS.timezone,
    lessonDurationMinutes:
      data?.lesson_duration_minutes ??
      DEFAULT_SCHEDULE_SETTINGS.lessonDurationMinutes,
    slotIntervalMinutes:
      data?.slot_interval_minutes ??
      DEFAULT_SCHEDULE_SETTINGS.slotIntervalMinutes,
    reschedulePricePolicy:
      data?.reschedule_price_policy ??
      DEFAULT_SCHEDULE_SETTINGS.reschedulePricePolicy,
    allowOpenEndedRecurringLessons:
      data?.allow_open_ended_recurring_lessons ??
      DEFAULT_SCHEDULE_SETTINGS.allowOpenEndedRecurringLessons,
    recurringGenerationHorizonWeeks:
      Number(
        data?.recurring_generation_horizon_weeks ??
          DEFAULT_SCHEDULE_SETTINGS.recurringGenerationHorizonWeeks,
      ),
    workingHours: normalizeWorkingHours(
      workingHoursResult.data,
      legacyStart,
      legacyEnd,
    ),
  };
};

const normalizeWorkingHours = (rows, fallbackStart, fallbackEnd) => {
  const byWeekday = new Map((rows ?? []).map((item) => [Number(item.weekday), item]));

  return WEEKDAYS.map(({ value: weekday }) => {
    const row = byWeekday.get(weekday);

    return {
      weekday,
      isWorking: row ? Boolean(row.is_working) : weekday <= 5,
      workdayStart: row?.workday_start?.slice(0, 5) || fallbackStart,
      workdayEnd: row?.workday_end?.slice(0, 5) || fallbackEnd,
    };
  });
};

const getIsoWeekday = (date) => {
  const weekday = date.getDay();
  return weekday === 0 ? 7 : weekday;
};

const getWorkingHoursForWeekday = (settings, weekday) =>
  settings.workingHours.find((item) => item.weekday === Number(weekday)) ?? null;

const getTimeSlotsForWeekday = (settings, weekday) => {
  const workingHours = getWorkingHoursForWeekday(settings, weekday);

  if (!workingHours?.isWorking) return [];

  return createTimeSlots(
    workingHours.workdayStart,
    workingHours.workdayEnd,
    settings.lessonDurationMinutes,
    settings.slotIntervalMinutes,
  );
};

const getTimeSlotsForDate = (settings, dateValue) => {
  const date = parseInputDate(dateValue);
  if (!date) return [];
  return getTimeSlotsForWeekday(settings, getIsoWeekday(date));
};

const fetchTeacherLessonsForWeek = async (weekStart) => {
  const start = startOfDay(addDays(weekStart, -1));
  const end = startOfDay(addDays(weekStart, 8));

  const { data, error } = await listTeacherLessonsForRange({
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  });

  if (error) {
    throw error;
  }

  return data ?? [];
};

const fetchTeacherScheduleBlocksForWeek = async (weekStart) => {
  const start = startOfDay(addDays(weekStart, -1));
  const end = startOfDay(addDays(weekStart, 8));

  const { data, error } = await listMyScheduleBlocksForRange({
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  });

  if (error) {
    throw error;
  }

  return data ?? [];
};

const fetchProjectedRecurringLessonsForWeek = async (weekStart) => {
  const fromDate = formatDateForInput(weekStart);
  const untilDate = formatDateForInput(addDays(weekStart, 6));

  const { data, error } = await listTeacherProjectedRecurringLessonsForRange({
    fromDate,
    untilDate,
  });

  if (error) {
    throw error;
  }

  return (data ?? []).map((item) => ({
    id: `projected-lesson-${item.recurring_lesson_id}-${item.occurrence_date}`,
    student_id: item.student_id,
    starts_at: item.starts_at,
    ends_at: item.ends_at,
    duration_minutes: item.duration_minutes,
    status: "scheduled",
    recurring_lesson_id: item.recurring_lesson_id,
    occurrence_date: item.occurrence_date,
    isProjectedRecurring: true,
    profiles: {
      full_name: item.student_full_name,
      email: item.student_email,
    },
  }));
};

const fetchProjectedRecurringBlocksForWeek = async (weekStart) => {
  const fromDate = formatDateForInput(weekStart);
  const untilDate = formatDateForInput(addDays(weekStart, 6));

  const { data, error } = await listTeacherProjectedRecurringBlocksForRange({
    fromDate,
    untilDate,
  });

  if (error) {
    throw error;
  }

  return (data ?? []).map((item) => ({
    id: `projected-block-${item.recurring_block_series_id}-${item.occurrence_date}`,
    starts_at: item.starts_at,
    ends_at: item.ends_at,
    reason: item.reason,
    recurring_block_series_id: item.recurring_block_series_id,
    isProjectedRecurring: true,
  }));
};

const getBlockStartSlotsForWeekday = (settings, weekday) => {
  const workingHours = getWorkingHoursForWeekday(settings, weekday);

  if (!workingHours?.isWorking) return [];

  const slots = createDisplayTimeSlots(
    workingHours.workdayStart,
    workingHours.workdayEnd,
    settings.slotIntervalMinutes,
  );

  return slots.filter(
    (slot) =>
      timeToMinutes(slot) + settings.slotIntervalMinutes <=
      timeToMinutes(workingHours.workdayEnd),
  );
};

const getBlockStartSlotsForDate = (settings, dateValue) => {
  const date = parseInputDate(dateValue);
  if (!date) return [];
  return getBlockStartSlotsForWeekday(settings, getIsoWeekday(date));
};

const getBlockEndSlotsForWeekday = (settings, weekday, startTime) => {
  if (!startTime) return [];

  const workingHours = getWorkingHoursForWeekday(settings, weekday);
  if (!workingHours?.isWorking) return [];

  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(workingHours.workdayEnd);
  const slots = [];

  for (
    let current = startMinutes + settings.slotIntervalMinutes;
    current <= endMinutes;
    current += settings.slotIntervalMinutes
  ) {
    slots.push(minutesToTime(current));
  }

  if (slots.at(-1) !== workingHours.workdayEnd) {
    slots.push(workingHours.workdayEnd);
  }

  return slots.filter((slot, index, items) => items.indexOf(slot) === index);
};

const getBlockEndSlotsForDate = (settings, dateValue, startTime) => {
  const date = parseInputDate(dateValue);
  if (!date) return [];
  return getBlockEndSlotsForWeekday(settings, getIsoWeekday(date), startTime);
};

const TeacherSchedule = () => {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedLessonId = searchParams.get("lessonId");

  const [students, setStudents] = useState([]);

  const [lessons, setLessons] = useState([]);

  const [projectedRecurringLessons, setProjectedRecurringLessons] = useState([]);

  const [scheduleBlocks, setScheduleBlocks] = useState([]);

  const [projectedRecurringBlocks, setProjectedRecurringBlocks] = useState([]);

  const [scheduleSettings, setScheduleSettings] = useState(() => ({
    ...DEFAULT_SCHEDULE_SETTINGS,
    workingHours: createDefaultWorkingHours(),
  }));

  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));

  const [selectedStudentId, setSelectedStudentId] = useState("");

  const [selectedDate, setSelectedDate] = useState("");

  const [selectedTime, setSelectedTime] = useState("");

  const [meetingUrl, setMeetingUrl] = useState("");

  const [createMode, setCreateMode] = useState("single");

  const [recurringWeekday, setRecurringWeekday] = useState("1");

  const [recurringValidFrom, setRecurringValidFrom] = useState("");

  const [recurringValidUntil, setRecurringValidUntil] = useState("");

  const [recurringIntervalWeeks, setRecurringIntervalWeeks] = useState("1");

  const [selectedLesson, setSelectedLesson] = useState(null);

  const [selectedBlock, setSelectedBlock] = useState(null);

  const [blockDate, setBlockDate] = useState("");

  const [blockStartTime, setBlockStartTime] = useState("");

  const [blockEndTime, setBlockEndTime] = useState("");

  const [blockReason, setBlockReason] = useState("");

  const [blockRepeatMode, setBlockRepeatMode] = useState("single");

  const [blockRecurringWeekday, setBlockRecurringWeekday] = useState("1");

  const [blockRecurringValidFrom, setBlockRecurringValidFrom] = useState("");

  const [blockRecurringValidUntil, setBlockRecurringValidUntil] = useState("");

  const [blockRecurringIntervalWeeks, setBlockRecurringIntervalWeeks] = useState("1");

  const [editingBlock, setEditingBlock] = useState(false);

  const [editingRecurringBlockSeries, setEditingRecurringBlockSeries] = useState(false);

  const [loadingRecurringBlockSeries, setLoadingRecurringBlockSeries] = useState(false);

  const [savingRecurringBlockSeries, setSavingRecurringBlockSeries] = useState(false);

  const [cancellingRecurringBlockSeriesId, setCancellingRecurringBlockSeriesId] = useState(null);

  const [blockSeriesWeekday, setBlockSeriesWeekday] = useState("1");

  const [blockSeriesStartTime, setBlockSeriesStartTime] = useState("");

  const [blockSeriesEndTime, setBlockSeriesEndTime] = useState("");

  const [blockSeriesIntervalWeeks, setBlockSeriesIntervalWeeks] = useState("1");

  const [blockSeriesValidUntil, setBlockSeriesValidUntil] = useState("");

  const [blockSeriesReason, setBlockSeriesReason] = useState("");

  const [savingBlock, setSavingBlock] = useState(false);

  const [deletingBlockId, setDeletingBlockId] = useState(null);

  const [loading, setLoading] = useState(true);

  const [creating, setCreating] = useState(false);

  const [cancellingLessonId, setCancellingLessonId] = useState(null);

  const [cancellingSeriesId, setCancellingSeriesId] = useState(null);

  const [editingRecurringSeries, setEditingRecurringSeries] = useState(false);

  const [loadingRecurringSeries, setLoadingRecurringSeries] = useState(false);

  const [savingRecurringSeries, setSavingRecurringSeries] = useState(false);

  const [seriesWeekday, setSeriesWeekday] = useState("1");

  const [seriesTime, setSeriesTime] = useState("");

  const [seriesIntervalWeeks, setSeriesIntervalWeeks] = useState("1");

  const [seriesValidUntil, setSeriesValidUntil] = useState("");

  const [seriesMeetingUrl, setSeriesMeetingUrl] = useState("");

  const [editingMeetingUrl, setEditingMeetingUrl] = useState(false);

  const [editingLesson, setEditingLesson] = useState(false);

  const [editLessonDate, setEditLessonDate] = useState("");

  const [editLessonMinDate, setEditLessonMinDate] = useState("");

  const [editLessonTime, setEditLessonTime] = useState("");

  const [editLessonMeetingUrl, setEditLessonMeetingUrl] = useState("");

  const [savingLesson, setSavingLesson] = useState(false);

  const [lessonMeetingUrlDraft, setLessonMeetingUrlDraft] = useState("");

  const [savingMeetingUrl, setSavingMeetingUrl] = useState(false);

  const [updatingOutcome, setUpdatingOutcome] = useState(false);

  const [pageErrorMessage, setPageErrorMessage] = useState("");

  const [createErrorMessage, setCreateErrorMessage] = useState("");

  const [detailErrorMessage, setDetailErrorMessage] = useState("");

  const [currentTimeMs, setCurrentTimeMs] = useState(null);

  useEffect(() => {
    const updateCurrentTime = () => {
      setCurrentTimeMs(Date.now());
    };

    const initialTimerId = window.setTimeout(updateCurrentTime, 0);
    const intervalId = window.setInterval(updateCurrentTime, 30_000);

    return () => {
      window.clearTimeout(initialTimerId);
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!createErrorMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setCreateErrorMessage("");
    }, 5000);

    return () => window.clearTimeout(timeoutId);
  }, [createErrorMessage]);

  useEffect(() => {
    if (!detailErrorMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setDetailErrorMessage("");
    }, 5000);

    return () => window.clearTimeout(timeoutId);
  }, [detailErrorMessage]);


  const locale = getIntlLocale(i18n.language);

  const scheduleTimezone = scheduleSettings.timezone;

  useEffect(() => {
    if (loading || !requestedLessonId) return undefined;

    let cancelled = false;

    const openLinkedLesson = async () => {
      try {
        setDetailErrorMessage("");

        const { data, error } = await getTeacherLessonById(requestedLessonId);
        if (error) throw error;
        if (cancelled) return;

        if (!data) {
          setSelectedLesson(null);
          setDetailErrorMessage(t("teacherSchedule.errors.lessonNotFound"));
          return;
        }

        const parts = getDatePartsInTimezone(data.starts_at, scheduleTimezone);
        const lessonDate = new Date(
          parts.year,
          parts.month - 1,
          parts.day,
          12,
          0,
          0,
          0,
        );

        setWeekStart(getMonday(lessonDate));
        setSelectedLesson(data);
        setSelectedBlock(null);
        setEditingBlock(false);
        setLessonMeetingUrlDraft(data.meeting_url || "");
        setEditingMeetingUrl(false);
        setEditingLesson(false);
        setEditingRecurringSeries(false);
  
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            document.getElementById("lesson-details-panel")?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          });
        });
      } catch (error) {
        if (cancelled) return;
        console.error("Open linked lesson error:", error);
        setDetailErrorMessage(t("teacherSchedule.errors.loadLesson"));
      }
    };

    openLinkedLesson();

    return () => {
      cancelled = true;
    };
  }, [loading, requestedLessonId, scheduleTimezone, t]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  }, [weekStart]);

  const enabledWorkingHours = useMemo(
    () => scheduleSettings.workingHours.filter((item) => item.isWorking),
    [scheduleSettings.workingHours],
  );

  const displayedLessons = useMemo(
    () => [...lessons, ...projectedRecurringLessons],
    [lessons, projectedRecurringLessons],
  );

  const displayedScheduleBlocks = useMemo(
    () => [...scheduleBlocks, ...projectedRecurringBlocks],
    [scheduleBlocks, projectedRecurringBlocks],
  );

  const calendarBounds = useMemo(() => {
    const fallbackStart = timeToMinutes(DEFAULT_SCHEDULE_SETTINGS.workdayStart);
    const fallbackEnd = timeToMinutes(DEFAULT_SCHEDULE_SETTINGS.workdayEnd);

    let startMinutes = enabledWorkingHours.length
      ? Math.min(...enabledWorkingHours.map((item) => timeToMinutes(item.workdayStart)))
      : fallbackStart;
    let endMinutes = enabledWorkingHours.length
      ? Math.max(...enabledWorkingHours.map((item) => timeToMinutes(item.workdayEnd)))
      : fallbackEnd;

    const displayedDates = new Set(weekDays.map(formatDateForInput));

    displayedLessons.forEach((lesson) => {
      if (!displayedDates.has(formatZonedDateForInput(lesson.starts_at, scheduleTimezone))) {
        return;
      }

      const start = getDatePartsInTimezone(lesson.starts_at, scheduleTimezone);
      const end = getDatePartsInTimezone(lesson.ends_at, scheduleTimezone);
      const lessonStartMinutes = start.hour * 60 + start.minute;
      const lessonEndMinutes = end.hour * 60 + end.minute;

      startMinutes = Math.min(startMinutes, lessonStartMinutes);
      endMinutes = Math.max(endMinutes, lessonEndMinutes);
    });

    displayedScheduleBlocks.forEach((block) => {
      if (!displayedDates.has(formatZonedDateForInput(block.starts_at, scheduleTimezone))) {
        return;
      }

      const start = getDatePartsInTimezone(block.starts_at, scheduleTimezone);
      const end = getDatePartsInTimezone(block.ends_at, scheduleTimezone);
      const blockStartMinutes = start.hour * 60 + start.minute;
      const blockEndMinutes = end.hour * 60 + end.minute;

      startMinutes = Math.min(startMinutes, blockStartMinutes);
      endMinutes = Math.max(endMinutes, blockEndMinutes);
    });

    return { startMinutes, endMinutes };
  }, [
    enabledWorkingHours,
    displayedLessons,
    displayedScheduleBlocks,
    scheduleTimezone,
    weekDays,
  ]);

  const calendarStartMinutes = calendarBounds.startMinutes;
  const calendarEndMinutes = calendarBounds.endMinutes;
  const calendarStart = minutesToTime(calendarStartMinutes);
  const calendarEnd = minutesToTime(calendarEndMinutes);

  const calendarHeight =
    (calendarEndMinutes - calendarStartMinutes) * PIXELS_PER_MINUTE +
    CALENDAR_TOP_PADDING +
    CALENDAR_BOTTOM_PADDING;

  const calendarEndTop =
    CALENDAR_TOP_PADDING +
    (calendarEndMinutes - calendarStartMinutes) * PIXELS_PER_MINUTE;

  const displayTimeSlots = useMemo(() => {
    return createDisplayTimeSlots(
      calendarStart,
      calendarEnd,
      scheduleSettings.slotIntervalMinutes,
    );
  }, [calendarStart, calendarEnd, scheduleSettings.slotIntervalMinutes]);

  const selectedDateSlots = useMemo(
    () => getTimeSlotsForDate(scheduleSettings, selectedDate),
    [scheduleSettings, selectedDate],
  );

  const blockStartSlots = useMemo(
    () => getBlockStartSlotsForDate(scheduleSettings, blockDate),
    [scheduleSettings, blockDate],
  );

  const blockEndSlots = useMemo(
    () =>
      getBlockEndSlotsForDate(
        scheduleSettings,
        blockDate,
        blockStartTime,
      ),
    [scheduleSettings, blockDate, blockStartTime],
  );

  const blockRecurringStartSlots = useMemo(
    () => getBlockStartSlotsForWeekday(scheduleSettings, Number(blockRecurringWeekday)),
    [scheduleSettings, blockRecurringWeekday],
  );

  const blockRecurringEndSlots = useMemo(
    () =>
      getBlockEndSlotsForWeekday(
        scheduleSettings,
        Number(blockRecurringWeekday),
        blockStartTime,
      ),
    [scheduleSettings, blockRecurringWeekday, blockStartTime],
  );

  const blockSeriesStartSlots = useMemo(
    () => getBlockStartSlotsForWeekday(scheduleSettings, Number(blockSeriesWeekday)),
    [scheduleSettings, blockSeriesWeekday],
  );

  const blockSeriesEndSlots = useMemo(
    () =>
      getBlockEndSlotsForWeekday(
        scheduleSettings,
        Number(blockSeriesWeekday),
        blockSeriesStartTime,
      ),
    [scheduleSettings, blockSeriesWeekday, blockSeriesStartTime],
  );

  const recurringTimeSlots = useMemo(
    () => getTimeSlotsForWeekday(scheduleSettings, Number(recurringWeekday)),
    [scheduleSettings, recurringWeekday],
  );

  const seriesTimeSlots = useMemo(
    () => getTimeSlotsForWeekday(scheduleSettings, Number(seriesWeekday)),
    [scheduleSettings, seriesWeekday],
  );

  const editLessonTimeSlots = useMemo(
    () => getTimeSlotsForDate(scheduleSettings, editLessonDate),
    [scheduleSettings, editLessonDate],
  );

  const timezoneConfig = getTimezone(scheduleTimezone);

  const timezoneLabel = timezoneConfig
    ? t(timezoneConfig.labelKey)
    : scheduleTimezone;

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        const [nextStudents, nextSettings] = await Promise.all([
          fetchActiveStudents(),
          fetchTeacherScheduleSettings(),
        ]);

        if (!cancelled) {
          setPageErrorMessage("");
          setStudents(nextStudents);
          setScheduleSettings(nextSettings);

          const firstWorkingDay = nextSettings.workingHours.find(
            (item) => item.isWorking,
          );
          if (firstWorkingDay) {
            const keepWorkingWeekday = (current) =>
              nextSettings.workingHours.some(
                (item) => item.isWorking && String(item.weekday) === current,
              )
                ? current
                : String(firstWorkingDay.weekday);

            setRecurringWeekday(keepWorkingWeekday);
            setBlockRecurringWeekday(keepWorkingWeekday);
            setBlockSeriesWeekday(keepWorkingWeekday);
          } else {
            setRecurringWeekday("");
            setBlockRecurringWeekday("");
            setBlockSeriesWeekday("");
          }
        }
      } catch (error) {
        console.error("TeacherSchedule initialization error:", error);

        if (!cancelled) {
          setPageErrorMessage(t("teacherSchedule.errors.load"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    initialize();

    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    let cancelled = false;

    const refreshWeek = async () => {
      try {
        const [
          nextLessons,
          nextBlocks,
          nextProjectedLessons,
          nextProjectedBlocks,
        ] = await Promise.all([
          fetchTeacherLessonsForWeek(weekStart),
          fetchTeacherScheduleBlocksForWeek(weekStart),
          fetchProjectedRecurringLessonsForWeek(weekStart),
          fetchProjectedRecurringBlocksForWeek(weekStart),
        ]);

        if (!cancelled) {
          setPageErrorMessage("");
          setLessons(nextLessons);
          setScheduleBlocks(nextBlocks);
          setProjectedRecurringLessons(nextProjectedLessons);
          setProjectedRecurringBlocks(nextProjectedBlocks);
        }
      } catch (error) {
        console.error("Load schedule error:", error);

        if (!cancelled) {
          setPageErrorMessage(t("teacherSchedule.errors.loadLessons"));
        }
      }
    };

    refreshWeek();

    return () => {
      cancelled = true;
    };
  }, [weekStart, t]);

  const loadLessons = async () => {
    try {
      const [
        nextLessons,
        nextBlocks,
        nextProjectedLessons,
        nextProjectedBlocks,
      ] = await Promise.all([
        fetchTeacherLessonsForWeek(weekStart),
        fetchTeacherScheduleBlocksForWeek(weekStart),
        fetchProjectedRecurringLessonsForWeek(weekStart),
        fetchProjectedRecurringBlocksForWeek(weekStart),
      ]);
      setPageErrorMessage("");
      setLessons(nextLessons);
      setScheduleBlocks(nextBlocks);
      setProjectedRecurringLessons(nextProjectedLessons);
      setProjectedRecurringBlocks(nextProjectedBlocks);
    } catch (error) {
      console.error("Load schedule error:", error);
      setPageErrorMessage(t("teacherSchedule.errors.loadLessons"));
    }
  };

  const handlePreviousWeek = () => {
    setSelectedLesson(null);
    setSelectedBlock(null);
    setSearchParams({}, { replace: true });

    setWeekStart((current) => addDays(current, -7));
  };

  const handleNextWeek = () => {
    setSelectedLesson(null);
    setSelectedBlock(null);
    setSearchParams({}, { replace: true });

    setWeekStart((current) => addDays(current, 7));
  };

  const handleCurrentWeek = () => {
    setSelectedLesson(null);
    setSelectedBlock(null);
    setSearchParams({}, { replace: true });

    setWeekStart(getMonday(new Date()));
  };

  const handleSelectedDateChange = (value) => {
    setSelectedDate(value);

    const slots = getTimeSlotsForDate(scheduleSettings, value);
    if (!slots.includes(selectedTime)) {
      setSelectedTime("");
    }

    const date = parseInputDate(value);
    if (date) {
      const weekday = getIsoWeekday(date);
      const workingHours = getWorkingHoursForWeekday(scheduleSettings, weekday);
      if (workingHours?.isWorking) {
        setRecurringWeekday(String(weekday));
      }
    }
  };

  const handleRecurringWeekdayChange = (value) => {
    setRecurringWeekday(value);
    const slots = getTimeSlotsForWeekday(scheduleSettings, Number(value));
    if (!slots.includes(selectedTime)) {
      setSelectedTime("");
    }
  };

  const handleSeriesWeekdayChange = (value) => {
    setSeriesWeekday(value);
    const slots = getTimeSlotsForWeekday(scheduleSettings, Number(value));
    if (!slots.includes(seriesTime)) {
      setSeriesTime("");
    }
  };

  const handleEditLessonDateChange = (value) => {
    setEditLessonDate(value);
    const slots = getTimeSlotsForDate(scheduleSettings, value);
    if (!slots.includes(editLessonTime)) {
      setEditLessonTime("");
    }
  };

  const handleBlockDateChange = (value) => {
    setBlockDate(value);

    const startSlots = getBlockStartSlotsForDate(scheduleSettings, value);
    const nextStart = startSlots.includes(blockStartTime) ? blockStartTime : "";
    setBlockStartTime(nextStart);

    const endSlots = getBlockEndSlotsForDate(
      scheduleSettings,
      value,
      nextStart,
    );
    setBlockEndTime((current) =>
      endSlots.includes(current) ? current : endSlots[0] || "",
    );
  };

  const handleBlockStartTimeChange = (value) => {
    setBlockStartTime(value);
    const endSlots =
      blockRepeatMode === "recurring"
        ? getBlockEndSlotsForWeekday(
            scheduleSettings,
            Number(blockRecurringWeekday),
            value,
          )
        : getBlockEndSlotsForDate(scheduleSettings, blockDate, value);
    setBlockEndTime((current) =>
      endSlots.includes(current) ? current : endSlots[0] || "",
    );
  };

  const handleBlockRecurringWeekdayChange = (value) => {
    setBlockRecurringWeekday(value);
    const startSlots = getBlockStartSlotsForWeekday(scheduleSettings, Number(value));
    const nextStart = startSlots.includes(blockStartTime) ? blockStartTime : startSlots[0] || "";
    setBlockStartTime(nextStart);
    const endSlots = getBlockEndSlotsForWeekday(
      scheduleSettings,
      Number(value),
      nextStart,
    );
    setBlockEndTime((current) =>
      endSlots.includes(current) ? current : endSlots[0] || "",
    );
  };

  const handleBlockSeriesWeekdayChange = (value) => {
    setBlockSeriesWeekday(value);
    const startSlots = getBlockStartSlotsForWeekday(scheduleSettings, Number(value));
    const nextStart = startSlots.includes(blockSeriesStartTime)
      ? blockSeriesStartTime
      : startSlots[0] || "";
    setBlockSeriesStartTime(nextStart);
    const endSlots = getBlockEndSlotsForWeekday(
      scheduleSettings,
      Number(value),
      nextStart,
    );
    setBlockSeriesEndTime((current) =>
      endSlots.includes(current) ? current : endSlots[0] || "",
    );
  };

  const handleBlockSeriesStartTimeChange = (value) => {
    setBlockSeriesStartTime(value);
    const endSlots = getBlockEndSlotsForWeekday(
      scheduleSettings,
      Number(blockSeriesWeekday),
      value,
    );
    setBlockSeriesEndTime((current) =>
      endSlots.includes(current) ? current : endSlots[0] || "",
    );
  };

  const handleSlotClick = (date, slot) => {
    const weekday = getIsoWeekday(date);
    const workingHours = getWorkingHoursForWeekday(scheduleSettings, weekday);
    const slotDuration =
      createMode === "block"
        ? scheduleSettings.slotIntervalMinutes
        : scheduleSettings.lessonDurationMinutes;
    const blockedByLesson = isSlotBlockedByLesson(
      date,
      slot,
      lessons,
      scheduleTimezone,
      slotDuration,
    );
    const blockedByScheduleBlock = isSlotBlockedByScheduleBlock(
      date,
      slot,
      scheduleBlocks,
      scheduleTimezone,
      slotDuration,
    );

    if (!workingHours?.isWorking || blockedByLesson || blockedByScheduleBlock) {
      return;
    }

    setSelectedLesson(null);
    setSelectedBlock(null);
    setSearchParams({}, { replace: true });

    const dateValue = formatDateForInput(date);

    setSelectedDate(dateValue);
    setSelectedTime(slot);
    setRecurringWeekday(String(weekday));
    setRecurringValidFrom(dateValue);

    setBlockDate(dateValue);
    setBlockStartTime(slot);
    const nextBlockEndSlots = getBlockEndSlotsForDate(
      scheduleSettings,
      dateValue,
      slot,
    );
    setBlockEndTime(nextBlockEndSlots[0] || "");
    setBlockReason("");
    setBlockRecurringWeekday(String(weekday));
    setBlockRecurringValidFrom(dateValue);

    setCreateErrorMessage("");
    setDetailErrorMessage("");

    requestAnimationFrame(() => {
      document.getElementById("lesson-create-form")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const handleLessonClick = (event, lesson) => {
    event.stopPropagation();

    setSelectedLesson(lesson);
    setSelectedBlock(null);
    setSearchParams({ lessonId: lesson.id }, { replace: true });
    setEditingBlock(false);
    setLessonMeetingUrlDraft(lesson.meeting_url || "");
    setEditingMeetingUrl(false);
    setEditingLesson(false);
    setEditingRecurringSeries(false);
    setDetailErrorMessage("");

    requestAnimationFrame(() => {
      document.getElementById("lesson-details-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const populateBlockDraft = (block) => {
    const start = getDatePartsInTimezone(block.starts_at, scheduleTimezone);
    const end = getDatePartsInTimezone(block.ends_at, scheduleTimezone);
    const dateValue = `${start.year}-${pad(start.month)}-${pad(start.day)}`;

    setBlockDate(dateValue);
    setBlockStartTime(`${pad(start.hour)}:${pad(start.minute)}`);
    setBlockEndTime(`${pad(end.hour)}:${pad(end.minute)}`);
    setBlockReason(block.reason || "");
  };

  const handleBlockClick = (event, block) => {
    event.stopPropagation();

    setSelectedBlock(block);
    setSelectedLesson(null);
    setSearchParams({}, { replace: true });
    setEditingBlock(false);
    setEditingRecurringBlockSeries(false);
    setEditingMeetingUrl(false);
    setEditingLesson(false);
    setEditingRecurringSeries(false);
    setDetailErrorMessage("");

    requestAnimationFrame(() => {
      document.getElementById("lesson-details-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const handleStartEditBlock = () => {
    if (!selectedBlock || selectedBlock.recurring_block_series_id) return;

    populateBlockDraft(selectedBlock);
    setBlockRepeatMode("single");
    setEditingBlock(true);
    setDetailErrorMessage("");
  };

  const handleCreateScheduleBlock = async (event) => {
    event.preventDefault();
    setCreateErrorMessage("");

    const isRecurring = blockRepeatMode === "recurring";

    if (
      !blockStartTime ||
      !blockEndTime ||
      (isRecurring
        ? !blockRecurringWeekday || !blockRecurringValidFrom
        : !blockDate)
    ) {
      setCreateErrorMessage(
        t("teacherSchedule.scheduleBlock.errors.requiredFields"),
      );
      return;
    }

    try {
      setSavingBlock(true);

      if (isRecurring) {
        const { data, error } = await createRecurringScheduleBlockWithGeneration({
          p_weekday: Number(blockRecurringWeekday),
          p_start_time: blockStartTime,
          p_end_time: blockEndTime,
          p_valid_from: blockRecurringValidFrom,
          p_valid_until: blockRecurringValidUntil || null,
          p_reason: blockReason.trim() || null,
          p_interval_weeks: Number(blockRecurringIntervalWeeks),
        });

        if (error) throw error;

        const result = Array.isArray(data) ? data[0] : data;
        const createdCount = result?.created_count ?? 0;
        const conflictCount = result?.conflict_count ?? 0;

        const message =
          conflictCount > 0
            ? t("teacherSchedule.scheduleBlock.recurring.messages.createdWithConflicts", {
                createdCount,
                conflictCount,
              })
            : t("teacherSchedule.scheduleBlock.recurring.messages.created", {
                createdCount,
              });
        if (conflictCount > 0) toast.warning(message);
        else toast.success(message);
        setBlockRecurringValidUntil("");
      } else {
        const { error } = await createScheduleBlock({
          blockDate,
          startTime: blockStartTime,
          endTime: blockEndTime,
          reason: blockReason.trim() || null,
        });

        if (error) throw error;
        toast.success(t("teacherSchedule.scheduleBlock.messages.created"));
      }

      setBlockReason("");
      setSelectedBlock(null);
      await loadLessons();
    } catch (error) {
      console.error("Create schedule block error:", error);
      toast.error(getScheduleBlockError(error, t));
    } finally {
      setSavingBlock(false);
    }
  };

  const handleSaveScheduleBlock = async () => {
    if (!selectedBlock || !blockDate || !blockStartTime || !blockEndTime) {
      return;
    }

    try {
      setSavingBlock(true);
      setDetailErrorMessage("");

      const { error } = await updateScheduleBlock({
        blockId: selectedBlock.id,
        blockDate,
        startTime: blockStartTime,
        endTime: blockEndTime,
        reason: blockReason.trim() || null,
      });

      if (error) throw error;

      setEditingBlock(false);
      setSelectedBlock(null);
      toast.success(t("teacherSchedule.scheduleBlock.messages.updated"));
      await loadLessons();
    } catch (error) {
      console.error("Update schedule block error:", error);
      toast.error(getScheduleBlockError(error, t));
    } finally {
      setSavingBlock(false);
    }
  };

  const handleDeleteScheduleBlock = async () => {
    if (!selectedBlock) return;

    const confirmed = window.confirm(
      t(
        selectedBlock.recurring_block_series_id
          ? "teacherSchedule.scheduleBlock.recurring.deleteOccurrenceConfirm"
          : "teacherSchedule.scheduleBlock.deleteConfirm",
      ),
    );

    if (!confirmed) return;

    try {
      setDeletingBlockId(selectedBlock.id);
      setDetailErrorMessage("");

      const { error } = await deleteScheduleBlock(selectedBlock.id);
      if (error) throw error;

      setSelectedBlock(null);
      setEditingBlock(false);
      toast.success(
        t(
          selectedBlock.recurring_block_series_id
            ? "teacherSchedule.scheduleBlock.recurring.messages.occurrenceDeleted"
            : "teacherSchedule.scheduleBlock.messages.deleted",
        ),
      );
      await loadLessons();
    } catch (error) {
      console.error("Delete schedule block error:", error);
      toast.error(getScheduleBlockError(error, t));
    } finally {
      setDeletingBlockId(null);
    }
  };

  const handleStartEditRecurringBlockSeries = async () => {
    if (!selectedBlock?.recurring_block_series_id) return;

    try {
      setLoadingRecurringBlockSeries(true);
      setDetailErrorMessage("");

      const { data, error } = await getRecurringScheduleBlockSeriesById(
        selectedBlock.recurring_block_series_id,
      );
      if (error) throw error;

      const weekday = Number(data.weekday);
      const startTime = data.start_time?.slice(0, 5) || "";
      const endTime = data.end_time?.slice(0, 5) || "";
      const availableStarts = getBlockStartSlotsForWeekday(
        scheduleSettings,
        weekday,
      );
      const availableEnds = getBlockEndSlotsForWeekday(
        scheduleSettings,
        weekday,
        startTime,
      );
      const firstWorkingDay = scheduleSettings.workingHours.find(
        (item) => item.isWorking,
      );

      if (availableStarts.includes(startTime) && availableEnds.includes(endTime)) {
        setBlockSeriesWeekday(String(weekday));
        setBlockSeriesStartTime(startTime);
        setBlockSeriesEndTime(endTime);
      } else if (firstWorkingDay) {
        const fallbackStarts = getBlockStartSlotsForWeekday(
          scheduleSettings,
          firstWorkingDay.weekday,
        );
        const fallbackStart = fallbackStarts[0] || "";
        const fallbackEnds = getBlockEndSlotsForWeekday(
          scheduleSettings,
          firstWorkingDay.weekday,
          fallbackStart,
        );
        setBlockSeriesWeekday(String(firstWorkingDay.weekday));
        setBlockSeriesStartTime(fallbackStart);
        setBlockSeriesEndTime(fallbackEnds[0] || "");
      } else {
        setBlockSeriesWeekday("");
        setBlockSeriesStartTime("");
        setBlockSeriesEndTime("");
      }
      setBlockSeriesIntervalWeeks(String(data.interval_weeks ?? 1));
      setBlockSeriesValidUntil(data.valid_until || "");
      setBlockSeriesReason(data.reason || "");
      setEditingRecurringBlockSeries(true);
      setEditingBlock(false);
    } catch (error) {
      console.error("Load recurring block series error:", error);
      setDetailErrorMessage(getScheduleBlockError(error, t));
    } finally {
      setLoadingRecurringBlockSeries(false);
    }
  };

  const handleSaveRecurringBlockSeries = async () => {
    if (
      !selectedBlock?.recurring_block_series_id ||
      !blockSeriesWeekday ||
      !blockSeriesStartTime ||
      !blockSeriesEndTime
    ) {
      return;
    }

    const confirmed = window.confirm(
      t("teacherSchedule.scheduleBlock.recurring.editFromHere.confirm"),
    );
    if (!confirmed) return;

    try {
      setSavingRecurringBlockSeries(true);
      setDetailErrorMessage("");

      const { data, error } = await editRecurringScheduleBlockSeriesFromBlock({
        p_block_id: selectedBlock.id,
        p_weekday: Number(blockSeriesWeekday),
        p_start_time: blockSeriesStartTime,
        p_end_time: blockSeriesEndTime,
        p_interval_weeks: Number(blockSeriesIntervalWeeks),
        p_valid_until: blockSeriesValidUntil || null,
        p_reason: blockSeriesReason.trim() || null,
      });
      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;
      const conflictCount = result?.conflict_count ?? 0;
      const message = t("teacherSchedule.scheduleBlock.recurring.editFromHere.success", {
        createdCount: result?.created_count ?? 0,
        conflictCount,
      });
      if (conflictCount > 0) toast.warning(message);
      else toast.success(message);
      setEditingRecurringBlockSeries(false);
      setSelectedBlock(null);
      await loadLessons();
    } catch (error) {
      console.error("Edit recurring block series error:", error);
      toast.error(getScheduleBlockError(error, t));
    } finally {
      setSavingRecurringBlockSeries(false);
    }
  };

  const handleCancelRecurringBlockSeriesFromBlock = async () => {
    if (!selectedBlock?.recurring_block_series_id) return;

    const confirmed = window.confirm(
      t("teacherSchedule.scheduleBlock.recurring.cancelFromHere.confirm"),
    );
    if (!confirmed) return;

    try {
      setCancellingRecurringBlockSeriesId(selectedBlock.recurring_block_series_id);
      setDetailErrorMessage("");

      const { data, error } = await cancelRecurringScheduleBlockSeriesFromBlock(
        selectedBlock.id,
      );
      if (error) throw error;

      toast.success(
        t("teacherSchedule.scheduleBlock.recurring.cancelFromHere.success", {
          count: data ?? 0,
        }),
      );
      setSelectedBlock(null);
      setEditingRecurringBlockSeries(false);
      await loadLessons();
    } catch (error) {
      console.error("Cancel recurring block series error:", error);
      toast.error(getScheduleBlockError(error, t));
    } finally {
      setCancellingRecurringBlockSeriesId(null);
    }
  };

  const handleStartEditLesson = () => {
    if (
      !selectedLesson ||
      selectedLesson.status !== "scheduled" ||
      isLessonStarted(selectedLesson)
    ) {
      return;
    }

    const startParts = getDatePartsInTimezone(
      selectedLesson.starts_at,
      scheduleTimezone,
    );

    setEditLessonDate(
      `${startParts.year}-${pad(startParts.month)}-${pad(startParts.day)}`,
    );
    setEditLessonMinDate(
      formatZonedDateForInput(new Date().toISOString(), scheduleTimezone),
    );
    const currentTime = `${pad(startParts.hour)}:${pad(startParts.minute)}`;
    const currentDate = `${startParts.year}-${pad(startParts.month)}-${pad(startParts.day)}`;
    const availableSlots = getTimeSlotsForDate(scheduleSettings, currentDate);
    setEditLessonTime(availableSlots.includes(currentTime) ? currentTime : "");
    setEditLessonMeetingUrl(selectedLesson.meeting_url || "");
    setEditingMeetingUrl(false);
    setEditingRecurringSeries(false);
    setEditingLesson(true);
    setDetailErrorMessage("");
  };

  const handleSaveLesson = async () => {
    if (
      !selectedLesson ||
      selectedLesson.status !== "scheduled" ||
      !editLessonDate ||
      !editLessonTime
    ) {
      return;
    }

    try {
      setSavingLesson(true);
      setDetailErrorMessage("");

      const normalizedMeetingUrl = editLessonMeetingUrl.trim() || null;

      const { error } = await updateLessonSchedule({
        lessonId: selectedLesson.id,
        lessonDate: editLessonDate,
        startTime: editLessonTime,
        meetingUrl: normalizedMeetingUrl,
      });

      if (error) {
        throw error;
      }

      setEditingLesson(false);
      setSelectedLesson(null);
      setSearchParams({}, { replace: true });
      toast.success(t("teacherSchedule.lessonEdit.success"));
      await loadLessons();
    } catch (error) {
      console.error("Update lesson schedule error:", error);
      toast.error(getUpdateLessonScheduleError(error, t));
    } finally {
      setSavingLesson(false);
    }
  };

  const handleCancelLesson = async () => {
    if (!selectedLesson || selectedLesson.status !== "scheduled") {
      return;
    }

    const confirmed = window.confirm(
      t("teacherSchedule.cancel.confirm"),
    );

    if (!confirmed) {
      return;
    }

    try {
      setCancellingLessonId(selectedLesson.id);
      setDetailErrorMessage("");

      const { error } = await cancelLesson({
        lessonId: selectedLesson.id,
      });

      if (error) {
        throw error;
      }

      toast.success(t("teacherSchedule.cancel.success"));

      setSelectedLesson(null);
      setSearchParams({}, { replace: true });

      await loadLessons();
    } catch (error) {
      console.error("Cancel lesson error:", error);
      toast.error(getCancelLessonError(error, t));
    } finally {
      setCancellingLessonId(null);
    }
  };

  const handleStartEditRecurringSeries = async () => {
    if (!selectedLesson?.recurring_lesson_id) {
      return;
    }

    try {
      setLoadingRecurringSeries(true);
      setDetailErrorMessage("");

      const { data, error } = await getRecurringLessonById(
        selectedLesson.recurring_lesson_id,
      );

      if (error) {
        throw error;
      }

      const currentWeekday = Number(data.weekday);
      const currentTime = data.start_time?.slice(0, 5) || "";
      const availableSlots = getTimeSlotsForWeekday(
        scheduleSettings,
        currentWeekday,
      );
      const firstWorkingDay = scheduleSettings.workingHours.find(
        (item) => item.isWorking,
      );

      if (availableSlots.includes(currentTime)) {
        setSeriesWeekday(String(currentWeekday));
        setSeriesTime(currentTime);
      } else {
        setSeriesWeekday(
          firstWorkingDay ? String(firstWorkingDay.weekday) : "",
        );
        setSeriesTime("");
      }
      setSeriesIntervalWeeks(String(data.interval_weeks ?? 1));
      setSeriesValidUntil(data.valid_until || "");
      setSeriesMeetingUrl(data.meeting_url || "");
      setEditingRecurringSeries(true);
      setEditingMeetingUrl(false);
    } catch (error) {
      console.error("Load recurring series error:", error);
      setDetailErrorMessage(t("teacherSchedule.recurring.editFromHere.errors.load"));
    } finally {
      setLoadingRecurringSeries(false);
    }
  };

  const handleSaveRecurringSeries = async () => {
    if (
      !selectedLesson?.recurring_lesson_id ||
      selectedLesson.status !== "scheduled" ||
      !seriesWeekday ||
      !seriesTime
    ) {
      return;
    }

    if (
      !scheduleSettings.allowOpenEndedRecurringLessons &&
      !seriesValidUntil
    ) {
      setDetailErrorMessage(t("teacherSchedule.recurring.errors.endDateRequired"));
      return;
    }

    const confirmed = window.confirm(
      t("teacherSchedule.recurring.editFromHere.confirm"),
    );

    if (!confirmed) {
      return;
    }

    try {
      setSavingRecurringSeries(true);
      setDetailErrorMessage("");

      const { data, error } = await editRecurringSeriesFromLesson({
        p_lesson_id: selectedLesson.id,
        p_weekday: Number(seriesWeekday),
        p_start_time: seriesTime,
        p_interval_weeks: Number(seriesIntervalWeeks),
        p_valid_until: seriesValidUntil || null,
        p_meeting_url: seriesMeetingUrl.trim() || null,
      });

      if (error) {
        throw error;
      }

      const result = Array.isArray(data) ? data[0] : data;

      const conflictCount = result?.conflict_count ?? 0;
      const message = t("teacherSchedule.recurring.editFromHere.success", {
        createdCount: result?.created_count ?? 0,
        conflictCount,
      });
      if (conflictCount > 0) toast.warning(message);
      else toast.success(message);

      setEditingRecurringSeries(false);
      setSelectedLesson(null);
      setSearchParams({}, { replace: true });
      await loadLessons();
    } catch (error) {
      console.error("Edit recurring series error:", error);
      toast.error(getEditRecurringSeriesError(error, t));
    } finally {
      setSavingRecurringSeries(false);
    }
  };

  const handleCancelRecurringSeriesFromLesson = async () => {
    if (
      !selectedLesson ||
      !selectedLesson.recurring_lesson_id ||
      selectedLesson.status !== "scheduled"
    ) {
      return;
    }

    const confirmed = window.confirm(
      t("teacherSchedule.recurring.cancelFromHere.confirm"),
    );

    if (!confirmed) {
      return;
    }

    try {
      setCancellingSeriesId(selectedLesson.recurring_lesson_id);
      setDetailErrorMessage("");

      const { data, error } = await cancelRecurringSeriesFromLesson(
        selectedLesson.id,
      );

      if (error) {
        throw error;
      }

      toast.success(
        t("teacherSchedule.recurring.cancelFromHere.success", {
          count: data ?? 0,
        }),
      );

      setSelectedLesson(null);
      setSearchParams({}, { replace: true });
      await loadLessons();
    } catch (error) {
      console.error("Cancel recurring series error:", error);
      toast.error(getCancelRecurringSeriesError(error, t));
    } finally {
      setCancellingSeriesId(null);
    }
  };

  const handleSaveLessonMeetingUrl = async () => {
    if (!selectedLesson || selectedLesson.status === "cancelled") {
      return;
    }

    try {
      setSavingMeetingUrl(true);
      setDetailErrorMessage("");

      const normalizedMeetingUrl = lessonMeetingUrlDraft.trim() || null;

      const { error } = await updateLessonMeetingUrl({
        lessonId: selectedLesson.id,
        meetingUrl: normalizedMeetingUrl,
      });

      if (error) {
        throw error;
      }

      setSelectedLesson((current) =>
        current
          ? {
              ...current,
              meeting_url: normalizedMeetingUrl,
            }
          : current,
      );

      setEditingMeetingUrl(false);
      toast.success(t("teacherSchedule.meetingLinkEdit.success"));
      await loadLessons();
    } catch (error) {
      console.error("Update lesson meeting link error:", error);
      toast.error(getUpdateLessonMeetingUrlError(error, t));
    } finally {
      setSavingMeetingUrl(false);
    }
  };


  const handleSetLessonOutcome = async (status) => {
    if (!selectedLesson || selectedLesson.status === "cancelled") {
      return;
    }

    try {
      setUpdatingOutcome(true);
      setDetailErrorMessage("");

      const { error } = await setLessonOutcome({
        lessonId: selectedLesson.id,
        status,
      });

      if (error) {
        throw error;
      }

      setSelectedLesson((current) =>
        current
          ? {
              ...current,
              status,
              completed_at: status === "completed" ? new Date().toISOString() : null,
              missed_at: status === "missed" ? new Date().toISOString() : null,
            }
          : current,
      );

      toast.success(
        status === "completed"
          ? t("teacherSchedule.outcome.completedSuccess")
          : t("teacherSchedule.outcome.missedSuccess"),
      );

      await loadLessons();
    } catch (error) {
      console.error("Set lesson outcome error:", error);
      toast.error(getLessonOutcomeError(error, t));
    } finally {
      setUpdatingOutcome(false);
    }
  };

  const handleCreateLesson = async (event) => {
    event.preventDefault();

    setCreateErrorMessage("");

    if (!selectedStudentId || !selectedDate || !selectedTime) {
      setCreateErrorMessage(t("teacherSchedule.errors.requiredFields"));

      return;
    }

    try {
      setCreating(true);

      const { error } = await createLesson({
        studentId: selectedStudentId,
        lessonDate: selectedDate,
        startTime: selectedTime,
        meetingUrl: meetingUrl.trim() || null,
      });

      if (error) {
        throw error;
      }

      toast.success(t("teacherSchedule.messages.lessonCreated"));

      setSelectedStudentId("");

      setMeetingUrl("");

      setSelectedLesson(null);
      setSearchParams({}, { replace: true });

      await loadLessons();
    } catch (error) {
      console.error("Create lesson error:", error);

      toast.error(getCreateLessonError(error, t));
    } finally {
      setCreating(false);
    }
  };

  const handleCreateModeChange = (mode) => {
    setCreateMode(mode);
    setCreateErrorMessage("");

    if (mode === "recurring" && selectedDate) {
      const date = parseInputDate(selectedDate);

      if (date) {
        const weekday = getIsoWeekday(date);
        const workingHours = getWorkingHoursForWeekday(
          scheduleSettings,
          weekday,
        );

        if (workingHours?.isWorking) {
          setRecurringWeekday(String(weekday));
          setRecurringValidFrom((current) => current || selectedDate);
        }
      }
    }

    if (mode === "block" && selectedDate) {
      const date = parseInputDate(selectedDate);
      const weekday = date ? getIsoWeekday(date) : null;
      const startSlots = getBlockStartSlotsForDate(
        scheduleSettings,
        selectedDate,
      );
      const nextStart = startSlots.includes(selectedTime) ? selectedTime : "";

      setBlockDate(selectedDate);
      setBlockStartTime(nextStart);
      setBlockRecurringValidFrom((current) => current || selectedDate);
      if (weekday) setBlockRecurringWeekday(String(weekday));

      const endSlots = getBlockEndSlotsForDate(
        scheduleSettings,
        selectedDate,
        nextStart,
      );
      setBlockEndTime(endSlots[0] || "");
    }
  };

  const handleBlockRepeatModeChange = (mode) => {
    setBlockRepeatMode(mode);
    setCreateErrorMessage("");

    if (mode === "recurring") {
      const startSlots = getBlockStartSlotsForWeekday(
        scheduleSettings,
        Number(blockRecurringWeekday),
      );
      const nextStart = startSlots.includes(blockStartTime)
        ? blockStartTime
        : startSlots[0] || "";
      setBlockStartTime(nextStart);
      const endSlots = getBlockEndSlotsForWeekday(
        scheduleSettings,
        Number(blockRecurringWeekday),
        nextStart,
      );
      setBlockEndTime((current) =>
        endSlots.includes(current) ? current : endSlots[0] || "",
      );
      setBlockRecurringValidFrom((current) => current || blockDate || selectedDate);
    } else {
      const startSlots = getBlockStartSlotsForDate(scheduleSettings, blockDate);
      const nextStart = startSlots.includes(blockStartTime)
        ? blockStartTime
        : startSlots[0] || "";
      setBlockStartTime(nextStart);
      const endSlots = getBlockEndSlotsForDate(scheduleSettings, blockDate, nextStart);
      setBlockEndTime((current) =>
        endSlots.includes(current) ? current : endSlots[0] || "",
      );
    }
  };

  const handleCreateRecurringLesson = async (event) => {
    event.preventDefault();

    setCreateErrorMessage("");

    if (
      !selectedStudentId ||
      !recurringWeekday ||
      !selectedTime ||
      !recurringValidFrom
    ) {
      setCreateErrorMessage(t("teacherSchedule.recurring.errors.requiredFields"));
      return;
    }

    if (
      !scheduleSettings.allowOpenEndedRecurringLessons &&
      !recurringValidUntil
    ) {
      setCreateErrorMessage(t("teacherSchedule.recurring.errors.endDateRequired"));
      return;
    }

    try {
      setCreating(true);

      const { data, error } = await createRecurringLessonWithGeneration({
        p_student_id: selectedStudentId,
        p_weekday: Number(recurringWeekday),
        p_start_time: selectedTime,
        p_valid_from: recurringValidFrom,
        p_valid_until: recurringValidUntil || null,
        p_meeting_url: meetingUrl.trim() || null,
        p_interval_weeks: Number(recurringIntervalWeeks),
      });

      if (error) {
        throw error;
      }

      const result = Array.isArray(data) ? data[0] : data;
      const createdCount = result?.created_count ?? 0;
      const conflictCount = result?.conflict_count ?? 0;

      const message =
        conflictCount > 0
          ? t("teacherSchedule.recurring.messages.createdWithConflicts", {
              createdCount,
              conflictCount,
            })
          : t("teacherSchedule.recurring.messages.created", {
              createdCount,
            });
      if (conflictCount > 0) toast.warning(message);
      else toast.success(message);

      setSelectedStudentId("");
      setRecurringValidUntil("");
      setMeetingUrl("");
      setSelectedLesson(null);
      setSearchParams({}, { replace: true });

      await loadLessons();
    } catch (error) {
      console.error("Create recurring lesson error:", error);
      toast.error(getCreateRecurringLessonError(error, t));
    } finally {
      setCreating(false);
    }
  };

  const getBlocksForDay = (date) => {
    const dayKey = formatDateForInput(date);

    return displayedScheduleBlocks.filter((block) => {
      const blockDate = getDatePartsInTimezone(
        block.starts_at,
        scheduleTimezone,
      );

      return (
        `${blockDate.year}-${pad(blockDate.month)}-${pad(blockDate.day)}` ===
        dayKey
      );
    });
  };

  const getLessonsForDay = (date) => {
    const dayKey = formatDateForInput(date);

    return displayedLessons.filter((lesson) => {
      if (lesson.status === "cancelled") {
        const hasPendingLatePaymentDecision =
          lesson.cancelled_by === "student" &&
          Boolean(lesson.cancellation_request_id) &&
          lesson.cancellation_charge_mode == null;

        if (
          lesson.cancellation_charge_mode !== "charged" &&
          !hasPendingLatePaymentDecision
        ) {
          return false;
        }
      }

      const lessonDate = getDatePartsInTimezone(
        lesson.starts_at,
        scheduleTimezone,
      );

      return (
        `${lessonDate.year}-${pad(lessonDate.month)}-${pad(lessonDate.day)}` ===
        dayKey
      );
    });
  };

  if (loading) {
    return (
      <section className={styles.page}>
        <div className={styles.state}>{t("teacherSchedule.loading")}</div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{t("teacherSchedule.title")}</h1>

          <p>{t("teacherSchedule.description")}</p>
        </div>

        <div className={styles.timezoneBadge}>
          <span>{t("teacherSchedule.timezone")}</span>

          <strong>{timezoneLabel}</strong>
        </div>
      </header>

      {pageErrorMessage && (
        <p className={styles.error}>{pageErrorMessage}</p>
      )}

      <div className={styles.settingsSummary}>
        <span>{t("teacherSchedule.weeklyAvailability")}</span>

        <span>
          {t("teacherSchedule.lessonDuration", {
            count: scheduleSettings.lessonDurationMinutes,
          })}
        </span>
      </div>

      <div className={styles.calendarToolbar}>
        <div className={styles.weekNavigation}>
          <button
            type="button"
            className={styles.navigationButton}
            onClick={handlePreviousWeek}
            aria-label={t("teacherSchedule.previousWeek")}
          >
            ←
          </button>

          <button
            type="button"
            className={styles.todayButton}
            onClick={handleCurrentWeek}
          >
            {t("teacherSchedule.today")}
          </button>

          <button
            type="button"
            className={styles.navigationButton}
            onClick={handleNextWeek}
            aria-label={t("teacherSchedule.nextWeek")}
          >
            →
          </button>
        </div>

        <strong className={styles.weekRange}>
          {formatWeekRange(weekStart, locale)}
        </strong>
      </div>

      <div className={styles.calendarScroll}>
        <div className={styles.calendar}>
          <div className={styles.calendarHeader}>
            <div className={styles.timeHeader} />

            {weekDays.map((date, index) => {
              const today = isSameCalendarDate(date, new Date());
              const workingHours = getWorkingHoursForWeekday(
                scheduleSettings,
                getIsoWeekday(date),
              );

              return (
                <div
                  key={DAY_NAMES[index]}
                  className={`${styles.dayHeader} ${
                    today ? styles.todayHeader : ""
                  } ${!workingHours?.isWorking ? styles.nonWorkingHeader : ""}`}
                >
                  <span>{t(`teacherSchedule.days.${DAY_NAMES[index]}`)}</span>

                  <strong>
                    {new Intl.DateTimeFormat(locale, {
                      day: "2-digit",
                      month: "2-digit",
                    }).format(date)}
                  </strong>
                </div>
              );
            })}
          </div>

          <div className={styles.calendarBody}>
            <div
              className={styles.timeColumn}
              style={{
                height: calendarHeight,
              }}
            >
              {displayTimeSlots.map((slot) => {
                const top =
                  CALENDAR_TOP_PADDING +
                  (timeToMinutes(slot) - calendarStartMinutes) *
                    PIXELS_PER_MINUTE;

                return (
                  <span
                    key={slot}
                    className={styles.timeLabel}
                    style={{
                      top: `${top}px`,
                    }}
                  >
                    {slot}
                  </span>
                );
              })}

              <span
                className={styles.endTimeLabel}
                style={{ top: `${calendarEndTop}px` }}
              >
                {calendarEnd}
              </span>
            </div>

            {weekDays.map((date) => {
              const dayLessons = getLessonsForDay(date);
              const dayBlocks = getBlocksForDay(date);
              const today = isSameCalendarDate(date, new Date());
              const weekday = getIsoWeekday(date);
              const workingHours = getWorkingHoursForWeekday(
                scheduleSettings,
                weekday,
              );
              const dayTimeSlots =
                createMode === "block"
                  ? getBlockStartSlotsForWeekday(scheduleSettings, weekday)
                  : getTimeSlotsForWeekday(scheduleSettings, weekday);
              const workingStartTop = workingHours?.isWorking
                ? CALENDAR_TOP_PADDING +
                  (timeToMinutes(workingHours.workdayStart) -
                    calendarStartMinutes) *
                    PIXELS_PER_MINUTE
                : CALENDAR_TOP_PADDING;
              const workingEndTop = workingHours?.isWorking
                ? CALENDAR_TOP_PADDING +
                  (timeToMinutes(workingHours.workdayEnd) -
                    calendarStartMinutes) *
                    PIXELS_PER_MINUTE
                : calendarEndTop;

              return (
                <div
                  key={date.toISOString()}
                  className={`${styles.dayColumn} ${
                    today ? styles.todayColumn : ""
                  } ${!workingHours?.isWorking ? styles.nonWorkingDay : ""}`}
                  style={{
                    height: calendarHeight,
                  }}
                >
                  {displayTimeSlots.map((slot) => {
                    const top =
                      CALENDAR_TOP_PADDING +
                      (timeToMinutes(slot) - calendarStartMinutes) *
                        PIXELS_PER_MINUTE;

                    return (
                      <div
                        key={`line-${slot}`}
                        className={styles.gridLine}
                        style={{
                          top: `${top}px`,
                        }}
                      />
                    );
                  })}

                  <div
                    className={`${styles.gridLine} ${styles.endGridLine}`}
                    style={{ top: `${calendarEndTop}px` }}
                  />

                  {workingHours?.isWorking && workingStartTop > CALENDAR_TOP_PADDING && (
                    <div
                      className={styles.unavailableRange}
                      style={{
                        top: `${CALENDAR_TOP_PADDING}px`,
                        height: `${workingStartTop - CALENDAR_TOP_PADDING}px`,
                      }}
                    />
                  )}

                  {workingHours?.isWorking && workingEndTop < calendarEndTop && (
                    <div
                      className={styles.unavailableRange}
                      style={{
                        top: `${workingEndTop}px`,
                        height: `${calendarEndTop - workingEndTop}px`,
                      }}
                    />
                  )}

                  {dayTimeSlots.map((slot) => {
                    const top =
                      CALENDAR_TOP_PADDING +
                      (timeToMinutes(slot) - calendarStartMinutes) *
                        PIXELS_PER_MINUTE;

                    const height =
                      scheduleSettings.slotIntervalMinutes * PIXELS_PER_MINUTE;

                    const slotDuration =
                      createMode === "block"
                        ? scheduleSettings.slotIntervalMinutes
                        : scheduleSettings.lessonDurationMinutes;
                    const blocked =
                      isSlotBlockedByLesson(
                        date,
                        slot,
                        dayLessons,
                        scheduleTimezone,
                        slotDuration,
                      ) ||
                      isSlotBlockedByScheduleBlock(
                        date,
                        slot,
                        dayBlocks,
                        scheduleTimezone,
                        slotDuration,
                      );

                    return (
                      <button
                        key={slot}
                        type="button"
                        className={`${styles.slot} ${
                          blocked ? styles.blockedSlot : ""
                        }`}
                        style={{
                          top: `${top}px`,
                          height: `${height}px`,
                        }}
                        disabled={blocked}
                        onClick={() => handleSlotClick(date, slot)}
                        aria-label={`${formatDateForInput(date)} ${slot}`}
                      />
                    );
                  })}

                  {dayBlocks.map((block) => {
                    const position = getScheduleBlockPosition(
                      block,
                      scheduleTimezone,
                      calendarStartMinutes,
                    );

                    const blockContent = (
                      <>
                        <strong className={styles.scheduleBlockTime}>
                          {formatLessonTime(
                            block.starts_at,
                            locale,
                            scheduleTimezone,
                          )}
                          {" — "}
                          {formatLessonTime(
                            block.ends_at,
                            locale,
                            scheduleTimezone,
                          )}
                        </strong>
                        <span className={styles.scheduleBlockLabel}>
                          🔒 {t("teacherSchedule.scheduleBlock.label")}
                        </span>
                        {block.reason && (
                          <span className={styles.scheduleBlockReason}>
                            {block.reason}
                          </span>
                        )}
                      </>
                    );

                    if (block.isProjectedRecurring) {
                      return (
                        <button
                          key={block.id}
                          type="button"
                          aria-disabled="true"
                          tabIndex={-1}
                          className={`${styles.scheduleBlock} ${styles.projectedOccurrence}`}
                          style={{
                            top: `${position.top}px`,
                            height: `${position.height}px`,
                          }}
                        >
                          {blockContent}
                        </button>
                      );
                    }

                    return (
                      <button
                        key={block.id}
                        type="button"
                        className={styles.scheduleBlock}
                        style={{
                          top: `${position.top}px`,
                          height: `${position.height}px`,
                        }}
                        onClick={(event) => handleBlockClick(event, block)}
                      >
                        {blockContent}
                      </button>
                    );
                  })}

                  {dayLessons.map((lesson) => {
                    const position = getLessonPosition(
                      lesson,
                      scheduleTimezone,
                      calendarStartMinutes,
                    );

                    const lessonContent = (
                      <>
                        <strong className={styles.lessonTime}>
                          {formatLessonTime(
                            lesson.starts_at,
                            locale,
                            scheduleTimezone,
                          )}
                          {" — "}
                          {formatLessonTime(
                            lesson.ends_at,
                            locale,
                            scheduleTimezone,
                          )}
                        </strong>

                        <span className={styles.lessonStudent}>
                          {lesson.profiles?.full_name ||
                            lesson.profiles?.email ||
                            t("teacherSchedule.unknownStudent")}
                        </span>

                        <span className={styles.lessonStatus}>
                          📘 {t(`teacherSchedule.statuses.${lesson.status}`)}
                        </span>
                      </>
                    );

                    if (lesson.isProjectedRecurring) {
                      return (
                        <button
                          key={lesson.id}
                          type="button"
                          aria-disabled="true"
                          tabIndex={-1}
                          className={`${styles.lesson} ${
                            styles[lesson.status] || ""
                          } ${styles.projectedOccurrence}`}
                          style={{
                            top: `${position.top}px`,
                            height: `${position.height}px`,
                          }}
                        >
                          {lessonContent}
                        </button>
                      );
                    }

                    return (
                      <button
                        key={lesson.id}
                        type="button"
                        className={`${styles.lesson} ${
                          styles[lesson.status] || ""
                        }`}
                        style={{
                          top: `${position.top}px`,
                          height: `${position.height}px`,
                        }}
                        onClick={(event) => handleLessonClick(event, lesson)}
                      >
                        {lessonContent}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className={styles.bottomGrid}>
        <section id="lesson-create-form" className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>
              {createMode === "block"
                ? t("teacherSchedule.scheduleBlock.createTitle")
                : t("teacherSchedule.createLesson")}
            </h2>

            <p>
              {createMode === "single"
                ? t("teacherSchedule.createLessonHint")
                : createMode === "recurring"
                  ? t("teacherSchedule.recurring.hint")
                  : t("teacherSchedule.scheduleBlock.hint")}
            </p>
          </div>

          <div
            className={styles.createModeSwitch}
            role="group"
            aria-label={t("teacherSchedule.createMode.label")}
          >
            <button
              type="button"
              className={`${styles.modeButton} ${
                createMode === "single" ? styles.modeButtonActive : ""
              }`}
              onClick={() => handleCreateModeChange("single")}
            >
              {t("teacherSchedule.createMode.single")}
            </button>

            <button
              type="button"
              className={`${styles.modeButton} ${
                createMode === "recurring" ? styles.modeButtonActive : ""
              }`}
              onClick={() => handleCreateModeChange("recurring")}
            >
              {t("teacherSchedule.createMode.recurring")}
            </button>

            <button
              type="button"
              className={`${styles.modeButton} ${
                createMode === "block" ? styles.modeButtonActive : ""
              }`}
              onClick={() => handleCreateModeChange("block")}
            >
              {t("teacherSchedule.createMode.block")}
            </button>
          </div>

          {createMode === "single" ? (
            <form className={styles.form} onSubmit={handleCreateLesson}>
              <label className={styles.field}>
                <span>{t("teacherSchedule.student")}</span>

                <select
                  value={selectedStudentId}
                  onChange={(event) => setSelectedStudentId(event.target.value)}
                >
                  <option value="">{t("teacherSchedule.selectStudent")}</option>

                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.full_name || student.email}
                    </option>
                  ))}
                </select>
              </label>

              <div className={styles.formRow}>
                <label className={styles.field}>
                  <span>{t("teacherSchedule.date")}</span>

                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(event) =>
                      handleSelectedDateChange(event.target.value)
                    }
                  />
                </label>

                <label className={styles.field}>
                  <span>{t("teacherSchedule.time")}</span>

                  <select
                    value={selectedTime}
                    onChange={(event) => setSelectedTime(event.target.value)}
                  >
                    <option value="">{t("teacherSchedule.selectTime")}</option>

                    {selectedDateSlots.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className={styles.field}>
                <span>{t("teacherSchedule.meetingUrl")}</span>

                <input
                  type="url"
                  value={meetingUrl}
                  onChange={(event) => setMeetingUrl(event.target.value)}
                  placeholder="https://..."
                />
              </label>

              {createErrorMessage && <p className={styles.error}>{createErrorMessage}</p>}


              <Button
                type="submit"
                variant="primary"
                size="large"
                disabled={creating}
              >
                {creating
                  ? t("teacherSchedule.creating")
                  : t("teacherSchedule.create")}
              </Button>
            </form>
          ) : createMode === "recurring" ? (
            <form
              className={styles.form}
              onSubmit={handleCreateRecurringLesson}
            >
              <label className={styles.field}>
                <span>{t("teacherSchedule.student")}</span>

                <select
                  value={selectedStudentId}
                  onChange={(event) => setSelectedStudentId(event.target.value)}
                >
                  <option value="">{t("teacherSchedule.selectStudent")}</option>

                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.full_name || student.email}
                    </option>
                  ))}
                </select>
              </label>

              <div className={styles.formRow}>
                <label className={styles.field}>
                  <span>{t("teacherSchedule.recurring.weekday")}</span>

                  <select
                    value={recurringWeekday}
                    onChange={(event) =>
                      handleRecurringWeekdayChange(event.target.value)
                    }
                  >
                    <option value="">
                      {t("teacherSchedule.recurring.selectWeekday")}
                    </option>
                    {enabledWorkingHours.map((item) => {
                      const dayName = WEEKDAYS.find(
                        (day) => day.value === item.weekday,
                      )?.key;

                      return (
                        <option key={item.weekday} value={item.weekday}>
                          {t(`teacherSchedule.recurring.weekdays.${dayName}`)}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label className={styles.field}>
                  <span>{t("teacherSchedule.time")}</span>

                  <select
                    value={selectedTime}
                    onChange={(event) => setSelectedTime(event.target.value)}
                  >
                    <option value="">{t("teacherSchedule.selectTime")}</option>

                    {recurringTimeSlots.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className={styles.field}>
                <span>{t("teacherSchedule.recurring.repeat")}</span>

                <select
                  value={recurringIntervalWeeks}
                  onChange={(event) =>
                    setRecurringIntervalWeeks(event.target.value)
                  }
                >
                  <option value="1">
                    {t("teacherSchedule.recurring.everyWeek")}
                  </option>
                  <option value="2">
                    {t("teacherSchedule.recurring.everyTwoWeeks")}
                  </option>
                </select>
              </label>

              <div className={styles.formRow}>
                <label className={styles.field}>
                  <span>{t("teacherSchedule.recurring.validFrom")}</span>

                  <input
                    type="date"
                    value={recurringValidFrom}
                    onChange={(event) =>
                      setRecurringValidFrom(event.target.value)
                    }
                  />
                </label>

                <label className={styles.field}>
                  <span>
                    {t(
                      scheduleSettings.allowOpenEndedRecurringLessons
                        ? "teacherSchedule.recurring.validUntil"
                        : "teacherSchedule.recurring.validUntilRequired",
                    )}
                  </span>

                  <input
                    type="date"
                    value={recurringValidUntil}
                    min={recurringValidFrom || undefined}
                    required={!scheduleSettings.allowOpenEndedRecurringLessons}
                    onChange={(event) =>
                      setRecurringValidUntil(event.target.value)
                    }
                  />
                </label>
              </div>

              <label className={styles.field}>
                <span>{t("teacherSchedule.meetingUrl")}</span>

                <input
                  type="url"
                  value={meetingUrl}
                  onChange={(event) => setMeetingUrl(event.target.value)}
                  placeholder="https://..."
                />
              </label>

              <p className={styles.formNote}>
                {t("teacherSchedule.recurring.generationNote", {
                  horizonWeeks: scheduleSettings.recurringGenerationHorizonWeeks,
                })}
              </p>

              {createErrorMessage && <p className={styles.error}>{createErrorMessage}</p>}


              <Button
                type="submit"
                variant="primary"
                size="large"
                disabled={creating}
              >
                {creating
                  ? t("teacherSchedule.recurring.creating")
                  : t("teacherSchedule.recurring.create")}
              </Button>
            </form>
          ) : (
            <form className={styles.form} onSubmit={handleCreateScheduleBlock}>
              <label className={styles.field}>
                <span>{t("teacherSchedule.scheduleBlock.repeatMode.label")}</span>
                <select
                  value={blockRepeatMode}
                  onChange={(event) => handleBlockRepeatModeChange(event.target.value)}
                >
                  <option value="single">
                    {t("teacherSchedule.scheduleBlock.repeatMode.single")}
                  </option>
                  <option value="recurring">
                    {t("teacherSchedule.scheduleBlock.repeatMode.recurring")}
                  </option>
                </select>
              </label>

              {blockRepeatMode === "recurring" ? (
                <>
                  <div className={styles.formRow}>
                    <label className={styles.field}>
                      <span>{t("teacherSchedule.recurring.weekday")}</span>
                      <select
                        value={blockRecurringWeekday}
                        onChange={(event) =>
                          handleBlockRecurringWeekdayChange(event.target.value)
                        }
                      >
                        <option value="">
                          {t("teacherSchedule.recurring.selectWeekday")}
                        </option>
                        {enabledWorkingHours.map((item) => {
                          const dayName = WEEKDAYS.find(
                            (day) => day.value === item.weekday,
                          )?.key;
                          return (
                            <option key={item.weekday} value={item.weekday}>
                              {t(`teacherSchedule.recurring.weekdays.${dayName}`)}
                            </option>
                          );
                        })}
                      </select>
                    </label>

                    <label className={styles.field}>
                      <span>{t("teacherSchedule.scheduleBlock.startTime")}</span>
                      <select
                        value={blockStartTime}
                        onChange={(event) =>
                          handleBlockStartTimeChange(event.target.value)
                        }
                      >
                        <option value="">{t("teacherSchedule.selectTime")}</option>
                        {blockRecurringStartSlots.map((slot) => (
                          <option key={slot} value={slot}>{slot}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className={styles.formRow}>
                    <label className={styles.field}>
                      <span>{t("teacherSchedule.scheduleBlock.endTime")}</span>
                      <select
                        value={blockEndTime}
                        onChange={(event) => setBlockEndTime(event.target.value)}
                        disabled={!blockStartTime}
                      >
                        <option value="">
                          {t("teacherSchedule.scheduleBlock.selectEndTime")}
                        </option>
                        {blockRecurringEndSlots.map((slot) => (
                          <option key={slot} value={slot}>{slot}</option>
                        ))}
                      </select>
                    </label>

                    <label className={styles.field}>
                      <span>{t("teacherSchedule.recurring.repeat")}</span>
                      <select
                        value={blockRecurringIntervalWeeks}
                        onChange={(event) =>
                          setBlockRecurringIntervalWeeks(event.target.value)
                        }
                      >
                        <option value="1">{t("teacherSchedule.recurring.everyWeek")}</option>
                        <option value="2">{t("teacherSchedule.recurring.everyTwoWeeks")}</option>
                      </select>
                    </label>
                  </div>

                  <div className={styles.formRow}>
                    <label className={styles.field}>
                      <span>{t("teacherSchedule.recurring.validFrom")}</span>
                      <input
                        type="date"
                        value={blockRecurringValidFrom}
                        onChange={(event) =>
                          setBlockRecurringValidFrom(event.target.value)
                        }
                      />
                    </label>

                    <label className={styles.field}>
                      <span>{t("teacherSchedule.scheduleBlock.recurring.validUntil")}</span>
                      <input
                        type="date"
                        value={blockRecurringValidUntil}
                        min={blockRecurringValidFrom || undefined}
                        onChange={(event) =>
                          setBlockRecurringValidUntil(event.target.value)
                        }
                      />
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.formRow}>
                    <label className={styles.field}>
                      <span>{t("teacherSchedule.date")}</span>
                      <input
                        type="date"
                        value={blockDate}
                        onChange={(event) =>
                          handleBlockDateChange(event.target.value)
                        }
                      />
                    </label>

                    <label className={styles.field}>
                      <span>{t("teacherSchedule.scheduleBlock.startTime")}</span>
                      <select
                        value={blockStartTime}
                        onChange={(event) =>
                          handleBlockStartTimeChange(event.target.value)
                        }
                      >
                        <option value="">{t("teacherSchedule.selectTime")}</option>
                        {blockStartSlots.map((slot) => (
                          <option key={slot} value={slot}>{slot}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className={styles.field}>
                    <span>{t("teacherSchedule.scheduleBlock.endTime")}</span>
                    <select
                      value={blockEndTime}
                      onChange={(event) => setBlockEndTime(event.target.value)}
                      disabled={!blockStartTime}
                    >
                      <option value="">
                        {t("teacherSchedule.scheduleBlock.selectEndTime")}
                      </option>
                      {blockEndSlots.map((slot) => (
                        <option key={slot} value={slot}>{slot}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              <label className={styles.field}>
                <span>{t("teacherSchedule.scheduleBlock.reason")}</span>
                <input
                  type="text"
                  value={blockReason}
                  maxLength={200}
                  onChange={(event) => setBlockReason(event.target.value)}
                  placeholder={t("teacherSchedule.scheduleBlock.reasonPlaceholder")}
                />
              </label>

              {blockRepeatMode === "recurring" && (
                <p className={styles.formNote}>
                  {t("teacherSchedule.scheduleBlock.recurring.generationNote", {
                        horizonWeeks: scheduleSettings.recurringGenerationHorizonWeeks,
                      })}
                </p>
              )}

              {createErrorMessage && (
                <p className={styles.error}>{createErrorMessage}</p>
              )}

              <Button
                type="submit"
                variant="primary"
                size="large"
                disabled={savingBlock}
              >
                {savingBlock
                  ? t("teacherSchedule.scheduleBlock.creating")
                  : blockRepeatMode === "recurring"
                    ? t("teacherSchedule.scheduleBlock.recurring.create")
                    : t("teacherSchedule.scheduleBlock.create")}
              </Button>
            </form>
          )}
        </section>

        <section id="lesson-details-panel" className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>
              {selectedBlock
                ? t("teacherSchedule.scheduleBlock.detailsTitle")
                : t("teacherSchedule.lessonDetails")}
            </h2>

            <p>
              {selectedBlock
                ? t("teacherSchedule.scheduleBlock.detailsHint")
                : t("teacherSchedule.lessonDetailsHint")}
            </p>
          </div>

          {detailErrorMessage && (
            <p className={styles.error}>{detailErrorMessage}</p>
          )}

          {selectedBlock ? (
            <div className={styles.lessonDetails}>
              {editingBlock ? (
                <div className={styles.recurringSeriesEditor}>
                  <div>
                    <h3>{t("teacherSchedule.scheduleBlock.editTitle")}</h3>
                    <p>{t("teacherSchedule.scheduleBlock.editHint")}</p>
                  </div>

                  <div className={styles.formRow}>
                    <label className={styles.field}>
                      <span>{t("teacherSchedule.date")}</span>
                      <input
                        type="date"
                        value={blockDate}
                        onChange={(event) => handleBlockDateChange(event.target.value)}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>{t("teacherSchedule.scheduleBlock.startTime")}</span>
                      <select
                        value={blockStartTime}
                        onChange={(event) => handleBlockStartTimeChange(event.target.value)}
                      >
                        <option value="">{t("teacherSchedule.selectTime")}</option>
                        {blockStartSlots.map((slot) => (
                          <option key={slot} value={slot}>{slot}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className={styles.field}>
                    <span>{t("teacherSchedule.scheduleBlock.endTime")}</span>
                    <select
                      value={blockEndTime}
                      onChange={(event) => setBlockEndTime(event.target.value)}
                      disabled={!blockStartTime}
                    >
                      <option value="">
                        {t("teacherSchedule.scheduleBlock.selectEndTime")}
                      </option>
                      {blockEndSlots.map((slot) => (
                        <option key={slot} value={slot}>{slot}</option>
                      ))}
                    </select>
                  </label>

                  <label className={styles.field}>
                    <span>{t("teacherSchedule.scheduleBlock.reason")}</span>
                    <input
                      type="text"
                      value={blockReason}
                      maxLength={200}
                      onChange={(event) => setBlockReason(event.target.value)}
                      placeholder={t("teacherSchedule.scheduleBlock.reasonPlaceholder")}
                    />
                  </label>

                  <div className={styles.inlineActions}>
                    <Button variant="primary" onClick={handleSaveScheduleBlock} disabled={savingBlock}>
                      {savingBlock
                        ? t("teacherSchedule.scheduleBlock.saving")
                        : t("teacherSchedule.scheduleBlock.save")}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditingBlock(false);
                        populateBlockDraft(selectedBlock);
                      }}
                      disabled={savingBlock}
                    >
                      {t("teacherSchedule.scheduleBlock.cancelEdit")}
                    </Button>
                  </div>
                </div>
              ) : editingRecurringBlockSeries ? (
                <div className={styles.recurringSeriesEditor}>
                  <div>
                    <h3>{t("teacherSchedule.scheduleBlock.recurring.editFromHere.title")}</h3>
                    <p>{t("teacherSchedule.scheduleBlock.recurring.editFromHere.hint")}</p>
                  </div>

                  <div className={styles.formRow}>
                    <label className={styles.field}>
                      <span>{t("teacherSchedule.recurring.weekday")}</span>
                      <select
                        value={blockSeriesWeekday}
                        onChange={(event) => handleBlockSeriesWeekdayChange(event.target.value)}
                      >
                        <option value="">{t("teacherSchedule.recurring.selectWeekday")}</option>
                        {enabledWorkingHours.map((item) => {
                          const dayName = WEEKDAYS.find(
                            (day) => day.value === item.weekday,
                          )?.key;
                          return (
                            <option key={item.weekday} value={item.weekday}>
                              {t(`teacherSchedule.recurring.weekdays.${dayName}`)}
                            </option>
                          );
                        })}
                      </select>
                    </label>

                    <label className={styles.field}>
                      <span>{t("teacherSchedule.scheduleBlock.startTime")}</span>
                      <select
                        value={blockSeriesStartTime}
                        onChange={(event) => handleBlockSeriesStartTimeChange(event.target.value)}
                      >
                        <option value="">{t("teacherSchedule.selectTime")}</option>
                        {blockSeriesStartSlots.map((slot) => (
                          <option key={slot} value={slot}>{slot}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className={styles.formRow}>
                    <label className={styles.field}>
                      <span>{t("teacherSchedule.scheduleBlock.endTime")}</span>
                      <select
                        value={blockSeriesEndTime}
                        onChange={(event) => setBlockSeriesEndTime(event.target.value)}
                        disabled={!blockSeriesStartTime}
                      >
                        <option value="">
                          {t("teacherSchedule.scheduleBlock.selectEndTime")}
                        </option>
                        {blockSeriesEndSlots.map((slot) => (
                          <option key={slot} value={slot}>{slot}</option>
                        ))}
                      </select>
                    </label>

                    <label className={styles.field}>
                      <span>{t("teacherSchedule.recurring.repeat")}</span>
                      <select
                        value={blockSeriesIntervalWeeks}
                        onChange={(event) => setBlockSeriesIntervalWeeks(event.target.value)}
                      >
                        <option value="1">{t("teacherSchedule.recurring.everyWeek")}</option>
                        <option value="2">{t("teacherSchedule.recurring.everyTwoWeeks")}</option>
                      </select>
                    </label>
                  </div>

                  <label className={styles.field}>
                    <span>{t("teacherSchedule.scheduleBlock.recurring.validUntil")}</span>
                    <input
                      type="date"
                      value={blockSeriesValidUntil}
                      min={formatZonedDateForInput(selectedBlock.starts_at, scheduleTimezone)}
                      onChange={(event) => setBlockSeriesValidUntil(event.target.value)}
                    />
                  </label>

                  <label className={styles.field}>
                    <span>{t("teacherSchedule.scheduleBlock.reason")}</span>
                    <input
                      type="text"
                      value={blockSeriesReason}
                      maxLength={200}
                      onChange={(event) => setBlockSeriesReason(event.target.value)}
                      placeholder={t("teacherSchedule.scheduleBlock.reasonPlaceholder")}
                    />
                  </label>

                  <div className={styles.inlineActions}>
                    <Button
                      variant="primary"
                      onClick={handleSaveRecurringBlockSeries}
                      disabled={savingRecurringBlockSeries}
                    >
                      {savingRecurringBlockSeries
                        ? t("teacherSchedule.scheduleBlock.recurring.editFromHere.saving")
                        : t("teacherSchedule.scheduleBlock.recurring.editFromHere.save")}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setEditingRecurringBlockSeries(false)}
                      disabled={savingRecurringBlockSeries}
                    >
                      {t("teacherSchedule.scheduleBlock.recurring.editFromHere.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.detailItem}>
                    <span>{t("teacherSchedule.date")}</span>
                    <strong>
                      {formatFullDate(selectedBlock.starts_at, locale, scheduleTimezone)}
                    </strong>
                  </div>

                  <div className={styles.detailItem}>
                    <span>{t("teacherSchedule.time")}</span>
                    <strong>
                      {formatLessonTime(selectedBlock.starts_at, locale, scheduleTimezone)}
                      {" — "}
                      {formatLessonTime(selectedBlock.ends_at, locale, scheduleTimezone)}
                    </strong>
                  </div>

                  <div className={styles.detailItem}>
                    <span>{t("teacherSchedule.scheduleBlock.type")}</span>
                    <strong>
                      {selectedBlock.recurring_block_series_id
                        ? t("teacherSchedule.scheduleBlock.repeatMode.recurring")
                        : t("teacherSchedule.scheduleBlock.repeatMode.single")}
                    </strong>
                  </div>

                  <div className={styles.detailItem}>
                    <span>{t("teacherSchedule.scheduleBlock.reason")}</span>
                    <strong>{selectedBlock.reason || "—"}</strong>
                  </div>

                  <div className={styles.lessonActions}>
                    {currentTimeMs !== null &&
                      new Date(selectedBlock.starts_at).getTime() > currentTimeMs && (
                        <>
                          {selectedBlock.recurring_block_series_id ? (
                            <Button
                              variant="secondary"
                              onClick={handleStartEditRecurringBlockSeries}
                              disabled={
                                loadingRecurringBlockSeries ||
                                savingRecurringBlockSeries ||
                                cancellingRecurringBlockSeriesId ===
                                  selectedBlock.recurring_block_series_id ||
                                deletingBlockId === selectedBlock.id
                              }
                            >
                              {loadingRecurringBlockSeries
                                ? t("teacherSchedule.scheduleBlock.recurring.editFromHere.loading")
                                : t("teacherSchedule.scheduleBlock.recurring.editFromHere.button")}
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              onClick={handleStartEditBlock}
                              disabled={savingBlock || deletingBlockId === selectedBlock.id}
                            >
                              {t("teacherSchedule.scheduleBlock.edit")}
                            </Button>
                          )}
                        </>
                      )}

                    <Button
                      variant="danger"
                      onClick={handleDeleteScheduleBlock}
                      disabled={
                        savingBlock ||
                        deletingBlockId === selectedBlock.id ||
                        savingRecurringBlockSeries ||
                        cancellingRecurringBlockSeriesId === selectedBlock.recurring_block_series_id
                      }
                    >
                      {deletingBlockId === selectedBlock.id
                        ? t("teacherSchedule.scheduleBlock.deleting")
                        : selectedBlock.recurring_block_series_id
                          ? t("teacherSchedule.scheduleBlock.recurring.deleteOccurrence")
                          : t("teacherSchedule.scheduleBlock.delete")}
                    </Button>

                    {selectedBlock.recurring_block_series_id &&
                      currentTimeMs !== null &&
                      new Date(selectedBlock.starts_at).getTime() > currentTimeMs && (
                        <Button
                          variant="danger"
                          onClick={handleCancelRecurringBlockSeriesFromBlock}
                          disabled={
                            cancellingRecurringBlockSeriesId ===
                              selectedBlock.recurring_block_series_id ||
                            deletingBlockId === selectedBlock.id ||
                            savingRecurringBlockSeries
                          }
                        >
                          {cancellingRecurringBlockSeriesId ===
                          selectedBlock.recurring_block_series_id
                            ? t("teacherSchedule.scheduleBlock.recurring.cancelFromHere.cancelling")
                            : t("teacherSchedule.scheduleBlock.recurring.cancelFromHere.button")}
                        </Button>
                      )}
                  </div>
                </>
              )}
            </div>
          ) : !selectedLesson ? (
            <div className={styles.emptyDetails}>
              {t("teacherSchedule.selectScheduleItemHint")}
            </div>
          ) : (
            <LessonDetails
              lesson={selectedLesson}
              locale={locale}
              scheduleTimezone={scheduleTimezone}
              scheduleSettings={scheduleSettings}
              enabledWorkingHours={enabledWorkingHours}
              editingRecurringSeries={editingRecurringSeries}
              setEditingRecurringSeries={setEditingRecurringSeries}
              seriesWeekday={seriesWeekday}
              handleSeriesWeekdayChange={handleSeriesWeekdayChange}
              seriesTime={seriesTime}
              setSeriesTime={setSeriesTime}
              seriesTimeSlots={seriesTimeSlots}
              seriesIntervalWeeks={seriesIntervalWeeks}
              setSeriesIntervalWeeks={setSeriesIntervalWeeks}
              seriesValidUntil={seriesValidUntil}
              setSeriesValidUntil={setSeriesValidUntil}
              seriesMeetingUrl={seriesMeetingUrl}
              setSeriesMeetingUrl={setSeriesMeetingUrl}
              handleSaveRecurringSeries={handleSaveRecurringSeries}
              savingRecurringSeries={savingRecurringSeries}
              editingLesson={editingLesson}
              setEditingLesson={setEditingLesson}
              editLessonDate={editLessonDate}
              editLessonMinDate={editLessonMinDate}
              handleEditLessonDateChange={handleEditLessonDateChange}
              editLessonTime={editLessonTime}
              setEditLessonTime={setEditLessonTime}
              editLessonTimeSlots={editLessonTimeSlots}
              editLessonMeetingUrl={editLessonMeetingUrl}
              setEditLessonMeetingUrl={setEditLessonMeetingUrl}
              handleSaveLesson={handleSaveLesson}
              savingLesson={savingLesson}
              editingMeetingUrl={editingMeetingUrl}
              setEditingMeetingUrl={setEditingMeetingUrl}
              lessonMeetingUrlDraft={lessonMeetingUrlDraft}
              setLessonMeetingUrlDraft={setLessonMeetingUrlDraft}
              handleSaveLessonMeetingUrl={handleSaveLessonMeetingUrl}
              savingMeetingUrl={savingMeetingUrl}
              handleSetLessonOutcome={handleSetLessonOutcome}
              updatingOutcome={updatingOutcome}
              handleStartEditLesson={handleStartEditLesson}
              cancellingLessonId={cancellingLessonId}
              loadingRecurringSeries={loadingRecurringSeries}
              cancellingSeriesId={cancellingSeriesId}
              handleStartEditRecurringSeries={handleStartEditRecurringSeries}
              handleCancelLesson={handleCancelLesson}
              handleCancelRecurringSeriesFromLesson={
                handleCancelRecurringSeriesFromLesson
              }
            />
          )}
        </section>
      </div>
    </section>
  );
};

export default TeacherSchedule;
