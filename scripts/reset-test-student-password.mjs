import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userId = process.env.TEST_USER_ID;
const newPassword = process.env.TEST_USER_PASSWORD;

if (!supabaseUrl || !serviceRoleKey || !userId || !newPassword) {
  throw new Error("Missing required environment variables.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const { data, error } = await supabase.auth.admin.updateUserById(userId, {
  password: newPassword,
});

if (error) {
  console.error(error);
  process.exit(1);
}

console.log("Password updated for:", data.user.email);