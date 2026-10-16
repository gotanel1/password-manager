"use strict";
const ITER = 600000;
const AUTO_LOCK_MS = 5 * 60 * 1000;
const CLIP_CLEAR_MS = 30 * 1000;
const enc = new TextEncoder(), dec = new TextDecoder();
const $ = id => document.getElementById(id);

const cfg = window.APP_CONFIG || {};
const sb = cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase
  ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
  : null;

let user = null;          // Supabase auth user
let remote = null;        // { blob, version } of the stored vault row, null if none yet
let key = null, salt = null, entries = [], editingId = null, lockTimer = null;

// ---------- crypto ----------
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function deriveKey(password, saltBytes, iter = ITER) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: saltBytes, iterations: iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function seal(k, s, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, enc.encode(JSON.stringify(data)));
  return { v: 1, kdf: "PBKDF2-SHA256", iter: ITER, salt: b64(s), iv: b64(iv), ct: b64(ct) };
}
async function unseal(blob, password) {
  const k = await deriveKey(password, unb64(blob.salt), blob.iter);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, k, unb64(blob.ct));
  return { key: k, salt: unb64(blob.salt), data: JSON.parse(dec.decode(pt)) };
}

// ---------- storage (Supabase, ciphertext only) ----------
async function fetchVault() {
  const { data, error } = await sb.from("vaults").select("blob, version").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  remote = data;
}
// Optimistic concurrency: an update only lands if nobody else saved since we loaded.
async function saveBlob(blob) {
  if (!remote) {
    const { data, error } = await sb.from("vaults").insert({ user_id: user.id, blob, version: 1 }).select("blob, version").single();
    if (error) throw error;
    remote = data; return;
  }
  const { data, error } = await sb.from("vaults")
    .update({ blob, version: remote.version + 1 })
    .eq("user_id", user.id).eq("version", remote.version)
    .select("blob, version");
  if (error && error.code !== "40001") throw error;
  if (error || !data.length) {
    toast("ตู้เซฟถูกแก้จากเครื่องอื่น กรุณาปลดล็อกใหม่");
    lock(); throw new Error("conflict");
  }
  remote = data[0];
}
async function persist() {
  try { await saveBlob(await seal(key, salt, entries)); }
  catch (e) { if (e.message !== "conflict") toast("บันทึกขึ้นเซิร์ฟเวอร์ไม่สำเร็จ: " + e.message); throw e; }
}

// ---------- password tools ----------
function randInt(max) { // unbiased
  const lim = Math.floor(0x100000000 / max) * max, a = new Uint32Array(1);
  do crypto.getRandomValues(a); while (a[0] >= lim);
  return a[0] % max;
}
function generate(len, sym) {
  const sets = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789"];
  if (sym) sets.push("!@#$%^&*()-_=+[]{};:,.?");
  const all = sets.join("");
  const out = sets.map(s => s[randInt(s.length)]); // one from each class
  while (out.length < len) out.push(all[randInt(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = randInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join("");
}
function bits(p) {
  if (!p) return 0;
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26; if (/[A-Z]/.test(p)) pool += 26;
  if (/\d/.test(p)) pool += 10; if (/[^a-zA-Z\d]/.test(p)) pool += 33;
  return Math.round(p.length * Math.log2(pool || 1));
}
// Tumbler scale: 0 none, 1 very weak (<40 bits), 2 fair (<60), 3 good (<80), 4 strong.
const LEVELS = [["", ""], ["อ่อนมาก", "danger"], ["พอใช้", "warn"], ["ดี", "good"], ["แข็งแรง", "good"]];
function score(p) { const b = bits(p); return !b ? 0 : b < 40 ? 1 : b < 60 ? 2 : b < 80 ? 3 : 4; }
function meter(el, p) {
  const s = score(p), [word, tone] = LEVELS[s];
  el.dataset.tone = tone;
  const pins = document.createElement("span"); pins.className = "pins";
  for (let i = 0; i < 4; i++) { const pin = document.createElement("span"); pin.className = "pin" + (i < s ? " on" : ""); pins.append(pin); }
  const w = document.createElement("span"); w.className = "word"; w.textContent = word;
  const d = document.createElement("span"); d.className = "meta muted"; d.textContent = p ? `${p.length} ตัว · ประมาณ ${bits(p)} บิต` : "";
  el.replaceChildren(pins, w, d);
}

// ---------- UI helpers ----------
function toast(t) { const e = $("toast"); e.textContent = t; e.classList.add("show"); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove("show"), 2500); }
function msg(el, t, kind) { el.textContent = t; el.className = "msg " + (kind || ""); }
let clipTimer;
async function copy(text, what) {
  await navigator.clipboard.writeText(text);
  toast(`คัดลอก${what}แล้ว · ล้างคลิปบอร์ดใน ${CLIP_CLEAR_MS / 1000} วินาที`);
  clearTimeout(clipTimer);
  clipTimer = setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), CLIP_CLEAR_MS);
}
function show(view) {
  ["authView", "lockView", "vaultView", "configError"].forEach(v => $(v).classList.toggle("hidden", v !== view));
}

