// Secondary pages: password generator, security dashboard, settings.
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react"
import { biometricSupported } from "./lib/biometric"
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Clock3, Copy, Download, Fingerprint, KeyRound, Laptop, LogOut, Moon, Network, RefreshCw,
  Settings, Shield, ShieldCheck, Sun, Upload, WandSparkles, LifeBuoy,
} from "lucide-react"
import { Badge, Button, GeneratorOptions, IconButton, Modal, PageTitle, SettingsRow, SettingsSection, Soon, Toggle, useConfirm } from "./ui"
import { useVault } from "./state"
import { RecoveryCodeCard, masterChecks } from "./access"
import { ago, type Issue } from "./lib/model"
import { DEFAULT_GEN, passphrase, pin, randomPassword, strength, type GenOptions } from "./lib/password"
import type { Prefs } from "./lib/prefs"
import { ImportCsvModal } from "./ImportCsvModal"

const MODES = ["สุ่มรหัสผ่าน", "วลีรหัสผ่าน", "รหัส PIN"] as const
type Mode = (typeof MODES)[number]

export function Generator() {
  const { data, update, copy } = useVault()
  const confirm = useConfirm()
  const [mode, setMode] = useState<Mode>("สุ่มรหัสผ่าน")
  const [gen, setGen] = useState<GenOptions>(DEFAULT_GEN)
  const [length, setLength] = useState(7) // words or PIN digits; the random password's length lives in `gen`
  const [value, setValue] = useState("")

  const range = [4, 12]
  const len = Math.min(range[1], Math.max(range[0], length))
  const regenerate = () => setValue(mode === "รหัส PIN" ? pin(len) : mode === "วลีรหัสผ่าน" ? passphrase(len) : randomPassword(gen))
  useEffect(regenerate, [mode, len, gen])
  const changeMode = (m: Mode) => { setMode(m); setLength(m === "วลีรหัสผ่าน" ? 7 : 6) }

  const s = strength(value)
  const copyAndRemember = async () => {
    if (!(await copy("รหัสผ่าน", value))) return
    void update((d) => ({
      ...d,
      generatorHistory: [{ value, at: Date.now() }, ...d.generatorHistory.filter((h) => h.value !== value)].slice(0, 10),
    })).catch(() => {})
  }

  return (
    <main className="page-shell generator-page">
      <PageTitle icon={<WandSparkles size={22} />} title="สร้างรหัสผ่าน" description="สร้างรหัสผ่านที่เดายากและไม่ซ้ำ เพื่อปกป้องทุกบัญชี" />
      <div className="generator-layout">
        <section className="generator-card">
          <div className="segmented">
            {MODES.map((m) => (
              <button type="button" className={mode === m ? "is-active" : ""} onClick={() => changeMode(m)} key={m}>{m}</button>
            ))}
          </div>
          <div className="password-output">
            <div className="generated-value">{colorize(value)}</div>
            <IconButton label="สร้างใหม่" onClick={regenerate}><RefreshCw size={19} /></IconButton>
            <Button variant="primary" icon={<Copy size={17} />} onClick={() => void copyAndRemember()}>คัดลอก</Button>
          </div>
          <div className={`strength-line strength-line--${s.level}`}>
            <span>{s.level >= 3 ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />} {s.label}</span>
            <span>{s.crack}</span>
          </div>
          <div className="generator-settings">
            {mode === "สุ่มรหัสผ่าน" ? (
              <GeneratorOptions value={gen} onChange={setGen} />
            ) : (
              <>
                <div className="range-heading">
                  <label htmlFor="length">{mode === "วลีรหัสผ่าน" ? "จำนวนคำ" : "ความยาว"}</label>
                  <output>{len} {mode === "วลีรหัสผ่าน" ? "คำ" : "หลัก"}</output>
                </div>
                <input id="length" className="range" type="range" min={range[0]} max={range[1]} value={len} onChange={(e) => setLength(Number(e.target.value))} />
              </>
            )}
          </div>
        </section>
        <aside className="history-card">
          <h2>ประวัติการสร้าง</h2>
          <p>เก็บ 10 รายการล่าสุดที่คัดลอก แบบเข้ารหัสในตู้เซฟ</p>
          {data.generatorHistory.length === 0 && <p className="muted-text">ยังไม่มีประวัติ</p>}
          {data.generatorHistory.map((h) => (
            <div className="generator-history" key={h.at}>
              <div>
                <code>{h.value}</code>
                <span>{ago(h.at)}</span>
              </div>
              <IconButton label="คัดลอกรหัสผ่านจากประวัติ" onClick={() => copy("รหัสผ่าน", h.value)}><Copy size={17} /></IconButton>
            </div>
          ))}
          {data.generatorHistory.length > 0 && (
            <button className="text-action" type="button" onClick={async () => {
              const ok = await confirm({
                title: "ล้างประวัติการสร้าง?", tone: "danger", confirmLabel: "ล้างประวัติ",
                message: `รหัสผ่านที่สร้างไว้ ${data.generatorHistory.length} รายการจะถูกลบจากประวัติถาวร รหัสที่บันทึกในรายการต่าง ๆ จะไม่ได้รับผลกระทบ`,
              })
              if (ok) void update((d) => ({ ...d, generatorHistory: [] })).catch(() => {})
            }}>ล้างประวัติ</button>
          )}
        </aside>
      </div>
    </main>
  )
}

