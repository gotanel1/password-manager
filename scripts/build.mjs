// Prepares site/ for deploy: vendors supabase-js and writes config.js from env vars.
// Netlify runs this as the build command; locally, put the vars in .env.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY (set them in Netlify env vars or .env)");
  process.exit(1);
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) {
  console.error(`SUPABASE_URL looks wrong: ${url}`);
  process.exit(1);
}

mkdirSync("site/vendor", { recursive: true });
copyFileSync("node_modules/@supabase/supabase-js/dist/umd/supabase.js", "site/vendor/supabase.js");
writeFileSync("site/config.js",
  `window.APP_CONFIG = ${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: anonKey })};\n`);
console.log(`Built site/ for ${url}`);
