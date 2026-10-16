import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

// SUPABASE_URL / SUPABASE_ANON_KEY come from Netlify env vars (or .env locally).
// VAULT_MOCK=1 swaps Supabase for an in-memory fake so the UI can be exercised offline.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "SUPABASE_")
  const mock = process.env.VAULT_MOCK === "1"
  if (command === "build" && mock) throw new Error("VAULT_MOCK is development-only; production builds must use real Supabase")
  if (!mock) {
    const key = env.SUPABASE_ANON_KEY ?? ""
    let serviceRole = false
    try { serviceRole = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString()).role === "service_role" } catch { /* Publishable keys are not JWTs. */ }
    if (key.startsWith("sb_secret_") || serviceRole) throw new Error("SUPABASE_ANON_KEY must be a public anon/publishable key; never use a secret/service_role key")
  }
  if (command === "build" && !mock) {
    const url = env.SUPABASE_URL ?? ""
    if (!url || !env.SUPABASE_ANON_KEY) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY (set them in Netlify env vars or .env)")
    }
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) {
      throw new Error(`SUPABASE_URL looks wrong: ${url}`)
    }
  }
  return {
    plugins: [react(), tailwindcss()],
    // Only these two public values may enter the client bundle.
    envPrefix: [],
    define: {
      "import.meta.env.SUPABASE_URL": JSON.stringify(mock ? "http://127.0.0.1:1" : env.SUPABASE_URL ?? ""),
      "import.meta.env.SUPABASE_ANON_KEY": JSON.stringify(mock ? "mock" : env.SUPABASE_ANON_KEY ?? ""),
    },
    resolve: {
      alias: mock ? [{ find: "@supabase/supabase-js", replacement: path.resolve(import.meta.dirname, "src/dev/mock-supabase.ts") }] : [],
    },
    build: { sourcemap: false, chunkSizeWarningLimit: 700 },
  }
})
