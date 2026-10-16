// Account access with a single master password: sign in / sign up, email confirmation, vault
// setup, recovery kit, unlock, forgot-password recovery and the one-time legacy-account upgrade.
import { useState, type FormEvent, type ReactNode } from "react"
import {
  AlertTriangle, ArrowLeft, Check, ChevronRight, Copy, Download, Eye, EyeOff, Fingerprint, KeyRound, LifeBuoy, Lock, LockKeyhole, Mail, ShieldCheck,
} from "lucide-react"
import { Brand, Button, IconButton, Soon, StrengthMeter } from "./ui"
import { strength } from "./lib/password"
import { download } from "./lib/prefs"
import { normalizeRecoveryCode } from "./lib/keys"

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
        <span>รหัสผ่านหลักไม่เคยออกจากอุปกรณ์ของคุณ</span>
      </footer>
    </main>
  )
}

function SecretInput({ value, onChange, placeholder, icon, error, autoFocus, autoComplete, name }: {
  value: string; onChange: (v: string) => void; placeholder: string; icon: ReactNode; error?: boolean; autoFocus?: boolean; autoComplete: string; name?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className={`access-input ${error ? "has-error" : ""}`}>
      {icon}
      <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        autoFocus={autoFocus} autoComplete={autoComplete} name={name} required aria-invalid={error || undefined} />
      <IconButton label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"} onClick={() => setShow(!show)}>
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </IconButton>
    </div>
  )
}

const ErrorText = ({ text }: { text: string }) => (text ? <small className="input-error" role="alert">{text}</small> : null)

/** Rules for a master password that also signs you in. */
export function masterChecks(pw: string, confirm: string) {
  const s = strength(pw)
  const checks = [
    { label: "อย่างน้อย 12 ตัวอักษร", pass: pw.length >= 12 },
    { label: "ระดับแข็งแรงขึ้นไป", pass: s.level >= 3 },
    { label: "มีตัวพิมพ์ใหญ่และพิมพ์เล็ก", pass: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
    { label: "ยืนยันรหัสผ่านตรงกัน", pass: !!confirm && confirm === pw },
  ]
  // Mixed case is advice; length, strength and confirmation are required.
  return { s, checks, ok: checks[0].pass && checks[1].pass && checks[3].pass }
}

function NewMasterFields({ value, confirm, setValue, setConfirm, label = "รหัสผ่านหลัก" }: {
  value: string; confirm: string; setValue: (v: string) => void; setConfirm: (v: string) => void; label?: string
}) {
  const { s, checks } = masterChecks(value, confirm)
  return (
    <>
      <label>
        <span>{label}</span>
        <SecretInput value={value} onChange={setValue} placeholder="อย่างน้อย 12 ตัวอักษร" icon={<KeyRound size={17} />} autoComplete="new-password" />
      </label>
      <label>
        <span>ยืนยัน{label}</span>
        <SecretInput value={confirm} onChange={setConfirm} placeholder="พิมพ์อีกครั้ง" icon={<KeyRound size={17} />} autoComplete="new-password" />
      </label>
      <StrengthMeter level={s.level} label={value ? s.label : "ยังไม่ได้กรอก"} />
      <div className="requirement-list">
        {checks.map((c) => <span className={c.pass ? "is-passed" : ""} key={c.label}><Check size={14} /> {c.label}</span>)}
      </div>
    </>
  )
}

function useBusy() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true); setError("")
    try { setError((await fn()) ?? "") } finally { setBusy(false) }
  }
  return { busy, error, setError, run }
}

