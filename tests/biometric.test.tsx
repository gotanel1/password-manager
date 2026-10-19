// @vitest-environment jsdom
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UnlockScreen } from "../src/access"
import { SettingsPage } from "../src/pages"
import { VaultContext, type VaultApi } from "../src/state"
import { ConfirmProvider } from "../src/ui"
import { analyze, emptyVault } from "../src/lib/model"
import { b64, unb64 } from "../src/lib/crypto"
import { newVaultKey, openV2, sealV2 } from "../src/lib/keys"
import {
  BiometricCancelledError, BiometricPendingError, BiometricUnsupportedError, biometricRecord, enrollBiometric, forgetBiometric, hasBiometric, unlockBiometric,
  unwrapFromDevice, wrapForDevice,
} from "../src/lib/biometric"

const email = "Test@Example.invalid"
const secret = () => crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer
/** Seals a token with `key` so a test can prove an unwrapped key is the same key. */
const header = { v: 2 as const, kdf: "PBKDF2-SHA256" as const, iter: 600_000, salt: "", keys: { master: { iv: "", ct: "" } } }
const canOpen = async (sealedWith: CryptoKey, candidate: CryptoKey) => {
  const blob = await sealV2(header, sealedWith, { ok: true })
  return openV2(blob, candidate).then(() => true, () => false)
}

afterEach(() => { forgetBiometric(); vi.unstubAllGlobals() })

describe("device wrapping", () => {
  it("round-trips the vault key through the PRF secret and rejects any other secret", async () => {
    const vaultKey = await newVaultKey()
    const prf = secret()
    const wrapped = await wrapForDevice(vaultKey, prf)
    expect(await canOpen(vaultKey, await unwrapFromDevice(wrapped, prf))).toBe(true)
    await expect(unwrapFromDevice(wrapped, secret())).rejects.toThrow()
    expect(JSON.stringify(wrapped)).not.toContain(b64(await crypto.subtle.exportKey("raw", vaultKey)))
  })
})

/** A fake platform authenticator: one passkey whose PRF is HMAC-like but deterministic per salt. */
function fakeAuthenticator({ prf = true, resultsAtCreate = true, fail, refuseGetsWithoutTap = 0 }:
  { prf?: boolean; resultsAtCreate?: boolean; fail?: string; /** How many assertions to refuse first, like Safari without a fresh tap. */ refuseGetsWithoutTap?: number } = {}) {
  const rawId = crypto.getRandomValues(new Uint8Array(16)).buffer
  const device = crypto.getRandomValues(new Uint8Array(32))
  const evaluate = async (salt: BufferSource) => {
    const s = ArrayBuffer.isView(salt) ? new Uint8Array(salt.buffer, salt.byteOffset, salt.byteLength) : new Uint8Array(salt as ArrayBuffer)
    return crypto.subtle.digest("SHA-256", new Uint8Array([...device, ...s]))
  }
  const calls = { create: [] as PublicKeyCredentialCreationOptions[], get: [] as PublicKeyCredentialRequestOptions[] }
  const credential = (results?: ArrayBuffer) => ({
    rawId, id: b64(rawId), type: "public-key",
    getClientExtensionResults: () => (prf ? { prf: { enabled: true, ...(results ? { results: { first: results } } : {}) } } : {}),
  })
  const credentials = {
    create: vi.fn(async (o: CredentialCreationOptions) => {
      if (fail) throw new DOMException("denied", fail)
      calls.create.push(o.publicKey!)
      return credential(resultsAtCreate ? await evaluate(o.publicKey!.extensions!.prf!.eval!.first) : undefined)
    }),
    get: vi.fn(async (o: CredentialRequestOptions) => {
      if (fail) throw new DOMException("denied", fail)
      if (refuseGetsWithoutTap-- > 0) throw new DOMException("no user activation", "NotAllowedError")
      calls.get.push(o.publicKey!)
      const allowed = o.publicKey!.allowCredentials ?? []
      if (!allowed.some((c) => b64(c.id as ArrayBuffer) === b64(rawId))) throw new DOMException("no such credential", "NotAllowedError")
      return credential(await evaluate(o.publicKey!.extensions!.prf!.eval!.first))
    }),
  }
  vi.stubGlobal("navigator", { ...navigator, credentials })
  return { calls, credentials }
}

