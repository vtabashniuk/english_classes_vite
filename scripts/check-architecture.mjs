import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const srcRoot = path.resolve("src");
const allowedSupabaseImport = /src[\\/]features[\\/][^\\/]+[\\/]api[\\/]|src[\\/]shared[\\/]api[\\/]/;
const violations = [];

const walk = async (directory) => {
  for (const name of await readdir(directory)) {
    const filePath = path.join(directory, name);
    const fileStat = await stat(filePath);

    if (fileStat.isDirectory()) {
      await walk(filePath);
      continue;
    }

    if (!/\.(js|jsx)$/.test(name)) {
      continue;
    }

    const source = await readFile(filePath, "utf8");
    const importsSupabaseClient = source.includes("supabaseClient");
    const importsLegacyClient = source.includes("lib/supabase");

    if (
      (importsSupabaseClient || importsLegacyClient) &&
      !allowedSupabaseImport.test(filePath)
    ) {
      violations.push(path.relative(process.cwd(), filePath));
    }
  }
};

await walk(srcRoot);

if (violations.length > 0) {
  console.error("Direct Supabase client access outside the data layer:");
  violations.forEach((file) => console.error(`- ${file}`));
  process.exit(1);
}

console.log("Architecture check passed: UI has no direct Supabase client access.");
