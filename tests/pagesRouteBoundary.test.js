import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pagesDir = path.join(root, "src/pages");
const router = readFileSync(path.join(root, "src/router.jsx"), "utf8");

const routeModules = Array.from(
  router.matchAll(/const\s+(\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\("(\.\/pages\/[^"\n]+)"\)\);/g),
  ([, component, importPath]) => ({ component, importPath }),
);

test("all page imports are lazy, have a real entry point and are referenced by a route", () => {
  assert.equal(routeModules.length, 24); // Includes the two Google OAuth Gate 4 pages.
  assert.doesNotMatch(router, /import\s+\w+\s+from\s+["']\.\/pages\//);
  for (const { component, importPath } of routeModules) {
    const moduleFile = path.join(root, "src", `${importPath.slice(2)}.jsx`);
    assert.ok(existsSync(moduleFile), `${component}: ${moduleFile} does not exist`);
    assert.ok(router.includes(`showPage(${component})`), `${component} is not used by a route`);
  }
});

test("all page JSX files live in matching directories", () => {
  const rootJsx = readdirSync(pagesDir).filter((file) => file.endsWith(".jsx"));
  assert.deepEqual(rootJsx, []);
  for (const { importPath } of routeModules) {
    const name = path.posix.basename(importPath);
    assert.equal(path.posix.basename(path.posix.dirname(importPath)), name);
  }
});

test("moved recovery and callback pages resolve local imports and styles", () => {
  const moved = ["AboutMePage", "AuthCallback", "ForgotPasswordPage", "GoogleAuthCallback", "GoogleInvitationAcceptance", "NotFoundPage", "ResetPasswordPage"];
  for (const name of moved) {
    const filePath = path.join(pagesDir, name, `${name}.jsx`);
    const text = readFileSync(filePath, "utf8");
    const imports = Array.from(text.matchAll(/from\s+["'](\.[^"']+)["']/g), ([, module]) => module);
    for (const module of imports) {
      const resolved = path.resolve(path.dirname(filePath), module);
      assert.ok(["", ".js", ".jsx"].some((ext) => existsSync(resolved + ext)), `${filePath}: ${module}`);
    }
  }
});
