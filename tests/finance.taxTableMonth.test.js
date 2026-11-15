import assert from "node:assert/strict";
import test from "node:test";

import { formatTaxTableMonth } from "../src/features/finance/lib/formatTaxTableMonth.js";

for (const [language, locale] of [["ua", "uk-UA"], ["en", "en-GB"], ["ru", "ru-RU"]]) {
  test(`tax table: capitalized short month for ${language}`, () => {
    const expected = new Intl.DateTimeFormat(locale, {
      month: "short", timeZone: "UTC",
    }).format(new Date("2026-10-01T00:00:00Z"));
    const result = formatTaxTableMonth("2026-10-01", language);
    assert.equal(result.month, expected.charAt(0).toLocaleUpperCase(locale) + expected.slice(1));
    assert.equal(result.year, "2026");
  });
}

test("tax table: invalid or missing dates return null", () => {
  for (const invalid of [null, "", "2026-00-01", "2026-13-01", "not-a-date"]) {
    assert.equal(formatTaxTableMonth(invalid, "ua"), null);
  }
});

test("tax table: month-only date strings are supported", () => {
  assert.equal(formatTaxTableMonth("2026-09", "ua").year, "2026");
});
