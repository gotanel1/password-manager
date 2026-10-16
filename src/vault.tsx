// Vault view: sidebar filters, item list rows, item detail, and the create/edit flows.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react"
import {
  AlertTriangle, Archive, ArrowLeft, Banknote, ChevronDown, ChevronRight, CircleUserRound, Copy, CreditCard, Eye, EyeOff, FileText, Folder, FolderPlus,
  Globe2, History, KeyRound, MoreHorizontal, Plus, RefreshCw, RotateCcw, Settings, ShieldCheck, Star, Tag, Trash2, UserRound, WandSparkles, Wifi,
} from "lucide-react"
import { Button, IconButton, Modal, SidebarItem, StrengthMeter, Toggle } from "./ui"
import { useVault } from "./state"
import {
  TYPES, applyEdit, domainOf, headlineOf, iconFor, primaryWarning, subtitleOf, thaiDate, type Issue, type Item, type ItemType,
} from "./lib/model"
import { parseTotp, secondsLeft, totpAt } from "./lib/totp"
import { randomPassword, strength } from "./lib/password"

export const TYPE_ICON: Record<ItemType, (size?: number) => ReactNode> = {
  login: (s = 18) => <KeyRound size={s} />,
  card: (s = 18) => <CreditCard size={s} />,
  note: (s = 18) => <FileText size={s} />,
  identity: (s = 18) => <CircleUserRound size={s} />,
  wifi: (s = 18) => <Wifi size={s} />,
  bank: (s = 18) => <Banknote size={s} />,
}

// ---------- filters ----------
export type Filter = string // "all" | "favorites" | "trash" | "type:x" | "folder:x" | "tag:x" | "issue:x"

const ISSUE_LABEL: Record<Issue, string> = { weak: "รหัสผ่านอ่อน", reused: "รหัสผ่านซ้ำ", old: "รหัสผ่านเก่า", no2fa: "ยังไม่มี 2FA" }

export function filterTitle(f: Filter) {
  if (f === "all") return "รายการทั้งหมด"
  if (f === "favorites") return "รายการโปรด"
  if (f === "trash") return "ถังขยะ"
  const [kind, value] = [f.slice(0, f.indexOf(":")), f.slice(f.indexOf(":") + 1)]
  if (kind === "type") return TYPES[value as ItemType].label
  if (kind === "tag") return `#${value}`
  if (kind === "issue") return ISSUE_LABEL[value as Issue]
  return value
}

export function applyFilter(items: Item[], f: Filter, issues: Map<string, Set<Issue>>) {
  if (f === "trash") return items.filter((i) => i.deleted)
  const live = items.filter((i) => !i.deleted)
  if (f === "all") return live
  if (f === "favorites") return live.filter((i) => i.favorite)
  const [kind, value] = [f.slice(0, f.indexOf(":")), f.slice(f.indexOf(":") + 1)]
  if (kind === "type") return live.filter((i) => i.type === value)
  if (kind === "folder") return live.filter((i) => i.folder === value)
  if (kind === "tag") return live.filter((i) => i.tags.includes(value))
  if (kind === "issue") return live.filter((i) => issues.get(i.id)?.has(value as Issue))
  return live
}

