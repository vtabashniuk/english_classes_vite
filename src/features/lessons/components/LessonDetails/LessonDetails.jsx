import { useTranslation } from "react-i18next";

import Button from "../../../../components/common/ui/Button/Button";
import { WEEKDAYS } from "../../../../constants/schedule";
import {
  formatFullDate,
  formatLessonTime,
  formatZonedDateForInput,
  isLessonStarted,
} from "../../../schedule/lib/scheduleUtils";
import { getMeetingProviderLabel } from "../../lib/meetingProvider";
import LessonTeacherNote from "../LessonTeacherNote/LessonTeacherNote";

import styles from "./LessonDetails.module.css";

const LessonDetails = ({
  lesson,
  locale,
  scheduleTimezone,
  scheduleSettings,
  enabledWorkingHours,
  editingRecurringSeries,
  setEditingRecurringSeries,
  seriesWeekday,
  handleSeriesWeekdayChange,
  seriesTime,
  setSeriesTime,
  seriesTimeSlots,
  seriesIntervalWeeks,
  setSeriesIntervalWeeks,
  seriesValidUntil,
  setSeriesValidUntil,
  seriesMeetingUrl,
  setSeriesMeetingUrl,
  handleSaveRecurringSeries,
  savingRecurringSeries,
  editingLesson,
  setEditingLesson,
  editLessonDate,
  editLessonMinDate,
  handleEditLessonDateChange,
  editLessonTime,
  setEditLessonTime,
  editLessonTimeSlots,
  editLessonMeetingUrl,
  setEditLessonMeetingUrl,
  handleSaveLesson,
  savingLesson,
  editingMeetingUrl,
  setEditingMeetingUrl,
  lessonMeetingUrlDraft,
  setLessonMeetingUrlDraft,
  handleSaveLessonMeetingUrl,
  savingMeetingUrl,
  handleSetLessonOutcome,
  updatingOutcome,
  handleStartEditLesson,
  cancellingLessonId,
  loadingRecurringSeries,
  cancellingSeriesId,
  handleStartEditRecurringSeries,
  handleCancelLesson,
  handleCancelRecurringSeriesFromLesson,
}) => {
  const { t } = useTranslation();

  if (!lesson) return null;

  const started = isLessonStarted(lesson);

  return (
    <div className={styles.lessonDetails}>
      <div className={styles.detailItem}>
        <span>{t("teacherSchedule.student")}</span>
        <strong>{lesson.profiles?.full_name || lesson.profiles?.email || "—"}</strong>
      </div>

      <div className={styles.detailItem}>
        <span>{t("teacherSchedule.date")}</span>
        <strong>{formatFullDate(lesson.starts_at, locale, scheduleTimezone)}</strong>
      </div>

      <div className={styles.detailItem}>
        <span>{t("teacherSchedule.time")}</span>
        <strong>
          {formatLessonTime(lesson.starts_at, locale, scheduleTimezone)}
          {" — "}
          {formatLessonTime(lesson.ends_at, locale, scheduleTimezone)}
        </strong>
      </div>

      <div className={styles.detailItem}>
        <span>{t("teacherSchedule.status")}</span>
        <strong>{t(`teacherSchedule.statuses.${lesson.status}`)}</strong>
      </div>

      {lesson.price_amount_minor != null && lesson.price_currency && (
        <div className={styles.detailItem}>
          <span>{t("teacherSchedule.lessonPrice")}</span>
          <strong>
            {new Intl.NumberFormat(locale, {
              style: "currency",
              currency: lesson.price_currency,
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }).format(Number(lesson.price_amount_minor) / 100)}
          </strong>
        </div>
      )}

      {lesson.pricing_date &&
        lesson.pricing_date !==
          formatZonedDateForInput(lesson.starts_at, scheduleTimezone) && (
          <div className={styles.detailItem}>
            <span>{t("teacherSchedule.pricingDate")}</span>
            <strong>{lesson.pricing_date}</strong>
          </div>
        )}

      {lesson.recurring_lesson_id && (
        <div className={styles.detailItem}>
          <span>{t("teacherSchedule.recurring.series")}</span>
          <strong>{t("teacherSchedule.recurring.seriesYes")}</strong>
        </div>
      )}

      {lesson.recurring_lesson_id &&
        lesson.status === "scheduled" &&
        !started &&
        !editingLesson &&
        editingRecurringSeries && (
          <div className={styles.editorBox}>
            <div>
              <h3>{t("teacherSchedule.recurring.editFromHere.title")}</h3>
              <p>{t("teacherSchedule.recurring.editFromHere.hint")}</p>
            </div>

            <div className={styles.formRow}>
              <label className={styles.field}>
                <span>{t("teacherSchedule.recurring.weekday")}</span>
                <select
                  value={seriesWeekday}
                  onChange={(event) =>
                    handleSeriesWeekdayChange(event.target.value)
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
                  value={seriesTime}
                  onChange={(event) => setSeriesTime(event.target.value)}
                >
                  <option value="">{t("teacherSchedule.selectTime")}</option>
                  {seriesTimeSlots.map((slot) => (
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
                onChange={(event) => setSeriesIntervalWeeks(event.target.value)}
              >
                <option value="1">{t("teacherSchedule.recurring.everyWeek")}</option>
                <option value="2">
                  {t("teacherSchedule.recurring.everyTwoWeeks")}
                </option>
              </select>
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
                value={seriesValidUntil}
                min={formatZonedDateForInput(
                  lesson.starts_at,
                  scheduleTimezone,
                )}
                required={!scheduleSettings.allowOpenEndedRecurringLessons}
                onChange={(event) => setSeriesValidUntil(event.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span>{t("teacherSchedule.meetingUrl")}</span>
              <input
                type="url"
                value={seriesMeetingUrl}
                onChange={(event) => setSeriesMeetingUrl(event.target.value)}
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

      {lesson.status === "scheduled" && !started && editingLesson && (
        <div className={styles.editorBox}>
          <div>
            <h3>
              {t(
                lesson.recurring_lesson_id
                  ? "teacherSchedule.lessonEdit.recurringOccurrenceTitle"
                  : "teacherSchedule.lessonEdit.title",
              )}
            </h3>
            <p>
              {t(
                scheduleSettings.reschedulePricePolicy === "target_date_tariff"
                  ? "teacherSchedule.lessonEdit.hintTargetDateTariff"
                  : "teacherSchedule.lessonEdit.hintKeepOriginal",
              )}
            </p>
          </div>

          <div className={styles.formRow}>
            <label className={styles.field}>
              <span>{t("teacherSchedule.date")}</span>
              <input
                type="date"
                value={editLessonDate}
                min={editLessonMinDate}
                onChange={(event) => handleEditLessonDateChange(event.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span>{t("teacherSchedule.time")}</span>
              <select
                value={editLessonTime}
                onChange={(event) => setEditLessonTime(event.target.value)}
              >
                <option value="">{t("teacherSchedule.selectTime")}</option>
                {editLessonTimeSlots.map((slot) => (
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
              value={editLessonMeetingUrl}
              onChange={(event) => setEditLessonMeetingUrl(event.target.value)}
              placeholder="https://..."
            />
          </label>

          <div className={styles.inlineActions}>
            <Button
              variant="primary"
              size="large"
              onClick={handleSaveLesson}
              disabled={savingLesson}
            >
              {savingLesson
                ? t("teacherSchedule.lessonEdit.saving")
                : t("teacherSchedule.lessonEdit.save")}
            </Button>

            <Button
              variant="secondary"
              onClick={() => setEditingLesson(false)}
              disabled={savingLesson}
            >
              {t("teacherSchedule.lessonEdit.cancel")}
            </Button>
          </div>
        </div>
      )}

      <div className={styles.detailItem}>
        <span>{t("teacherSchedule.meetingUrl")}</span>
        {lesson.meeting_url ? (
          <a href={lesson.meeting_url} target="_blank" rel="noreferrer">
            {getMeetingProviderLabel(lesson.meeting_url, t)} ↗
          </a>
        ) : (
          <strong>—</strong>
        )}
      </div>

      {lesson.status !== "cancelled" &&
        !editingRecurringSeries &&
        !editingLesson && (
          <div className={styles.meetingLinkEditor}>
            {editingMeetingUrl ? (
              <>
                <label className={styles.field}>
                  <span>{t("teacherSchedule.meetingLinkEdit.label")}</span>
                  <input
                    type="url"
                    value={lessonMeetingUrlDraft}
                    onChange={(event) => setLessonMeetingUrlDraft(event.target.value)}
                    placeholder="https://..."
                  />
                </label>

                <div className={styles.inlineActions}>
                  <Button
                    variant="primary"
                    size="large"
                    onClick={handleSaveLessonMeetingUrl}
                    disabled={savingMeetingUrl}
                  >
                    {savingMeetingUrl
                      ? t("teacherSchedule.meetingLinkEdit.saving")
                      : t("teacherSchedule.meetingLinkEdit.save")}
                  </Button>

                  <Button
                    variant="secondary"
                    onClick={() => {
                      setLessonMeetingUrlDraft(lesson.meeting_url || "");
                      setEditingMeetingUrl(false);
                    }}
                    disabled={savingMeetingUrl}
                  >
                    {t("teacherSchedule.meetingLinkEdit.cancel")}
                  </Button>
                </div>
              </>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  setLessonMeetingUrlDraft(lesson.meeting_url || "");
                  setEditingMeetingUrl(true);
                }}
              >
                {t("teacherSchedule.meetingLinkEdit.button")}
              </Button>
            )}
          </div>
        )}

      <LessonTeacherNote lessonId={lesson.id} />

      <div className={styles.lessonActions}>
        {started && lesson.status !== "cancelled" && (
          <>
            {lesson.status !== "completed" && (
              <Button
                variant="success"
                onClick={() => handleSetLessonOutcome("completed")}
                disabled={updatingOutcome}
              >
                {t("teacherSchedule.outcome.completed")}
              </Button>
            )}

            {lesson.status !== "missed" && (
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

        {lesson.status === "scheduled" && !started && !editingLesson && (
          <>
            <Button
              variant="secondary"
              onClick={handleStartEditLesson}
              disabled={
                savingLesson ||
                cancellingLessonId === lesson.id ||
                (Boolean(lesson.recurring_lesson_id) &&
                  (loadingRecurringSeries ||
                    savingRecurringSeries ||
                    cancellingSeriesId === lesson.recurring_lesson_id))
              }
            >
              {t(
                lesson.recurring_lesson_id
                  ? "teacherSchedule.lessonEdit.recurringOccurrenceButton"
                  : "teacherSchedule.lessonEdit.button",
              )}
            </Button>

            {lesson.recurring_lesson_id && (
              <Button
                variant="secondary"
                onClick={handleStartEditRecurringSeries}
                disabled={
                  loadingRecurringSeries ||
                  savingRecurringSeries ||
                  cancellingSeriesId === lesson.recurring_lesson_id ||
                  cancellingLessonId === lesson.id
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
                cancellingLessonId === lesson.id ||
                (Boolean(lesson.recurring_lesson_id) &&
                  cancellingSeriesId === lesson.recurring_lesson_id) ||
                savingRecurringSeries ||
                savingLesson
              }
            >
              {cancellingLessonId === lesson.id
                ? t("teacherSchedule.cancel.cancelling")
                : t("teacherSchedule.cancel.button")}
            </Button>

            {lesson.recurring_lesson_id && (
              <Button
                variant="danger"
                onClick={handleCancelRecurringSeriesFromLesson}
                disabled={
                  cancellingSeriesId === lesson.recurring_lesson_id ||
                  cancellingLessonId === lesson.id
                }
              >
                {cancellingSeriesId === lesson.recurring_lesson_id
                  ? t("teacherSchedule.recurring.cancelFromHere.cancelling")
                  : t("teacherSchedule.recurring.cancelFromHere.button")}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default LessonDetails;
