import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "react-i18next";

import { supabase } from "../../lib/supabase";

import { getIntlLocale } from "../../utils/getIntlLocale";

import { getTimezone } from "../../constants/timezones";

import { DEFAULT_SCHEDULE_SETTINGS } from "../../constants/schedule";

import styles from "./TeacherSchedule.module.css";

const PIXELS_PER_MINUTE = 1.15;
const CALENDAR_TOP_PADDING = 18;
const CALENDAR_BOTTOM_PADDING = 18;

const DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday"];

const TeacherSchedule = () => {
  const { t, i18n } = useTranslation();

  const [students, setStudents] = useState([]);

  const [lessons, setLessons] = useState([]);

  const [scheduleSettings, setScheduleSettings] = useState(
    DEFAULT_SCHEDULE_SETTINGS,
  );

  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));

  const [selectedStudentId, setSelectedStudentId] = useState("");

  const [selectedDate, setSelectedDate] = useState("");

  const [selectedTime, setSelectedTime] = useState("");

  const [zoomUrl, setZoomUrl] = useState("");

  const [selectedLesson, setSelectedLesson] = useState(null);

  const [loading, setLoading] = useState(true);

  const [creating, setCreating] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");

  const [successMessage, setSuccessMessage] = useState("");

  const locale = getIntlLocale(i18n.language);

  const scheduleTimezone = scheduleSettings.timezone;

  const workdayStartMinutes = timeToMinutes(scheduleSettings.workdayStart);

  const workdayEndMinutes = timeToMinutes(scheduleSettings.workdayEnd);

  const calendarHeight =
    (workdayEndMinutes - workdayStartMinutes) * PIXELS_PER_MINUTE +
    CALENDAR_TOP_PADDING +
    CALENDAR_BOTTOM_PADDING;

  const workdayEndTop =
    CALENDAR_TOP_PADDING +
    (workdayEndMinutes - workdayStartMinutes) * PIXELS_PER_MINUTE;

  const weekDays = useMemo(() => {
    return Array.from({ length: 5 }, (_, index) => addDays(weekStart, index));
  }, [weekStart]);

  const timeSlots = useMemo(() => {
    return createTimeSlots(
      scheduleSettings.workdayStart,
      scheduleSettings.workdayEnd,
      scheduleSettings.lessonDurationMinutes,
      scheduleSettings.slotIntervalMinutes,
    );
  }, [scheduleSettings]);

  const displayTimeSlots = useMemo(() => {
    return createDisplayTimeSlots(
      scheduleSettings.workdayStart,
      scheduleSettings.workdayEnd,
      scheduleSettings.slotIntervalMinutes,
    );
  }, [scheduleSettings]);

  const timezoneConfig = getTimezone(scheduleTimezone);

  const timezoneLabel = timezoneConfig
    ? t(timezoneConfig.labelKey)
    : scheduleTimezone;

  useEffect(() => {
    const initialize = async () => {
      try {
        setLoading(true);
        setErrorMessage("");

        await Promise.all([loadStudents(), loadTeacherSettings()]);
      } catch (error) {
        console.error("TeacherSchedule initialization error:", error);

        setErrorMessage(t("teacherSchedule.errors.load"));
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, [t]);

  useEffect(() => {
    loadLessons();
  }, [weekStart]);

  const loadStudents = async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, is_active")
      .eq("role", "student")
      .eq("is_active", true)
      .order("full_name");

    if (error) {
      throw error;
    }

    setStudents(data ?? []);
  };

  const loadTeacherSettings = async () => {
    const { data, error } = await supabase
      .from("teacher_settings")
      .select(
        `
          schedule_timezone,
          workday_start,
          workday_end,
          lesson_duration_minutes,
          slot_interval_minutes
        `,
      )
      .single();

    if (error) {
      throw error;
    }

    setScheduleSettings({
      timezone: data?.schedule_timezone || DEFAULT_SCHEDULE_SETTINGS.timezone,

      workdayStart:
        data?.workday_start?.slice(0, 5) ||
        DEFAULT_SCHEDULE_SETTINGS.workdayStart,

      workdayEnd:
        data?.workday_end?.slice(0, 5) || DEFAULT_SCHEDULE_SETTINGS.workdayEnd,

      lessonDurationMinutes:
        data?.lesson_duration_minutes ??
        DEFAULT_SCHEDULE_SETTINGS.lessonDurationMinutes,

      slotIntervalMinutes:
        data?.slot_interval_minutes ??
        DEFAULT_SCHEDULE_SETTINGS.slotIntervalMinutes,
    });
  };

  const loadLessons = async () => {
    try {
      setErrorMessage("");

      /*
          Беремо невеликий запас з обох
          боків, а вже сам календар
          фільтрує уроки у timezone
          викладача.
        */
      const start = startOfDay(addDays(weekStart, -1));

      const end = startOfDay(addDays(weekStart, 6));

      const { data, error } = await supabase
        .from("lessons")
        .select(
          `
            id,
            student_id,
            teacher_id,
            starts_at,
            ends_at,
            duration_minutes,
            status,
            zoom_url,
            profiles:student_id (
              id,
              full_name,
              email
            )
          `,
        )
        .gte("starts_at", start.toISOString())
        .lt("starts_at", end.toISOString())
        .order("starts_at", {
          ascending: true,
        });

      if (error) {
        throw error;
      }

      setLessons(data ?? []);
    } catch (error) {
      console.error("Load lessons error:", error);

      setErrorMessage(t("teacherSchedule.errors.loadLessons"));
    }
  };

  const handlePreviousWeek = () => {
    setSelectedLesson(null);

    setWeekStart((current) => addDays(current, -7));
  };

  const handleNextWeek = () => {
    setSelectedLesson(null);

    setWeekStart((current) => addDays(current, 7));
  };

  const handleCurrentWeek = () => {
    setSelectedLesson(null);

    setWeekStart(getMonday(new Date()));
  };

  const handleSlotClick = (date, slot) => {
    const blocked = isSlotBlockedByLesson(
      date,
      slot,
      lessons,
      scheduleTimezone,
      scheduleSettings.lessonDurationMinutes,
    );

    if (blocked) {
      return;
    }

    setSelectedLesson(null);

    setSelectedDate(formatDateForInput(date));

    setSelectedTime(slot);

    setSuccessMessage("");

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

    requestAnimationFrame(() => {
      document.getElementById("lesson-details-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const handleCreateLesson = async (event) => {
    event.preventDefault();

    setErrorMessage("");
    setSuccessMessage("");

    if (!selectedStudentId || !selectedDate || !selectedTime) {
      setErrorMessage(t("teacherSchedule.errors.requiredFields"));

      return;
    }

    try {
      setCreating(true);

      const { error } = await supabase.rpc("create_lesson", {
        p_student_id: selectedStudentId,

        p_lesson_date: selectedDate,

        p_start_time: selectedTime,

        p_zoom_url: zoomUrl.trim() || null,
      });

      if (error) {
        throw error;
      }

      setSuccessMessage(t("teacherSchedule.messages.lessonCreated"));

      setSelectedStudentId("");

      setZoomUrl("");

      setSelectedLesson(null);

      await loadLessons();
    } catch (error) {
      console.error("Create lesson error:", error);

      setErrorMessage(getCreateLessonError(error, t));
    } finally {
      setCreating(false);
    }
  };

  const getLessonsForDay = (date) => {
    const dayKey = formatDateForInput(date);

    return lessons.filter((lesson) => {
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

      <div className={styles.settingsSummary}>
        <span>
          {scheduleSettings.workdayStart}
          {" — "}
          {scheduleSettings.workdayEnd}
        </span>

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

              return (
                <div
                  key={DAY_NAMES[index]}
                  className={`${styles.dayHeader} ${
                    today ? styles.todayHeader : ""
                  }`}
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
                  (timeToMinutes(slot) - workdayStartMinutes) *
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
                style={{ top: `${workdayEndTop}px` }}
              >
                {scheduleSettings.workdayEnd}
              </span>
            </div>

            {weekDays.map((date) => {
              const dayLessons = getLessonsForDay(date);

              const today = isSameCalendarDate(date, new Date());

              return (
                <div
                  key={date.toISOString()}
                  className={`${styles.dayColumn} ${
                    today ? styles.todayColumn : ""
                  }`}
                  style={{
                    height: calendarHeight,
                  }}
                >
                  {displayTimeSlots.map((slot) => {
                    const top =
                      CALENDAR_TOP_PADDING +
                      (timeToMinutes(slot) - workdayStartMinutes) *
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
                    style={{ top: `${workdayEndTop}px` }}
                  />

                  {timeSlots.map((slot) => {
                    const top =
                      CALENDAR_TOP_PADDING +
                      (timeToMinutes(slot) - workdayStartMinutes) *
                        PIXELS_PER_MINUTE;

                    const height =
                      scheduleSettings.slotIntervalMinutes * PIXELS_PER_MINUTE;

                    const blocked = isSlotBlockedByLesson(
                      date,
                      slot,
                      dayLessons,
                      scheduleTimezone,
                      scheduleSettings.lessonDurationMinutes,
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

                  {dayLessons.map((lesson) => {
                    const position = getLessonPosition(
                      lesson,
                      scheduleTimezone,
                      workdayStartMinutes,
                    );

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
                        <strong className={styles.lessonTime}>
                          {formatLessonTime(
                            lesson.starts_at,
                            locale,
                            scheduleTimezone,
                          )}
                        </strong>

                        <span className={styles.lessonStudent}>
                          {lesson.profiles?.full_name ||
                            lesson.profiles?.email ||
                            t("teacherSchedule.unknownStudent")}
                        </span>
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
            <h2>{t("teacherSchedule.createLesson")}</h2>

            <p>{t("teacherSchedule.createLessonHint")}</p>
          </div>

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
                  onChange={(event) => setSelectedDate(event.target.value)}
                />
              </label>

              <label className={styles.field}>
                <span>{t("teacherSchedule.time")}</span>

                <select
                  value={selectedTime}
                  onChange={(event) => setSelectedTime(event.target.value)}
                >
                  <option value="">{t("teacherSchedule.selectTime")}</option>

                  {timeSlots.map((slot) => (
                    <option key={slot} value={slot}>
                      {slot}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className={styles.field}>
              <span>{t("teacherSchedule.zoomUrl")}</span>

              <input
                type="url"
                value={zoomUrl}
                onChange={(event) => setZoomUrl(event.target.value)}
                placeholder="https://..."
              />
            </label>

            {errorMessage && <p className={styles.error}>{errorMessage}</p>}

            {successMessage && (
              <p className={styles.success}>{successMessage}</p>
            )}

            <button
              type="submit"
              className={styles.primaryButton}
              disabled={creating}
            >
              {creating
                ? t("teacherSchedule.creating")
                : t("teacherSchedule.create")}
            </button>
          </form>
        </section>

        <section id="lesson-details-panel" className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>{t("teacherSchedule.lessonDetails")}</h2>

            <p>{t("teacherSchedule.lessonDetailsHint")}</p>
          </div>

          {!selectedLesson ? (
            <div className={styles.emptyDetails}>
              {t("teacherSchedule.selectLessonHint")}
            </div>
          ) : (
            <div className={styles.lessonDetails}>
              <div className={styles.detailItem}>
                <span>{t("teacherSchedule.student")}</span>

                <strong>
                  {selectedLesson.profiles?.full_name ||
                    selectedLesson.profiles?.email ||
                    "—"}
                </strong>
              </div>

              <div className={styles.detailItem}>
                <span>{t("teacherSchedule.date")}</span>

                <strong>
                  {formatFullDate(
                    selectedLesson.starts_at,
                    locale,
                    scheduleTimezone,
                  )}
                </strong>
              </div>

              <div className={styles.detailItem}>
                <span>{t("teacherSchedule.time")}</span>

                <strong>
                  {formatLessonTime(
                    selectedLesson.starts_at,
                    locale,
                    scheduleTimezone,
                  )}
                  {" — "}
                  {formatLessonTime(
                    selectedLesson.ends_at,
                    locale,
                    scheduleTimezone,
                  )}
                </strong>
              </div>

              <div className={styles.detailItem}>
                <span>{t("teacherSchedule.status")}</span>

                <strong>
                  {t(`teacherSchedule.statuses.${selectedLesson.status}`)}
                </strong>
              </div>

              <div className={styles.detailItem}>
                <span>Zoom</span>

                {selectedLesson.zoom_url ? (
                  <a
                    href={selectedLesson.zoom_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("teacherSchedule.openZoom")}
                  </a>
                ) : (
                  <strong>—</strong>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </section>
  );
};

const pad = (value) => String(value).padStart(2, "0");

const timeToMinutes = (value) => {
  const [hours, minutes] = value.split(":").map(Number);

  return hours * 60 + minutes;
};

const minutesToTime = (minutes) => {
  const hours = Math.floor(minutes / 60);

  const mins = minutes % 60;

  return `${pad(hours)}:${pad(mins)}`;
};

const createTimeSlots = (
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

const createDisplayTimeSlots = (
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

const getMonday = (date) => {
  const result = new Date(date);

  result.setHours(12, 0, 0, 0);

  const day = result.getDay();

  const difference = day === 0 ? -6 : 1 - day;

  result.setDate(result.getDate() + difference);

  return result;
};

const addDays = (date, amount) => {
  const result = new Date(date);

  result.setDate(result.getDate() + amount);

  return result;
};

const startOfDay = (date) => {
  const result = new Date(date);

  result.setHours(0, 0, 0, 0);

  return result;
};

const formatDateForInput = (date) => {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
};

const formatWeekRange = (weekStart, locale) => {
  const weekEnd = addDays(weekStart, 4);

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

const isSameCalendarDate = (first, second) => {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
};

const getDatePartsInTimezone = (value, timezone) => {
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

const getLessonPosition = (lesson, timezone, workdayStartMinutes) => {
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

const isSlotBlockedByLesson = (
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

const formatLessonTime = (value, locale, timezone) => {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
};

const formatFullDate = (value, locale, timezone) => {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
};

const getCreateLessonError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("WEEKEND_NOT_ALLOWED")) {
    return t("teacherSchedule.errors.weekend");
  }

  if (message.includes("OUTSIDE_WORKING_HOURS")) {
    return t("teacherSchedule.errors.workingHours");
  }

  if (message.includes("INVALID_TIME_SLOT")) {
    return t("teacherSchedule.errors.invalidSlot");
  }

  if (message.includes("LESSON_TIME_CONFLICT")) {
    return t("teacherSchedule.errors.conflict");
  }

  if (message.includes("LESSON_IN_PAST")) {
    return t("teacherSchedule.errors.past");
  }

  if (message.includes("STUDENT_NOT_FOUND")) {
    return t("teacherSchedule.errors.studentNotFound");
  }

  return t("teacherSchedule.errors.create");
};

export default TeacherSchedule;