export function Sidebar({ filter, setFilter, openPage, onNewFolder }: {
  filter: Filter; setFilter: (f: Filter) => void; openPage: (p: string) => void; onNewFolder: () => void
}) {
  const { data, analysis } = useVault()
  const [showTags, setShowTags] = useState(filter.startsWith("tag:"))
  const live = data.items.filter((i) => !i.deleted)
  const count = (pred: (i: Item) => boolean) => live.filter(pred).length
  const tags = useMemo(() => [...new Set(live.flatMap((i) => i.tags))].sort((a, b) => a.localeCompare(b, "th")), [live])
  const issueCount = analysis.totals.weak + analysis.totals.reused
  const item = (f: Filter, icon: ReactNode, label: string, n?: number) => (
    <SidebarItem key={f} icon={icon} label={label} count={n} active={filter === f} onClick={() => setFilter(f)} />
  )

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav" aria-label="เมนูคลัง">
        <div className="sidebar-group">
          {item("all", <Archive size={18} />, "รายการทั้งหมด", live.length)}
          {item("favorites", <Star size={18} />, "รายการโปรด", count((i) => i.favorite))}
        </div>

        <div className="sidebar-group">
          <p className="sidebar-label">ประเภท</p>
          {(Object.keys(TYPES) as ItemType[]).map((t) => item(`type:${t}`, TYPE_ICON[t](), TYPES[t].label, count((i) => i.type === t)))}
        </div>

        <div className="sidebar-group">
          <div className="sidebar-label-row">
            <p className="sidebar-label">โฟลเดอร์</p>
            <IconButton label="สร้างโฟลเดอร์" onClick={onNewFolder}><Plus size={15} /></IconButton>
          </div>
          {data.folders.map((f) => item(`folder:${f}`, <Folder size={18} />, f, count((i) => i.folder === f)))}
        </div>

        <div className="sidebar-group">
          <SidebarItem icon={<Tag size={18} />} label="แท็ก" count={tags.length} active={showTags && filter.startsWith("tag:")} onClick={() => setShowTags(!showTags)} />
          {showTags && (
            <div className="sidebar-sub">
              {tags.length ? tags.map((t) => item(`tag:${t}`, <span className="tag-hash">#</span>, t, count((i) => i.tags.includes(t))))
                : <p className="sidebar-empty">ยังไม่มีแท็ก</p>}
            </div>
          )}
          {item("trash", <Trash2 size={18} />, "ถังขยะ", data.items.filter((i) => i.deleted).length)}
        </div>

        <div className="sidebar-group sidebar-bottom">
          <p className="sidebar-label">เครื่องมือ</p>
          <SidebarItem icon={<WandSparkles size={18} />} label="สร้างรหัสผ่าน" onClick={() => openPage("generator")} />
          <SidebarItem icon={<ShieldCheck size={18} />} label="ความปลอดภัย" count={issueCount || undefined} onClick={() => openPage("security")} />
          <SidebarItem icon={<Settings size={18} />} label="ตั้งค่า" onClick={() => openPage("settings")} />
        </div>
      </nav>
      <div className="security-note">
        <ShieldCheck size={20} />
        <div>
          <strong>ข้อมูลของคุณปลอดภัย</strong>
          <span>เข้ารหัสแบบ Zero-knowledge</span>
        </div>
      </div>
    </aside>
  )
}

export function SiteIcon({ item, large }: { item: Item; large?: boolean }) {
  const icon = iconFor(item)
  return (
    <span className={`site-icon ${large ? "site-icon--large" : ""}`} style={{ "--icon-color": icon.color } as CSSProperties}>
      {item.type === "login" || item.type === "bank" ? icon.text : TYPE_ICON[item.type](large ? 22 : 17)}
    </span>
  )
}

export function ItemRow({ item, selected, onClick }: { item: Item; selected: boolean; onClick: () => void }) {
  const { analysis } = useVault()
  const warning = primaryWarning(analysis.issues.get(item.id))
  return (
    <button className={`item-row ${selected ? "is-selected" : ""}`} onClick={onClick} type="button">
      <SiteIcon item={item} />
      <span className="item-main">
        <span className="item-title-line">
          <strong>{item.title || "ไม่มีชื่อ"}</strong>
          {warning && !item.deleted && (
            <span className={`mini-warning ${warning === "weak" ? "danger" : ""}`}>
              <AlertTriangle size={12} />
              {warning === "weak" ? "อ่อน" : "ซ้ำ"}
            </span>
          )}
        </span>
        <span className="item-username">{subtitleOf(item) || TYPES[item.type].label}</span>
      </span>
      {item.favorite && <Star className="favorite" size={16} fill="currentColor" />}
      <ChevronRight className="mobile-chevron" size={18} />
    </button>
  )
}

function CopyButton({ label, text }: { label: string; text: string }) {
  const { copy } = useVault()
  return (
    <IconButton label={`คัดลอก${label}`} onClick={() => copy(label, text)} disabled={!text}>
      <Copy size={17} />
    </IconButton>
  )
}

function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className={`field-row ${mono ? "is-mono" : ""}`}>
      <div>
        <p className="eyebrow">{label}</p>
        <div className="field-value">{children}</div>
      </div>
    </div>
  )
}

