export const getCreateLessonError = (error, t) => {
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


export const getCreateRecurringLessonError = (error, t) => {
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

export const getUpdateLessonZoomError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("LESSON_CANCELLED")) {
    return t("teacherSchedule.zoomEdit.errors.cancelled");
  }

  if (message.includes("LESSON_NOT_FOUND")) {
    return t("teacherSchedule.zoomEdit.errors.notFound");
  }

  return t("teacherSchedule.zoomEdit.errors.generic");
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
