import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

// SUPABASE_URL / SUPABASE_ANON_KEY come from Netlify env vars (or .env locally).
// VAULT_MOCK=1 swaps Supabase for an in-memory fake so the UI can be exercised offline.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "SUPABASE_")
  const mock = process.env.VAULT_MOCK === "1"
  if (mock) {
    process.env.SUPABASE_URL ||= "http://127.0.0.1:1"
    process.env.SUPABASE_ANON_KEY ||= "mock"
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
    envPrefix: ["SUPABASE_"],
    resolve: {
      alias: mock ? [{ find: "@supabase/supabase-js", replacement: path.resolve(__dirname, "src/dev/mock-supabase.ts") }] : [],
    },
    build: { sourcemap: false, chunkSizeWarningLimit: 700 },
  }
})
