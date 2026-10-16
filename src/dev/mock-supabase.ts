// DEV ONLY: in-memory stand-in for @supabase/supabase-js, enabled by `npm run dev:mock`.
// Mirrors only the calls src/lib/sync.ts and App.tsx make, including the version check.
type Row = { user_id: string; blob: unknown; version: number }
type Session = { user: { id: string; email: string } } | null
type Listener = (event: string, session: Session) => void

const load = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? "") as T } catch { return d } }
const db: { rows: Record<string, Row> } = load("mock.db", { rows: {} })
const persist = () => localStorage.setItem("mock.db", JSON.stringify(db))
;(window as any).__mockDb = db

export type User = { id: string; email: string }

export function createClient() {
  let session: Session = load("mock.session", null)
  const listeners: Listener[] = []
  const emit = (ev: string) => listeners.forEach((l) => l(ev, session))
  const setSession = (s: Session, ev: string) => { session = s; localStorage.setItem("mock.session", JSON.stringify(s)); emit(ev) }

  function from(_table: string) {
    const st: { op?: string; values?: any; filters: Record<string, unknown> } = { filters: {} }
    const run = () => {
      const uid = st.filters.user_id as string
      const row = db.rows[uid]
      if (st.op === "insert") { db.rows[st.values.user_id] = { ...st.values }; persist(); return { data: [db.rows[st.values.user_id]], error: null } }
      if (st.op === "update") {
        if (!row || ("version" in st.filters && row.version !== st.filters.version)) return { data: [], error: null }
        db.rows[uid] = { ...row, ...st.values }; persist(); return { data: [db.rows[uid]], error: null }
      }
      if (st.op === "delete") { delete db.rows[uid]; persist(); return { data: [], error: null } }
      return { data: row ? [row] : [], error: null }
    }
    const api: any = {
      select: () => api,
      eq: (k: string, v: unknown) => { st.filters[k] = v; return api },
      insert: (v: any) => { st.op = "insert"; st.values = v; return api },
      update: (v: any) => { st.op = "update"; st.values = v; return api },
      delete: () => { st.op = "delete"; return api },
      // Like the real client, results are copies, never live references to stored rows.
      maybeSingle: async () => { const r = structuredClone(run()); return { data: r.data[0] ?? null, error: null } },
      single: async () => { const r = structuredClone(run()); return { data: r.data[0] ?? null, error: null } },
      then: (res: (v: unknown) => void) => res(structuredClone(run())),
    }
    return api
  }

  // Accounts: e-mail → password. Passwords are checked, so wrong-password paths are exercised.
  const users: Record<string, { password: string }> = load("mock.users", {})
  const persistUsers = () => localStorage.setItem("mock.users", JSON.stringify(users))
  const userFor = (email: string) => ({ id: "mock-" + email.toLowerCase(), email: email.toLowerCase() })
  const fail = (message: string) => ({ data: { user: null, session: null }, error: { message } })

  // Simulated "forgot password" e-mail link: /#type=recovery&mock_email=someone@example.test
  const link = new URLSearchParams(location.hash.slice(1))
  const recoveryEmail = link.get("type") === "recovery" ? link.get("mock_email") : null
  if (recoveryEmail && users[recoveryEmail.toLowerCase()]) session = { user: userFor(recoveryEmail) }

  return {
    from,
    auth: {
      onAuthStateChange(l: Listener) {
        listeners.push(l)
        setTimeout(() => { l("INITIAL_SESSION", session); if (recoveryEmail && session) l("PASSWORD_RECOVERY", session) })
        return { data: { subscription: { unsubscribe() { listeners.splice(listeners.indexOf(l), 1) } } } }
      },
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        const u = users[email.toLowerCase()]
        if (!u || u.password !== password) return fail("Invalid login credentials")
        setSession({ user: userFor(email) }, "SIGNED_IN")
        return { data: { session, user: session!.user }, error: null }
      },
      async signUp({ email, password }: { email: string; password: string }) {
        if (users[email.toLowerCase()]) return fail("User already registered")
        users[email.toLowerCase()] = { password }
        persistUsers()
        return { data: { session: null, user: null }, error: null } // e-mail confirmation required
      },
      async updateUser({ password }: { password: string }) {
        if (!session) return fail("Auth session missing!")
        users[session.user.email] = { password }
        persistUsers()
        return { data: { user: session.user }, error: null }
      },
      async resetPasswordForEmail(email: string) {
        console.info(`[mock] recovery link: ${location.origin}/#type=recovery&mock_email=${encodeURIComponent(email)}`)
        return { error: null }
      },
      async resend() { return { error: null } },
      // "others" ends sessions on other devices only; the mock has none, so this one stays signed in.
      async signOut({ scope }: { scope?: "global" | "local" | "others" } = {}) {
        if (scope !== "others") setSession(null, "SIGNED_OUT")
        return { error: null }
      },
    },
  }
}
