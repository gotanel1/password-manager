// Cross-account RLS check against a real Supabase project, using two test users' access tokens.
// Never prints tokens or vault blobs. If a policy is broken it restores the victim's row from a snapshot.
import assert from "node:assert/strict"

const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, RLS_TOKEN_A: tokenA, RLS_TOKEN_B: tokenB } = process.env
assert(url && anon, "Missing SUPABASE_URL / SUPABASE_ANON_KEY in .env")
assert(tokenA && tokenB, "Missing RLS_TOKEN_A / RLS_TOKEN_B in .env.rls.local")

const userId = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url")).sub
const users = [{ name: "A", token: tokenA, id: userId(tokenA) }, { name: "B", token: tokenB, id: userId(tokenB) }]
assert(users[0].id !== users[1].id, "RLS_TOKEN_A and RLS_TOKEN_B belong to the same user")

async function rest(token, method, query, body) {
  const res = await fetch(`${url}/rest/v1/vaults${query}`, {
    method,
    headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body && JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch {}
  return { status: res.status, data }
}

let failed = 0
function check(ok, label) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
  if (!ok) failed++
}
const empty = (r) => r.status >= 400 || (Array.isArray(r.data) && r.data.length === 0)
const ownRow = async (user) => {
  const r = await rest(user.token, "GET", `?select=user_id,version,updated_at,blob&user_id=eq.${user.id}`)
  assert(r.status === 200, `Account ${user.name}: cannot read own row (HTTP ${r.status}); the token may have expired, copy a fresh one`)
  return r.data[0] ?? null
}

console.log(`Supabase: ${new URL(url).host}\n`)
check(empty(await rest(anon, "GET", "?select=user_id")), "Signed-out visitor sees no vault rows")

for (const [attacker, victim] of [[users[0], users[1]], [users[1], users[0]]]) {
  const own = await rest(attacker.token, "GET", "?select=user_id")
  check(own.status === 200 && own.data.every((row) => row.user_id === attacker.id), `${attacker.name} reads only its own row`)

  const snapshot = await ownRow(victim)
  if (!snapshot) {
    const r = await rest(attacker.token, "POST", "", { user_id: victim.id, blob: { ct: "x", iv: "x", salt: "x" }, version: 1 })
    check(r.status === 403 && r.data?.code === "42501", `${attacker.name} cannot create a vault for ${victim.name} (expected 42501)`)
    if (r.status < 300) await rest(victim.token, "DELETE", `?user_id=eq.${victim.id}`)
    continue
  }
  console.log(`SKIP  ${attacker.name} insert for ${victim.name}: ${victim.name} already has a vault`)

  check(empty(await rest(attacker.token, "GET", `?select=user_id&user_id=eq.${victim.id}`)), `${attacker.name} cannot read ${victim.name}'s vault`)
  // Same blob and version + 1: if the policy were broken only the version would move, not the data.
  check(empty(await rest(attacker.token, "PATCH", `?user_id=eq.${victim.id}`, { blob: snapshot.blob, version: snapshot.version + 1 })), `${attacker.name} cannot update ${victim.name}'s vault`)
  check(empty(await rest(attacker.token, "DELETE", `?user_id=eq.${victim.id}`)), `${attacker.name} cannot delete ${victim.name}'s vault`)

  const after = await ownRow(victim)
  if (!after) await rest(victim.token, "POST", "", { user_id: victim.id, blob: snapshot.blob, version: snapshot.version })
  check(after && after.version === snapshot.version && after.updated_at === snapshot.updated_at, `${victim.name}'s vault is unchanged afterwards${after ? "" : " (row was deleted and has been restored)"}`)
}

console.log(failed ? `\n${failed} check(s) FAILED: stop using real data and fix RLS first` : "\nAll RLS checks passed")
process.exitCode = failed ? 1 : 0
