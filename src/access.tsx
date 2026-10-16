// Sign in / sign up, email confirmation, first-run onboarding and unlock — wired to Supabase and the vault key.
import { useState, type FormEvent, type ReactNode } from "react"
import {
  AlertTriangle, Check, ChevronRight, Download, Eye, EyeOff, Fingerprint, KeyRound, Laptop, Lock, LockKeyhole, Mail, Network, Shield, ShieldCheck,
} from "lucide-react"
import { Brand, Button, IconButton, Soon, StrengthMeter } from "./ui"
import { strength } from "./lib/password"
import { download } from "./lib/prefs"

function AccessLayout({ children }: { children: ReactNode }) {
  return (
    <main className="access-layout">
      <header className="access-header">
        <Brand />
        <div className="access-security">
          <ShieldCheck size={16} />
          เข้ารหัสแบบ Zero-knowledge
        </div>
      </header>
      <div className="access-content">{children}</div>
      <footer className="access-footer">
        <span>© {new Date().getFullYear() + 543} ตู้เซฟ</span>
        <span>ข้อมูลถูกเข้ารหัสบนอุปกรณ์ของคุณก่อนซิงก์</span>
      </footer>
    </main>
  )
}

function SecretInput({ value, onChange, placeholder, icon, error, autoFocus, autoComplete, minLength }: {
  value: string; onChange: (v: string) => void; placeholder: string; icon: ReactNode; error?: boolean; autoFocus?: boolean; autoComplete: string; minLength?: number
}) {
  const [show, setShow] = useState(false)
  return (
    <div className={`access-input ${error ? "has-error" : ""}`}>
      {icon}
      <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        autoFocus={autoFocus} autoComplete={autoComplete} minLength={minLength} required />
      <IconButton label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"} onClick={() => setShow(!show)}>
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </IconButton>
    </div>
  )
}

export function AuthScreen({ initialEmail, onSubmit }: {
  initialEmail: string
  onSubmit: (mode: "signin" | "signup", email: string, password: string) => Promise<string | null>
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin")
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError((await onSubmit(mode, email.trim(), password)) ?? "")
    setBusy(false)
  }

  return (
    <AccessLayout>
      <section className="auth-card">
        <div className="auth-heading">
          <span className="auth-icon"><LockKeyhole size={22} /></span>
          <h1>{mode === "signin" ? "ยินดีต้อนรับกลับ" : "สร้างบัญชีตู้เซฟ"}</h1>
          <p>{mode === "signin" ? "เข้าสู่ระบบเพื่อเข้าถึงตู้เซฟของคุณ" : "เริ่มปกป้องรหัสผ่านด้วยการเข้ารหัสที่มีเพียงคุณเท่านั้นที่เปิดได้"}</p>
        </div>
        <div className="auth-tabs">
          <button type="button" className={mode === "signin" ? "is-active" : ""} onClick={() => { setMode("signin"); setError("") }}>เข้าสู่ระบบ</button>
          <button type="button" className={mode === "signup" ? "is-active" : ""} onClick={() => { setMode("signup"); setError("") }}>สร้างบัญชี</button>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>อีเมล</span>
            <div className="access-input">
              <Mail size={17} />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="username" required />
            </div>
          </label>
          <label>
            <span>รหัสผ่านบัญชี</span>
            <SecretInput value={password} onChange={setPassword} placeholder="อย่างน้อย 8 ตัวอักษร" icon={<KeyRound size={17} />}
              autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} error={!!error} />
            {error && <small className="input-error">{error}</small>}
          </label>
          <div className="account-password-note">
            <Shield size={17} />
            <span>
              <strong>รหัสผ่านบัญชี ใช้ล็อกอิน</strong>
              ต่างจากรหัสผ่านหลักที่ใช้เปิดข้อมูลในตู้เซฟ
            </span>
          </div>
          <Button variant="primary" className="auth-submit" type="submit" disabled={busy}>
            {busy ? "กำลังดำเนินการ…" : mode === "signin" ? "เข้าสู่ระบบ" : "สร้างบัญชี"}
          </Button>
        </form>
        <p className="auth-terms">การดำเนินการต่อหมายถึงคุณยอมรับข้อกำหนดการใช้งานและนโยบายความเป็นส่วนตัว</p>
      </section>
    </AccessLayout>
  )
}

