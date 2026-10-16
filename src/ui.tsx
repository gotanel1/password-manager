// Presentational building blocks from the Figma Make design (Design Vault Password Manager).
import { useEffect, type ReactNode } from "react"
import { LockKeyhole, X } from "lucide-react"

type ButtonProps = {
  children: ReactNode
  variant?: "primary" | "secondary" | "ghost" | "danger"
  icon?: ReactNode
  className?: string
  onClick?: () => void
  label?: string
  type?: "button" | "submit"
  disabled?: boolean
}

export function Button({ children, variant = "secondary", icon, className = "", onClick, label, type = "button", disabled }: ButtonProps) {
  return (
    <button className={`button button--${variant} ${className}`} onClick={onClick} aria-label={label} type={type} disabled={disabled}>
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
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
