import {
  assertLocalAdminResetConfig,
  assertUserMatchesExpectedEmail,
} from "./lib/localAdminSafety.mjs";

// Validate target and explicit intent BEFORE loading the Supabase SDK or
// initializing any privileged client. Never allow a cloud Supabase URL.
const {
  supabaseUrl,
  serviceRoleKey,
  userId,
  expectedEmail,
  newPassword,
} = assertLocalAdminResetConfig(process.env, process.argv.slice(2));

const { createClient } = await import("@supabase/supabase-js");
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// An ID typo must not silently reset another local user's password.
const { data: existing, error: lookupError } = await supabase.auth.admin.getUserById(userId);
if (lookupError || !existing?.user) {
  throw new Error("Could not verify local test user. Password not changed.");
}
assertUserMatchesExpectedEmail(existing.user.email, expectedEmail);

const { error } = await supabase.auth.admin.updateUserById(userId, {
  password: newPassword,
});
if (error) {
  throw new Error("Local test password reset failed. Check the local Supabase logs.");
}

console.log("Local test password updated for:", expectedEmail);