describe("enrolling and unlocking with a passkey", () => {
  it("stores the vault key wrapped by the PRF secret and unlocks with one assertion", async () => {
    const auth = fakeAuthenticator()
    const vaultKey = await newVaultKey()
    await enrollBiometric(email, vaultKey)

    const created = auth.calls.create[0]
    expect(created.authenticatorSelection).toMatchObject({ authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" })
    expect(created.user.name).toBe("test@example.invalid")
    expect(created.extensions?.prf?.eval?.first).toBeTruthy()
    const record = biometricRecord(email)!
    expect(record.email).toBe("test@example.invalid")
    expect(hasBiometric("other@example.invalid")).toBe(false)
    // Nothing on this device is the key itself or anything derived from it without the authenticator.
    expect(localStorage.getItem("vault-biometric")).not.toContain(b64(await crypto.subtle.exportKey("raw", vaultKey)))

    const unlocked = await unlockBiometric(email)
    expect(await canOpen(vaultKey, unlocked)).toBe(true)
    const asked = auth.calls.get[0]
    expect(asked.userVerification).toBe("required")
    expect(b64(asked.allowCredentials![0].id as ArrayBuffer)).toBe(record.credentialId)
    expect(b64(asked.extensions!.prf!.eval!.first as ArrayBuffer)).toBe(record.salt)
    expect(unb64(record.salt)).toHaveLength(32)
  })

  it("asks a second time when the authenticator only hands out the secret on assertion", async () => {
    const auth = fakeAuthenticator({ resultsAtCreate: false })
    const vaultKey = await newVaultKey()
    await enrollBiometric(email, vaultKey)
    expect(auth.credentials.get).toHaveBeenCalledTimes(1)
    expect(await canOpen(vaultKey, await unlockBiometric(email))).toBe(true)
  })

  it("keeps the new passkey as pending when the browser wants a fresh tap, and finishes on the next try", async () => {
    const auth = fakeAuthenticator({ resultsAtCreate: false, refuseGetsWithoutTap: 1 })
    const vaultKey = await newVaultKey()
    await expect(enrollBiometric(email, vaultKey)).rejects.toBeInstanceOf(BiometricPendingError)
    expect(hasBiometric(email)).toBe(false) // nothing usable yet, so the unlock screen does not offer it

    await enrollBiometric(email, vaultKey)
    expect(auth.credentials.create).toHaveBeenCalledTimes(1) // the pending passkey is reused, not a second one made
    expect(hasBiometric(email)).toBe(true)
    expect(localStorage.getItem("vault-biometric-pending")).toBeNull()
    expect(await canOpen(vaultKey, await unlockBiometric(email))).toBe(true)
  })

  it("refuses an authenticator without PRF and stores nothing", async () => {
    fakeAuthenticator({ prf: false })
    await expect(enrollBiometric(email, await newVaultKey())).rejects.toBeInstanceOf(BiometricUnsupportedError)
    expect(hasBiometric(email)).toBe(false)
  })

  it("reports a cancelled prompt as such, and a missing enrolment plainly", async () => {
    fakeAuthenticator({ fail: "NotAllowedError" })
    await expect(enrollBiometric(email, await newVaultKey())).rejects.toBeInstanceOf(BiometricCancelledError)
    await expect(unlockBiometric(email)).rejects.toThrow("ยังไม่ได้เปิดใช้")
  })

  it("ignores a record left by another account and tolerates garbage in storage", () => {
    localStorage.setItem("vault-biometric", JSON.stringify({ email: "someone@example.invalid", credentialId: "x", salt: "y", wrapped: { iv: "", ct: "" } }))
    expect(hasBiometric(email)).toBe(false)
    localStorage.setItem("vault-biometric", "{not json")
    expect(hasBiometric(email)).toBe(false)
  })
})

describe("screens", () => {
  let host: HTMLDivElement, root: Root
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove() })
  const render = (ui: ReactNode) => act(async () => { root.render(ui) })
  const button = (text: string) => [...host.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === text)
  const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
  const api = (over: Partial<VaultApi> = {}) => ({
    email, data: emptyVault(), analysis: analyze([]),
    prefs: { theme: "light", autoLockMin: 5, clipboardSec: 30 }, setPrefs: vi.fn(),
    update: vi.fn(), copy: vi.fn(), toast: vi.fn(), lock: vi.fn(), signOut: vi.fn(),
    changeMaster: vi.fn(), rotateRecovery: vi.fn(), importBackup: vi.fn(), exportBackup: vi.fn(), deleteVault: vi.fn(),
    biometric: false, enableBiometric: vi.fn(async () => null), disableBiometric: vi.fn(),
    ...over,
  }) as VaultApi

  it("shows the passkey button on the unlock screen only when this device is enrolled", async () => {
    await render(<UnlockScreen email={email} onUnlock={async () => null} onSignOut={() => {}} />)
    expect(button("ปลดล็อกด้วย Passkey หรือลายนิ้วมือ")).toBeUndefined()

    const onBiometric = vi.fn(async () => "Passkey นี้เปิดตู้เซฟปัจจุบันไม่ได้แล้ว")
    await render(<UnlockScreen email={email} onUnlock={async () => null} onBiometric={onBiometric} onSignOut={() => {}} />)
    await click(button("ปลดล็อกด้วย Passkey หรือลายนิ้วมือ")!)
    expect(onBiometric).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain("Passkey นี้เปิดตู้เซฟปัจจุบันไม่ได้แล้ว")
  })

  it("offers the setting only with a platform authenticator, and the toggle enrols or forgets", async () => {
    const a = api()
    await render(<ConfirmProvider><VaultContext.Provider value={a}><SettingsPage /></VaultContext.Provider></ConfirmProvider>)
    expect(button("ปลดล็อกด้วย Passkey")).toBeUndefined()
    expect(host.textContent).toContain("ไม่รองรับ")

    vi.stubGlobal("PublicKeyCredential", { isUserVerifyingPlatformAuthenticatorAvailable: async () => true })
    const b = api()
    await render(<ConfirmProvider><VaultContext.Provider value={b}><SettingsPage key="supported" /></VaultContext.Provider></ConfirmProvider>)
    await click(button("ปลดล็อกด้วย Passkey")!)
    expect(b.enableBiometric).toHaveBeenCalledTimes(1)
    expect(b.toast).toHaveBeenCalledWith(expect.stringContaining("เปิดใช้แล้ว"))

    const c = api({ biometric: true })
    await render(<ConfirmProvider><VaultContext.Provider value={c}><SettingsPage key="on" /></VaultContext.Provider></ConfirmProvider>)
    await click(button("ปลดล็อกด้วย Passkey")!)
    expect(c.disableBiometric).toHaveBeenCalledTimes(1)
    expect(c.enableBiometric).not.toHaveBeenCalled()
  })
})