/** Digits and symbols get their own colour so similar-looking characters are easy to tell apart. */
function colorize(v: string) {
  return [...v].map((c, i) => (
    <span key={i} className={/\d/.test(c) ? "ch-num" : /[^a-zA-Z\d-]/.test(c) ? "ch-sym" : undefined}>{c}</span>
  ))
}

export function SecurityPage({ openIssue }: { openIssue: (i: Issue) => void }) {
  const { analysis } = useVault()
  const t = analysis.totals
  const issues: { key: Issue; icon: ReactNode; title: string; tone: string; text: string }[] = [
    { key: "weak", icon: <AlertTriangle />, title: "รหัสผ่านอ่อน", tone: "danger", text: "ควรเปลี่ยนทันที" },
    { key: "reused", icon: <Copy />, title: "รหัสผ่านซ้ำ", tone: "warning", text: "ใช้ในหลายบัญชี" },
    { key: "old", icon: <Clock3 />, title: "รหัสผ่านเก่า", tone: "neutral", text: "ไม่ได้เปลี่ยนเกิน 1 ปี" },
    { key: "no2fa", icon: <Fingerprint />, title: "ยังไม่มี 2FA", tone: "accent", text: "เพิ่มการปกป้องอีกชั้น" },
  ]
  const fix = t.weak + t.reused
  const status = analysis.checked === 0 ? ["neutral", "ยังไม่มีข้อมูล"] : analysis.score >= 80 ? ["success", "สถานะดี"] : analysis.score >= 50 ? ["warning", "ควรปรับปรุง"] : ["danger", "มีความเสี่ยง"]
  return (
    <main className="page-shell security-page">
      <PageTitle icon={<ShieldCheck size={22} />} title="ความปลอดภัย" description="ตรวจสุขภาพรหัสผ่านและแก้ไขจุดเสี่ยงในคลังของคุณ" />
      <section className="score-panel">
        <div className="score-ring" style={{ "--score": `${analysis.score * 3.6}deg` } as CSSProperties}>
          <span>{analysis.checked ? analysis.score : "–"}</span>
          <small>จาก 100</small>
        </div>
        <div>
          <Badge tone={status[0] as "success"}>{status[1]}</Badge>
          <h2>{analysis.checked === 0 ? "เพิ่มรหัสผ่านเพื่อเริ่มตรวจสอบ" : fix ? `พบ ${fix} รายการที่ควรแก้ไข` : "ไม่พบรหัสผ่านอ่อนหรือซ้ำ"}</h2>
          <p>ตรวจจาก {analysis.checked} รหัสผ่านในคลัง การวิเคราะห์ทั้งหมดทำบนอุปกรณ์นี้เท่านั้น</p>
        </div>
      </section>
      <div className="issue-grid">
        {issues.map((issue) => (
          <button className={`issue-card issue-card--${issue.tone}`} type="button" key={issue.key} onClick={() => openIssue(issue.key)} disabled={!t[issue.key]}>
            <span className="issue-icon">{issue.icon}</span>
            <div>
              <strong>{t[issue.key]}</strong>
              <h3>{issue.title}</h3>
              <p>{issue.text}</p>
            </div>
            <ChevronRight size={19} />
          </button>
        ))}
        <div className="issue-card issue-card--success is-static">
          <span className="issue-icon"><Network /></span>
          <div>
            <strong>–</strong>
            <h3>พบในการรั่วไหล</h3>
            <p><Soon /></p>
          </div>
        </div>
      </div>
      <section className="breach-note">
        <Shield size={22} />
        <div>
          <h2>การตรวจสอบการรั่วไหลแบบเป็นส่วนตัว</h2>
          <p>จะตรวจกับฐานข้อมูลรหัสผ่านที่รั่วไหลโดยไม่ส่งรหัสผ่านจริงออกจากอุปกรณ์ของคุณ</p>
        </div>
        <Button disabled>ตรวจสอบตอนนี้ <Soon /></Button>
      </section>
    </main>
  )
}

