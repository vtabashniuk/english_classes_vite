import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getTimezone } from "../../constants/timezones";
import { useAuth } from "../../context/useAuth";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../features/notifications/api/notificationsApi";
import { formatFinanceMoney } from "../../utils/formatFinanceMoney";
import { getIntlLocale } from "../../utils/getIntlLocale";

import styles from "./Notifications.module.css";

const fetchNotifications = async () => {
  const { data, error } = await listNotifications();

  if (error) {
    throw error;
  }

  return data ?? [];
};


const Notifications = () => {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [processingId, setProcessingId] = useState(null);
  const [markingAll, setMarkingAll] = useState(false);

  const timezone = profile?.timezone || "Europe/Kyiv";
  const timezoneConfig = getTimezone(timezone);
  const timezoneLabel = timezoneConfig ? t(timezoneConfig.labelKey) : timezone;
  const language = i18n.resolvedLanguage || i18n.language;
  const intlLocale = getIntlLocale(language);

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.is_read).length,
    [notifications],
  );



  useEffect(() => {
    let cancelled = false;

    const refreshNotifications = async ({ showLoading = false } = {}) => {
      try {
        if (showLoading && !cancelled) {
          setLoading(true);
        }

        const nextNotifications = await fetchNotifications();

        if (!cancelled) {
          setErrorMessage("");
          setNotifications(nextNotifications);
        }
      } catch (error) {
        console.error("Notification load error:", error);

        if (!cancelled) {
          setErrorMessage(t("notifications.errors.load"));
        }
      } finally {
        if (showLoading && !cancelled) {
          setLoading(false);
        }
      }
    };

    refreshNotifications({ showLoading: true });

    const handleFocus = () => {
      refreshNotifications();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
    };
  }, [t]);

  const formatDate = (value) =>
    new Intl.DateTimeFormat(intlLocale, {
      timeZone: timezone,
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(new Date(value));

  const formatTime = (value) =>
    new Intl.DateTimeFormat(intlLocale, {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));

  const formatCreatedAt = (value) =>
    new Intl.DateTimeFormat(intlLocale, {
      timeZone: timezone,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));

  const formatCalendarDate = (value) => {
    if (!value) return "—";

    const [year, month, day] = value.split("-").map(Number);

    return new Intl.DateTimeFormat(intlLocale, {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(new Date(year, month - 1, day));
  };

  const formatRateAmount = (amountMinor) => {
    if (amountMinor === null || amountMinor === undefined) return "—";

    return new Intl.NumberFormat(intlLocale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(Number(amountMinor) / 100);
  };



  const getBody = (notification) => {
    const startsAt = notification.data?.startsAt;
    const oldStartsAt = notification.data?.oldStartsAt;
    const rawPriceAmountMinor = notification.data?.priceAmountMinor;
    const priceAmountMinor = Number(rawPriceAmountMinor);
    const priceCurrency = notification.data?.priceCurrency;
    const amount =
      rawPriceAmountMinor !== null &&
      rawPriceAmountMinor !== undefined &&
      Number.isFinite(priceAmountMinor) &&
      priceCurrency
        ? formatFinanceMoney(priceAmountMinor, priceCurrency, language)
        : "—";

    const rawOldPriceAmountMinor = notification.data?.oldPriceAmountMinor;
    const oldPriceAmountMinor = Number(rawOldPriceAmountMinor);
    const oldPriceCurrency = notification.data?.oldPriceCurrency;
    const oldAmount =
      rawOldPriceAmountMinor !== null &&
      rawOldPriceAmountMinor !== undefined &&
      Number.isFinite(oldPriceAmountMinor) &&
      oldPriceCurrency
        ? formatFinanceMoney(oldPriceAmountMinor, oldPriceCurrency, language)
        : "—";

    const hasCurrentPrice = amount !== "—";
    const hasOldPrice = oldAmount !== "—";
    const priceUnchanged =
      hasCurrentPrice &&
      hasOldPrice &&
      priceAmountMinor === oldPriceAmountMinor &&
      priceCurrency === oldPriceCurrency;

    const hasReschedulePriceSnapshot =
      Object.prototype.hasOwnProperty.call(
        notification.data ?? {},
        "oldPriceAmountMinor",
      ) ||
      Object.prototype.hasOwnProperty.call(
        notification.data ?? {},
        "priceAmountMinor",
      );

    let reschedulePriceInfo = "";

    if (hasReschedulePriceSnapshot && (hasCurrentPrice || hasOldPrice)) {
      reschedulePriceInfo = priceUnchanged
        ? t("notifications.reschedulePrice.unchanged", { amount })
        : t("notifications.reschedulePrice.changed", { oldAmount, amount });
    } else if (hasReschedulePriceSnapshot) {
      reschedulePriceInfo = t("notifications.reschedulePrice.notSet");
    }

    return t(notification.body_key, {
      studentName: notification.data?.studentName || t("notifications.student"),
      date: startsAt ? formatDate(startsAt) : "—",
      time: startsAt ? formatTime(startsAt) : "—",
      oldDate: oldStartsAt ? formatDate(oldStartsAt) : "—",
      oldTime: oldStartsAt ? formatTime(oldStartsAt) : "—",
      duration: notification.data?.durationMinutes,
      assignmentTitle: notification.data?.assignmentTitle || "—",
      materialTitle: notification.data?.materialTitle || "—",
      rateAmount: formatRateAmount(notification.data?.newAmountMinor),
      rateCurrency: notification.data?.newCurrency || "—",
      effectiveDate: formatCalendarDate(notification.data?.effectiveFrom),
      amount,
      priceInfo: reschedulePriceInfo,
      waiverReason: notification.data?.waiverReason || "—",
      graceHours: notification.data?.graceHours ?? 18,
    });
  };

  const markAsRead = async (notificationId) => {
    try {
      setProcessingId(notificationId);
      setErrorMessage("");

      const { error } = await markNotificationRead(notificationId);

      if (error) {
        throw error;
      }

      setNotifications((current) =>
        current.map((item) =>
          item.id === notificationId ? { ...item, is_read: true } : item,
        ),
      );

      window.dispatchEvent(new Event("notifications-changed"));
    } catch (error) {
      console.error("Mark notification read error:", error);
      setErrorMessage(t("notifications.errors.markRead"));
    } finally {
      setProcessingId(null);
    }
  };



  const markAllAsRead = async () => {
    try {
      setMarkingAll(true);
      setErrorMessage("");

      const { error } = await markAllNotificationsRead();

      if (error) {
        throw error;
      }

      setNotifications((current) =>
        current.map((item) => ({ ...item, is_read: true })),
      );

      window.dispatchEvent(new Event("notifications-changed"));
    } catch (error) {
      console.error("Mark all notifications read error:", error);
      setErrorMessage(t("notifications.errors.markAllRead"));
    } finally {
      setMarkingAll(false);
    }
  };

  if (loading) {
    return (
      <section className={styles.page}>
        <div className={styles.state}>{t("notifications.loading")}</div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{t("notifications.title")}</h1>
          <p>{t("notifications.description")}</p>
        </div>

        <div className={styles.headerMeta}>
          <span>{t("notifications.timezone")}</span>
          <strong>{timezoneLabel}</strong>
        </div>
      </header>

      <div className={styles.toolbar}>
        <span className={styles.unreadCount}>
          {t("notifications.unreadCount", { count: unreadCount })}
        </span>

        {unreadCount > 0 && (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={markAllAsRead}
            disabled={markingAll}
          >
            {markingAll
              ? t("notifications.markingAllRead")
              : t("notifications.markAllRead")}
          </button>
        )}
      </div>

      {errorMessage && <div className={styles.error}>{errorMessage}</div>}

      {notifications.length === 0 ? (
        <div className={styles.emptyState}>
          <h2>{t("notifications.emptyTitle")}</h2>
          <p>{t("notifications.empty")}</p>
        </div>
      ) : (
        <div className={styles.list}>
          {notifications.map((notification) => {
            return (
              <article
                key={notification.id}
                className={`${styles.card} ${
                  notification.is_read ? styles.read : styles.unread
                }`}
              >
                <div className={styles.cardContent}>
                  <div className={styles.titleRow}>
                    <h2>{t(notification.title_key)}</h2>
                    {!notification.is_read && (
                      <span className={styles.unreadDot} aria-hidden="true" />
                    )}
                  </div>

                  <p>{getBody(notification)}</p>

                  {notification.type === "lesson_request_rejected" &&
                    notification.data?.comment && (
                      <div className={styles.teacherComment}>
                        <strong>{t("notifications.teacherComment")}</strong>
                        <p>{notification.data.comment}</p>
                      </div>
                    )}



                  <time dateTime={notification.created_at}>
                    {formatCreatedAt(notification.created_at)}
                  </time>
                </div>

                {!notification.is_read && (
                  <button
                    type="button"
                    className={styles.markReadButton}
                    onClick={() => markAsRead(notification.id)}
                    disabled={processingId === notification.id}
                  >
                    {processingId === notification.id
                      ? t("notifications.markingRead")
                      : t("notifications.markRead")}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};


export default Notifications;
