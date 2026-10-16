import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ result: {} as { data: unknown; error: unknown }, calls: [] as unknown[][] }))
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: (table: string) => {
  h.calls.push(["from", table])
  const query: Record<string, unknown> = {}
  for (const method of ["select", "eq", "insert", "update", "delete"]) query[method] = (...args: unknown[]) => { h.calls.push([method, ...args]); return query }
  query.maybeSingle = query.single = async () => h.result
  query.then = (resolve: (result: unknown) => unknown) => resolve(h.result)
  return query
} }) }))

beforeEach(() => { h.calls = []; vi.resetModules(); vi.stubEnv("SUPABASE_URL", "http://localhost:54321"); vi.stubEnv("SUPABASE_ANON_KEY", "public-test-key") })
describe("Supabase persistence queries (not a live RLS test)", () => {
  it("filters updates by both owner and expected version", async () => {
    const { saveVault } = await import("../src/lib/sync")
    const blob = {} as Parameters<typeof saveVault>[2]
    const user = { id: "test-user" } as Parameters<typeof saveVault>[0]
    h.result = { data: [{ blob, version: 5 }], error: null }
    expect(await saveVault(user, { blob, version: 4 }, blob)).toEqual({ blob, version: 5 })
    expect(h.calls).toContainEqual(["eq", "user_id", "test-user"])
    expect(h.calls).toContainEqual(["eq", "version", 4])
    expect(h.calls).toContainEqual(["update", { blob, version: 5 }])
  })
  it.each([{ data: [], error: null }, { data: null, error: { code: "40001" } }])("rejects conflicting writes %#", async (result) => {
    const { saveVault, ConflictError } = await import("../src/lib/sync")
    h.result = result
    const blob = {} as Parameters<typeof saveVault>[2]
    await expect(saveVault({ id: "test" } as Parameters<typeof saveVault>[0], { blob, version: 1 }, blob)).rejects.toBeInstanceOf(ConflictError)
  })
  it("propagates fetch and transport failures", async () => {
    const { fetchVault, saveVault } = await import("../src/lib/sync")
    h.result = { data: null, error: new Error("offline") }
    const user = { id: "test" } as Parameters<typeof fetchVault>[0]
    const blob = {} as Parameters<typeof saveVault>[2]
    await expect(fetchVault(user)).rejects.toThrow("offline")
    await expect(saveVault(user, { blob, version: 1 }, blob)).rejects.toThrow("offline")
  })
})