function SecretValue({ label, value }: { label: string; value: string }) {
  const [show, setShow] = useState(false)
  return (
    <>
      <span>{show ? value : "•".repeat(Math.min(18, Math.max(8, value.length)))}</span>
      <IconButton label={show ? `ซ่อน${label}` : `แสดง${label}`} onClick={() => setShow(!show)}>
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </IconButton>
      <CopyButton label={label} text={value} />
    </>
  )
}

function Totp({ secret }: { secret: string }) {
  const params = useMemo(() => parseTotp(secret), [secret])
  const [code, setCode] = useState("")
  const [left, setLeft] = useState(30)
  useEffect(() => {
    if (!params) return
    let alive = true
    const tick = async () => {
      const c = await totpAt(params)
      if (alive) { setCode(c); setLeft(secondsLeft(params)) }
    }
    void tick()
    const t = window.setInterval(tick, 1000)
    return () => { alive = false; window.clearInterval(t) }
  }, [params])

  if (!params) {
    return (
      <div className="detail-section">
        <p className="eyebrow">รหัสยืนยันแบบสองขั้นตอน</p>
        <p className="muted-text">คีย์ 2FA ไม่ถูกต้อง ตรวจสอบคีย์ base32 หรือ otpauth:// อีกครั้ง</p>
      </div>
    )
  }
  const half = Math.ceil(code.length / 2)
  return (
    <div className="detail-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">รหัสยืนยันแบบสองขั้นตอน</p>
          <div className="totp-code"><span>{code.slice(0, half)}</span> <span>{code.slice(half)}</span></div>
        </div>
        <div className="totp-actions">
          <div className="totp-ring" style={{ "--progress": `${(left / params.period) * 360}deg` } as CSSProperties}><span>{left}</span></div>
          <CopyButton label="รหัสยืนยัน" text={code} />
        </div>
      </div>
    </div>
  )
}

function ItemMenu({ item, onClose }: { item: Item; onClose: () => void }) {
  const { update, toast } = useVault()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    window.addEventListener("mousedown", off)
    return () => window.removeEventListener("mousedown", off)
  }, [onClose])
  const set = (patch: Partial<Item>, msg: string) => {
    onClose()
    void update((d) => ({ ...d, items: d.items.map((i) => (i.id === item.id ? { ...i, ...patch, updated: Date.now() } : i)) })).then(() => toast(msg))
  }
  return (
    <div className="menu" ref={ref} role="menu">
      {item.deleted ? (
        <>
          <button type="button" role="menuitem" onClick={() => set({ deleted: undefined }, "กู้คืนรายการแล้ว")}><RotateCcw size={16} /> กู้คืน</button>
          <button type="button" role="menuitem" className="is-danger" onClick={() => {
            onClose()
            if (confirm(`ลบ "${item.title}" ถาวร? การดำเนินการนี้ย้อนกลับไม่ได้`))
              void update((d) => ({ ...d, items: d.items.filter((i) => i.id !== item.id) })).then(() => toast("ลบถาวรแล้ว"))
          }}><Trash2 size={16} /> ลบถาวร</button>
        </>
      ) : (
        <button type="button" role="menuitem" className="is-danger" onClick={() => set({ deleted: Date.now() }, "ย้ายไปถังขยะแล้ว")}>
          <Trash2 size={16} /> ย้ายไปถังขยะ
        </button>
      )}
    </div>
  )
}