export function EmailConfirmation({ email, onContinue, onResend }: { email: string; onContinue: () => void; onResend: () => Promise<string | null> }) {
  const [note, setNote] = useState("")
  return (
    <AccessLayout>
      <section className="auth-card confirmation-card">
        <span className="confirmation-icon"><Mail size={28} /><i><Check size={13} /></i></span>
        <h1>ตรวจสอบอีเมลของคุณ</h1>
        <p>
          เราส่งลิงก์ยืนยันไปที่ <strong>{email}</strong>
          <br />
          เปิดลิงก์ในอีเมลเพื่อดำเนินการต่อ
        </p>
        <Button variant="primary" className="auth-submit" onClick={onContinue}>ฉันยืนยันอีเมลแล้ว</Button>
        <button className="text-action" type="button" onClick={async () => setNote((await onResend()) ?? "ส่งอีเมลอีกครั้งแล้ว")}>
          ยังไม่ได้รับอีเมล? ส่งอีกครั้ง
        </button>
        {note && <small className="auth-terms">{note}</small>}
      </section>
    </AccessLayout>
  )
}

export function OnboardingScreen({ email, onCreate, onComplete }: {
  email: string
  onCreate: (masterPassword: string) => Promise<string | null>
  onComplete: () => void
}) {
  const [step, setStep] = useState(1)
  const [masterPassword, setMasterPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const s = strength(masterPassword)
  const checks = [
    { label: "อย่างน้อย 12 ตัวอักษร", pass: masterPassword.length >= 12 },
    { label: "มีตัวพิมพ์ใหญ่และพิมพ์เล็ก", pass: /[a-z]/.test(masterPassword) && /[A-Z]/.test(masterPassword) },
    { label: "มีตัวเลขหรือสัญลักษณ์", pass: /[^a-zA-Z]/.test(masterPassword) },
    { label: "ยืนยันรหัสผ่านตรงกัน", pass: !!confirm && confirm === masterPassword },
  ]
  const ready = checks[0].pass && checks[3].pass && s.level >= 3

  const downloadKit = () =>
    download(
      "emergency-kit.txt",
      `ชุดฉุกเฉินตู้เซฟ\n\nเว็บไซต์: ${location.origin}\nอีเมล: ${email}\n\nรหัสผ่านหลัก: ______________________________\n\nพิมพ์เอกสารนี้ เขียนรหัสผ่านหลักด้วยมือ แล้วเก็บไว้ในที่ปลอดภัย\nถ้าลืมรหัสผ่านหลัก จะไม่มีใครกู้ข้อมูลคืนให้ได้\n`,
      "text/plain;charset=utf-8",
    )

  const next = async () => {
    if (step === 1) return setStep(2)
    if (step === 2) {
      if (!ready) return setError(s.level < 3 ? "รหัสผ่านหลักยังไม่แข็งแรงพอ" : "กรุณาตรวจสอบเงื่อนไขให้ครบ")
      setBusy(true)
      const err = await onCreate(masterPassword)
      setBusy(false)
      if (err) return setError(err)
      setMasterPassword(""); setConfirm("")
      return setStep(3)
    }
    onComplete()
  }

  return (
    <AccessLayout>
      <section className="onboarding-card">
        <div className="stepper" aria-label={`ขั้นตอนที่ ${step} จาก 3`}>
          {[1, 2, 3].map((n) => (
            <span key={n} className={n <= step ? "is-active" : ""}>{n < step ? <Check size={13} /> : n}</span>
          ))}
        </div>

        {step === 1 && (
          <div className="onboarding-step">
            <div className="zero-knowledge-illustration">
              <span><Laptop size={30} /></span><i />
              <span className="illustration-lock"><LockKeyhole size={28} /></span><i />
              <span><Network size={30} /></span>
            </div>
            <p className="step-kicker">ขั้นตอนที่ 1 จาก 3</p>
            <h1>ข้อมูลถูกล็อกก่อนออกจากอุปกรณ์</h1>
            <p className="step-description">
              รหัสผ่านและข้อมูลสำคัญจะถูกเข้ารหัสบนอุปกรณ์ของคุณก่อนอัปโหลด เราจึงไม่สามารถอ่านหรือเข้าถึงข้อมูลในตู้เซฟได้
            </p>
            <div className="privacy-points">
              <span><Check size={16} /> มีเพียงคุณที่ปลดล็อกข้อมูลได้</span>
              <span><Check size={16} /> ข้อมูลที่ซิงก์ถูกเข้ารหัสเสมอ</span>
              <span><Check size={16} /> เราไม่เก็บรหัสผ่านหลักของคุณ</span>
            </div>
          </div>
        )}

        {step === 2 && (
          <form className="onboarding-step password-step" onSubmit={(e) => { e.preventDefault(); void next() }}>
            <p className="step-kicker">ขั้นตอนที่ 2 จาก 3</p>
            <h1>สร้างรหัสผ่านหลัก</h1>
            <p className="step-description">ใช้สำหรับปลดล็อกข้อมูลทั้งหมด ควรจำได้แต่ผู้อื่นคาดเดาไม่ได้</p>
            <input type="email" value={email} autoComplete="username" readOnly hidden />
            <label className="master-field">
              <span>รหัสผ่านหลัก</span>
              <input type="password" value={masterPassword} onChange={(e) => { setMasterPassword(e.target.value); setError("") }}
                placeholder="สร้างรหัสผ่านหลักที่แข็งแรง" autoComplete="new-password" autoFocus />
            </label>
            <label className="master-field">
              <span>ยืนยันรหัสผ่านหลัก</span>
              <input type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setError("") }}
                placeholder="พิมพ์รหัสผ่านหลักอีกครั้ง" autoComplete="new-password" />
            </label>
            <StrengthMeter level={s.level} label={masterPassword ? s.label : "ยังไม่ได้กรอก"} />
            <div className="requirement-list">
              {checks.map((c) => (
                <span className={c.pass ? "is-passed" : ""} key={c.label}><Check size={14} /> {c.label}</span>
              ))}
            </div>
            {error && <small className="input-error">{error}</small>}
            <div className="master-warning">
              <AlertTriangle size={20} />
              <span>
                <strong>ถ้าลืมรหัสผ่านหลัก จะกู้คืนไม่ได้</strong>
                ตู้เซฟไม่มีสำเนารหัสผ่านหลักของคุณ โปรดจดเก็บไว้ในที่ปลอดภัย
              </span>
            </div>
            <button type="submit" hidden />
          </form>
        )}

        {step === 3 && (
          <div className="onboarding-step">
            <div className="kit-preview">
              <div className="kit-paper">
                <Brand />
                <span>ชุดฉุกเฉิน</span><i /><i />
                <small>เก็บไว้ในสถานที่ปลอดภัย</small>
              </div>
              <span><ShieldCheck size={24} /></span>
            </div>
            <p className="step-kicker">ขั้นตอนที่ 3 จาก 3</p>
            <h1>ดาวน์โหลดชุดฉุกเฉิน</h1>
            <p className="step-description">เอกสารนี้มีอีเมลบัญชีและช่องสำหรับจดรหัสผ่านหลัก พิมพ์แล้วเก็บในที่ปลอดภัยที่มีเพียงคุณเข้าถึงได้</p>
            <Button variant="secondary" icon={<Download size={18} />} onClick={downloadKit}>ดาวน์โหลด Emergency Kit</Button>
          </div>
        )}

        <div className="onboarding-actions">
          {step === 2 && <Button variant="ghost" onClick={() => setStep(1)}>ย้อนกลับ</Button>}
          <Button variant="primary" onClick={() => void next()} className="next-button" disabled={busy || (step === 2 && !ready)}>
            {busy ? "กำลังสร้างตู้เซฟ…" : step === 3 ? "เปิดตู้เซฟของฉัน" : step === 2 ? "สร้างตู้เซฟ" : "ดำเนินการต่อ"}
            <ChevronRight size={17} />
          </Button>
        </div>
      </section>
    </AccessLayout>
  )
}

