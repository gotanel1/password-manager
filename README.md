# ตู้เซฟรหัสผ่าน (Password Manager)

เว็บแอปจัดการรหัสผ่านแบบ zero-knowledge ตู้เซฟถูกเข้ารหัสในเบราว์เซอร์ด้วย AES-256-GCM โดยใช้กุญแจที่สร้างจากรหัสผ่านหลักด้วย PBKDF2-SHA256 600,000 รอบ จากนั้นจึงส่งไปเก็บใน Supabase
**Supabase และ Netlify ไม่เคยเห็นรหัสผ่านหลักหรือข้อมูลที่ยังไม่เข้ารหัส**

| ส่วน | หน้าที่ |
|---|---|
| `src/` | แอป React + Vite ที่ย้ายดีไซน์มาจาก Figma Make "Design Vault Password Manager" |
| `src/lib/` | ส่วนที่ไม่เกี่ยวกับหน้าจอ: เข้ารหัส (`crypto.ts`), ซิงก์ Supabase (`sync.ts`), โมเดลข้อมูลและการวิเคราะห์ความปลอดภัย (`model.ts`), TOTP (`totp.ts`), ตัวสร้างรหัสผ่าน (`password.ts`) |
| `src/dev/mock-supabase.ts` | Supabase จำลองในหน่วยความจำ ใช้กับ `npm run dev:mock` เท่านั้น ไม่ถูกรวมใน build จริง |
| `vite.config.ts` | เปิดให้ frontend เฉพาะ `SUPABASE_URL` / `SUPABASE_ANON_KEY` กัน secret/service_role key และห้าม production build ด้วย mock |
| `supabase/migrations/` | ตาราง `vaults` พร้อม RLS (ผู้ใช้เข้าถึงได้เฉพาะแถวของตัวเอง) และ trigger ที่กันการเขียนทับข้อมูลที่ใหม่กว่า |
| `netlify.toml` | คำสั่ง build, โฟลเดอร์ publish และ security headers (CSP ที่อนุญาตให้คุยกับ `*.supabase.co` เท่านั้น) |

มีรหัสผ่าน 2 ชุดที่ใช้แยกกัน:
- **รหัสผ่านบัญชี** ใช้ล็อกอิน Supabase Auth ถ้าลืมสามารถรีเซ็ตได้
- **รหัสผ่านหลัก** ใช้ถอดรหัสตู้เซฟ **ถ้าลืมจะกู้คืนไม่ได้**

## 1. ตั้งค่า Supabase

1. สร้างโปรเจกต์ที่ https://supabase.com/dashboard
2. ไปที่ **SQL Editor** แล้วรันไฟล์ `supabase/migrations/20261016000000_vaults.sql`
   หรือใช้ CLI:
   ```bash
   npx supabase link --project-ref <project-ref>
   ```
   ```bash
   npx supabase db push
   ```
3. ไปที่ **Authentication → URL Configuration**
   - ตั้ง **Site URL** เป็น URL ของ Netlify เช่น `https://your-site.netlify.app`
   - เพิ่ม URL เดียวกันใน **Redirect URLs** (ลิงก์ยืนยันอีเมลจะพากลับมาที่หน้านี้)
4. ไปที่ **Project Settings → API** แล้วคัดลอก **Project URL** และ **anon / publishable key**
   ⚠️ ห้ามใช้ `service_role` key ในหน้าเว็บเด็ดขาด

## 2. Deploy บน Netlify ผ่าน GitHub

1. Push repo นี้ขึ้น GitHub
2. ที่ Netlify ไปที่ **Add new site → Import an existing project → GitHub** แล้วเลือก repo นี้
   ค่า build จะถูกอ่านจาก `netlify.toml` อัตโนมัติ (`npm run build` และโฟลเดอร์ `dist`)
3. ไปที่ **Site configuration → Environment variables** แล้วเพิ่มค่า:
   - `SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `SUPABASE_ANON_KEY` = anon key
4. กด **Deploy** หลังจากนี้ทุกครั้งที่ push เข้า `main` ระบบจะ deploy ใหม่ให้เอง

## พัฒนาบนเครื่อง

```bash
cp .env.example .env
```
ใส่ค่าใน `.env` แล้วรัน:
```bash
npm install
```
```bash
npm run dev
```
จากนั้นเปิด http://127.0.0.1:8765 แล้วเพิ่ม `http://127.0.0.1:8765` ใน Redirect URLs ของ Supabase ด้วย

