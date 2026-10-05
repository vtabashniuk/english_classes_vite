export const getCreateLessonError = (error, t) => {
  const message = error?.message ?? "";

  if (
    message.includes("NON_WORKING_DAY") ||
    message.includes("WEEKEND_NOT_ALLOWED")
  ) {
    return t("teacherSchedule.errors.nonWorkingDay");
  }

  if (message.includes("OUTSIDE_WORKING_HOURS")) {
    return t("teacherSchedule.errors.workingHours");
  }

  if (message.includes("INVALID_TIME_SLOT")) {
    return t("teacherSchedule.errors.invalidSlot");
  }

  if (message.includes("SCHEDULE_BLOCK_CONFLICT")) {
    return t("teacherSchedule.errors.scheduleBlockConflict");
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


export const getCreateRecurringLessonError = (error, t) => {
  const message = error?.message ?? "";

  if (
    message.includes("INVALID_WEEKDAY") ||
    message.includes("NON_WORKING_DAY")
  ) {
    return t("teacherSchedule.recurring.errors.weekday");
  }

  if (message.includes("INVALID_INTERVAL_WEEKS")) {
    return t("teacherSchedule.recurring.errors.interval");
  }

  if (message.includes("VALID_FROM_IN_PAST")) {
    return t("teacherSchedule.recurring.errors.past");
  }

  if (message.includes("END_DATE_REQUIRED")) {
    return t("teacherSchedule.recurring.errors.endDateRequired");
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

  if (message.includes("RECURRING_BLOCK_SERIES_CONFLICT")) {
    return t("teacherSchedule.recurring.errors.blockSeriesConflict");
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

export const getUpdateLessonScheduleError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("RECURRING_LESSON_REQUIRES_SERIES_EDIT")) {
    return t("teacherSchedule.lessonEdit.errors.recurring");
  }

  if (message.includes("LESSON_NOT_SCHEDULED")) {
    return t("teacherSchedule.lessonEdit.errors.notScheduled");
  }

  if (message.includes("PAST_LESSON_CANNOT_BE_EDITED") ||
      message.includes("LESSON_IN_PAST")) {
    return t("teacherSchedule.lessonEdit.errors.past");
  }

  if (message.includes("CANCELLATION_REQUEST_PENDING")) {
    return t("teacherSchedule.lessonEdit.errors.cancellationPending");
  }

  if (message.includes("RESCHEDULE_REQUEST_PENDING")) {
    return t("teacherSchedule.lessonEdit.errors.reschedulePending");
  }

  if (
    message.includes("NON_WORKING_DAY") ||
    message.includes("WEEKEND_NOT_ALLOWED")
  ) {
    return t("teacherSchedule.errors.nonWorkingDay");
  }

  if (message.includes("OUTSIDE_WORKING_HOURS")) {
    return t("teacherSchedule.errors.workingHours");
  }

  if (message.includes("INVALID_TIME_SLOT")) {
    return t("teacherSchedule.errors.invalidSlot");
  }

  if (message.includes("SCHEDULE_BLOCK_CONFLICT")) {
    return t("teacherSchedule.errors.scheduleBlockConflict");
  }

  if (message.includes("LESSON_TIME_CONFLICT")) {
    return t("teacherSchedule.errors.conflict");
  }

  if (message.includes("LESSON_NOT_FOUND")) {
    return t("teacherSchedule.lessonEdit.errors.notFound");
  }

  return t("teacherSchedule.lessonEdit.errors.generic");
};

export const getUpdateLessonMeetingUrlError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("LESSON_CANCELLED")) {
    return t("teacherSchedule.meetingLinkEdit.errors.cancelled");
  }

  if (message.includes("LESSON_NOT_FOUND")) {
    return t("teacherSchedule.meetingLinkEdit.errors.notFound");
  }

  return t("teacherSchedule.meetingLinkEdit.errors.generic");
};

export const getLessonOutcomeError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("LESSON_NOT_STARTED")) {
    return t("teacherSchedule.outcome.errors.notStarted");
  }

  if (message.includes("LESSON_CANCELLED")) {
    return t("teacherSchedule.outcome.errors.cancelled");
  }

  if (message.includes("LESSON_PRICE_NOT_SET")) {
    return t("teacherSchedule.outcome.errors.priceNotSet");
  }

  if (message.includes("CANCELLATION_REQUEST_PENDING")) {
    return t("teacherSchedule.outcome.errors.cancellationPending");
  }

  if (message.includes("LESSON_NOT_FOUND")) {
    return t("teacherSchedule.outcome.errors.notFound");
  }

  return t("teacherSchedule.outcome.errors.generic");
};