export function UnlockScreen({ email, onUnlock, onSignOut }: { email: string; onUnlock: (password: string) => Promise<string | null>; onSignOut: () => void }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    const err = await onUnlock(password)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <AccessLayout>
      <section className="auth-card unlock-card">
        <span className="unlock-avatar">{initials(email)}</span>
        <h1>ปลดล็อกตู้เซฟ</h1>
        <p className="unlock-email">{email}</p>
        <form className="auth-form" onSubmit={submit}>
          <input type="email" value={email} autoComplete="username" readOnly hidden />
          <label>
            <span>รหัสผ่านหลัก</span>
            <SecretInput value={password} onChange={(v) => { setPassword(v); setError("") }} placeholder="ป้อนรหัสผ่านหลัก"
              icon={<Lock size={17} />} error={!!error} autoFocus autoComplete="current-password" />
            {error && <small className="input-error">{error}</small>}
          </label>
          <Button variant="primary" className="auth-submit" type="submit" disabled={busy}>{busy ? "กำลังปลดล็อก…" : "ปลดล็อก"}</Button>
        </form>
        <div className="unlock-divider"><span>หรือ</span></div>
        <Button variant="secondary" className="auth-submit" icon={<Fingerprint size={19} />} disabled>
          ปลดล็อกด้วย Passkey หรือลายนิ้วมือ <Soon />
        </Button>
        <button className="text-action" type="button" onClick={onSignOut}>ออกจากบัญชีนี้</button>
      </section>
    </AccessLayout>
  )
}

export function initials(email: string) {
  const name = email.split("@")[0].replace(/[^a-zA-Z0-9ก-๙]/g, " ").trim()
  const parts = name.split(/\s+/)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase() || "?"
}