async function showLock() {
  show("lockView");
  $("whoami").textContent = user.email;
  $("whoTile").textContent = initial(user.email);
  msg($("lockMsg"), "กำลังโหลดตู้เซฟ…");
  try { await fetchVault(); msg($("lockMsg"), ""); }
  catch (e) { return msg($("lockMsg"), "โหลดตู้เซฟไม่สำเร็จ: " + e.message, "err"); }
  const isNew = !remote;
  $("lockTitle").textContent = isNew ? "สร้างตู้เซฟใหม่" : "ปลดล็อกตู้เซฟ";
  $("lockBtn").textContent = isNew ? "สร้าง" : "ปลดล็อก";
  $("confirmWrap").classList.toggle("hidden", !isNew);
  $("master").autocomplete = isNew ? "new-password" : "current-password";
  $("master").value = $("master2").value = "";
  $("master").focus();
}
function lock() {
  key = null; salt = null; entries = []; $("list").replaceChildren();
  document.querySelectorAll("dialog[open]").forEach(d => d.close());
  clearTimeout(lockTimer);
  if (user) showLock(); else show("authView");
}
function touch() { if (!key) return; clearTimeout(lockTimer); lockTimer = setTimeout(lock, AUTO_LOCK_MS); }
["mousemove", "keydown", "click", "touchstart"].forEach(ev => document.addEventListener(ev, touch, { passive: true }));

function showVault() { show("vaultView"); $("search").value = ""; render(); touch(); }