const SECTIONS = [["security", "ความปลอดภัย"], ["sessions", "อุปกรณ์และเซสชัน"], ["import", "นำเข้าและส่งออก"], ["appearance", "รูปลักษณ์"], ["account", "บัญชี"]] as const

function Select({ value, options, onChange, label }: { value: number; options: [number, string][]; onChange: (v: number) => void; label: string }) {
  return (
    <div className="select-wrap select-wrap--compact">
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <ChevronDown size={15} />
    </div>
  )
}

export function SettingsPage() {
  const { prefs, setPrefs, signOut, email, exportBackup, deleteVault, rotateRecovery, toast, biometric, enableBiometric, disableBiometric } = useVault()
  const [bioSupported, setBioSupported] = useState(false)
  const [bioBusy, setBioBusy] = useState(false)
  useEffect(() => { void biometricSupported().then(setBioSupported) }, [])
  const toggleBiometric = async () => {
    if (biometric) {
      disableBiometric()
      toast("ปิดใช้ Passkey บนอุปกรณ์นี้แล้ว ลบ passkey ของตู้เซฟออกจากตั้งค่าเครื่องได้ถ้าต้องการ")
      return
    }
    setBioBusy(true)
    try {
      const err = await enableBiometric()
      toast(err ?? "เปิดใช้แล้ว ปลดล็อกด้วย Passkey ได้ในเบราว์เซอร์หรือแอปนี้ รหัสผ่านหลักยังใช้ได้เสมอ")
    } finally { setBioBusy(false) }
  }
  const confirm = useConfirm()
  const [active, setActive] = useState("security")
  const [changing, setChanging] = useState(false)
  const [newCode, setNewCode] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [importing, setImporting] = useState<File | null>(null)
  const [importingCsv, setImportingCsv] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const set = (p: Partial<Prefs>) => setPrefs({ ...prefs, ...p })
  const go = (id: string) => { setActive(id); document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }) }

  return (
    <main className="page-shell settings-page">
      <PageTitle icon={<Settings size={22} />} title="ตั้งค่า" description="จัดการความปลอดภัย อุปกรณ์ และรูปแบบการใช้งาน" />
      <div className="settings-layout">
        <nav className="settings-nav">
          {SECTIONS.map(([id, label]) => (
            <button type="button" className={active === id ? "is-active" : ""} key={id} onClick={() => go(id)}>{label}</button>
          ))}
        </nav>
        <div className="settings-content">
          <SettingsSection id="settings-security" title="ความปลอดภัย" description="ควบคุมวิธีล็อกและปกป้องตู้เซฟ">
            <SettingsRow title="ล็อกอัตโนมัติ" description="เมื่อละการใช้งาน">
              <Select label="ล็อกอัตโนมัติ" value={prefs.autoLockMin} onChange={(v) => set({ autoLockMin: v })}
                options={[[1, "1 นาที"], [5, "5 นาที"], [15, "15 นาที"], [30, "30 นาที"]]} />
            </SettingsRow>
            <SettingsRow title="ล้างคลิปบอร์ด" description="ลบรหัสผ่านที่คัดลอกโดยอัตโนมัติ">
              <Select label="ล้างคลิปบอร์ด" value={prefs.clipboardSec} onChange={(v) => set({ clipboardSec: v })}
                options={[[15, "15 วินาที"], [30, "30 วินาที"], [60, "1 นาที"], [90, "90 วินาที"]]} />
            </SettingsRow>
            <SettingsRow title="รหัสผ่านหลัก" description="ใช้ทั้งเข้าสู่ระบบและเปิดตู้เซฟ เปลี่ยนแล้วใช้รหัสใหม่ได้ทุกอุปกรณ์">
              <Button icon={<KeyRound size={16} />} onClick={() => setChanging(true)}>เปลี่ยน</Button>
            </SettingsRow>
            <SettingsRow title="รหัสกู้คืน" description="ใช้กู้ตู้เซฟเมื่อลืมรหัสผ่านหลัก ถ้าทำหายหรือสงสัยว่ารั่ว ให้สร้างใหม่">
              <Button icon={<LifeBuoy size={16} />} onClick={async () => {
                const ok = await confirm({
                  title: "สร้างรหัสกู้คืนใหม่?", tone: "warning", confirmLabel: "สร้างรหัสใหม่",
                  message: "รหัสกู้คืนเดิมจะใช้ไม่ได้ทันที อย่าลืมเก็บรหัสใหม่ไว้ใน Emergency Kit",
                })
                if (!ok) return
                const code = await rotateRecovery()
                if (code) setNewCode(code)
                else toast("สร้างรหัสกู้คืนใหม่ไม่สำเร็จ รหัสเดิมยังใช้ได้")
              }}>สร้างใหม่</Button>
            </SettingsRow>
            <SettingsRow title="ปลดล็อกด้วย Passkey" description={bioSupported
              ? "ใช้ Face ID, Touch ID หรือลายนิ้วมือแทนรหัสผ่านหลัก เฉพาะในเบราว์เซอร์หรือแอปนี้ (iPhone ต้อง iOS 18 ขึ้นไป)"
              : "เบราว์เซอร์นี้ไม่มีตัวยืนยันตัวตนในเครื่อง หรือยังไม่รองรับ"}>
              {bioSupported
                ? <Toggle checked={biometric} onChange={() => void toggleBiometric()} label="ปลดล็อกด้วย Passkey" disabled={bioBusy} />
                : <Badge>ไม่รองรับ</Badge>}
            </SettingsRow>
            <SettingsRow title="การยืนยันสองขั้นตอน" description="เพิ่มความปลอดภัยให้บัญชีตู้เซฟ"><Soon /></SettingsRow>
          </SettingsSection>

          <SettingsSection id="settings-sessions" title="อุปกรณ์และเซสชัน" description="อุปกรณ์ที่ลงชื่อเข้าใช้บัญชีนี้">
            <SettingsRow title="รายการอุปกรณ์" description="ดูอุปกรณ์ที่ลงชื่อเข้าใช้อยู่"><Soon /></SettingsRow>
            <SettingsRow title="ออกจากระบบทุกอุปกรณ์" description="ใช้เมื่อสงสัยว่ามีผู้อื่นเข้าถึงบัญชี">
              <Button icon={<LogOut size={16} />} onClick={async () => {
                const ok = await confirm({
                  title: "ออกจากระบบทุกอุปกรณ์?", tone: "warning", confirmLabel: "ออกจากระบบทั้งหมด",
                  message: "ทุกอุปกรณ์รวมถึงเครื่องนี้จะต้องเข้าสู่ระบบและปลดล็อกใหม่ ข้อมูลในตู้เซฟไม่ได้รับผลกระทบ",
                })
                if (ok) signOut(true)
              }}>ออกทั้งหมด</Button>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection id="settings-import" title="นำเข้าและส่งออก" description="ไฟล์สำรองถูกเข้ารหัสด้วยรหัสผ่านหลักเสมอ">
            <SettingsRow title="ส่งออกไฟล์สำรอง" description="ดาวน์โหลดตู้เซฟแบบเข้ารหัส (.json)">
              <Button icon={<Download size={16} />} onClick={exportBackup}>ส่งออก</Button>
            </SettingsRow>
            <SettingsRow title="นำเข้าไฟล์สำรอง" description="รวมรายการจากไฟล์สำรองของตู้เซฟ (รายการที่มีอยู่แล้วจะไม่ถูกทับ)">
              <Button icon={<Upload size={16} />} onClick={() => fileRef.current?.click()}>นำเข้า</Button>
              <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ""
                if (!f) return
                setImporting(f)
              }} />
            </SettingsRow>
            <SettingsRow title="นำเข้าจาก Chrome หรือ Bitwarden" description="ดูตัวอย่างจากไฟล์ CSV และข้ามรายการซ้ำก่อนบันทึก">
              <Button icon={<Upload size={16} />} onClick={() => setImportingCsv(true)}>นำเข้า CSV</Button>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection id="settings-appearance" title="รูปลักษณ์" description="เลือกรูปแบบที่สบายตาสำหรับคุณ">
            <div className="theme-options">
              {([
                { value: "light", label: "สว่าง", icon: <Sun /> },
                { value: "dark", label: "มืด", icon: <Moon /> },
                { value: "system", label: "ตามระบบ", icon: <Laptop /> },
              ] as const).map((o) => (
                <button type="button" className={prefs.theme === o.value ? "is-active" : ""} onClick={() => set({ theme: o.value })} key={o.value}>
                  <span>{o.icon}</span>
                  {o.label}
                  {prefs.theme === o.value && <Check size={16} />}
                </button>
              ))}
            </div>
          </SettingsSection>

          <SettingsSection id="settings-account" title="บัญชี" description={email}>
            <SettingsRow title="ออกจากระบบ" description="ล็อกตู้เซฟและออกจากบัญชีบนเครื่องนี้">
              <Button icon={<LogOut size={16} />} onClick={() => signOut()}>ออกจากระบบ</Button>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="โซนอันตราย" description="การดำเนินการนี้ไม่สามารถย้อนกลับได้" danger>
            <SettingsRow title="ลบข้อมูลตู้เซฟ" description="ลบรายการทั้งหมดในตู้เซฟอย่างถาวร (บัญชีอีเมลยังคงอยู่)">
              <Button variant="danger" onClick={() => setDeleting(true)}>ลบตู้เซฟ</Button>
            </SettingsRow>
          </SettingsSection>
        </div>
      </div>
      {changing && <ChangeMasterModal close={() => setChanging(false)} />}
      {newCode && (
        <Modal eyebrow="ความปลอดภัย" title="รหัสกู้คืนใหม่" onClose={() => setNewCode(null)}>
          <p className="muted-text">รหัสเดิมใช้ไม่ได้แล้ว เก็บรหัสนี้ไว้ในที่ปลอดภัย หน้าต่างนี้จะไม่แสดงรหัสซ้ำอีก</p>
          <RecoveryCodeCard email={email} code={newCode} />
          <div className="editor-actions"><Button variant="primary" onClick={() => setNewCode(null)}>เก็บแล้ว</Button></div>
        </Modal>
      )}
      {importing && <ImportBackupModal file={importing} close={() => setImporting(null)} />}
      {importingCsv && <ImportCsvModal close={() => setImportingCsv(false)} />}
      {deleting && (
        <Modal eyebrow="โซนอันตราย" title="ลบข้อมูลตู้เซฟ" onClose={() => setDeleting(false)}>
          <DeleteVaultForm email={email} onConfirm={deleteVault} close={() => setDeleting(false)} />
        </Modal>
      )}
    </main>
  )
}

