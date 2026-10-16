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

  return {
    from,
    auth: {
      onAuthStateChange(l: Listener) {
        listeners.push(l)
        setTimeout(() => l("INITIAL_SESSION", session))
        return { data: { subscription: { unsubscribe() { listeners.splice(listeners.indexOf(l), 1) } } } }
      },
      async signInWithPassword({ email }: { email: string }) {
        setSession({ user: { id: "mock-" + email, email } }, "SIGNED_IN")
        return { data: { session }, error: null }
      },
      async signUp() { return { data: { session: null, user: null }, error: null } },
      async resend() { return { error: null } },
      async signOut() { setSession(null, "SIGNED_OUT"); return { error: null } },
    },
  }
}
