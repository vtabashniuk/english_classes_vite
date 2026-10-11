// Reused by finance history and both assignment histories.
export const DEFAULT_HISTORY_PAGE_SIZE = 20;
export const getPageCount = (total, pageSize) =>
  Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
export const getPageRange = (page, pageSize) => ({
  offset: page * pageSize,
  limit: pageSize,
});
