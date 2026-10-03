import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import {
  createPaymentAccount,
  getMyCurrentTaxProfile,
  getMyTaxParameterOverrides,
  getMyTaxParameters,
  getMyTaxProfiles,
  getTeacherPaymentAccounts,
  setMyTaxParameters,
  setMyTaxProfile,
} from "../../features/finance/api/financeApi";
import {
  getMyTeacherScheduleSettings,
  getMyTeacherWorkingHours,
  updateMyFinancePreferences,
  updateMyScheduleSettings,
} from "../../features/settings/api/teacherSettingsApi";
import { TIMEZONES } from "../../constants/timezones";
import {
  DEFAULT_FINANCE_SETTINGS,
  FINANCE_CURRENCIES,
  FINANCE_HISTORY_PAGE_SIZE_OPTIONS,
  MAX_FREE_CANCELLATION_HOURS,
  MAX_LOW_BALANCE_LESSONS,
  MIN_FREE_CANCELLATION_HOURS,
  MIN_LOW_BALANCE_LESSONS,
} from "../../constants/finance";
import {
  createDefaultWorkingHours,
  DEFAULT_SCHEDULE_SETTINGS,
  LESSON_DURATION_STEP,
  MAX_LESSON_DURATION,
  MIN_LESSON_DURATION,
  WEEKDAYS,
} from "../../constants/schedule";
import { formatFinanceMoney } from "../../utils/formatFinanceMoney";

import styles from "./TeacherSettings.module.css";

const DEFAULT_PARAMETER_VALUES = {
  minimum_wage_minor: "",
  living_wage_minor: "",
  esv_rate: "",
  group1_single_tax_rate: "",
  group1_military_levy_rate: "",
  group2_single_tax_rate: "",
  group2_military_levy_rate: "",
  group3_single_tax_rate: "",
  group3_military_levy_rate: "",
};