function ImportBackupModal({ file, close }: { file: File; close: () => void }) {
  const { importBackup, toast } = useVault()
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  return (
    <Modal eyebrow="ไฟล์สำรองเข้ารหัส" title="นำเข้าไฟล์สำรอง" onClose={busy ? () => {} : close}>
      <form className="editor-form" onSubmit={async (e) => {
        e.preventDefault()
        if (busy || !password) return
        setBusy(true)
        try {
          const result = await importBackup(file, password)
          if (!/^นำเข้า \d+ รายการ$/.test(result)) { setError(result); return }
          toast(result)
          close()
        } catch { setError("นำเข้าไม่สำเร็จ กรุณาตรวจไฟล์และลองอีกครั้ง") }
        finally { setBusy(false) }
      }}>
        <p className="muted-text">{file.name} · รายการเดิมจะไม่ถูกเขียนทับ</p>
        <label className="master-field"><span>รหัสผ่านหลักของไฟล์สำรอง</span>
          <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError("") }} autoComplete="off" autoFocus required disabled={busy} />
        </label>
        {error && <small className="input-error" role="alert">{error}</small>}
        <div className="editor-actions">
          <Button variant="ghost" onClick={close} disabled={busy}>ยกเลิก</Button>
          <Button variant="primary" type="submit" disabled={busy || !password}>{busy ? "กำลังนำเข้า…" : "นำเข้าไฟล์"}</Button>
        </div>
      </form>
    </Modal>
  )
}

