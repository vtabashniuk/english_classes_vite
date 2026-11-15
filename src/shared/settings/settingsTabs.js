/** Pure URL helpers: usable by both teacher and student settings pages. */
export const getSettingsTab = (search, validTabs, defaultTab = "profile") => {
  const valid = new Set(validTabs);
  const requested = new URLSearchParams(search).get("tab");
  return requested && valid.has(requested) ? requested : defaultTab;
};

/** Keep unrelated query parameters intact when changing a tab. */
export const withSettingsTab = (search, tab) => {
  const params = new URLSearchParams(search);
  params.set("tab", tab);
  return `?${params.toString()}`;
};

/** Old teacher settings deep links must keep working after migration. */
export const TEACHER_LEGACY_SETTINGS_ANCHORS = Object.freeze({
  "finance-preferences": "finance",
  "payment-accounts": "finance",
  "payment-instructions": "finance",
  "tax-profile": "taxes",
  "tax-parameters": "taxes",
});

export const getLegacyTeacherSettingsTab = (hash) =>
  TEACHER_LEGACY_SETTINGS_ANCHORS[String(hash || "").replace(/^#/, "")] ?? null;
