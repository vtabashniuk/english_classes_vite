import { useEffect, useState } from "react";

import { hasPendingLessonRequests } from "../../lessonRequests/api/lessonRequestsApi";
import { hasUnreadNotifications } from "../../notifications/api/notificationsApi";

export const useDashboardIndicators = ({ profile, pathname }) => {
  const [unreadState, setUnreadState] = useState({
    profileId: null,
    value: false,
  });
  const [pendingState, setPendingState] = useState({
    profileId: null,
    value: false,
  });

  const profileId = profile?.id ?? null;
  const isTeacher = profile?.role === "teacher";

  useEffect(() => {
    if (!profileId) {
      return undefined;
    }

    let cancelled = false;

    const loadUnreadState = async () => {
      const { data, error } = await hasUnreadNotifications();

      if (!cancelled && !error) {
        setUnreadState({
          profileId,
          value: (data?.length ?? 0) > 0,
        });
      }
    };

    loadUnreadState();
    window.addEventListener("notifications-changed", loadUnreadState);

    return () => {
      cancelled = true;
      window.removeEventListener("notifications-changed", loadUnreadState);
    };
  }, [profileId, pathname]);

  useEffect(() => {
    if (!profileId || !isTeacher) {
      return undefined;
    }

    let cancelled = false;

    const loadPendingRequestsState = async () => {
      const { data, error } = await hasPendingLessonRequests(profileId);

      if (!cancelled && !error) {
        setPendingState({
          profileId,
          value: (data?.length ?? 0) > 0,
        });
      }
    };

    loadPendingRequestsState();
    window.addEventListener("lesson-requests-changed", loadPendingRequestsState);

    return () => {
      cancelled = true;
      window.removeEventListener(
        "lesson-requests-changed",
        loadPendingRequestsState,
      );
    };
  }, [profileId, isTeacher, pathname]);

  return {
    isTeacher,
    hasUnreadNotifications:
      unreadState.profileId === profileId ? unreadState.value : false,
    hasPendingRequests:
      isTeacher && pendingState.profileId === profileId
        ? pendingState.value
        : false,
  };
};
