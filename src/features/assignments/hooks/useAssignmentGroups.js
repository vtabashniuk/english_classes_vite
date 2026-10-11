import { useEffect, useMemo, useState } from "react";
import { DEFAULT_HISTORY_PAGE_SIZE, getPageCount } from "../../../shared/pagination/pagination";

const GROUPS = ["pending", "completed"];
const initialPages = { pending: 0, completed: 0 };

export default function useAssignmentGroups(fetchGroup, identity, pageSize = DEFAULT_HISTORY_PAGE_SIZE) {
  const [pages, setPages] = useState(initialPages);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState({ requestKey: null, error: null,
    pending: { items: [], count: 0 }, completed: { items: [], count: 0 } });

  const pendingPageSize = typeof pageSize === "number" ? pageSize : pageSize.pending;
  const completedPageSize = typeof pageSize === "number" ? pageSize : pageSize.completed;
  const pageSizes = useMemo(
    () => ({ pending: pendingPageSize, completed: completedPageSize }),
    [pendingPageSize, completedPageSize],
  );
  const requestKey = `${identity}:${pages.pending}:${pages.completed}:${pageSizes.pending}:${pageSizes.completed}:${reloadKey}`;

  useEffect(() => {
    let cancelled = false;
    // This remains asynchronous to avoid set-state-in-effect lint and stale request updates.
    const load = async () => {
      try {
        const queries = GROUPS.map((key) => fetchGroup({
          status: key === "pending" ? "assigned" : "completed",
          page: pages[key], pageSize: pageSizes[key],
        }));
        const responses = await Promise.all(queries);
        const error = responses.find((response) => response.error)?.error;
        if (error) throw error;
        if (cancelled) return;
        // Completion / edits may empty the last page: navigate to the nearest valid page.
        const invalidGroup = GROUPS.find((key, i) => pages[key] >= getPageCount(responses[i].count ?? 0, pageSizes[key]));
        if (invalidGroup) {
          setPages((current) => ({ ...current,
            [invalidGroup]: getPageCount(responses[GROUPS.indexOf(invalidGroup)].count ?? 0, pageSizes[invalidGroup]) - 1 }));
          return;
        }
        setResult({ requestKey, error: null,
          pending: { items: responses[0].data ?? [], count: responses[0].count ?? 0 },
          completed: { items: responses[1].data ?? [], count: responses[1].count ?? 0 } });
      } catch (error) {
        if (!cancelled) setResult({ requestKey, error,
          pending: { items: [], count: 0 }, completed: { items: [], count: 0 } });
      }
    };
    load();
    return () => { cancelled = true; };
  }, [fetchGroup, identity, pageSizes, pages, reloadKey, requestKey]);

  const setPage = (key, nextPage) => setPages((current) => ({ ...current, [key]: nextPage }));
  const reload = () => setReloadKey((value) => value + 1);
  return { ...result, loading: result.requestKey !== requestKey,
    pages, pageSize, pageSizes, setPage, reload };
}
