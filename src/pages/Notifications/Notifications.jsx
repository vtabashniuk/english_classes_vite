import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getTimezone } from "../../constants/timezones";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { getIntlLocale } from "../../utils/getIntlLocale";

import styles from "./Notifications.module.css";

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
  const intlLocale = getIntlLocale(i18n.resolvedLanguage || i18n.language);

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.is_read).length,
    [notifications],
  );

  const loadNotifications = async () => {
    try {
      setErrorMessage("");

      const { data, error } = await supabase
        .from("notifications")
        .select(
          "id, type, lesson_id, title_key, body_key, data, is_read, created_at",
        )
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      setNotifications(data ?? []);
    } catch (error) {
      console.error("Notification load error:", error);
      setErrorMessage(t("notifications.errors.load"));
    }
  };

  useEffect(() => {
    const initialize = async () => {
      try {
        setLoading(true);
        await loadNotifications();
      } finally {
        setLoading(false);
      }
    };

    initialize();
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

  const getBody = (notification) => {
    const startsAt = notification.data?.startsAt;

    return t(notification.body_key, {
      studentName: notification.data?.studentName || t("notifications.student"),
      date: startsAt ? formatDate(startsAt) : "—",
      time: startsAt ? formatTime(startsAt) : "—",
      duration: notification.data?.durationMinutes,
    });
  };

  const markAsRead = async (notificationId) => {
    try {
      setProcessingId(notificationId);
      setErrorMessage("");

      const { error } = await supabase.rpc("mark_notification_read", {
        p_notification_id: notificationId,
      });

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

      const { error } = await supabase.rpc("mark_all_notifications_read");

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
          {notifications.map((notification) => (
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
          ))}
        </div>
      )}
    </section>
  );
};

export default Notifications;