// Monogram from the name instead of a fetched favicon, so the list never reveals which sites you use.
const initial = s => (s || "?").replace(/^https?:\/\//, "").replace(/^www\./, "").charAt(0).toUpperCase();
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

function render() {
  const q = $("search").value.trim().toLowerCase();
  const list = entries
    .filter(e => !q || [e.title, e.user, e.url].some(v => (v || "").toLowerCase().includes(q)))
    .sort((a, b) => a.title.localeCompare(b.title, "th"));
  const uses = new Map();
  for (const e of entries) if (e.pass) uses.set(e.pass, (uses.get(e.pass) || 0) + 1);
  const reused = entries.filter(e => e.pass && uses.get(e.pass) > 1).length;
  const weak = entries.filter(e => e.pass && score(e.pass) === 1).length;
  $("count").textContent = [`${entries.length} รายการ`, reused && `ใช้ซ้ำ ${reused}`, weak && `อ่อน ${weak}`].filter(Boolean).join(" · ");
  const root = $("list");
  if (!list.length) {
    root.replaceChildren(el("div", "empty", entries.length ? "ไม่พบรายการ ลองค้นด้วยชื่อโดเมน" : "ยังไม่มีรายการ กด “เพิ่มรายการ” เพื่อเริ่ม"));
    return;
  }
  root.replaceChildren(...list.map(e => {
    const row = el("div", "entry");
    const tile = el("span", "tile", initial(e.title)); tile.setAttribute("aria-hidden", "true");
    const main = el("div", "main");
    main.append(el("span", "name", e.title), el("span", "sub meta", e.user || e.url || " "));
    const tags = el("div", "tags");
    if (e.pass && score(e.pass) === 1) tags.append(el("span", "tag danger", "อ่อน"));
    if (e.pass && uses.get(e.pass) > 1) tags.append(el("span", "tag warn", `ใช้ซ้ำ ${uses.get(e.pass)} ที่`));
    const acts = el("div", "acts");
    const mk = (label, cls, fn) => { const b = el("button", cls, label); b.onclick = fn; return b; };
    if (e.user) acts.append(mk("ชื่อผู้ใช้", "small", () => copy(e.user, "ชื่อผู้ใช้")));
    if (e.pass) acts.append(mk("รหัสผ่าน", "small", () => copy(e.pass, "รหัสผ่าน")));
    acts.append(mk("แก้ไข", "small quiet", () => openEdit(e)));
    row.append(tile, main, tags, acts);
    return row;
  }));
}

// ---------- account ----------
$("authForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const mode = ev.submitter?.value, m = $("authMsg");
  const creds = { email: $("email").value.trim(), password: $("loginPw").value };
  msg(m, "กำลังดำเนินการ…");
  const { data, error } = mode === "signup"
    ? await sb.auth.signUp({ ...creds, options: { emailRedirectTo: location.origin } })
    : await sb.auth.signInWithPassword(creds);
  if (error) return msg(m, error.message, "err");
  if (mode === "signup" && !data.session) return msg(m, "ส่งอีเมลยืนยันแล้ว กดลิงก์ในอีเมลแล้วกลับมาเข้าสู่ระบบ", "ok");
  $("loginPw").value = ""; msg(m, "");
});
$("signOutBtn").onclick = () => sb.auth.signOut();

// ---------- unlock / create ----------
$("master").addEventListener("input", () => meter($("masterMeter"), $("master").value));
$("lockForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const pw = $("master").value, m = $("lockMsg");
  $("lockBtn").disabled = true; msg(m, "กำลังประมวลผล…");
  try {
    if (!remote) {
      if (pw.length < 10) return msg(m, "รหัสผ่านหลักควรยาวอย่างน้อย 10 ตัวอักษร", "err");
      if (pw !== $("master2").value) return msg(m, "รหัสผ่านทั้งสองช่องไม่ตรงกัน", "err");
      salt = crypto.getRandomValues(new Uint8Array(16));
      key = await deriveKey(pw, salt); entries = [];
      await persist();
    } else {
      try { ({ key, salt, data: entries } = await unseal(remote.blob, pw)); }
      catch { return msg(m, "รหัสผ่านหลักไม่ถูกต้อง", "err"); }
    }
    msg(m, ""); showVault();
  } catch (e) { msg(m, e.message, "err"); }
  finally { $("lockBtn").disabled = false; }
});
$("lockNowBtn").onclick = lock;
$("search").oninput = render;

// ---------- add / edit ----------
function openEdit(e) {
  editingId = e ? e.id : null;
  $("editTitle").textContent = e ? "แก้ไขรายการ" : "เพิ่มรายการ";
  $("fTitle").value = e?.title || ""; $("fUser").value = e?.user || "";
  $("fPass").value = e?.pass || ""; $("fUrl").value = e?.url || ""; $("fNotes").value = e?.notes || "";
  $("fPass").type = "password"; $("togglePass").textContent = "แสดง";
  $("delBtn").classList.toggle("hidden", !e);
  meter($("passMeter"), $("fPass").value);
  $("editDlg").showModal();
}
$("addBtn").onclick = () => openEdit(null);
$("fPass").oninput = () => meter($("passMeter"), $("fPass").value);
function reveal(on) { $("fPass").type = on ? "text" : "password"; $("togglePass").textContent = on ? "ซ่อน" : "แสดง"; }
$("togglePass").onclick = () => reveal($("fPass").type === "password");
$("genBtn").onclick = () => {
  const len = Math.max(8, Math.min(128, +$("genLen").value || 20));
  $("fPass").value = generate(len, $("genSym").checked); reveal(true);
  meter($("passMeter"), $("fPass").value);
};
$("editForm").addEventListener("submit", async ev => {
  if (ev.submitter?.value !== "save") return;
  ev.preventDefault();
  $("editDlg").close();
  const data = { title: $("fTitle").value.trim(), user: $("fUser").value.trim(), pass: $("fPass").value,
                 url: $("fUrl").value.trim(), notes: $("fNotes").value, updated: Date.now() };
  if (editingId) Object.assign(entries.find(x => x.id === editingId), data);
  else entries.push({ id: crypto.randomUUID(), created: Date.now(), ...data });
  render();
  await persist(); toast("บันทึกแล้ว");
});
$("delBtn").onclick = async () => {
  if (!confirm("ลบรายการนี้ถาวร?")) return;
  entries = entries.filter(x => x.id !== editingId);
  $("editDlg").close(); render(); await persist(); toast("ลบแล้ว");
};