const TeacherSettings = () => {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language;
  const location = useLocation();

  const [timezone, setTimezone] = useState(DEFAULT_SCHEDULE_SETTINGS.timezone);
  const [workingHours, setWorkingHours] = useState(createDefaultWorkingHours);
  const [lessonDurationMinutes, setLessonDurationMinutes] = useState(
    DEFAULT_SCHEDULE_SETTINGS.lessonDurationMinutes,
  );
  const [teacherToday, setTeacherToday] = useState(getBrowserDateString());
  const [lowBalanceThresholdLessons, setLowBalanceThresholdLessons] = useState(
    DEFAULT_FINANCE_SETTINGS.lowBalanceLessonsThreshold,
  );
  const [freeCancellationHours, setFreeCancellationHours] = useState(
    DEFAULT_FINANCE_SETTINGS.freeCancellationHours,
  );
  const [historyPageSize, setHistoryPageSize] = useState(
    DEFAULT_FINANCE_SETTINGS.historyPageSize,
  );

  const [taxProfiles, setTaxProfiles] = useState([]);
  const [currentTaxProfile, setCurrentTaxProfile] = useState(null);
  const [taxpayerType, setTaxpayerType] = useState("none");
  const [peGroup, setPeGroup] = useState(3);
  const [taxEffectiveFrom, setTaxEffectiveFrom] = useState(getBrowserDateString());
  const [taxEditing, setTaxEditing] = useState(false);

  const [parameterOverrides, setParameterOverrides] = useState([]);
  const [parameterEffectiveFrom, setParameterEffectiveFrom] = useState(
    getBrowserDateString(),
  );
  const [parameterValues, setParameterValues] = useState(DEFAULT_PARAMETER_VALUES);
  const [parameterSources, setParameterSources] = useState({});

  const [paymentAccounts, setPaymentAccounts] = useState([]);
  const [accountName, setAccountName] = useState("");
  const [accountCurrency, setAccountCurrency] = useState("UAH");
  const [accountOwnerType, setAccountOwnerType] = useState("personal");
  const [accountType, setAccountType] = useState("card");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [financePreferencesSaving, setFinancePreferencesSaving] = useState(false);
  const [financePreferencesError, setFinancePreferencesError] = useState("");
  const [financePreferencesSuccess, setFinancePreferencesSuccess] = useState("");

  const [taxSaving, setTaxSaving] = useState(false);
  const [taxErrorMessage, setTaxErrorMessage] = useState("");
  const [taxSuccessMessage, setTaxSuccessMessage] = useState("");

  const [parameterSaving, setParameterSaving] = useState(false);
  const [parameterError, setParameterError] = useState("");
  const [parameterSuccess, setParameterSuccess] = useState("");

  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [accountSuccess, setAccountSuccess] = useState("");

  const scheduledTaxProfiles = useMemo(
    () =>
      taxProfiles
        .filter((profile) => profile.effective_from > teacherToday)
        .sort((a, b) => a.effective_from.localeCompare(b.effective_from)),
    [taxProfiles, teacherToday],
  );

  const scheduledParameterOverrides = useMemo(
    () =>
      parameterOverrides
        .filter((item) => item.effective_from > teacherToday)
        .sort((a, b) => {
          const dateCompare = a.effective_from.localeCompare(b.effective_from);
          return dateCompare || a.code.localeCompare(b.code);
        }),
    [parameterOverrides, teacherToday],
  );

  const profileForParameterDate = useMemo(
    () => getProfileForDate(taxProfiles, parameterEffectiveFrom),
    [taxProfiles, parameterEffectiveFrom],
  );

  const activePeGroup =
    profileForParameterDate?.taxpayer_type === "pe"
      ? Number(profileForParameterDate.pe_group)
      : null;
  const hasAnyPeProfile = taxProfiles.some((profile) => profile.taxpayer_type === "pe");
  const peTaxEnabled = currentTaxProfile?.taxpayer_type === "pe";
  const resolvedAccountOwnerType =
    peTaxEnabled && accountOwnerType === "pe" ? "pe" : "personal";
  const availableAccountTypes =
    resolvedAccountOwnerType === "pe"
      ? ["bank_account", "card", "cash"]
      : ["card", "cash"];
  const resolvedAccountType = availableAccountTypes.includes(accountType)
    ? accountType
    : availableAccountTypes[0];

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setLoading(true);
        setErrorMessage("");
        setTaxErrorMessage("");

        const [
          scheduleResult,
          workingHoursResult,
          taxProfilesResult,
          currentProfileResult,
          accountsResult,
        ] = await Promise.all([
          getMyTeacherScheduleSettings(),
          getMyTeacherWorkingHours(),
          getMyTaxProfiles(),
          getMyCurrentTaxProfile(),
          getTeacherPaymentAccounts(),
        ]);

        const initialError =
          scheduleResult.error ||
          workingHoursResult.error ||
          taxProfilesResult.error ||
          currentProfileResult.error ||
          accountsResult.error;
        if (initialError) throw initialError;

        const data = scheduleResult.data;
        const resolvedTimezone =
          data?.schedule_timezone || DEFAULT_SCHEDULE_SETTINGS.timezone;
        const today = getDateInTimeZone(resolvedTimezone);
        const profiles = taxProfilesResult.data ?? [];
        const current = currentProfileResult.data ?? null;
        const nextPeProfile = profiles.find(
          (profile) =>
            profile.taxpayer_type === "pe" && profile.effective_from > today,
        );
        const initialParameterDate =
          current?.taxpayer_type === "pe"
            ? today
            : (nextPeProfile?.effective_from ?? today);

        const [parametersResult, overridesResult] = await Promise.all([
          getMyTaxParameters(initialParameterDate),
          getMyTaxParameterOverrides(),
        ]);
        if (parametersResult.error || overridesResult.error) {
          throw parametersResult.error || overridesResult.error;
        }

        setTimezone(resolvedTimezone);
        setTeacherToday(today);
        setLowBalanceThresholdLessons(
          Number(
            data?.low_balance_threshold_lessons ??
              DEFAULT_FINANCE_SETTINGS.lowBalanceLessonsThreshold,
          ),
        );
        setFreeCancellationHours(
          Number(
            data?.free_cancellation_hours ??
              DEFAULT_FINANCE_SETTINGS.freeCancellationHours,
          ),
        );
        setHistoryPageSize(
          Number(
            data?.finance_history_page_size ??
              DEFAULT_FINANCE_SETTINGS.historyPageSize,
          ),
        );
        setWorkingHours(
          normalizeWorkingHours(
            workingHoursResult.data,
            data?.workday_start?.slice(0, 5) ||
              DEFAULT_SCHEDULE_SETTINGS.workdayStart,
            data?.workday_end?.slice(0, 5) ||
              DEFAULT_SCHEDULE_SETTINGS.workdayEnd,
          ),
        );
        setLessonDurationMinutes(
          data?.lesson_duration_minutes ??
            DEFAULT_SCHEDULE_SETTINGS.lessonDurationMinutes,
        );

        setTaxProfiles(profiles);
        setCurrentTaxProfile(current);
        const baseProfile = current ?? profiles.at(-1) ?? null;
        if (baseProfile) {
          setTaxpayerType(baseProfile.taxpayer_type);
          setPeGroup(Number(baseProfile.pe_group ?? 3));
          setTaxEditing(false);
        } else {
          setTaxEditing(true);
        }
        setTaxEffectiveFrom(today);

        setParameterEffectiveFrom(initialParameterDate);
        setParameterOverrides(overridesResult.data ?? []);
        applyResolvedParameters(parametersResult.data ?? [], {
          setParameterValues,
          setParameterSources,
        });

        setPaymentAccounts(accountsResult.data ?? []);
      } catch (error) {
        console.error("Load teacher settings error:", error);
        setErrorMessage(t("teacherSettings.errors.load"));
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, [t]);

  useEffect(() => {
    if (loading || !location.hash) return;

    const targetId = decodeURIComponent(location.hash.slice(1));
    const target = document.getElementById(targetId);
    if (!target) return;

    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [loading, location.hash]);

  const handleWorkingHoursChange = (weekday, field, value) => {
    setWorkingHours((current) =>
      current.map((item) =>
        item.weekday === weekday ? { ...item, [field]: value } : item,
      ),
    );
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    const duration = Number(lessonDurationMinutes);
    const invalidWorkingDay = workingHours.some((item) => {
      if (!item.isWorking) return false;
      if (!item.workdayStart || !item.workdayEnd) return true;

      const startMinutes = timeValueToMinutes(item.workdayStart);
      const endMinutes = timeValueToMinutes(item.workdayEnd);

      return endMinutes <= startMinutes || endMinutes - startMinutes < duration;
    });

    if (invalidWorkingDay) {
      setErrorMessage(t("teacherSettings.errors.invalidWorkingHours"));
      return;
    }

    try {
      setSaving(true);
      const { error } = await updateMyScheduleSettings({
        timezone,
        workingHours,
        lessonDurationMinutes: duration,
      });
      if (error) throw error;

      setTeacherToday(getDateInTimeZone(timezone));
      setSuccessMessage(t("teacherSettings.messages.saved"));
    } catch (error) {
      console.error("Update teacher settings error:", error);
      setErrorMessage(getSettingsError(error, t));
    } finally {
      setSaving(false);
    }
  };

  const handleFinancePreferencesSubmit = async (event) => {
    event.preventDefault();
    setFinancePreferencesError("");
    setFinancePreferencesSuccess("");

    const threshold = Number(lowBalanceThresholdLessons);
    if (
      !Number.isInteger(threshold) ||
      threshold < MIN_LOW_BALANCE_LESSONS ||
      threshold > MAX_LOW_BALANCE_LESSONS
    ) {
      setFinancePreferencesError(
        t("teacherSettings.financePreferences.errors.invalidThreshold"),
      );
      return;
    }

    const cancellationHours = Number(freeCancellationHours);
    if (
      !Number.isInteger(cancellationHours) ||
      cancellationHours < MIN_FREE_CANCELLATION_HOURS ||
      cancellationHours > MAX_FREE_CANCELLATION_HOURS
    ) {
      setFinancePreferencesError(
        t("teacherSettings.financePreferences.errors.invalidCancellationHours"),
      );
      return;
    }

    const resolvedHistoryPageSize = Number(historyPageSize);
    if (!FINANCE_HISTORY_PAGE_SIZE_OPTIONS.includes(resolvedHistoryPageSize)) {
      setFinancePreferencesError(
        t("teacherSettings.financePreferences.errors.invalidHistoryPageSize"),
      );
      return;
    }

    try {
      setFinancePreferencesSaving(true);
      const { error } = await updateMyFinancePreferences({
        lowBalanceThresholdLessons: threshold,
        freeCancellationHours: cancellationHours,
        historyPageSize: resolvedHistoryPageSize,
      });
      if (error) throw error;

      setLowBalanceThresholdLessons(threshold);
      setFreeCancellationHours(cancellationHours);
      setHistoryPageSize(resolvedHistoryPageSize);
      setFinancePreferencesSuccess(
        t("teacherSettings.financePreferences.messages.saved"),
      );
    } catch (error) {
      console.error("Update finance preferences error:", error);
      setFinancePreferencesError(
        t("teacherSettings.financePreferences.errors.save"),
      );
    } finally {
      setFinancePreferencesSaving(false);
    }
  };

  const startTaxEditing = () => {
    const baseProfile = currentTaxProfile ?? scheduledTaxProfiles.at(-1) ?? null;
    setTaxpayerType(baseProfile?.taxpayer_type ?? "none");
    setPeGroup(Number(baseProfile?.pe_group ?? 3));
    setTaxEffectiveFrom(teacherToday);
    setTaxErrorMessage("");
    setTaxSuccessMessage("");
    setTaxEditing(true);
  };

  const handleTaxSubmit = async (event) => {
    event.preventDefault();
    setTaxErrorMessage("");
    setTaxSuccessMessage("");

    if (!taxEffectiveFrom) {
      setTaxErrorMessage(t("teacherSettings.tax.errors.dateRequired"));
      return;
    }

    if (taxEffectiveFrom < teacherToday) {
      setTaxErrorMessage(t("teacherSettings.tax.errors.pastDate"));
      return;
    }

    try {
      setTaxSaving(true);
      const { error } = await setMyTaxProfile({
        taxpayerType,
        peGroup: taxpayerType === "pe" ? Number(peGroup) : null,
        effectiveFrom: taxEffectiveFrom,
      });
      if (error) throw error;

      const [profilesResult, currentResult] = await Promise.all([
        getMyTaxProfiles(),
        getMyCurrentTaxProfile(),
      ]);
      if (profilesResult.error || currentResult.error) {
        throw profilesResult.error || currentResult.error;
      }

      setTaxProfiles(profilesResult.data ?? []);
      setCurrentTaxProfile(currentResult.data ?? null);
      setTaxEditing(false);
      setTaxSuccessMessage(t("teacherSettings.tax.messages.saved"));
    } catch (error) {
      console.error("Update tax settings error:", error);
      setTaxErrorMessage(getTaxSettingsError(error, t));
    } finally {
      setTaxSaving(false);
    }
  };

  const handleParameterDateChange = async (nextDate) => {
    setParameterEffectiveFrom(nextDate);
    setParameterError("");
    setParameterSuccess("");
    if (!nextDate) return;

    try {
      const result = await getMyTaxParameters(nextDate);
      if (result.error) throw result.error;
      applyResolvedParameters(result.data ?? [], {
        setParameterValues,
        setParameterSources,
      });
    } catch (error) {
      console.error("Load tax parameters for date error:", error);
      setParameterError(t("teacherSettings.finance.parametersError"));
    }
  };

  const handleParameterSubmit = async (event) => {
    event.preventDefault();
    setParameterError("");
    setParameterSuccess("");

    if (parameterEffectiveFrom < teacherToday) {
      setParameterError(t("teacherSettings.finance.pastDate"));
      return;
    }

    if (!activePeGroup) {
      setParameterError(t("teacherSettings.finance.noPeForDate"));
      return;
    }

    const values = buildParameterPayload(activePeGroup, parameterValues);
    if (!values) {
      setParameterError(t("teacherSettings.finance.invalidParameter"));
      return;
    }

    try {
      setParameterSaving(true);
      const result = await setMyTaxParameters({
        effectiveFrom: parameterEffectiveFrom,
        values,
      });
      if (result.error) throw result.error;

      const [parametersResult, overridesResult] = await Promise.all([
        getMyTaxParameters(parameterEffectiveFrom),
        getMyTaxParameterOverrides(),
      ]);
      if (parametersResult.error || overridesResult.error) {
        throw parametersResult.error || overridesResult.error;
      }

      applyResolvedParameters(parametersResult.data ?? [], {
        setParameterValues,
        setParameterSources,
      });
      setParameterOverrides(overridesResult.data ?? []);
      setParameterSuccess(t("teacherSettings.finance.parametersSaved"));
    } catch (error) {
      console.error("Save tax parameters error:", error);
      setParameterError(getTaxParameterError(error, t));
    } finally {
      setParameterSaving(false);
    }
  };

  const handleAccountSubmit = async (event) => {
    event.preventDefault();
    setAccountError("");
    setAccountSuccess("");

    const normalizedName = accountName.trim();
    if (!normalizedName) {
      setAccountError(t("teacherSettings.finance.accountNameRequired"));
      return;
    }

    const provider = resolvedAccountType === "cash" ? "manual" : "monobank";

    try {
      setAccountSaving(true);
      const result = await createPaymentAccount({
        name: normalizedName,
        provider,
        accountType: resolvedAccountType,
        ownerType: resolvedAccountOwnerType,
        currency: accountCurrency,
      });
      if (result.error) throw result.error;

      const accountsResult = await getTeacherPaymentAccounts();
      if (accountsResult.error) throw accountsResult.error;

      setPaymentAccounts(accountsResult.data ?? []);
      setAccountName("");
      setAccountSuccess(t("teacherSettings.finance.accountCreated"));
    } catch (error) {
      console.error("Create payment account error:", error);
      setAccountError(getAccountError(error, t));
    } finally {
      setAccountSaving(false);
    }
  };

  if (loading) {
    return (
      <section className={styles.page}>
        <div className={styles.state}>{t("teacherSettings.loading")}</div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{t("teacherSettings.title")}</h1>
          <p>{t("teacherSettings.description")}</p>
        </div>
      </header>

      <div className={styles.content}>
        <form id="schedule-settings" className={styles.card} onSubmit={handleSubmit}>
          <div className={styles.cardHeader}>
            <h2>{t("teacherSettings.scheduleTitle")}</h2>
            <p>{t("teacherSettings.scheduleDescription")}</p>
          </div>

          <label className={styles.field}>
            <span>{t("teacherSettings.timezone")}</span>
            <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
              {TIMEZONES.map((item) => (
                <option key={item.value} value={item.value}>
                  {t(item.labelKey)}
                </option>
              ))}
            </select>
            <small>{t("teacherSettings.timezoneHint")}</small>
          </label>

          <div className={styles.workingDays}>
            <div className={styles.workingDaysHeader}>
              <strong>{t("teacherSettings.workingDaysTitle")}</strong>
              <small>{t("teacherSettings.workingDaysHint")}</small>
            </div>

            {workingHours.map((item) => {
              const day = WEEKDAYS.find((weekday) => weekday.value === item.weekday);

              return (
                <div key={item.weekday} className={styles.workingDayRow}>
                  <label className={styles.workingDayToggle}>
                    <input
                      type="checkbox"
                      checked={item.isWorking}
                      onChange={(event) =>
                        handleWorkingHoursChange(
                          item.weekday,
                          "isWorking",
                          event.target.checked,
                        )
                      }
                    />
                    <span>{t(`teacherSettings.weekdays.${day.key}`)}</span>
                  </label>

                  <div className={styles.workingDayTimes}>
                    <input
                      type="time"
                      step="1800"
                      value={item.workdayStart}
                      disabled={!item.isWorking}
                      aria-label={t("teacherSettings.workdayStart")}
                      onChange={(event) =>
                        handleWorkingHoursChange(
                          item.weekday,
                          "workdayStart",
                          event.target.value,
                        )
                      }
                    />
                    <span>—</span>
                    <input
                      type="time"
                      step="1800"
                      value={item.workdayEnd}
                      disabled={!item.isWorking}
                      aria-label={t("teacherSettings.workdayEnd")}
                      onChange={(event) =>
                        handleWorkingHoursChange(
                          item.weekday,
                          "workdayEnd",
                          event.target.value,
                        )
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <label className={styles.field}>
            <span>{t("teacherSettings.lessonDuration")}</span>
            <select
              value={lessonDurationMinutes}
              onChange={(event) => setLessonDurationMinutes(Number(event.target.value))}
            >
              {createDurationOptions().map((minutes) => (
                <option key={minutes} value={minutes}>
                  {t("teacherSettings.minutes", { count: minutes })}
                </option>
              ))}
            </select>
            <small>{t("teacherSettings.lessonDurationHint")}</small>
          </label>

          <div className={styles.readOnlyField}>
            <span>{t("teacherSettings.slotInterval")}</span>
            <strong>
              {t("teacherSettings.minutes", {
                count: DEFAULT_SCHEDULE_SETTINGS.slotIntervalMinutes,
              })}
            </strong>
            <small>{t("teacherSettings.slotIntervalHint")}</small>
          </div>

          {errorMessage && <p className={styles.error}>{errorMessage}</p>}
          {successMessage && <p className={styles.success}>{successMessage}</p>}

          <div className={styles.actions}>
            <button type="submit" className={styles.primaryButton} disabled={saving}>
              {saving ? t("teacherSettings.saving") : t("teacherSettings.save")}
            </button>
          </div>
        </form>

        <form
          id="finance-preferences"
          className={styles.card}
          onSubmit={handleFinancePreferencesSubmit}
        >
          <div className={styles.cardHeader}>
            <h2>{t("teacherSettings.financePreferences.title")}</h2>
            <p>{t("teacherSettings.financePreferences.description")}</p>
          </div>

          <label className={styles.field}>
            <span>{t("teacherSettings.financePreferences.lowBalanceThreshold")}</span>
            <input
              type="number"
              min={MIN_LOW_BALANCE_LESSONS}
              max={MAX_LOW_BALANCE_LESSONS}
              step="1"
              value={lowBalanceThresholdLessons}
              onChange={(event) =>
                setLowBalanceThresholdLessons(event.target.value)
              }
              disabled={financePreferencesSaving}
            />
            <small>{t("teacherSettings.financePreferences.lowBalanceHint")}</small>
          </label>

          <label className={styles.field}>
            <span>{t("teacherSettings.financePreferences.freeCancellationHours")}</span>
            <input
              type="number"
              min={MIN_FREE_CANCELLATION_HOURS}
              max={MAX_FREE_CANCELLATION_HOURS}
              step="1"
              value={freeCancellationHours}
              onChange={(event) => setFreeCancellationHours(event.target.value)}
              disabled={financePreferencesSaving}
            />
            <small>{t("teacherSettings.financePreferences.freeCancellationHint")}</small>
          </label>

          <label className={styles.field}>
            <span>{t("teacherSettings.financePreferences.historyPageSize")}</span>
            <select
              value={historyPageSize}
              onChange={(event) => setHistoryPageSize(Number(event.target.value))}
              disabled={financePreferencesSaving}
            >
              {FINANCE_HISTORY_PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <small>{t("teacherSettings.financePreferences.historyPageSizeHint")}</small>
          </label>

          {financePreferencesError && (
            <p className={styles.error}>{financePreferencesError}</p>
          )}
          {financePreferencesSuccess && (
            <p className={styles.success}>{financePreferencesSuccess}</p>
          )}

          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={financePreferencesSaving}
            >
              {financePreferencesSaving
                ? t("teacherSettings.financePreferences.saving")
                : t("teacherSettings.financePreferences.save")}
            </button>
          </div>
        </form>

        <section id="tax-profile" className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>{t("teacherSettings.tax.title")}</h2>
            <p>{t("teacherSettings.tax.description")}</p>
          </div>

          {!taxEditing ? (
            <>
              <div className={styles.savedTaxProfile}>
                <span>{t("teacherSettings.tax.currentStatus")}</span>
                <strong>{formatTaxProfile(currentTaxProfile, t)}</strong>
                {currentTaxProfile?.effective_from && (
                  <small>
                    {t("teacherSettings.tax.activeSince", {
                      date: formatDate(currentTaxProfile.effective_from),
                    })}
                  </small>
                )}
              </div>

              {scheduledTaxProfiles.length > 0 && (
                <div className={styles.scheduledList}>
                  <strong>{t("teacherSettings.tax.scheduledTitle")}</strong>
                  {scheduledTaxProfiles.map((profile) => (
                    <div key={profile.id} className={styles.scheduledItem}>
                      <span>{formatTaxProfile(profile, t)}</span>
                      <small>
                        {t("teacherSettings.tax.fromDate", {
                          date: formatDate(profile.effective_from),
                        })}
                      </small>
                    </div>
                  ))}
                </div>
              )}

              {taxSuccessMessage && <p className={styles.success}>{taxSuccessMessage}</p>}

              <div className={styles.actions}>
                <button type="button" className={styles.secondaryButton} onClick={startTaxEditing}>
                  {t("teacherSettings.tax.edit")}
                </button>
              </div>
            </>
          ) : (
            <form className={styles.inlineForm} onSubmit={handleTaxSubmit}>
              <label className={styles.field}>
                <span>{t("teacherSettings.tax.taxpayerType")}</span>
                <select
                  value={taxpayerType}
                  onChange={(event) => setTaxpayerType(event.target.value)}
                  disabled={taxSaving}
                >
                  <option value="none">{t("teacherSettings.tax.types.none")}</option>
                  <option value="pe">{t("teacherSettings.tax.types.pe")}</option>
                </select>
                <small>{t("teacherSettings.tax.taxpayerTypeHint")}</small>
              </label>

              {taxpayerType === "pe" ? (
                <label className={styles.field}>
                  <span>{t("teacherSettings.tax.peGroup")}</span>
                  <select
                    value={peGroup}
                    onChange={(event) => setPeGroup(Number(event.target.value))}
                    disabled={taxSaving}
                  >
                    <option value={1}>{t("teacherSettings.tax.groups.1")}</option>
                    <option value={2}>{t("teacherSettings.tax.groups.2")}</option>
                    <option value={3}>{t("teacherSettings.tax.groups.3")}</option>
                  </select>
                  <small>{t("teacherSettings.finance.parametersFollowProfile")}</small>
                </label>
              ) : (
                <div className={styles.readOnlyField}>
                  <span>{t("teacherSettings.tax.noTaxTitle")}</span>
                  <small>{t("teacherSettings.tax.noTaxHint")}</small>
                </div>
              )}

              <label className={styles.field}>
                <span>{t("teacherSettings.tax.effectiveFrom")}</span>
                <input
                  type="date"
                  min={teacherToday}
                  value={taxEffectiveFrom}
                  onChange={(event) => setTaxEffectiveFrom(event.target.value)}
                  disabled={taxSaving}
                />
                <small>{t("teacherSettings.tax.effectiveFromHint")}</small>
              </label>

              {taxErrorMessage && <p className={styles.error}>{taxErrorMessage}</p>}

              <div className={styles.actionsSplit}>
                {taxProfiles.length > 0 && (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => setTaxEditing(false)}
                    disabled={taxSaving}
                  >
                    {t("common.cancel")}
                  </button>
                )}
                <button type="submit" className={styles.primaryButton} disabled={taxSaving}>
                  {taxSaving ? t("teacherSettings.tax.saving") : t("teacherSettings.tax.save")}
                </button>
              </div>
            </form>
          )}
        </section>

        <section id="tax-parameters" className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>{t("teacherSettings.finance.parametersTitle")}</h2>
            <p>{t("teacherSettings.finance.parametersDescription")}</p>
          </div>

          {hasAnyPeProfile ? (
            <>
              <form className={styles.inlineForm} onSubmit={handleParameterSubmit}>
                <label className={styles.field}>
                  <span>{t("teacherSettings.finance.effectiveFrom")}</span>
                  <input
                    type="date"
                    min={teacherToday}
                    value={parameterEffectiveFrom}
                    onChange={(event) => handleParameterDateChange(event.target.value)}
                    disabled={parameterSaving}
                  />
                </label>

                {activePeGroup ? (
                  <>
                    <div className={styles.sectionBadge}>
                      {t("teacherSettings.finance.groupLabel", { group: activePeGroup })}
                    </div>
                    <div className={styles.referenceGrid}>
                      <MoneyParameterField
                        label={t("teacherSettings.finance.minimumWage")}
                        code="minimum_wage_minor"
                        value={parameterValues.minimum_wage_minor}
                        source={parameterSources.minimum_wage_minor}
                        onChange={setParameterValues}
                        t={t}
                        disabled={parameterSaving}
                      />

                      {activePeGroup === 1 && (
                        <MoneyParameterField
                          label={t("teacherSettings.finance.livingWage")}
                          code="living_wage_minor"
                          value={parameterValues.living_wage_minor}
                          source={parameterSources.living_wage_minor}
                          onChange={setParameterValues}
                          t={t}
                          disabled={parameterSaving}
                        />
                      )}

                      <RateParameterField
                        label={t("teacherSettings.finance.singleTaxRate")}
                        code={`group${activePeGroup}_single_tax_rate`}
                        value={parameterValues[`group${activePeGroup}_single_tax_rate`]}
                        source={parameterSources[`group${activePeGroup}_single_tax_rate`]}
                        onChange={setParameterValues}
                        t={t}
                        disabled={parameterSaving}
                      />

                      <RateParameterField
                        label={t("teacherSettings.finance.militaryRate")}
                        code={`group${activePeGroup}_military_levy_rate`}
                        value={parameterValues[`group${activePeGroup}_military_levy_rate`]}
                        source={parameterSources[`group${activePeGroup}_military_levy_rate`]}
                        onChange={setParameterValues}
                        t={t}
                        disabled={parameterSaving}
                      />

                      <RateParameterField
                        label={t("teacherSettings.finance.esvRate")}
                        code="esv_rate"
                        value={parameterValues.esv_rate}
                        source={parameterSources.esv_rate}
                        onChange={setParameterValues}
                        t={t}
                        disabled={parameterSaving}
                      />
                    </div>
                  </>
                ) : (
                  <p className={styles.hint}>{t("teacherSettings.finance.noPeForDate")}</p>
                )}

                {parameterError && <p className={styles.error}>{parameterError}</p>}
                {parameterSuccess && <p className={styles.success}>{parameterSuccess}</p>}

                <div className={styles.actions}>
                  <button
                    type="submit"
                    className={styles.primaryButton}
                    disabled={parameterSaving || !activePeGroup}
                  >
                    {parameterSaving
                      ? t("teacherSettings.finance.savingParameters")
                      : t("teacherSettings.finance.saveParameters")}
                  </button>
                </div>
              </form>

              <div className={styles.scheduledList}>
                <strong>{t("teacherSettings.finance.scheduledParameters")}</strong>
                {scheduledParameterOverrides.length > 0 ? (
                  scheduledParameterOverrides.map((item) => (
                    <div key={item.id} className={styles.scheduledItem}>
                      <div className={styles.scheduledText}>
                        <span>{formatParameterName(item.code, t)}</span>
                        <strong>{formatParameterValue(item, language)}</strong>
                      </div>
                      <small>{formatDate(item.effective_from)}</small>
                    </div>
                  ))
                ) : (
                  <p className={styles.hint}>{t("teacherSettings.finance.noScheduledParameters")}</p>
                )}
              </div>
            </>
          ) : (
            <p className={styles.hint}>{t("teacherSettings.finance.parametersOnlyPe")}</p>
          )}
        </section>

        <section id="payment-accounts" className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>{t("teacherSettings.finance.accountsTitle")}</h2>
            <p>{t("teacherSettings.finance.accountsDescription")}</p>
          </div>

          {paymentAccounts.length > 0 ? (
            <div className={styles.accountList}>
              {paymentAccounts.map((account) => (
                <div key={account.id} className={styles.accountItem}>
                  <div>
                    <strong>{account.name}</strong>
                    <small>
                      {account.currency} · {formatAccountOwner(account.owner_type, t)} · {formatAccountType(account.account_type, t)}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.hint}>{t("teacherSettings.finance.noAccounts")}</p>
          )}

          <form className={styles.inlineForm} onSubmit={handleAccountSubmit}>
            <div className={styles.referenceGrid}>
              <label className={`${styles.field} ${styles.fullField}`}>
                <span>{t("teacherSettings.finance.accountName")}</span>
                <input
                  type="text"
                  value={accountName}
                  onChange={(event) => setAccountName(event.target.value)}
                  placeholder={t("teacherSettings.finance.accountNamePlaceholder")}
                  maxLength={100}
                  disabled={accountSaving}
                />
              </label>

              <label className={styles.field}>
                <span>{t("teacherSettings.finance.currency")}</span>
                <select
                  value={accountCurrency}
                  onChange={(event) => setAccountCurrency(event.target.value)}
                  disabled={accountSaving}
                >
                  {FINANCE_CURRENCIES.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>{t("teacherSettings.finance.owner")}</span>
                <select
                  value={resolvedAccountOwnerType}
                  onChange={(event) => setAccountOwnerType(event.target.value)}
                  disabled={accountSaving}
                >
                  <option value="personal">{t("teacherSettings.finance.ownerPersonal")}</option>
                  {peTaxEnabled && (
                    <option value="pe">{t("teacherSettings.finance.ownerPe")}</option>
                  )}
                </select>
              </label>

              <label className={styles.field}>
                <span>{t("teacherSettings.finance.accountType")}</span>
                <select
                  value={resolvedAccountType}
                  onChange={(event) => setAccountType(event.target.value)}
                  disabled={accountSaving}
                >
                  {availableAccountTypes.map((type) => (
                    <option key={type} value={type}>
                      {formatAccountType(type, t)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {!peTaxEnabled && (
              <p className={styles.hint}>{t("teacherSettings.finance.peAccountDisabled")}</p>
            )}
            {accountError && <p className={styles.error}>{accountError}</p>}
            {accountSuccess && <p className={styles.success}>{accountSuccess}</p>}

            <div className={styles.actions}>
              <button type="submit" className={styles.secondaryButton} disabled={accountSaving}>
                {accountSaving
                  ? t("teacherSettings.finance.creatingAccount")
                  : t("teacherSettings.finance.createAccount")}
              </button>
            </div>
          </form>
        </section>
      </div>
    </section>
  );
};

const MoneyParameterField = ({ label, code, value, source, onChange, t, disabled }) => (
  <label className={styles.field}>
    <span>{label}</span>
    <input
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(event) =>
        onChange((current) => ({ ...current, [code]: event.target.value }))
      }
      disabled={disabled}
      placeholder="0,00"
    />
    <small>{formatSource(source, t)}</small>
  </label>
);

const RateParameterField = ({ label, code, value, source, onChange, t, disabled }) => (
  <label className={styles.field}>
    <span>{label}</span>
    <input
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(event) =>
        onChange((current) => ({ ...current, [code]: event.target.value }))
      }
      disabled={disabled}
      placeholder="0,00"
    />
    <small>{formatSource(source, t)}</small>
  </label>
);

const createDurationOptions = () => {
  const options = [];
  for (
    let value = MIN_LESSON_DURATION;
    value <= MAX_LESSON_DURATION;
    value += LESSON_DURATION_STEP
  ) {
    options.push(value);
  }
  return options;
};

const applyResolvedParameters = (
  rows,
  { setParameterValues, setParameterSources },
) => {
  const nextValues = { ...DEFAULT_PARAMETER_VALUES };
  const nextSources = {};

  rows.forEach((item) => {
    const numeric = Number(item.value_numeric);
    nextValues[item.code] =
      item.unit === "uah_minor"
        ? toDecimalInput(numeric / 100)
        : toDecimalInput(numeric * 100);
    nextSources[item.code] = item.source;
  });

  setParameterValues(nextValues);
  setParameterSources(nextSources);
};

const buildParameterPayload = (group, values) => {
  const minimumWage = parseMajorMoney(values.minimum_wage_minor);
  const esvRate = parsePercent(values.esv_rate);
  const singleRate = parsePercent(values[`group${group}_single_tax_rate`]);
  const militaryRate = parsePercent(values[`group${group}_military_levy_rate`]);

  if (
    !isPositiveInteger(minimumWage) ||
    !isValidRatio(esvRate) ||
    !isValidRatio(singleRate) ||
    !isValidRatio(militaryRate)
  ) {
    return null;
  }

  const payload = {
    minimum_wage_minor: minimumWage,
    esv_rate: esvRate,
    [`group${group}_single_tax_rate`]: singleRate,
    [`group${group}_military_levy_rate`]: militaryRate,
  };

  if (group === 1) {
    const livingWage = parseMajorMoney(values.living_wage_minor);
    if (!isPositiveInteger(livingWage)) return null;
    payload.living_wage_minor = livingWage;
  }

  return payload;
};

const parseMajorMoney = (value) => {
  const numeric = Number(String(value ?? "").trim().replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) return NaN;
  return Math.round(numeric * 100);
};

const parsePercent = (value) => {
  const numeric = Number(String(value ?? "").trim().replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) return NaN;
  return numeric / 100;
};

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
const isValidRatio = (value) => Number.isFinite(value) && value > 0 && value <= 1;

const toDecimalInput = (value) => {
  if (!Number.isFinite(Number(value))) return "";
  return String(Number(value)).replace(".", ",");
};

const getBrowserDateString = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

const getDateInTimeZone = (timeZone) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const getProfileForDate = (profiles, date) =>
  profiles
    .filter(
      (profile) =>
        profile.effective_from <= date &&
        (!profile.effective_to || date < profile.effective_to),
    )
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;

const formatTaxProfile = (profile, t) => {
  if (!profile) return t("teacherSettings.tax.notConfigured");
  if (profile.taxpayer_type === "none") return t("teacherSettings.tax.types.none");
  return `${t("teacherSettings.tax.types.pe")} · ${t(`teacherSettings.tax.groups.${profile.pe_group}`)}`;
};

const formatDate = (dateString) => {
  if (!dateString) return "—";
  const [year, month, day] = dateString.split("-");
  return `${day}.${month}.${year}`;
};

const formatSource = (source, t) =>
  source === "teacher"
    ? t("teacherSettings.finance.teacherValue")
    : t("teacherSettings.finance.platformDefault");

const formatParameterName = (code, t) => {
  if (code === "minimum_wage_minor") return t("teacherSettings.finance.minimumWage");
  if (code === "living_wage_minor") return t("teacherSettings.finance.livingWage");
  if (code === "esv_rate") return t("teacherSettings.finance.esvRate");
  if (code.includes("single_tax")) return t("teacherSettings.finance.singleTaxRate");
  return t("teacherSettings.finance.militaryRate");
};

const formatParameterValue = (item, language) => {
  if (item.unit === "uah_minor") {
    return formatFinanceMoney(item.value_numeric, "UAH", language);
  }
  return `${toDecimalInput(Number(item.value_numeric) * 100)}%`;
};

const formatAccountOwner = (ownerType, t) =>
  ownerType === "pe"
    ? t("teacherSettings.finance.ownerPe")
    : t("teacherSettings.finance.ownerPersonal");

const formatAccountType = (accountType, t) => {
  if (accountType === "bank_account") return t("teacherSettings.finance.typeBank");
  if (accountType === "cash") return t("teacherSettings.finance.typeCash");
  return t("teacherSettings.finance.typeCard");
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

const timeValueToMinutes = (value) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

const getSettingsError = (error, t) => {
  const message = error?.message ?? "";
  if (message.includes("INVALID_TIMEZONE")) return t("teacherSettings.errors.invalidTimezone");
  if (message.includes("INVALID_WORKING_HOURS")) return t("teacherSettings.errors.invalidWorkingHours");
  if (message.includes("INVALID_WORKDAY")) return t("teacherSettings.errors.invalidWorkday");
  if (message.includes("INVALID_LESSON_DURATION")) return t("teacherSettings.errors.invalidDuration");
  if (message.includes("WORKDAY_TOO_SHORT")) return t("teacherSettings.errors.workdayTooShort");
  if (message.includes("TEACHER_REQUIRED")) return t("teacherSettings.errors.teacherRequired");
  return t("teacherSettings.errors.save");
};

const getTaxSettingsError = (error, t) => {
  const message = error?.message ?? "";
  if (message.includes("INVALID_PE_GROUP")) return t("teacherSettings.tax.errors.invalidGroup");
  if (message.includes("TAX_PROFILE_PAST_DATE_NOT_ALLOWED")) return t("teacherSettings.tax.errors.pastDate");
  if (message.includes("INVALID_TAXPAYER_TYPE")) return t("teacherSettings.tax.errors.invalidType");
  return t("teacherSettings.tax.errors.save");
};

const getTaxParameterError = (error, t) => {
  const message = error?.message ?? "";
  if (message.includes("TAX_PARAMETER_PAST_DATE_NOT_ALLOWED")) {
    return t("teacherSettings.finance.pastDate");
  }
  if (
    message.includes("INVALID_TAX_PARAMETER") ||
    message.includes("UNSUPPORTED_TAX_PARAMETER")
  ) {
    return t("teacherSettings.finance.invalidParameter");
  }
  return t("teacherSettings.finance.parametersError");
};

const getAccountError = (error, t) => {
  const message = error?.message ?? "";
  if (message.includes("PE_TAX_PROFILE_REQUIRED")) {
    return t("teacherSettings.finance.peAccountDisabled");
  }
  return t("teacherSettings.finance.accountError");
};

export default TeacherSettings;
