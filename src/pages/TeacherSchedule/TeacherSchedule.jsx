import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "react-i18next";

import { supabase } from "../../lib/supabase";

import { getIntlLocale } from "../../utils/getIntlLocale";

import { getTimezone } from "../../constants/timezones";

import { DEFAULT_SCHEDULE_SETTINGS } from "../../constants/schedule";

import Button from "../../components/common/ui/Button/Button";

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

  const [createMode, setCreateMode] = useState("single");

  const [recurringWeekday, setRecurringWeekday] = useState("1");

  const [recurringValidFrom, setRecurringValidFrom] = useState("");

  const [recurringValidUntil, setRecurringValidUntil] = useState("");

  const [recurringIntervalWeeks, setRecurringIntervalWeeks] = useState("1");

  const [selectedLesson, setSelectedLesson] = useState(null);

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

  const [seriesZoomUrl, setSeriesZoomUrl] = useState("");

  const [editingZoom, setEditingZoom] = useState(false);

  const [lessonZoomDraft, setLessonZoomDraft] = useState("");

  const [savingZoom, setSavingZoom] = useState(false);

  const [updatingOutcome, setUpdatingOutcome] = useState(false);

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
            recurring_lesson_id,
            starts_at,
            ends_at,
            duration_minutes,
            status,
            zoom_url,
            completed_at,
            missed_at,
            cancelled_by,
            cancelled_at,
            cancellation_reason,
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

    const dateValue = formatDateForInput(date);

    setSelectedDate(dateValue);

    setSelectedTime(slot);

    if (date.getDay() >= 1 && date.getDay() <= 5) {
      setRecurringWeekday(String(date.getDay()));
    }

    setRecurringValidFrom(dateValue);

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
    setLessonZoomDraft(lesson.zoom_url || "");
    setEditingZoom(false);
    setEditingRecurringSeries(false);
    setErrorMessage("");
    setSuccessMessage("");

    requestAnimationFrame(() => {
      document.getElementById("lesson-details-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
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
      setErrorMessage("");
      setSuccessMessage("");

      const { error } = await supabase.rpc("cancel_lesson", {
        p_lesson_id: selectedLesson.id,
        p_reason: null,
      });

      if (error) {
        throw error;
      }

      setSuccessMessage(t("teacherSchedule.cancel.success"));

      setSelectedLesson(null);

      await loadLessons();
    } catch (error) {
      console.error("Cancel lesson error:", error);
      setErrorMessage(getCancelLessonError(error, t));
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
      setErrorMessage("");
      setSuccessMessage("");

      const { data, error } = await supabase
        .from("recurring_lessons")
        .select("weekday, start_time, interval_weeks, valid_until, zoom_url")
        .eq("id", selectedLesson.recurring_lesson_id)
        .single();

      if (error) {
        throw error;
      }

      setSeriesWeekday(String(data.weekday));
      setSeriesTime(data.start_time?.slice(0, 5) || "");
      setSeriesIntervalWeeks(String(data.interval_weeks ?? 1));
      setSeriesValidUntil(data.valid_until || "");
      setSeriesZoomUrl(data.zoom_url || "");
      setEditingRecurringSeries(true);
      setEditingZoom(false);
    } catch (error) {
      console.error("Load recurring series error:", error);
      setErrorMessage(t("teacherSchedule.recurring.editFromHere.errors.load"));
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

    const confirmed = window.confirm(
      t("teacherSchedule.recurring.editFromHere.confirm"),
    );

    if (!confirmed) {
      return;
    }

    try {
      setSavingRecurringSeries(true);
      setErrorMessage("");
      setSuccessMessage("");

      const { data, error } = await supabase.rpc(
        "edit_recurring_series_from_lesson",
        {
          p_lesson_id: selectedLesson.id,
          p_weekday: Number(seriesWeekday),
          p_start_time: seriesTime,
          p_interval_weeks: Number(seriesIntervalWeeks),
          p_valid_until: seriesValidUntil || null,
          p_zoom_url: seriesZoomUrl.trim() || null,
          p_generate_weeks: 8,
        },
      );

      if (error) {
        throw error;
      }

      const result = Array.isArray(data) ? data[0] : data;

      setSuccessMessage(
        t("teacherSchedule.recurring.editFromHere.success", {
          createdCount: result?.created_count ?? 0,
          conflictCount: result?.conflict_count ?? 0,
        }),
      );

      setEditingRecurringSeries(false);
      setSelectedLesson(null);
      await loadLessons();
    } catch (error) {
      console.error("Edit recurring series error:", error);
      setErrorMessage(getEditRecurringSeriesError(error, t));
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
      setErrorMessage("");
      setSuccessMessage("");

      const { data, error } = await supabase.rpc(
        "cancel_recurring_series_from_lesson",
        {
          p_lesson_id: selectedLesson.id,
        },
      );

      if (error) {
        throw error;
      }

      setSuccessMessage(
        t("teacherSchedule.recurring.cancelFromHere.success", {
          count: data ?? 0,
        }),
      );

      setSelectedLesson(null);
      await loadLessons();
    } catch (error) {
      console.error("Cancel recurring series error:", error);
      setErrorMessage(getCancelRecurringSeriesError(error, t));
    } finally {
      setCancellingSeriesId(null);
    }
  };

  const handleSaveLessonZoom = async () => {
    if (!selectedLesson || selectedLesson.status === "cancelled") {
      return;
    }

    try {
      setSavingZoom(true);
      setErrorMessage("");
      setSuccessMessage("");

      const normalizedZoomUrl = lessonZoomDraft.trim() || null;

      const { error } = await supabase.rpc("update_lesson_zoom", {
        p_lesson_id: selectedLesson.id,
        p_zoom_url: normalizedZoomUrl,
      });

      if (error) {
        throw error;
      }

      setSelectedLesson((current) =>
        current
          ? {
              ...current,
              zoom_url: normalizedZoomUrl,
            }
          : current,
      );

      setEditingZoom(false);
      setSuccessMessage(t("teacherSchedule.zoomEdit.success"));
      await loadLessons();
    } catch (error) {
      console.error("Update lesson Zoom error:", error);
      setErrorMessage(getUpdateLessonZoomError(error, t));
    } finally {
      setSavingZoom(false);
    }
  };

  const handleSetLessonOutcome = async (status) => {
    if (!selectedLesson || selectedLesson.status === "cancelled") {
      return;
    }

    try {
      setUpdatingOutcome(true);
      setErrorMessage("");
      setSuccessMessage("");

      const { error } = await supabase.rpc("set_lesson_outcome", {
        p_lesson_id: selectedLesson.id,
        p_status: status,
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

      setSuccessMessage(
        status === "completed"
          ? t("teacherSchedule.outcome.completedSuccess")
          : t("teacherSchedule.outcome.missedSuccess"),
      );

      await loadLessons();
    } catch (error) {
      console.error("Set lesson outcome error:", error);
      setErrorMessage(getLessonOutcomeError(error, t));
    } finally {
      setUpdatingOutcome(false);
    }
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

  const handleCreateModeChange = (mode) => {
    setCreateMode(mode);
    setErrorMessage("");
    setSuccessMessage("");

    if (mode === "recurring" && selectedDate) {
      const date = parseInputDate(selectedDate);

      if (date && date.getDay() >= 1 && date.getDay() <= 5) {
        setRecurringWeekday(String(date.getDay()));
        setRecurringValidFrom((current) => current || selectedDate);
      }
    }
  };

  const handleCreateRecurringLesson = async (event) => {
    event.preventDefault();

    setErrorMessage("");
    setSuccessMessage("");

    if (
      !selectedStudentId ||
      !recurringWeekday ||
      !selectedTime ||
      !recurringValidFrom
    ) {
      setErrorMessage(t("teacherSchedule.recurring.errors.requiredFields"));
      return;
    }

    try {
      setCreating(true);

      const { data, error } = await supabase.rpc(
        "create_recurring_lesson_with_generation",
        {
          p_student_id: selectedStudentId,
          p_weekday: Number(recurringWeekday),
          p_start_time: selectedTime,
          p_valid_from: recurringValidFrom,
          p_valid_until: recurringValidUntil || null,
          p_zoom_url: zoomUrl.trim() || null,
          p_interval_weeks: Number(recurringIntervalWeeks),
          p_generate_weeks: 8,
        },
      );

      if (error) {
        throw error;
      }

      const result = Array.isArray(data) ? data[0] : data;
      const createdCount = result?.created_count ?? 0;
      const conflictCount = result?.conflict_count ?? 0;

      setSuccessMessage(
        conflictCount > 0
          ? t("teacherSchedule.recurring.messages.createdWithConflicts", {
              createdCount,
              conflictCount,
            })
          : t("teacherSchedule.recurring.messages.created", {
              createdCount,
            }),
      );

      setSelectedStudentId("");
      setRecurringValidUntil("");
      setZoomUrl("");
      setSelectedLesson(null);

      await loadLessons();
    } catch (error) {
      console.error("Create recurring lesson error:", error);
      setErrorMessage(getCreateRecurringLessonError(error, t));
    } finally {
      setCreating(false);
    }
  };

  const getLessonsForDay = (date) => {
    const dayKey = formatDateForInput(date);

    return lessons.filter((lesson) => {
      if (lesson.status === "cancelled") {
        return false;
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

            <p>
              {createMode === "single"
                ? t("teacherSchedule.createLessonHint")
                : t("teacherSchedule.recurring.hint")}
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
          ) : (
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
                    onChange={(event) => setRecurringWeekday(event.target.value)}
                  >
                    {DAY_NAMES.map((dayName, index) => (
                      <option key={dayName} value={index + 1}>
                        {t(`teacherSchedule.recurring.weekdays.${dayName}`)}
                      </option>
                    ))}
                  </select>
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
                  <span>{t("teacherSchedule.recurring.validUntil")}</span>

                  <input
                    type="date"
                    value={recurringValidUntil}
                    min={recurringValidFrom || undefined}
                    onChange={(event) =>
                      setRecurringValidUntil(event.target.value)
                    }
                  />
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

              <p className={styles.formNote}>
                {t("teacherSchedule.recurring.generationNote")}
              </p>

              {errorMessage && <p className={styles.error}>{errorMessage}</p>}

              {successMessage && (
                <p className={styles.success}>{successMessage}</p>
              )}

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
          )}
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

              {selectedLesson.recurring_lesson_id && (
                <div className={styles.detailItem}>
                  <span>{t("teacherSchedule.recurring.series")}</span>

                  <strong>{t("teacherSchedule.recurring.seriesYes")}</strong>
                </div>
              )}

              {selectedLesson.recurring_lesson_id &&
                selectedLesson.status === "scheduled" &&
                !isLessonStarted(selectedLesson) &&
                editingRecurringSeries && (
                  <div className={styles.recurringSeriesEditor}>
                    <div>
                      <h3>{t("teacherSchedule.recurring.editFromHere.title")}</h3>
                      <p>{t("teacherSchedule.recurring.editFromHere.hint")}</p>
                    </div>

                    <div className={styles.formRow}>
                      <label className={styles.field}>
                        <span>{t("teacherSchedule.recurring.weekday")}</span>
                        <select
                          value={seriesWeekday}
                          onChange={(event) => setSeriesWeekday(event.target.value)}
                        >
                          {DAY_NAMES.map((dayName, index) => (
                            <option key={dayName} value={index + 1}>
                              {t(`teacherSchedule.recurring.weekdays.${dayName}`)}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className={styles.field}>
                        <span>{t("teacherSchedule.time")}</span>
                        <select
                          value={seriesTime}
                          onChange={(event) => setSeriesTime(event.target.value)}
                        >
                          {timeSlots.map((slot) => (
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
                        value={seriesIntervalWeeks}
                        onChange={(event) =>
                          setSeriesIntervalWeeks(event.target.value)
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

                    <label className={styles.field}>
                      <span>{t("teacherSchedule.recurring.validUntil")}</span>
                      <input
                        type="date"
                        value={seriesValidUntil}
                        min={formatZonedDateForInput(
                          selectedLesson.starts_at,
                          scheduleTimezone,
                        )}
                        onChange={(event) =>
                          setSeriesValidUntil(event.target.value)
                        }
                      />
                    </label>

                    <label className={styles.field}>
                      <span>{t("teacherSchedule.zoomUrl")}</span>
                      <input
                        type="url"
                        value={seriesZoomUrl}
                        onChange={(event) => setSeriesZoomUrl(event.target.value)}
                        placeholder="https://..."
                      />
                    </label>

                    <div className={styles.inlineActions}>
                      <Button
                        variant="primary"
                        size="large"
                        onClick={handleSaveRecurringSeries}
                        disabled={savingRecurringSeries}
                      >
                        {savingRecurringSeries
                          ? t("teacherSchedule.recurring.editFromHere.saving")
                          : t("teacherSchedule.recurring.editFromHere.save")}
                      </Button>

                      <Button
                        variant="secondary"
                        onClick={() => setEditingRecurringSeries(false)}
                        disabled={savingRecurringSeries}
                      >
                        {t("teacherSchedule.recurring.editFromHere.cancel")}
                      </Button>
                    </div>
                  </div>
                )}

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

              {selectedLesson.status !== "cancelled" &&
                !editingRecurringSeries && (
                <div className={styles.zoomEditor}>
                  {editingZoom ? (
                    <>
                      <label className={styles.field}>
                        <span>{t("teacherSchedule.zoomEdit.label")}</span>
                        <input
                          type="url"
                          value={lessonZoomDraft}
                          onChange={(event) =>
                            setLessonZoomDraft(event.target.value)
                          }
                          placeholder="https://..."
                        />
                      </label>

                      <div className={styles.inlineActions}>
                        <Button
                          variant="primary"
                          size="large"
                          onClick={handleSaveLessonZoom}
                          disabled={savingZoom}
                        >
                          {savingZoom
                            ? t("teacherSchedule.zoomEdit.saving")
                            : t("teacherSchedule.zoomEdit.save")}
                        </Button>

                        <Button
                          variant="secondary"
                          onClick={() => {
                            setLessonZoomDraft(selectedLesson.zoom_url || "");
                            setEditingZoom(false);
                          }}
                          disabled={savingZoom}
                        >
                          {t("teacherSchedule.zoomEdit.cancel")}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setLessonZoomDraft(selectedLesson.zoom_url || "");
                        setEditingZoom(true);
                      }}
                    >
                      {t("teacherSchedule.zoomEdit.button")}
                    </Button>
                  )}
                </div>
              )}

              {errorMessage && <p className={styles.error}>{errorMessage}</p>}
              {successMessage && <p className={styles.success}>{successMessage}</p>}

              <div className={styles.lessonActions}>
                {isLessonStarted(selectedLesson) &&
                  selectedLesson.status !== "cancelled" && (
                    <>
                      {selectedLesson.status !== "completed" && (
                        <Button
                          variant="success"
                          onClick={() => handleSetLessonOutcome("completed")}
                          disabled={updatingOutcome}
                        >
                          {t("teacherSchedule.outcome.completed")}
                        </Button>
                      )}

                      {selectedLesson.status !== "missed" && (
                        <Button
                          variant="warning"
                          onClick={() => handleSetLessonOutcome("missed")}
                          disabled={updatingOutcome}
                        >
                          {t("teacherSchedule.outcome.missed")}
                        </Button>
                      )}
                    </>
                  )}

                {selectedLesson.status === "scheduled" &&
                  !isLessonStarted(selectedLesson) && (
                    <>
                      {selectedLesson.recurring_lesson_id && (
                        <Button
                          variant="secondary"
                          onClick={handleStartEditRecurringSeries}
                          disabled={
                            loadingRecurringSeries ||
                            savingRecurringSeries ||
                            cancellingSeriesId === selectedLesson.recurring_lesson_id ||
                            cancellingLessonId === selectedLesson.id ||
                            savingRecurringSeries
                          }
                        >
                          {loadingRecurringSeries
                            ? t("teacherSchedule.recurring.editFromHere.loading")
                            : t("teacherSchedule.recurring.editFromHere.button")}
                        </Button>
                      )}

                      <Button
                        variant="danger"
                        onClick={handleCancelLesson}
                        disabled={
                          cancellingLessonId === selectedLesson.id ||
                          cancellingSeriesId === selectedLesson.recurring_lesson_id ||
                          savingRecurringSeries
                        }
                      >
                        {cancellingLessonId === selectedLesson.id
                          ? t("teacherSchedule.cancel.cancelling")
                          : t("teacherSchedule.cancel.button")}
                      </Button>

                      {selectedLesson.recurring_lesson_id && (
                        <Button
                          variant="danger"
                          onClick={handleCancelRecurringSeriesFromLesson}
                          disabled={
                            cancellingSeriesId === selectedLesson.recurring_lesson_id ||
                            cancellingLessonId === selectedLesson.id
                          }
                        >
                          {cancellingSeriesId === selectedLesson.recurring_lesson_id
                            ? t(
                                "teacherSchedule.recurring.cancelFromHere.cancelling",
                              )
                            : t(
                                "teacherSchedule.recurring.cancelFromHere.button",
                              )}
                        </Button>
                      )}
                    </>
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

const parseInputDate = (value) => {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

const formatDateForInput = (date) => {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
};

const formatZonedDateForInput = (value, timezone) => {
  const parts = getDatePartsInTimezone(value, timezone);

  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
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


const getCreateRecurringLessonError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("INVALID_WEEKDAY")) {
    return t("teacherSchedule.recurring.errors.weekday");
  }

  if (message.includes("INVALID_INTERVAL_WEEKS")) {
    return t("teacherSchedule.recurring.errors.interval");
  }

  if (message.includes("VALID_FROM_IN_PAST")) {
    return t("teacherSchedule.recurring.errors.past");
  }

  if (message.includes("INVALID_DATE_RANGE")) {
    return t("teacherSchedule.recurring.errors.dateRange");
  }

  if (message.includes("NO_OCCURRENCE_IN_DATE_RANGE")) {
    return t("teacherSchedule.recurring.errors.noOccurrence");
  }

  if (message.includes("OUTSIDE_WORKING_HOURS")) {
    return t("teacherSchedule.errors.workingHours");
  }

  if (message.includes("INVALID_TIME_SLOT")) {
    return t("teacherSchedule.errors.invalidSlot");
  }

  if (message.includes("RECURRING_TEACHER_CONFLICT")) {
    return t("teacherSchedule.recurring.errors.teacherConflict");
  }

  if (message.includes("RECURRING_STUDENT_CONFLICT")) {
    return t("teacherSchedule.recurring.errors.studentConflict");
  }

  if (message.includes("STUDENT_NOT_FOUND")) {
    return t("teacherSchedule.errors.studentNotFound");
  }

  return t("teacherSchedule.recurring.errors.create");
};

const isLessonStarted = (lesson) => {
  return new Date(lesson.starts_at).getTime() <= Date.now();
};

const getUpdateLessonZoomError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("LESSON_CANCELLED")) {
    return t("teacherSchedule.zoomEdit.errors.cancelled");
  }

  if (message.includes("LESSON_NOT_FOUND")) {
    return t("teacherSchedule.zoomEdit.errors.notFound");
  }

  return t("teacherSchedule.zoomEdit.errors.generic");
};

const getLessonOutcomeError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("LESSON_NOT_STARTED")) {
    return t("teacherSchedule.outcome.errors.notStarted");
  }

  if (message.includes("LESSON_CANCELLED")) {
    return t("teacherSchedule.outcome.errors.cancelled");
  }

  if (message.includes("LESSON_NOT_FOUND")) {
    return t("teacherSchedule.outcome.errors.notFound");
  }

  return t("teacherSchedule.outcome.errors.generic");
};

const getEditRecurringSeriesError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("NOT_RECURRING_LESSON")) {
    return t("teacherSchedule.recurring.editFromHere.errors.notRecurring");
  }

  if (message.includes("LESSON_NOT_SCHEDULED")) {
    return t("teacherSchedule.recurring.editFromHere.errors.notScheduled");
  }

  if (message.includes("PAST_LESSON_CANNOT_BE_EDITED")) {
    return t("teacherSchedule.recurring.editFromHere.errors.past");
  }

  if (message.includes("LESSON_NOT_FOUND") ||
      message.includes("RECURRING_LESSON_NOT_FOUND")) {
    return t("teacherSchedule.recurring.editFromHere.errors.notFound");
  }

  if (message.includes("INVALID_WEEKDAY")) {
    return t("teacherSchedule.recurring.errors.weekday");
  }

  if (message.includes("INVALID_INTERVAL_WEEKS")) {
    return t("teacherSchedule.recurring.errors.interval");
  }

  if (message.includes("INVALID_DATE_RANGE")) {
    return t("teacherSchedule.recurring.errors.dateRange");
  }

  if (message.includes("NO_OCCURRENCE_IN_DATE_RANGE")) {
    return t("teacherSchedule.recurring.errors.noOccurrence");
  }

  if (message.includes("OUTSIDE_WORKING_HOURS")) {
    return t("teacherSchedule.errors.workingHours");
  }

  if (message.includes("INVALID_TIME_SLOT")) {
    return t("teacherSchedule.errors.invalidSlot");
  }

  if (message.includes("RECURRING_TEACHER_CONFLICT")) {
    return t("teacherSchedule.recurring.errors.teacherConflict");
  }

  if (message.includes("RECURRING_STUDENT_CONFLICT")) {
    return t("teacherSchedule.recurring.errors.studentConflict");
  }

  return t("teacherSchedule.recurring.editFromHere.errors.generic");
};

const getCancelRecurringSeriesError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("NOT_RECURRING_LESSON")) {
    return t("teacherSchedule.recurring.cancelFromHere.errors.notRecurring");
  }

  if (message.includes("LESSON_NOT_SCHEDULED")) {
    return t("teacherSchedule.recurring.cancelFromHere.errors.notScheduled");
  }

  if (message.includes("PAST_LESSON_CANNOT_BE_CANCELLED")) {
    return t("teacherSchedule.recurring.cancelFromHere.errors.past");
  }

  if (message.includes("LESSON_NOT_FOUND")) {
    return t("teacherSchedule.recurring.cancelFromHere.errors.notFound");
  }

  return t("teacherSchedule.recurring.cancelFromHere.errors.generic");
};

const getCancelLessonError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("LESSON_ALREADY_CANCELLED")) {
    return t("teacherSchedule.cancel.errors.alreadyCancelled");
  }

  if (message.includes("COMPLETED_LESSON_CANNOT_BE_CANCELLED")) {
    return t("teacherSchedule.cancel.errors.completed");
  }

  if (message.includes("PAST_LESSON_CANNOT_BE_CANCELLED")) {
    return t("teacherSchedule.cancel.errors.past");
  }

  if (message.includes("LESSON_NOT_FOUND")) {
    return t("teacherSchedule.cancel.errors.notFound");
  }

  return t("teacherSchedule.cancel.errors.generic");
};

export default TeacherSchedule;
