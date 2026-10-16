import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type RefObject } from "react"
import { type LucideIcon, Check, ChevronDown, Lock, LogOut, Moon, MoreHorizontal, Plus, Search, Settings, ShieldCheck, Sun, Vault, WandSparkles, X } from "lucide-react"
import { AuthScreen, EmailConfirmation, OnboardingScreen, UnlockScreen, initials } from "./access"
import { Badge, Brand, Button, IconButton, SidebarItem } from "./ui"
import { Detail, FolderModal, ItemEditor, ItemRow, Sidebar, TypePicker, applyFilter, filterTitle, type Filter } from "./vault"
import { Generator, SecurityPage, SettingsPage } from "./pages"
import { VaultContext, useVault, type VaultApi } from "./state"
import { isEnvelope, newKey, seal, unseal, type Key } from "./lib/crypto"
import { analyze, emptyVault, migrate, newItem, type Item, type ItemType, type VaultData } from "./lib/model"
import { copyText, download, loadPrefs, savePrefs, type Prefs } from "./lib/prefs"
import { ConflictError, deleteVault, fetchVault, saveVault, sb, type Remote, type User } from "./lib/sync"

type Phase = "loading" | "config" | "auth" | "email" | "onboarding" | "unlock" | "app"
type Page = "vault" | "generator" | "security" | "settings"
type SyncState = "saved" | "saving" | "error"

const authError = (msg: string) =>
  /invalid login/i.test(msg) ? "อีเมลหรือรหัสผ่านบัญชีไม่ถูกต้อง"
    : /not confirmed/i.test(msg) ? "ยังไม่ได้ยืนยันอีเมล กรุณากดลิงก์ในอีเมลก่อน"
    : /already registered/i.test(msg) ? "อีเมลนี้มีบัญชีอยู่แล้ว ลองเข้าสู่ระบบ"
    : /rate limit/i.test(msg) ? "ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่"
    : /fetch/i.test(msg) ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ต"
    : msg

