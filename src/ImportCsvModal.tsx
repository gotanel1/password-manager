import { useEffect, useRef, useState } from "react"
import { useVault } from "./state"
import { Button, Modal } from "./ui"
import { MAX_IMPORT_BYTES, mergeCsvImport, parsePasswordCsv, planCsvImport, type CsvImport } from "./lib/import"

export function ImportCsvModal({ close }: { close: () => void }) {
  const { data, update, toast } = useVault()
  const [parsed, setParsed] = useState<CsvImport | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const request = useRef(0)
  useEffect(() => () => { request.current++ }, [])
  const plan = parsed ? planCsvImport(data, parsed.items) : null
  const dismiss = () => { if (!busy) { request.current++; close() } }
  return (
    <Modal eyebrow="ย้ายข้อมูลเข้าตู้เซฟ" title="นำเข้าจาก Chrome / Bitwarden" onClose={dismiss} wide>
      <form className="editor-form" onSubmit={async (e) => {
        e.preventDefault()
        if (busy || !parsed || !plan?.added.length) return
        setBusy(true)
        setError("")
        let count = 0
        try {
          await update((latest) => {
            const next = mergeCsvImport(latest, parsed.items)
            count = next.items.length - latest.items.length
            return next
          })
          toast(`นำเข้า ${count} รายการแล้ว`)
          close()
        } catch { setError("นำเข้าไม่สำเร็จ กรุณาตรวจการเชื่อมต่อและลองอีกครั้ง") }
        finally { setBusy(false) }
      }}>
        <p className="muted-text">เลือกไฟล์ CSV จาก Chrome หรือ Bitwarden รองรับข้อมูลเข้าสู่ระบบและโน้ต ขนาดไม่เกิน 5 MB และ 10,000 รายการ</p>
        <p className="muted-text">ไฟล์ CSV มีรหัสผ่านที่ยังไม่เข้ารหัส แอปอ่านไฟล์ในเครื่องและเข้ารหัสก่อนบันทึก หลังนำเข้าสำเร็จควรลบไฟล์ CSV ที่ส่งออกไว้</p>
        <label className="master-field"><span>ไฟล์ CSV</span>
          <input type="file" accept=".csv,text/csv" disabled={busy} onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            const id = ++request.current
            setParsed(null)
            setError("")
            if (!file) return
            if (file.size > MAX_IMPORT_BYTES) { setError("ไฟล์ต้องมีขนาดไม่เกิน 5 MB"); return }
            setBusy(true)
            try {
              const result = parsePasswordCsv(await file.text())
              if (id === request.current) setParsed(result)
            } catch (err) {
              if (id === request.current) setError(err instanceof Error ? err.message : "อ่านไฟล์ไม่สำเร็จ")
            } finally { if (id === request.current) setBusy(false) }
          }} />
        </label>
        {parsed && plan && <div aria-live="polite">
          <p>{parsed.source} · พบ {parsed.items.length} รายการ · เพิ่มใหม่ {plan.added.length} รายการ · ข้ามรายการซ้ำ {plan.duplicates} รายการ</p>
          <p className="muted-text">ข้ามเฉพาะรายการที่เนื้อหาตรงกันทั้งหมด รายการที่รหัสผ่านต่างกันจะเพิ่มแยก ข้อมูลเดิมจะไม่ถูกเขียนทับ คอลัมน์เพิ่มเติมจะเก็บในโน้ต</p>
          <ul>{plan.added.slice(0, 10).map((item) => <li key={item.id}>{item.title} · {item.type === "login" ? "ข้อมูลเข้าสู่ระบบ" : "โน้ต"}</li>)}</ul>
          {plan.added.length > 10 && <p className="muted-text">และอีก {plan.added.length - 10} รายการ</p>}
        </div>}
        {error && <small className="input-error" role="alert">{error}</small>}
        <div className="editor-actions">
          <Button variant="ghost" onClick={dismiss} disabled={busy}>ยกเลิก</Button>
          <Button variant="primary" type="submit" disabled={busy || !plan?.added.length}>{busy ? "กำลังดำเนินการ…" : `ยืนยันนำเข้า ${plan?.added.length ?? 0} รายการ`}</Button>
        </div>
      </form>
    </Modal>
  )
}
