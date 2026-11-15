import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("dialog keeps keyboard focus inside and restores previous focus", () => {
  const code = source("src/shared/dialog/Dialog.jsx");
  assert.match(code, /event\.key !== "Tab"/);
  assert.match(code, /event\.key === "Escape"/);
  assert.match(code, /previousFocusRef\.current\.focus\(\)/);
  assert.match(code, /aria-modal="true"/);
  assert.match(code, /createPortal/);
});

test("confirmations require explicit actions with translated labels", () => {
  const code = source("src/shared/dialog/ConfirmDialog.jsx");
  assert.match(code, /onClick=\{onConfirm\}/);
  assert.match(code, /onClick=\{onCancel\}/);
  assert.match(code, /cancelLabel/);
  assert.match(code, /confirmLabel/);
});

test("unsaved-changes confirmation shares the same dialog implementation", () => {
  const code = source("src/shared/unsavedChanges/UnsavedChangesDialog.jsx");
  assert.match(code, /import ConfirmDialog from "\.\.\/dialog\/ConfirmDialog"/);
  assert.match(code, /onCancel=\{onStay\}/);
  assert.match(code, /onConfirm=\{onLeave\}/);
});

test("provider resolves promises even when unmounted", () => {
  const code = source("src/shared/dialog/DialogProvider.jsx");
  assert.match(code, /request\.resolve\(false\)/);
  assert.match(code, /queueRef\.current/);
});