ถ้าอยากลองหน้าจอโดยไม่ต่อ Supabase จริง ให้รันคำสั่งนี้ (ข้อมูลจะเก็บใน localStorage ของเบราว์เซอร์และไม่ถูกส่งออกไปไหน):
```bash
npm run dev:mock
```

## ฟีเจอร์

ใช้งานได้จริง: สมัคร/ล็อกอิน, onboarding พร้อม Emergency Kit, ปลดล็อกด้วยรหัสผ่านหลัก, รายการ 6 ประเภท (บัญชีล็อกอิน บัตรเครดิต บันทึกลับ ข้อมูลส่วนตัว Wi-Fi บัญชีธนาคาร), โฟลเดอร์, แท็ก, รายการโปรด, ถังขยะ, รหัส 2FA (TOTP), ประวัติรหัสผ่าน, ตัวสร้างรหัสผ่าน/วลี/PIN, แดชบอร์ดตรวจรหัสอ่อน ซ้ำ และเก่า, ล็อกอัตโนมัติ, ล้างคลิปบอร์ดอัตโนมัติ, โหมดมืด, ส่งออก/นำเข้าไฟล์สำรองแบบเข้ารหัส, เปลี่ยนรหัสผ่านหลัก, ออกจากระบบทุกอุปกรณ์

ติดป้าย "เร็ว ๆ นี้": ปลดล็อกด้วย Passkey, 2FA ของบัญชี, รายการอุปกรณ์, ตรวจรหัสที่รั่วไหล, นำเข้าจาก Chrome/Bitwarden/CSV

ตู้เซฟที่สร้างด้วยเวอร์ชันก่อนหน้าจะถูกแปลงเป็นรูปแบบใหม่ให้อัตโนมัติเมื่อปลดล็อก

## ตรวจสอบก่อนทดลองใช้

```bash
npm test
npm run typecheck
npm run build
npm run verify:build
```

มี Vitest สำหรับคิวบันทึก การเข้ารหัส ไฟล์สำรอง ข้อมูลตู้เซฟ และการเชื่อมต่อกับหน้าจอ การทดสอบที่จำลอง Supabase ไม่ยืนยัน RLS หรือการตั้งค่าบริการจริง

- [คู่มือเริ่มใช้งานและสำรองข้อมูล](USER_GUIDE.md)
- [ผลตรวจ ขั้นตอนเตรียมบัญชีทดสอบ และเงื่อนไขก่อน deploy](TESTING.md)
- [เช็กลิสต์สถานะงาน](CHECKLIST.md)

เมื่อบันทึกล้มเหลว แอปจะยังไม่แสดงรายการนั้นว่าเป็นข้อมูลที่บันทึกแล้ว และจะไม่ส่งออกสำเนาเก่าในฐานะไฟล์ล่าสุด ให้ลองบันทึกซ้ำก่อนล็อกหรือโหลดหน้าใหม่ งานที่รับไว้ในคิวจะจบก่อนเปิดรอบตู้เซฟถัดไป ส่วนหน้าจอตู้เซฟจะถูกซ่อนทันทีเมื่อล็อก

## หมายเหตุด้านความปลอดภัย

- anon key เปิดเผยในหน้าเว็บได้ เพราะ RLS เป็นตัวป้องกันข้อมูล และในฐานข้อมูลมีแค่ ciphertext
- การแก้ไขพร้อมกันจากหลายเครื่องจะถูกตรวจจับผ่านคอลัมน์ `version` ฝั่งที่บันทึกช้ากว่าจะถูกให้ปลดล็อกใหม่ แทนที่จะเขียนทับข้อมูลของอีกเครื่อง
- ควรกด "ส่งออก" เก็บไฟล์สำรองไว้เป็นระยะ ไฟล์ที่ได้ยังเข้ารหัสอยู่