// ---------- change master ----------
$("changeMasterBtn").onclick = () => { ["oldM", "newM", "newM2"].forEach(i => $(i).value = ""); msg($("masterMsg"), ""); $("masterDlg").showModal(); };
$("masterForm").addEventListener("submit", async ev => {
  if (ev.submitter?.value !== "save") return;
  ev.preventDefault();
  const m = $("masterMsg");
  if ($("newM").value.length < 10) return msg(m, "รหัสใหม่ควรยาวอย่างน้อย 10 ตัวอักษร", "err");
  if ($("newM").value !== $("newM2").value) return msg(m, "รหัสใหม่ไม่ตรงกัน", "err");
  try { await unseal(remote.blob, $("oldM").value); } catch { return msg(m, "รหัสเดิมไม่ถูกต้อง", "err"); }
  salt = crypto.getRandomValues(new Uint8Array(16));
  key = await deriveKey($("newM").value, salt);
  await persist(); $("masterDlg").close(); toast("เปลี่ยนรหัสผ่านหลักแล้ว");
});

// ---------- export / import ----------
$("exportBtn").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(remote.blob)], { type: "application/json" }));
  a.download = `vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
  toast("ส่งออกไฟล์สำรองแล้ว (ยังเข้ารหัสอยู่)");
};
const pickFile = () => { $("fileIn").value = ""; $("fileIn").click(); };
$("importBtn").onclick = pickFile; $("importLockedBtn").onclick = pickFile;
$("fileIn").onchange = async () => {
  const f = $("fileIn").files[0]; if (!f) return;
  let blob;
  try { blob = JSON.parse(await f.text()); if (!blob.ct || !blob.salt || !blob.iv) throw 0; }
  catch { return toast("ไฟล์ไม่ถูกต้อง"); }
  const pw = prompt("ใส่รหัสผ่านหลักของไฟล์สำรองนี้");
  if (pw === null) return;
  let imported;
  try { imported = await unseal(blob, pw); } catch { return toast("รหัสผ่านไม่ถูกต้อง"); }
  if (key) { // merge into the open vault
    const ids = new Set(entries.map(e => e.id));
    const added = imported.data.filter(e => !ids.has(e.id));
    entries.push(...added); render(); await persist();
    toast(`นำเข้า ${added.length} รายการ`);
  } else { // replace the locked (or empty) vault
    if (remote && !confirm("แทนที่ตู้เซฟบนเซิร์ฟเวอร์ด้วยไฟล์สำรองนี้?")) return;
    await saveBlob(blob);
    ({ key, salt, data: entries } = imported);
    showVault();
  }
};

// ---------- boot ----------
if (!sb) show("configError");
else sb.auth.onAuthStateChange((event, session) => {
  const next = session?.user || null;
  if (event !== "INITIAL_SESSION" && next?.id === user?.id) return; // token refresh etc.
  user = next;
  // Defer: Supabase recommends not awaiting other supabase calls inside this callback.
  setTimeout(lock, 0);
});