export const getEditRecurringSeriesError = (error, t) => {
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

  if (
    message.includes("INVALID_WEEKDAY") ||
    message.includes("NON_WORKING_DAY")
  ) {
    return t("teacherSchedule.recurring.errors.weekday");
  }

  if (message.includes("INVALID_INTERVAL_WEEKS")) {
    return t("teacherSchedule.recurring.errors.interval");
  }

  if (message.includes("END_DATE_REQUIRED")) {
    return t("teacherSchedule.recurring.errors.endDateRequired");
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

  if (message.includes("RECURRING_BLOCK_SERIES_CONFLICT")) {
    return t("teacherSchedule.recurring.errors.blockSeriesConflict");
  }

  if (message.includes("RECURRING_TEACHER_CONFLICT")) {
    return t("teacherSchedule.recurring.errors.teacherConflict");
  }

  if (message.includes("RECURRING_STUDENT_CONFLICT")) {
    return t("teacherSchedule.recurring.errors.studentConflict");
  }

  return t("teacherSchedule.recurring.editFromHere.errors.generic");
};

export const getCancelRecurringSeriesError = (error, t) => {
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

export const getCancelLessonError = (error, t) => {
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


export const getScheduleBlockError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("RECURRING_BLOCK_LESSON_SERIES_CONFLICT")) {
    return t("teacherSchedule.scheduleBlock.recurring.errors.lessonSeriesConflict");
  }

  if (message.includes("RECURRING_BLOCK_SERIES_CONFLICT")) {
    return t("teacherSchedule.scheduleBlock.recurring.errors.seriesConflict");
  }

  if (message.includes("RECURRING_BLOCK_REQUIRES_SERIES_EDIT")) {
    return t("teacherSchedule.scheduleBlock.recurring.errors.useSeriesEdit");
  }

  if (message.includes("NOT_RECURRING_BLOCK")) {
    return t("teacherSchedule.scheduleBlock.recurring.errors.notRecurring");
  }

  if (message.includes("RECURRING_BLOCK_SERIES_NOT_FOUND")) {
    return t("teacherSchedule.scheduleBlock.recurring.errors.notFound");
  }

  if (message.includes("PAST_BLOCK_CANNOT_BE_EDITED") ||
      message.includes("PAST_BLOCK_CANNOT_BE_CANCELLED")) {
    return t("teacherSchedule.scheduleBlock.recurring.errors.past");
  }

  if (message.includes("INVALID_INTERVAL_WEEKS")) {
    return t("teacherSchedule.scheduleBlock.recurring.errors.interval");
  }

  if (message.includes("VALID_FROM_IN_PAST")) {
    return t("teacherSchedule.scheduleBlock.recurring.errors.validFromPast");
  }

  if (message.includes("END_DATE_REQUIRED")) {
    return t("teacherSchedule.scheduleBlock.recurring.errors.endDateRequired");
  }

  if (message.includes("INVALID_DATE_RANGE")) {
    return t("teacherSchedule.scheduleBlock.recurring.errors.dateRange");
  }

  if (message.includes("NO_OCCURRENCE_IN_DATE_RANGE")) {
    return t("teacherSchedule.scheduleBlock.recurring.errors.noOccurrence");
  }

  if (message.includes("SCHEDULE_BLOCK_LESSON_CONFLICT")) {
    return t("teacherSchedule.scheduleBlock.errors.lessonConflict");
  }

  if (message.includes("SCHEDULE_BLOCK_CONFLICT")) {
    return t("teacherSchedule.scheduleBlock.errors.blockConflict");
  }

  if (message.includes("SCHEDULE_BLOCK_NOT_FOUND")) {
    return t("teacherSchedule.scheduleBlock.errors.notFound");
  }

  if (message.includes("SCHEDULE_BLOCK_IN_PAST")) {
    return t("teacherSchedule.scheduleBlock.errors.past");
  }

  if (message.includes("SCHEDULE_BLOCK_INVALID_RANGE")) {
    return t("teacherSchedule.scheduleBlock.errors.range");
  }

  if (message.includes("SCHEDULE_BLOCK_REASON_TOO_LONG")) {
    return t("teacherSchedule.scheduleBlock.errors.reasonTooLong");
  }

  if (message.includes("NON_WORKING_DAY")) {
    return t("teacherSchedule.errors.nonWorkingDay");
  }

  if (message.includes("OUTSIDE_WORKING_HOURS")) {
    return t("teacherSchedule.scheduleBlock.errors.workingHours");
  }

  if (message.includes("INVALID_TIME_SLOT")) {
    return t("teacherSchedule.scheduleBlock.errors.invalidSlot");
  }

  return t("teacherSchedule.scheduleBlock.errors.generic");
};