export function Detail({ item, onBack, onEdit }: { item?: Item; onBack: () => void; onEdit: (focusPassword?: boolean) => void }) {
  const { update, analysis } = useVault()
  const [menu, setMenu] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  useEffect(() => { setShowHistory(false); setMenu(false) }, [item?.id])

  if (!item) {
    return (
      <section className="detail-pane">
        <div className="empty-state">
          <ShieldCheck size={28} />
          <h2>เลือกรายการเพื่อดูรายละเอียด</h2>
          <p>ข้อมูลทั้งหมดถูกถอดรหัสเฉพาะบนอุปกรณ์นี้</p>
        </div>
      </section>
    )
  }

  const warning = item.deleted ? undefined : primaryWarning(analysis.issues.get(item.id))
  const toggleFav = () => void update((d) => ({ ...d, items: d.items.map((i) => (i.id === item.id ? { ...i, favorite: !i.favorite } : i)) }))
  const fields = TYPES[item.type].fields.filter((f) => f.key !== "totp" && item.fields[f.key])

  return (
    <section className="detail-pane">
      <header className="detail-header">
        <IconButton label="กลับไปที่รายการ" onClick={onBack}><ArrowLeft size={20} /></IconButton>
        <div className="detail-actions-mobile">
          {!item.deleted && <Button variant="ghost" onClick={() => onEdit()}>แก้ไข</Button>}
          <IconButton label="ตัวเลือกเพิ่มเติม" onClick={() => setMenu(!menu)}><MoreHorizontal size={20} /></IconButton>
        </div>
        <div className="detail-actions-desktop">
          {!item.deleted && <Button variant="secondary" onClick={() => onEdit()}>แก้ไข</Button>}
          <IconButton label="ตัวเลือกเพิ่มเติม" onClick={() => setMenu(!menu)}><MoreHorizontal size={20} /></IconButton>
        </div>
        {menu && <ItemMenu item={item} onClose={() => setMenu(false)} />}
      </header>

      <div className="detail-scroll">
        {item.deleted && (
          <div className="alert alert--danger">
            <Trash2 size={19} />
            <div>
              <strong>รายการนี้อยู่ในถังขยะ</strong>
              <span>ย้ายเมื่อ {thaiDate(item.deleted)} · กู้คืนหรือลบถาวรได้จากเมนู ⋯</span>
            </div>
          </div>
        )}
        <div className="detail-identity">
          <SiteIcon item={item} large />
          <div>
            <h1>{item.title || "ไม่มีชื่อ"}</h1>
            <p>{headlineOf(item)}</p>
          </div>
          <IconButton label={item.favorite ? "นำออกจากรายการโปรด" : "เพิ่มในรายการโปรด"} onClick={toggleFav}>
            <Star size={20} className={item.favorite ? "favorite" : ""} fill={item.favorite ? "currentColor" : "none"} />
          </IconButton>
        </div>

        {warning && (
          <div className={`alert ${warning === "weak" ? "alert--danger" : "alert--warning"}`}>
            <AlertTriangle size={19} />
            <div>
              <strong>{warning === "weak" ? "รหัสผ่านนี้คาดเดาได้ง่าย" : "พบการใช้รหัสผ่านซ้ำ"}</strong>
              <span>แนะนำให้สร้างรหัสผ่านใหม่ที่ไม่ซ้ำกับรายการอื่น</span>
            </div>
            <button type="button" onClick={() => onEdit(true)}>เปลี่ยน</button>
          </div>
        )}

        {fields.length > 0 && (
          <div className="fields-section">
            {fields.map((f) => (
              <Field key={f.key} label={f.label} mono={f.mono}>
                {f.secret ? (
                  <SecretValue label={f.label} value={item.fields[f.key]} />
                ) : f.link ? (
                  <>
                    <a href={/^https?:\/\//i.test(item.fields[f.key]) ? item.fields[f.key] : `https://${item.fields[f.key]}`} target="_blank" rel="noreferrer noopener">
                      {domainOf(item.fields[f.key])}
                      <Globe2 size={15} />
                    </a>
                    <CopyButton label={f.label} text={item.fields[f.key]} />
                  </>
                ) : (
                  <>
                    <span className={f.multiline ? "pre-line" : ""}>{item.fields[f.key]}</span>
                    <CopyButton label={f.label} text={item.fields[f.key]} />
                  </>
                )}
              </Field>
            ))}
          </div>
        )}

        {item.fields.totp && <Totp secret={item.fields.totp} />}

        {item.notes && (
          <div className="detail-section notes">
            <p className="eyebrow">บันทึก</p>
            <p className="pre-line">{item.notes}</p>
          </div>
        )}

        <div className="detail-section meta-grid">
          <div>
            <p className="eyebrow">โฟลเดอร์</p>
            <span className="folder-link"><Folder size={16} /> {item.folder || "ไม่มีโฟลเดอร์"}</span>
          </div>
          <div>
            <p className="eyebrow">แท็ก</p>
            <div className="tag-row">
              {item.tags.length ? item.tags.map((t) => <span className="tag-chip" key={t}>{t}</span>) : <span className="muted-text">—</span>}
            </div>
          </div>
        </div>

        {item.fields.password !== undefined && (
          <>
            <button className="history-row" type="button" onClick={() => setShowHistory(!showHistory)} disabled={!item.history.length}>
              <History size={18} />
              <div>
                <strong>ประวัติรหัสผ่าน</strong>
                <span>
                  {item.history.length ? `เปลี่ยนล่าสุด ${thaiDate(item.passwordChanged ?? item.updated)} · ${item.history.length} รหัสเดิม` : "ยังไม่เคยเปลี่ยนรหัสผ่าน"}
                </span>
              </div>
              <ChevronRight size={18} className={showHistory ? "is-open" : ""} />
            </button>
            {showHistory && (
              <div className="history-list">
                {item.history.map((h, i) => (
                  <div className="generator-history" key={i}>
                    <div>
                      <code>{h.password}</code>
                      <span>ใช้ถึง {thaiDate(h.changed)}</span>
                    </div>
                    <CopyButton label="รหัสผ่านเดิม" text={h.password} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="timestamps">
          <span>สร้างเมื่อ {thaiDate(item.created)}</span>
          <span>แก้ไขล่าสุด {thaiDate(item.updated)}</span>
        </div>
      </div>
    </section>
  )
}

// ---------- create / edit ----------
export function TypePicker({ onPick, close }: { onPick: (t: ItemType) => void; close: () => void }) {
  return (
    <Modal eyebrow="เพิ่มลงในคลัง" title="สร้างรายการใหม่" onClose={close}>
      <div className="type-grid">
        {(Object.keys(TYPES) as ItemType[]).map((t) => (
          <button className="type-card" type="button" key={t} onClick={() => onPick(t)}>
            <span>{t === "identity" ? <UserRound /> : TYPE_ICON[t](20)}</span>
            <div>
              <strong>{TYPES[t].label}</strong>
              <small>{TYPES[t].hint}</small>
            </div>
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
    </Modal>
  )
}

export function ItemEditor({ initial, isNew, focusPassword, close, onSaved }: {
  initial: Item; isNew: boolean; focusPassword?: boolean; close: () => void; onSaved: (id: string) => void
}) {
  const { data, update, toast } = useVault()
  const [item, setItem] = useState<Item>(initial)
  const [tagText, setTagText] = useState(initial.tags.join(", "))
  const [reveal, setReveal] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const pwRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (focusPassword) pwRef.current?.focus() }, [focusPassword])

  const setField = (k: string, v: string) => setItem((i) => ({ ...i, fields: { ...i.fields, [k]: v } }))
  const pw = item.fields.password
  const s = strength(pw ?? "")
  const totpBad = !!item.fields.totp && !parseTotp(item.fields.totp)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (totpBad) return
    setBusy(true)
    const tags = [...new Set(tagText.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean))]
    const prev = data.items.find((i) => i.id === item.id)
    const next = applyEdit(prev, { ...item, title: item.title.trim(), tags })
    try {
      await update((d) => ({
        ...d,
        items: prev ? d.items.map((i) => (i.id === next.id ? next : i)) : [next, ...d.items],
        folders: next.folder && !d.folders.includes(next.folder) ? [...d.folders, next.folder] : d.folders,
      }))
      toast(isNew ? "เพิ่มรายการแล้ว" : "บันทึกการแก้ไขแล้ว")
      onSaved(next.id)
      close()
    } catch {
      setBusy(false)
    }
  }

  return (
    <Modal eyebrow={TYPES[item.type].label} title={isNew ? "สร้างรายการใหม่" : "แก้ไขรายการ"} onClose={close} wide>
      <form className="editor-form" onSubmit={save}>
        <label className="master-field">
          <span>ชื่อรายการ</span>
          <input value={item.title} onChange={(e) => setItem({ ...item, title: e.target.value })} placeholder="เช่น Gmail, บัตร KBank" required autoFocus={!focusPassword} />
        </label>

        {TYPES[item.type].fields.map((f) => (
          <label className="master-field" key={f.key}>
            <span>{f.label}</span>
            {f.multiline ? (
              <textarea value={item.fields[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)} rows={3} />
            ) : f.secret ? (
              <div className="editor-input">
                <input ref={f.key === "password" ? pwRef : undefined} className={f.mono ? "mono" : ""} type={reveal[f.key] ? "text" : "password"}
                  value={item.fields[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)} placeholder={f.placeholder}
                  autoComplete={f.key === "password" ? "new-password" : "off"} spellCheck={false} />
                <IconButton label={reveal[f.key] ? "ซ่อน" : "แสดง"} onClick={() => setReveal({ ...reveal, [f.key]: !reveal[f.key] })}>
                  {reveal[f.key] ? <EyeOff size={17} /> : <Eye size={17} />}
                </IconButton>
                {f.key === "password" && (
                  <IconButton label="สร้างรหัสผ่านใหม่" onClick={() => {
                    setField("password", randomPassword({ length: 20, upper: true, numbers: true, symbols: true, avoidAmbiguous: true }))
                    setReveal({ ...reveal, password: true })
                  }}><RefreshCw size={17} /></IconButton>
                )}
              </div>
            ) : (
              <input className={f.mono ? "mono" : ""} value={item.fields[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)}
                placeholder={f.placeholder} type={f.link ? "url" : "text"} autoComplete="off" />
            )}
            {f.key === "password" && pw ? <StrengthMeter level={s.level} label={`${s.label} · ${s.crack}`} /> : null}
            {f.key === "totp" && totpBad && <small className="input-error">คีย์ 2FA ไม่ถูกต้อง</small>}
          </label>
        ))}

        <div className="editor-grid">
          <label className="master-field">
            <span>โฟลเดอร์</span>
            <div className="select-wrap">
              <select value={item.folder} onChange={(e) => setItem({ ...item, folder: e.target.value })}>
                <option value="">ไม่มีโฟลเดอร์</option>
                {data.folders.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <ChevronDown size={16} />
            </div>
          </label>
          <label className="master-field">
            <span>แท็ก (คั่นด้วยจุลภาค)</span>
            <input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="งาน, สำคัญ" />
          </label>
        </div>

        <label className="master-field">
          <span>บันทึก</span>
          <textarea value={item.notes} onChange={(e) => setItem({ ...item, notes: e.target.value })} rows={item.type === "note" ? 8 : 3} />
        </label>

        <div className="setting-toggle editor-fav">
          <span>รายการโปรด</span>
          <Toggle checked={item.favorite} onChange={() => setItem({ ...item, favorite: !item.favorite })} label="รายการโปรด" />
        </div>

        <div className="editor-actions">
          <Button variant="ghost" onClick={close}>ยกเลิก</Button>
          <Button variant="primary" type="submit" disabled={busy || totpBad}>{busy ? "กำลังบันทึก…" : "บันทึก"}</Button>
        </div>
      </form>
    </Modal>
  )
}

export function FolderModal({ close }: { close: () => void }) {
  const { data, update, toast } = useVault()
  const [name, setName] = useState("")
  const exists = data.folders.includes(name.trim())
  return (
    <Modal eyebrow="จัดระเบียบ" title="สร้างโฟลเดอร์" onClose={close}>
      <form className="editor-form" onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim() || exists) return
        await update((d) => ({ ...d, folders: [...d.folders, name.trim()] }))
        toast(`สร้างโฟลเดอร์ "${name.trim()}" แล้ว`)
        close()
      }}>
        <label className="master-field">
          <span>ชื่อโฟลเดอร์</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ครอบครัว" autoFocus required />
          {exists && <small className="input-error">มีโฟลเดอร์ชื่อนี้แล้ว</small>}
        </label>
        <div className="editor-actions">
          <Button variant="ghost" onClick={close}>ยกเลิก</Button>
          <Button variant="primary" type="submit" icon={<FolderPlus size={17} />} disabled={!name.trim() || exists}>สร้าง</Button>
        </div>
      </form>
    </Modal>
  )
}