export default function App() {
  const [phase, setPhase] = useState<Phase>(sb ? "loading" : "config")
  const [user, setUser] = useState<User | null>(null)
  const [pendingEmail, setPendingEmail] = useState("")
  const [data, setData] = useState<VaultData>(emptyVault)
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [sync, setSync] = useState<SyncState>("saved")
  const [toastMsg, setToastMsg] = useState("")
  const keyRef = useRef<Key | null>(null)
  const remoteRef = useRef<Remote>(null)
  const dataRef = useRef<VaultData>(data)
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve())
  const userRef = useRef<User | null>(null)

  const toast = useCallback((m: string) => {
    setToastMsg(m)
    window.clearTimeout((toast as any).t)
    ;(toast as any).t = window.setTimeout(() => setToastMsg(""), 3200)
  }, [])

  // ---------- session ----------
  const clearVault = () => {
    keyRef.current = null
    dataRef.current = emptyVault()
    setData(dataRef.current)
  }
  const enterLocked = useCallback(async (u: User) => {
    try {
      remoteRef.current = await fetchVault(u)
      setPhase(remoteRef.current ? "unlock" : "onboarding")
    } catch (e) {
      toast("โหลดตู้เซฟไม่สำเร็จ: " + (e as Error).message)
      setPhase("unlock")
    }
  }, [toast])

  useEffect(() => {
    if (!sb) return
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      const next = session?.user ?? null
      if (event !== "INITIAL_SESSION" && next?.id === userRef.current?.id) return // token refresh
      userRef.current = next
      setUser(next)
      clearVault()
      // Supabase advises against awaiting other client calls inside this callback.
      setTimeout(() => (next ? void enterLocked(next) : setPhase("auth")), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [enterLocked])

  const lock = useCallback(() => {
    clearVault()
    if (userRef.current) void enterLocked(userRef.current)
  }, [enterLocked])

  const signOut = useCallback((everywhere = false) => {
    clearVault()
    void sb!.auth.signOut({ scope: everywhere ? "global" : "local" })
  }, [])

  // ---------- persistence ----------
  const persist = useCallback((next: VaultData) => {
    const run = saveQueue.current.then(async () => {
      setSync("saving")
      try {
        remoteRef.current = await saveVault(userRef.current!, remoteRef.current, await seal(keyRef.current!, next))
        setSync("saved")
      } catch (e) {
        setSync("error")
        if (e instanceof ConflictError) {
          toast("ตู้เซฟถูกแก้ไขจากอุปกรณ์อื่น กรุณาปลดล็อกใหม่เพื่อโหลดข้อมูลล่าสุด")
          lock()
        } else toast("บันทึกไม่สำเร็จ: " + (e as Error).message)
        throw e
      }
    })
    saveQueue.current = run.catch(() => {})
    return run as Promise<void>
  }, [lock, toast])

  const update = useCallback(async (fn: (d: VaultData) => VaultData) => {
    const next = fn(dataRef.current)
    dataRef.current = next
    setData(next)
    await persist(next)
  }, [persist])

  // ---------- auto-lock ----------
  useEffect(() => {
    if (phase !== "app") return
    let t = window.setTimeout(lock, prefs.autoLockMin * 60_000)
    const touch = () => { window.clearTimeout(t); t = window.setTimeout(lock, prefs.autoLockMin * 60_000) }
    const evs = ["mousemove", "keydown", "click", "touchstart", "scroll"]
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    return () => { window.clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, touch)) }
  }, [phase, prefs.autoLockMin, lock])

  // ---------- theme ----------
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => (document.documentElement.dataset.theme = prefs.theme === "system" ? (mq.matches ? "dark" : "light") : prefs.theme)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [prefs.theme])
  const setPrefs = (p: Prefs) => { setPrefsState(p); savePrefs(p) }

  // ---------- API for screens ----------
  const analysis = useMemo(() => analyze(data.items), [data.items])
  const api: VaultApi = {
    email: user?.email ?? "",
    data, update, toast, prefs, setPrefs, analysis, lock, signOut,
    copy: (label, text) =>
      copyText(text, prefs.clipboardSec).then(
        () => { toast(`คัดลอก${label}แล้ว · ล้างคลิปบอร์ดใน ${prefs.clipboardSec} วิ`); return true },
        () => { toast("คัดลอกไม่สำเร็จ เบราว์เซอร์ไม่อนุญาตให้เข้าถึงคลิปบอร์ด"); return false },
      ),
    changeMaster: async (oldPw, newPw) => {
      try { await unseal(remoteRef.current!.blob, oldPw) } catch { return "รหัสผ่านหลักเดิมไม่ถูกต้อง" }
      const prevKey = keyRef.current
      keyRef.current = await newKey(newPw)
      try { await persist(dataRef.current); return null } catch (e) { keyRef.current = prevKey; return (e as Error).message }
    },
    exportBackup: () => {
      if (!remoteRef.current) return
      download(`vault-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(remoteRef.current.blob))
      toast("ส่งออกไฟล์สำรองแล้ว (ยังเข้ารหัสอยู่)")
    },
    importBackup: async (file, pw) => {
      let blob: unknown
      try { blob = JSON.parse(await file.text()) } catch { return "ไฟล์ไม่ถูกต้อง" }
      if (!isEnvelope(blob)) return "ไฟล์นี้ไม่ใช่ไฟล์สำรองของตู้เซฟ"
      let incoming: VaultData
      try { incoming = migrate((await unseal(blob, pw)).data) } catch { return "รหัสผ่านไม่ถูกต้อง" }
      const ids = new Set(dataRef.current.items.map((i) => i.id))
      const added = incoming.items.filter((i) => !ids.has(i.id))
      await update((d) => ({ ...d, items: [...d.items, ...added], folders: [...new Set([...d.folders, ...incoming.folders])] }))
      return `นำเข้า ${added.length} รายการ`
    },
    deleteVault: async () => {
      await deleteVault(userRef.current!)
      remoteRef.current = null
      clearVault()
      setPhase("onboarding")
      toast("ลบข้อมูลตู้เซฟแล้ว")
    },
  }

  // ---------- access screens ----------
  let screen: JSX.Element
  if (phase === "config") screen = <ConfigError />
  else if (phase === "loading") screen = <div className="boot"><Brand /></div>
  else if (phase === "auth")
    screen = (
      <AuthScreen
        initialEmail={pendingEmail}
        onSubmit={async (mode, email, password) => {
          const { data: res, error } = mode === "signup"
            ? await sb!.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } })
            : await sb!.auth.signInWithPassword({ email, password })
          if (error) return authError(error.message)
          if (mode === "signup" && !res.session) { setPendingEmail(email); setPhase("email") }
          return null
        }}
      />
    )
  else if (phase === "email")
    screen = (
      <EmailConfirmation
        email={pendingEmail}
        onContinue={() => setPhase("auth")}
        onResend={async () => {
          const { error } = await sb!.auth.resend({ type: "signup", email: pendingEmail, options: { emailRedirectTo: location.origin } })
          return error ? authError(error.message) : null
        }}
      />
    )
  else if (phase === "onboarding")
    screen = (
      <OnboardingScreen
        email={user?.email ?? ""}
        onCreate={async (master) => {
          try {
            keyRef.current = await newKey(master)
            const fresh = emptyVault()
            remoteRef.current = await saveVault(user!, null, await seal(keyRef.current, fresh))
            dataRef.current = fresh
            setData(fresh)
            return null
          } catch (e) {
            keyRef.current = null
            return "สร้างตู้เซฟไม่สำเร็จ: " + (e as Error).message
          }
        }}
        onComplete={() => setPhase("app")}
      />
    )
  else if (phase === "unlock")
    screen = (
      <UnlockScreen
        email={user?.email ?? ""}
        onSignOut={() => signOut()}
        onUnlock={async (password) => {
          try { remoteRef.current = await fetchVault(user!) } catch { /* keep the copy we have */ }
          if (!remoteRef.current) { setPhase("onboarding"); return null }
          try {
            const { key, data: raw } = await unseal(remoteRef.current.blob, password)
            keyRef.current = key
            dataRef.current = migrate(raw)
            setData(dataRef.current)
            setSync("saved")
            setPhase("app")
            return null
          } catch {
            return "รหัสผ่านหลักไม่ถูกต้อง กรุณาลองอีกครั้ง"
          }
        }}
      />
    )

  else
    screen = (
      <VaultContext.Provider value={api}>
        <MainApp sync={sync} />
      </VaultContext.Provider>
    )

  return (
    <>
      {screen}
      {toastMsg && (
        <div className="toast" role="status">
          <span><Check size={16} /></span>
          {toastMsg}
          <button type="button" onClick={() => setToastMsg("")} aria-label="ปิด"><X size={16} /></button>
        </div>
      )}
    </>
  )
}

function ConfigError() {
  return (
    <main className="access-layout">
      <div className="access-content">
        <section className="auth-card">
          <div className="auth-heading">
            <h1>ยังไม่ได้ตั้งค่า Supabase</h1>
            <p>ตั้ง SUPABASE_URL และ SUPABASE_ANON_KEY ใน .env หรือใน Netlify แล้ว build ใหม่</p>
          </div>
        </section>
      </div>
    </main>
  )
}

// ---------- unlocked app shell ----------
function MainApp({ sync }: { sync: SyncState }) {
  const api = useVault()
  const { data, analysis } = api
  const [page, setPage] = useState<Page>("vault")
  const [filter, setFilter] = useState<Filter>("all")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<"updated" | "name">("updated")
  const [selectedId, setSelectedId] = useState<string>()
  const [mobileDetail, setMobileDetail] = useState(false)
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<{ item: Item; isNew: boolean; focusPassword?: boolean }>()
  const [newFolder, setNewFolder] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = applyFilter(data.items, filter, analysis.issues).filter(
      (i) => !q || [i.title, i.notes, ...Object.entries(i.fields).filter(([k]) => !["password", "totp", "cvv", "pin"].includes(k)).map(([, v]) => v), ...i.tags]
        .some((v) => v.toLowerCase().includes(q)),
    )
    return list.sort((a, b) => (sort === "name" ? a.title.localeCompare(b.title, "th") : b.updated - a.updated))
  }, [data.items, filter, analysis.issues, search, sort])
  const selected = filtered.find((i) => i.id === selectedId) ?? filtered[0]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPage("vault")
        setTimeout(() => searchRef.current?.focus(), 0)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const changePage = (p: string) => { setPage(p as Page); setMobileDetail(false) }
  const pickType = (t: ItemType) => {
    setPicking(false)
    const item = newItem(t)
    if (filter.startsWith("folder:")) item.folder = filter.slice(7)
    setEditing({ item, isNew: true })
  }
  const theme = document.documentElement.dataset.theme

  return (
    <div className="app">
      {page === "vault" ? (
        <>
          <Topbar search={search} setSearch={setSearch} searchRef={searchRef} sync={sync} openNew={() => setPicking(true)}
            toggleTheme={() => api.setPrefs({ ...api.prefs, theme: theme === "dark" ? "light" : "dark" })} theme={theme} />
          <div className={`vault-layout ${mobileDetail ? "show-detail" : ""}`}>
            <Sidebar filter={filter} setFilter={(f) => { setFilter(f); setMobileDetail(false) }} openPage={changePage} onNewFolder={() => setNewFolder(true)} />
            <section className="list-pane">
              <div className="list-header">
                <div>
                  <h1>{filterTitle(filter)}</h1>
                  <span>{filtered.length} รายการ</span>
                </div>
                <button className="sort-button" type="button" onClick={() => setSort(sort === "updated" ? "name" : "updated")}>
                  {sort === "updated" ? "แก้ไขล่าสุด" : "ชื่อ ก–ฮ"} <ChevronDown size={15} />
                </button>
              </div>
              <div className="mobile-search">
                <Search size={18} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาในตู้เซฟ" />
              </div>
              <div className="item-list">
                {filtered.length ? (
                  filtered.map((item) => (
                    <ItemRow key={item.id} item={item} selected={item.id === selected?.id} onClick={() => { setSelectedId(item.id); setMobileDetail(true) }} />
                  ))
                ) : (
                  <EmptyList search={search} filter={filter} clear={() => setSearch("")} create={() => setPicking(true)} />
                )}
              </div>
              <button className="mobile-fab" type="button" aria-label="สร้างรายการ" onClick={() => setPicking(true)}><Plus size={24} /></button>
            </section>
            <Detail item={selected} onBack={() => setMobileDetail(false)}
              onEdit={(focusPassword) => selected && setEditing({ item: selected, isNew: false, focusPassword })} />
          </div>
        </>
      ) : (
        <div className="secondary-layout">
          <AppNav page={page} setPage={changePage} />
          {page === "generator" && <Generator />}
          {page === "security" && <SecurityPage openIssue={(i) => { setFilter(`issue:${i}`); setSearch(""); changePage("vault") }} />}
          {page === "settings" && <SettingsPage />}
        </div>
      )}
      <BottomNav page={page} setPage={changePage} />
      {picking && <TypePicker onPick={pickType} close={() => setPicking(false)} />}
      {editing && (
        <ItemEditor initial={editing.item} isNew={editing.isNew} focusPassword={editing.focusPassword} close={() => setEditing(undefined)}
          onSaved={(id) => { setSelectedId(id); if (editing.isNew && filter === "trash") setFilter("all") }} />
      )}
      {newFolder && <FolderModal close={() => setNewFolder(false)} />}
    </div>
  )
}

function EmptyList({ search, filter, clear, create }: { search: string; filter: Filter; clear: () => void; create: () => void }) {
  if (search)
    return (
      <div className="empty-state">
        <Search size={28} />
        <h2>ไม่พบรายการ</h2>
        <p>ลองค้นหาด้วยชื่อเว็บไซต์หรือชื่อผู้ใช้อื่น</p>
        <Button onClick={clear}>ล้างการค้นหา</Button>
      </div>
    )
  if (filter === "trash")
    return (
      <div className="empty-state">
        <ShieldCheck size={28} />
        <h2>ถังขยะว่างเปล่า</h2>
        <p>รายการที่ลบจะอยู่ที่นี่จนกว่าคุณจะลบถาวร</p>
      </div>
    )
  if (filter.startsWith("issue:"))
    return (
      <div className="empty-state">
        <ShieldCheck size={28} />
        <h2>ไม่มีปัญหาในหมวดนี้แล้ว</h2>
        <p>เยี่ยมมาก รหัสผ่านในหมวดนี้ได้รับการแก้ไขครบแล้ว</p>
      </div>
    )
  return (
    <div className="empty-state">
      <Vault size={28} />
      <h2>ยังไม่มีรายการ</h2>
      <p>เพิ่มรหัสผ่าน บัตร หรือบันทึกลับรายการแรกของคุณ</p>
      <Button variant="primary" icon={<Plus size={18} />} onClick={create}>สร้างรายการ</Button>
    </div>
  )
}

function Topbar({ search, setSearch, searchRef, sync, openNew, toggleTheme, theme }: {
  search: string; setSearch: (v: string) => void; searchRef: RefObject<HTMLInputElement | null>; sync: SyncState
  openNew: () => void; toggleTheme: () => void; theme?: string
}) {
  const { lock, email } = useVault()
  return (
    <header className="topbar">
      <div className="mobile-brand"><Brand /></div>
      <div className="search-box">
        <Search size={18} />
        <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาในตู้เซฟ..." aria-label="ค้นหาในตู้เซฟ" />
        <kbd>Ctrl K</kbd>
      </div>
      <div className="topbar-actions">
        <SyncBadge sync={sync} />
        <IconButton label={theme === "dark" ? "ใช้โหมดสว่าง" : "ใช้โหมดมืด"} onClick={toggleTheme}>
          {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
        </IconButton>
        <IconButton label="ล็อกตู้เซฟ" onClick={lock}><Lock size={18} /></IconButton>
        <Button variant="primary" icon={<Plus size={18} />} onClick={openNew}>สร้างรายการ</Button>
        <AccountMenu email={email} />
      </div>
    </header>
  )
}

function SyncBadge({ sync }: { sync: SyncState }) {
  if (sync === "saving") return <Badge tone="accent"><span className="status-dot" /> กำลังบันทึก…</Badge>
  if (sync === "error") return <Badge tone="danger"><span className="status-dot" /> บันทึกไม่สำเร็จ</Badge>
  return <Badge tone="success"><span className="status-dot" /> ซิงก์แล้ว</Badge>
}

function AccountMenu({ email }: { email: string }) {
  const { lock, signOut } = useVault()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener("mousedown", off)
    return () => window.removeEventListener("mousedown", off)
  }, [open])
  return (
    <div className="account-menu" ref={ref}>
      <button className="avatar" type="button" aria-label="บัญชี" title={email} onClick={() => setOpen(!open)}>
        {initials(email)}
        <span className="online-dot" />
      </button>
      {open && (
        <div className="menu menu--right" role="menu">
          <p className="menu-label">{email}</p>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); lock() }}><Lock size={16} /> ล็อกตู้เซฟ</button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); signOut() }}><LogOut size={16} /> ออกจากระบบ</button>
        </div>
      )}
    </div>
  )
}

const TABS: { value: Page; label: string; Icon: LucideIcon }[] = [
  { value: "vault", label: "คลัง", Icon: Vault },
  { value: "generator", label: "สร้างรหัส", Icon: WandSparkles },
  { value: "security", label: "ความปลอดภัย", Icon: ShieldCheck },
  { value: "settings", label: "ตั้งค่า", Icon: Settings },
]

function BottomNav({ page, setPage }: { page: Page; setPage: (p: string) => void }) {
  return (
    <nav className="bottom-nav" aria-label="เมนูหลัก">
      {TABS.map((t) => (
        <button type="button" className={page === t.value ? "is-active" : ""} onClick={() => setPage(t.value)} key={t.value}>
          <t.Icon />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  )
}

function AppNav({ page, setPage }: { page: Page; setPage: (p: string) => void }) {
  const { email, signOut } = useVault()
  return (
    <aside className="app-rail">
      <Brand />
      <nav>
        {TABS.map((t) => (
          <SidebarItem key={t.value} icon={<t.Icon size={18} />} label={t.value === "generator" ? "สร้างรหัสผ่าน" : t.label}
            active={page === t.value} onClick={() => setPage(t.value)} />
        ))}
      </nav>
      <div className="rail-account">
        <span>{initials(email)}</span>
        <div>
          <strong>{email.split("@")[0]}</strong>
          <small>{email}</small>
        </div>
        <IconButton label="ออกจากระบบ" onClick={() => signOut()}><MoreHorizontal size={18} /></IconButton>
      </div>
    </aside>
  )
}
