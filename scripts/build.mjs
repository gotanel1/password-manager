// Prepares site/ for deploy: vendors supabase-js and the fonts, and writes config.js from env vars.
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
// Self-hosted fonts (the CSP allows no third-party origins): only the latin + thai woff2 subsets we use.
const FONTS = [
  ["ibm-plex-sans-thai", [400, 500, 600]],
  ["ibm-plex-mono", [400, 500]],
  ["source-serif-4", [600]],
  ["noto-serif-thai", [600]],
];
mkdirSync("site/vendor/fonts", { recursive: true });
let fontCss = "";
for (const [pkg, weights] of FONTS) {
  const dir = `node_modules/@fontsource/${pkg}`;
  for (const w of weights) {
    for (const face of readFileSync(`${dir}/${w}.css`, "utf8").match(/@font-face\s*{[^}]*}/g)) {
      const file = face.match(/url\(\.\/files\/([^)]+\.woff2)\)/)[1];
      if (!/-(latin|thai)-\d+-normal\.woff2$/.test(file)) continue;
      copyFileSync(`${dir}/files/${file}`, `site/vendor/fonts/${file}`);
      fontCss += face.replace(/src:[^;]*;/, `src: url(fonts/${file}) format('woff2');`) + "\n";
    }
  }
}
writeFileSync("site/vendor/fonts.css", fontCss);

writeFileSync("site/config.js",
  `window.APP_CONFIG = ${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: anonKey })};\n`);
console.log(`Built site/ for ${url}`);