// ---------- sign in / sign up ----------
export function AuthScreen({ initialEmail, onSignIn, onSignUp, onForgot, onLegacy }: {
  initialEmail: string
  onSignIn: (email: string, password: string) => Promise<string | null>
  onSignUp: (email: string, password: string) => Promise<string | null>
  onForgot: (email: string) => void
  onLegacy: (email: string, password: string) => void
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin")
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [failed, setFailed] = useState(false)
  const { busy, error, setError, run } = useBusy()
  const ok = mode === "signin" ? !!password : masterChecks(password, confirm).ok
  const switchMode = (m: "signin" | "signup") => { setMode(m); setError(""); setFailed(false); setConfirm("") }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!ok) return setError(mode === "signup" ? "รหัสผ่านหลักยังไม่ผ่านเงื่อนไขด้านล่าง" : "กรุณากรอกรหัสผ่านหลัก")
    void run(async () => {
      const err = await (mode === "signin" ? onSignIn : onSignUp)(email.trim(), password)
      setFailed(mode === "signin" && !!err)
      return err
    })
  }

  return (
    <AccessLayout>
      <section className="auth-card">
        <div className="auth-heading">
          <span className="auth-icon"><LockKeyhole size={22} /></span>
          <h1>{mode === "signin" ? "ยินดีต้อนรับกลับ" : "สร้างบัญชีตู้เซฟ"}</h1>
          <p>{mode === "signin" ? "ใช้อีเมลและรหัสผ่านหลักเพื่อเข้าสู่ตู้เซฟ" : "รหัสผ่านหลักตัวเดียว ใช้ทั้งเข้าสู่ระบบและเปิดตู้เซฟ"}</p>
        </div>
        <div className="auth-tabs">
          <button type="button" className={mode === "signin" ? "is-active" : ""} onClick={() => switchMode("signin")}>เข้าสู่ระบบ</button>
          <button type="button" className={mode === "signup" ? "is-active" : ""} onClick={() => switchMode("signup")}>สร้างบัญชี</button>
        </div>
        <form className="auth-form" onSubmit={submit} noValidate>
          <label>
            <span>อีเมล</span>
            <div className="access-input">
              <Mail size={17} />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="username" required />
            </div>
          </label>
          {mode === "signin" ? (
            <label>
              <span>รหัสผ่านหลัก</span>
              <SecretInput value={password} onChange={setPassword} placeholder="รหัสผ่านหลักของคุณ" icon={<KeyRound size={17} />}
                autoComplete="current-password" error={!!error} />
            </label>
          ) : (
            <NewMasterFields value={password} confirm={confirm} setValue={setPassword} setConfirm={setConfirm} />
          )}
          <ErrorText text={error} />
          <div className="account-password-note">
            <ShieldCheck size={17} />
            <span>
              <strong>รหัสผ่านหลักไม่ถูกส่งออกจากเครื่อง</strong>
              เบราว์เซอร์จะแปลงเป็นกุญแจล็อกอินแยกต่างหาก เซิร์ฟเวอร์จึงเปิดตู้เซฟของคุณไม่ได้
            </span>
          </div>
          <Button variant="primary" className="auth-submit" type="submit" disabled={busy}>
            {busy ? "กำลังตรวจสอบ…" : mode === "signin" ? "เข้าสู่ระบบ" : "สร้างบัญชี"}
          </Button>
        </form>
        {mode === "signin" && (
          <div className="auth-links">
            <button className="text-action" type="button" onClick={() => onForgot(email.trim())}>ลืมรหัสผ่านหลัก?</button>
            {failed && (
              <button className="text-action" type="button" onClick={() => onLegacy(email.trim(), password)}>
                บัญชีสร้างก่อนเปลี่ยนเป็นรหัสผ่านเดียว? อัปเกรดบัญชี
              </button>
            )}
          </div>
        )}
        {mode === "signup" && (
          <div className="master-warning">
            <AlertTriangle size={20} />
            <span><strong>เก็บรหัสกู้คืนให้ดี</strong>หลังสร้างตู้เซฟ ระบบจะให้รหัสกู้คืน ถ้าลืมรหัสผ่านหลักและไม่มีรหัสนี้ จะกู้ข้อมูลไม่ได้</span>
          </div>
        )}
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
          เปิดลิงก์ในอีเมล แล้วกลับมาเข้าสู่ระบบด้วยรหัสผ่านหลัก
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

// ---------- vault setup (signed in, no vault yet, master not in memory) ----------
export function SetupScreen({ email, onCreate, onSignOut }: { email: string; onCreate: (password: string) => Promise<string | null>; onSignOut: () => void }) {
  const [password, setPassword] = useState("")
  const { busy, error, run } = useBusy()
  return (
    <AccessLayout>
      <section className="auth-card unlock-card">
        <span className="unlock-avatar">{initials(email)}</span>
        <h1>สร้างตู้เซฟ</h1>
        <p className="unlock-email">{email}</p>
        <form className="auth-form" onSubmit={(e) => { e.preventDefault(); void run(() => onCreate(password)) }}>
          <input type="email" value={email} autoComplete="username" readOnly hidden />
          <label>
            <span>ยืนยันรหัสผ่านหลักที่ใช้สมัคร</span>
            <SecretInput value={password} onChange={setPassword} placeholder="รหัสผ่านหลัก" icon={<Lock size={17} />} error={!!error} autoFocus autoComplete="current-password" />
          </label>
          <ErrorText text={error} />
          <Button variant="primary" className="auth-submit" type="submit" disabled={busy || !password}>{busy ? "กำลังสร้างตู้เซฟ…" : "สร้างตู้เซฟ"}</Button>
        </form>
        <button className="text-action" type="button" onClick={onSignOut}>ออกจากบัญชีนี้</button>
      </section>
    </AccessLayout>
  )
}

// ---------- recovery kit ----------
export function emergencyKitText(email: string, code: string) {
  return `ชุดฉุกเฉินตู้เซฟ\n\nเว็บไซต์: ${location.origin}\nอีเมล: ${email}\nรหัสกู้คืน: ${code}\n\nรหัสผ่านหลัก: ______________________________\n\n` +
    `ใช้รหัสกู้คืนเมื่อลืมรหัสผ่านหลัก: กด "ลืมรหัสผ่านหลัก?" ที่หน้าเข้าสู่ระบบ ยืนยันทางอีเมล แล้วกรอกรหัสนี้\n` +
    `ใครมีทั้งอีเมลของคุณและรหัสนี้จะเปิดตู้เซฟได้ พิมพ์เก็บไว้ในที่ปลอดภัย แล้วลบไฟล์นี้ออกจากเครื่อง\n`
}

export function RecoveryCodeCard({ email, code, onCopy }: { email: string; code: string; onCopy?: (code: string) => void }) {
  return (
    <div className="recovery-card">
      <p className="eyebrow">รหัสกู้คืนของคุณ</p>
      <code className="recovery-code">{code}</code>
      <div className="recovery-actions">
        {onCopy && <Button icon={<Copy size={16} />} onClick={() => onCopy(code)}>คัดลอก</Button>}
        <Button icon={<Download size={16} />} onClick={() => download("emergency-kit.txt", emergencyKitText(email, code), "text/plain;charset=utf-8")}>
          ดาวน์โหลด Emergency Kit
        </Button>
      </div>
    </div>
  )
}

export function KitScreen({ email, code, reason, onDone, onCopy }: {
  email: string; code: string; reason: "new" | "upgraded" | "recovered"; onDone: () => void; onCopy?: (code: string) => void
}) {
  const [saved, setSaved] = useState(false)
  const title = { new: "ตู้เซฟพร้อมใช้งาน", upgraded: "อัปเกรดบัญชีเรียบร้อย", recovered: "ตั้งรหัสผ่านหลักใหม่แล้ว" }[reason]
  return (
    <AccessLayout>
      <section className="onboarding-card">
        <div className="onboarding-step">
          <div className="kit-preview">
            <div className="kit-paper">
              <Brand />
              <span>ชุดฉุกเฉิน</span><i /><i />
              <small>เก็บไว้ในสถานที่ปลอดภัย</small>
            </div>
            <span><LifeBuoy size={24} /></span>
          </div>
          <p className="step-kicker">{title}</p>
          <h1>เก็บรหัสกู้คืนไว้ก่อนใช้งาน</h1>
          <p className="step-description">
            {reason === "recovered" ? "รหัสกู้คืนเดิมใช้ไม่ได้แล้ว นี่คือรหัสใหม่ " : ""}
            ถ้าลืมรหัสผ่านหลัก ต้องใช้รหัสนี้ร่วมกับการยืนยันทางอีเมลเพื่อกู้ตู้เซฟ เราไม่มีสำเนาให้
          </p>
          <RecoveryCodeCard email={email} code={code} onCopy={onCopy} />
          <label className="kit-confirm">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            ฉันจดหรือดาวน์โหลดรหัสกู้คืนเก็บไว้แล้ว
          </label>
        </div>
        <div className="onboarding-actions">
          <Button variant="primary" onClick={onDone} className="next-button" disabled={!saved}>
            เปิดตู้เซฟของฉัน <ChevronRight size={17} />
          </Button>
        </div>
      </section>
    </AccessLayout>
  )
}

// ---------- unlock ----------
export function UnlockScreen({ email, onUnlock, onSignOut }: { email: string; onUnlock: (password: string) => Promise<string | null>; onSignOut: () => void }) {
  const [password, setPassword] = useState("")
  const { busy, error, setError, run } = useBusy()
  return (
    <AccessLayout>
      <section className="auth-card unlock-card">
        <span className="unlock-avatar">{initials(email)}</span>
        <h1>ปลดล็อกตู้เซฟ</h1>
        <p className="unlock-email">{email}</p>
        <form className="auth-form" onSubmit={(e) => { e.preventDefault(); void run(() => onUnlock(password)) }}>
          <input type="email" value={email} autoComplete="username" readOnly hidden />
          <label>
            <span>รหัสผ่านหลัก</span>
            <SecretInput value={password} onChange={(v) => { setPassword(v); setError("") }} placeholder="ป้อนรหัสผ่านหลัก"
              icon={<Lock size={17} />} error={!!error} autoFocus autoComplete="current-password" />
          </label>
          <ErrorText text={error} />
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

// ---------- forgot master password ----------
export function ForgotScreen({ initialEmail, onSend, onBack }: { initialEmail: string; onSend: (email: string) => Promise<string | null>; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail)
  const [sent, setSent] = useState(false)
  const { busy, error, run } = useBusy()
  return (
    <AccessLayout>
      <section className="auth-card">
        <div className="auth-heading">
          <span className="auth-icon"><LifeBuoy size={22} /></span>
          <h1>ลืมรหัสผ่านหลัก</h1>
          <p>กู้ตู้เซฟได้ด้วย 2 อย่างคู่กัน: ลิงก์ยืนยันทางอีเมล และรหัสกู้คืนจาก Emergency Kit</p>
        </div>
        {sent ? (
          <div className="account-password-note">
            <Mail size={17} />
            <span><strong>ส่งลิงก์ไปที่ {email} แล้ว</strong>เปิดลิงก์ในอีเมล ระบบจะพาไปหน้ากรอกรหัสกู้คืนและตั้งรหัสผ่านหลักใหม่</span>
          </div>
        ) : (
          <form className="auth-form" onSubmit={(e) => { e.preventDefault(); void run(async () => { const err = await onSend(email.trim()); if (!err) setSent(true); return err }) }}>
            <label>
              <span>อีเมล</span>
              <div className="access-input">
                <Mail size={17} />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="username" required autoFocus />
              </div>
            </label>
            <ErrorText text={error} />
            <Button variant="primary" className="auth-submit" type="submit" disabled={busy || !email.trim()}>{busy ? "กำลังส่ง…" : "ส่งลิงก์กู้คืน"}</Button>
          </form>
        )}
        <button className="text-action" type="button" onClick={onBack}><ArrowLeft size={14} /> กลับไปหน้าเข้าสู่ระบบ</button>
      </section>
    </AccessLayout>
  )
}

export function RecoverScreen({ email, onRecover, onCancel }: {
  email: string; onRecover: (code: string, password: string) => Promise<string | null>; onCancel: () => void
}) {
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const { busy, error, setError, run } = useBusy()
  const codeOk = !!normalizeRecoveryCode(code)
  return (
    <AccessLayout>
      <section className="auth-card">
        <div className="auth-heading">
          <span className="auth-icon"><LifeBuoy size={22} /></span>
          <h1>ตั้งรหัสผ่านหลักใหม่</h1>
          <p>ยืนยันอีเมล {email} แล้ว กรอกรหัสกู้คืนจาก Emergency Kit</p>
        </div>
        <form className="auth-form" noValidate onSubmit={(e) => {
          e.preventDefault()
          if (!codeOk) return setError("รูปแบบรหัสกู้คืนไม่ถูกต้อง (25 ตัวอักษร เช่น ABCDE-FGHJK-…)")
          if (!masterChecks(password, confirm).ok) return setError("รหัสผ่านหลักใหม่ยังไม่ผ่านเงื่อนไข")
          void run(() => onRecover(code, password))
        }}>
          <input type="email" value={email} autoComplete="username" readOnly hidden />
          <label>
            <span>รหัสกู้คืน</span>
            <div className={`access-input ${code && !codeOk ? "has-error" : ""}`}>
              <LifeBuoy size={17} />
              <input className="mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
                autoComplete="off" spellCheck={false} autoFocus />
            </div>
          </label>
          <NewMasterFields value={password} confirm={confirm} setValue={setPassword} setConfirm={setConfirm} label="รหัสผ่านหลักใหม่" />
          <ErrorText text={error} />
          <Button variant="primary" className="auth-submit" type="submit" disabled={busy}>{busy ? "กำลังกู้ตู้เซฟ…" : "กู้ตู้เซฟและตั้งรหัสใหม่"}</Button>
        </form>
        <button className="text-action" type="button" onClick={onCancel}>ยกเลิกและออกจากระบบ</button>
      </section>
    </AccessLayout>
  )
}

// ---------- one-time upgrade for accounts from the two-password era ----------
export function LegacyScreen({ email, needsAccountPassword, prefillOld = "", presetOld, presetNew, onUpgrade, onBack }: {
  email: string
  needsAccountPassword: boolean
  /** Editable starting value for the old master password field. */
  prefillOld?: string
  /** Already-verified old master password (field hidden). */
  presetOld?: string
  /** Already-chosen new master password (field hidden). */
  presetNew?: string
  onUpgrade: (accountPassword: string, oldMaster: string, newMaster: string | null) => Promise<string | null>
  onBack: () => void
}) {
  const [accountPw, setAccountPw] = useState("")
  const [oldField, setOldField] = useState(prefillOld)
  const [newMaster, setNewMaster] = useState("")
  const [confirm, setConfirm] = useState("")
  const { busy, error, setError, run } = useBusy()
  const oldMaster = presetOld ?? oldField
  // Without a preset new password, the old master password becomes the sign-in password,
  // so it must meet the new bar; otherwise ask for a new one.
  const needsNew = !presetNew && !!oldMaster && !masterChecks(oldMaster, oldMaster).ok
  return (
    <AccessLayout>
      <section className="auth-card">
        <div className="auth-heading">
          <span className="auth-icon"><KeyRound size={22} /></span>
          <h1>อัปเกรดเป็นรหัสผ่านเดียว</h1>
          <p>ทำครั้งเดียว หลังจากนี้ใช้แค่อีเมลกับรหัสผ่านหลักเข้าสู่ระบบ ข้อมูลในตู้เซฟจะอยู่ครบ</p>
        </div>
        <form className="auth-form" noValidate onSubmit={(e) => {
          e.preventDefault()
          if ((needsAccountPassword && !accountPw) || !oldMaster) return setError("กรุณากรอกข้อมูลให้ครบ")
          if (needsNew && !masterChecks(newMaster, confirm).ok) return setError("รหัสผ่านหลักใหม่ยังไม่ผ่านเงื่อนไข")
          void run(() => onUpgrade(accountPw, oldMaster, presetNew ?? (needsNew ? newMaster : null)))
        }}>
          <input type="email" value={email} autoComplete="username" readOnly hidden />
          {needsAccountPassword && (
            <label>
              <span>รหัสผ่านบัญชีเดิม (ที่ใช้ล็อกอิน)</span>
              <SecretInput value={accountPw} onChange={setAccountPw} placeholder="รหัสผ่านบัญชีเดิม" icon={<Mail size={17} />} autoComplete="current-password" autoFocus />
            </label>
          )}
          {presetOld === undefined && (
            <label>
              <span>รหัสผ่านหลักเดิม (ที่ใช้ปลดล็อกตู้เซฟ)</span>
              <SecretInput value={oldField} onChange={setOldField} placeholder="รหัสผ่านหลักเดิม" icon={<Lock size={17} />} autoComplete="off" autoFocus={!needsAccountPassword} />
            </label>
          )}
          {needsNew && (
            <>
              <div className="master-warning">
                <AlertTriangle size={20} />
                <span><strong>รหัสผ่านหลักเดิมยังไม่แข็งแรงพอ</strong>เพราะต่อไปจะใช้เข้าสู่ระบบด้วย กรุณาตั้งรหัสผ่านหลักใหม่</span>
              </div>
              <NewMasterFields value={newMaster} confirm={confirm} setValue={setNewMaster} setConfirm={setConfirm} label="รหัสผ่านหลักใหม่" />
            </>
          )}
          <ErrorText text={error} />
          <Button variant="primary" className="auth-submit" type="submit" disabled={busy}>{busy ? "กำลังอัปเกรด…" : "อัปเกรดบัญชี"}</Button>
        </form>
        <button className="text-action" type="button" onClick={onBack}><ArrowLeft size={14} /> {needsAccountPassword ? "กลับไปหน้าเข้าสู่ระบบ" : "ออกจากบัญชีนี้"}</button>
      </section>
    </AccessLayout>
  )
}

export function initials(email: string) {
  const name = email.split("@")[0].replace(/[^a-zA-Z0-9ก-๙]/g, " ").trim()
  const parts = name.split(/\s+/)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase() || "?"
}
