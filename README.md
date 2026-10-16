# ตู้เซฟรหัสผ่าน (Password Manager)

เว็บแอปจัดการรหัสผ่านแบบ zero-knowledge ตู้เซฟถูกเข้ารหัสในเบราว์เซอร์ด้วย AES-256-GCM โดยใช้กุญแจที่สร้างจากรหัสผ่านหลักด้วย PBKDF2-SHA256 600,000 รอบ จากนั้นจึงส่งไปเก็บใน Supabase
**Supabase และ Netlify ไม่เคยเห็นรหัสผ่านหลักหรือข้อมูลที่ยังไม่เข้ารหัส**

| ส่วน | หน้าที่ |
|---|---|
| `site/` | หน้าเว็บ ไม่มี framework (`index.html`, `app.js`, `app.css`) |
| `scripts/build.mjs` | คัดลอก supabase-js ไปไว้ที่ `site/vendor/` และสร้าง `site/config.js` จาก env |
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
   ค่า build จะถูกอ่านจาก `netlify.toml` อัตโนมัติ (`npm run build` และโฟลเดอร์ `site`)
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

## หมายเหตุด้านความปลอดภัย

- anon key เปิดเผยในหน้าเว็บได้ เพราะ RLS เป็นตัวป้องกันข้อมูล และในฐานข้อมูลมีแค่ ciphertext
- การแก้ไขพร้อมกันจากหลายเครื่องจะถูกตรวจจับผ่านคอลัมน์ `version` ฝั่งที่บันทึกช้ากว่าจะถูกให้ปลดล็อกใหม่ แทนที่จะเขียนทับข้อมูลของอีกเครื่อง
- ควรกด "ส่งออก" เก็บไฟล์สำรองไว้เป็นระยะ ไฟล์ที่ได้ยังเข้ารหัสอยู่