function ChangeMasterModal({ close }: { close: () => void }) {
  const { changeMaster, toast } = useVault()
  const [oldPw, setOld] = useState("")
  const [newPw, setNew] = useState("")
  const [confirmPw, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    // Same rules as sign-up; the confirmation is compared below for its own message.
    if (!masterChecks(newPw, newPw).ok) return setError("รหัสผ่านหลักใหม่ต้องยาวอย่างน้อย 12 ตัวและแข็งแรง")
    if (newPw !== confirmPw) return setError("รหัสผ่านใหม่ไม่ตรงกัน")
    setBusy(true)
    const err = await changeMaster(oldPw, newPw)
    setBusy(false)
    if (err) return setError(err)
    toast("เปลี่ยนรหัสผ่านหลักแล้ว")
    close()
  }
  return (
    <Modal eyebrow="ความปลอดภัย" title="เปลี่ยนรหัสผ่านหลัก" onClose={close}>
      <form className="editor-form" onSubmit={submit}>
        <label className="master-field"><span>รหัสผ่านหลักเดิม</span>
          <input type="password" value={oldPw} onChange={(e) => { setOld(e.target.value); setError("") }} autoComplete="current-password" required autoFocus /></label>
        <label className="master-field"><span>รหัสผ่านหลักใหม่</span>
          <input type="password" value={newPw} onChange={(e) => { setNew(e.target.value); setError("") }} autoComplete="new-password" required /></label>
        <label className="master-field"><span>ยืนยันรหัสผ่านหลักใหม่</span>
          <input type="password" value={confirmPw} onChange={(e) => { setConfirm(e.target.value); setError("") }} autoComplete="new-password" required /></label>
        {error && <small className="input-error">{error}</small>}
        <div className="editor-actions">
          <Button variant="ghost" onClick={close}>ยกเลิก</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? "กำลังเข้ารหัสใหม่…" : "เปลี่ยนรหัสผ่านหลัก"}</Button>
        </div>
      </form>
    </Modal>
  )
}

function DeleteVaultForm({ email, onConfirm, close }: { email: string; onConfirm: () => Promise<void>; close: () => void }) {
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  return (
    <form className="editor-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await onConfirm() } catch { setBusy(false) } }}>
      <div className="master-warning">
        <AlertTriangle size={20} />
        <span><strong>รายการทั้งหมดจะหายไปถาวร</strong>แนะนำให้ส่งออกไฟล์สำรองก่อน</span>
      </div>
      <label className="master-field"><span>พิมพ์ {email} เพื่อยืนยัน</span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus /></label>
      <div className="editor-actions">
        <Button variant="ghost" onClick={close}>ยกเลิก</Button>
        <Button variant="danger" type="submit" disabled={typed !== email || busy}>ลบตู้เซฟถาวร</Button>
      </div>
    </form>
  )
}
