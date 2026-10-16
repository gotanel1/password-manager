import { afterEach, describe, expect, it, vi } from "vitest"
import config from "../vite.config"

afterEach(() => vi.unstubAllEnvs())
describe("production / mock separation", () => {
  it("refuses any production build with VAULT_MOCK enabled", async () => {
    vi.stubEnv("VAULT_MOCK", "1")
    await expect(async () => (config as Function)({ command: "build", mode: "production" })).rejects.toThrow("development-only")
  })
  it("uses dummy public values and the mock alias only in development", async () => {
    vi.stubEnv("VAULT_MOCK", "1")
    const value = await (config as Function)({ command: "serve", mode: "development" })
    expect(value.resolve.alias[0].replacement).toMatch(/mock-supabase\.ts$/)
    expect(value.define["import.meta.env.SUPABASE_ANON_KEY"]).toBe('"mock"')
    expect(value.envPrefix).toEqual([])
  })
  it("allows only the two public environment values in a real build", async () => {
    vi.stubEnv("VAULT_MOCK", "0")
    vi.stubEnv("SUPABASE_URL", "https://test-project.supabase.co")
    vi.stubEnv("SUPABASE_ANON_KEY", "public-test-key")
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "secret-must-not-be-exposed")
    const value = await (config as Function)({ command: "build", mode: "production" })
    expect(value.resolve.alias).toEqual([])
    expect(Object.keys(value.define)).toEqual(["import.meta.env.SUPABASE_URL", "import.meta.env.SUPABASE_ANON_KEY"])
    expect(JSON.stringify(value.define)).not.toContain("secret-must-not-be-exposed")
  })
  it.each(["sb_secret_test-only", `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`])("refuses privileged keys without printing their values", async (key) => {
    vi.stubEnv("VAULT_MOCK", "0")
    vi.stubEnv("SUPABASE_ANON_KEY", key)
    expect(() => (config as Function)({ command: "serve", mode: "development" })).toThrow("public anon/publishable")
  })
})
