// Presentational building blocks from the Figma Make design (Design Vault Password Manager).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { AlertTriangle, LockKeyhole, X } from "lucide-react"

type ButtonProps = {
  children: ReactNode
  variant?: "primary" | "secondary" | "ghost" | "danger"
  icon?: ReactNode
  className?: string
  onClick?: () => void
  label?: string
  type?: "button" | "submit"
  disabled?: boolean
  autoFocus?: boolean
}

export function Button({ children, variant = "secondary", icon, className = "", onClick, label, type = "button", disabled, autoFocus }: ButtonProps) {
  return (
    <button className={`button button--${variant} ${className}`} onClick={onClick} aria-label={label} type={type} disabled={disabled} autoFocus={autoFocus}>
      {icon}
      {children}
    </button>
  )
}

export function IconButton({ children, label, onClick, active = false, disabled }: { children: ReactNode; label: string; onClick?: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button className={`icon-button ${active ? "is-active" : ""}`} aria-label={label} title={label} onClick={onClick} type="button" disabled={disabled}>
      {children}
    </button>
  )
}

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <LockKeyhole size={19} strokeWidth={2.2} />
      </span>
      <strong>ตู้เซฟ</strong>
    </div>
  )
}

export type Tone = "neutral" | "success" | "warning" | "danger" | "accent"
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`badge badge--${tone}`}>{children}</span>
}

/** Marks a designed feature that is not wired up yet. */
export const Soon = () => <Badge>เร็ว ๆ นี้</Badge>

export function SidebarItem({ icon, label, count, active, onClick }: { icon: ReactNode; label: string; count?: number; active?: boolean; onClick?: () => void }) {
  return (
    <button className={`sidebar-item ${active ? "is-active" : ""}`} onClick={onClick} type="button">
      {icon}
      <span>{label}</span>
      {count !== undefined && <small>{count}</small>}
    </button>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" className={`toggle ${checked ? "is-on" : ""}`} aria-pressed={checked} aria-label={label} onClick={onChange} disabled={disabled}>
      <span />
    </button>
  )
}

export function SettingToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="setting-toggle">
      <span>{label}</span>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

export function PageTitle({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="page-title">
      <span>{icon}</span>
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  )
}

export function SettingsSection({ id, title, description, children, danger }: { id?: string; title: string; description: string; children: ReactNode; danger?: boolean }) {
  return (
    <section id={id} className={`settings-section ${danger ? "is-danger" : ""}`}>
      <div className="settings-section-title">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {children}
    </section>
  )
}

export function SettingsRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {children}
    </div>
  )
}

export function Modal({ eyebrow, title, onClose, children, wide }: { eyebrow?: string; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const backdrop = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // With stacked dialogs (e.g. a confirm over the editor) only the topmost one closes.
      const all = document.querySelectorAll(".modal-backdrop")
      if (e.key === "Escape" && all[all.length - 1] === backdrop.current) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose} ref={backdrop}>
      <div className={`modal ${wide ? "modal--wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
          </div>
          <IconButton label="ปิด" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  )
}

export function StrengthMeter({ level, label }: { level: number; label: string }) {
  return (
    <div className={`strength-meter strength-meter--${level}`}>
      <div>
        {[1, 2, 3, 4].map((bar) => (
          <i key={bar} className={bar <= level ? "is-active" : ""} />
        ))}
      </div>
      <span>{label || "—"}</span>
    </div>
  )
}

// ---------- Confirmation dialog ----------
export type ConfirmOptions = {
  title: string
  message: ReactNode
  confirmLabel: string
  /** "danger" for irreversible actions; "warning" for recoverable ones such as moving to trash. */
  tone?: "danger" | "warning"
}
type Pending = ConfirmOptions & { resolve: (ok: boolean) => void }

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false)

/** Promise-based replacement for window.confirm that matches the app's dialogs. */
export const useConfirm = () => useContext(ConfirmContext)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...o, resolve })), [])
  const answer = (ok: boolean) => { pending?.resolve(ok); setPending(null) }
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && (
        <Modal eyebrow={pending.tone === "warning" ? "ยืนยันการดำเนินการ" : "ย้อนกลับไม่ได้"} title={pending.title} onClose={() => answer(false)}>
          <div className={`confirm-body confirm-body--${pending.tone ?? "danger"}`}>
            <AlertTriangle size={20} />
            <div>{pending.message}</div>
          </div>
          <div className="editor-actions">
            {/* Cancel takes focus so Enter never confirms a destructive action by accident. */}
            <Button variant="ghost" onClick={() => answer(false)} autoFocus>ยกเลิก</Button>
            <Button variant={pending.tone === "warning" ? "primary" : "danger"} onClick={() => answer(true)}>{pending.confirmLabel}</Button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  )
}
