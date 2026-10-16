// Opening, creating, upgrading and recovering vaults. Pure crypto + one save call; no UI state.
import { isEnvelope, unb64, unseal, type Envelope } from "./crypto"
import {
  deriveMasterKeys, emailSalt, headerOf, isEnvelopeV2, newHeader, newRecoveryCode, newVaultKey, openV2, recoveryWrapKey, sealV2,
  unlockWithMaster, unwrap, wrap, type EnvelopeV2, type Header, type MasterKeys,
} from "./keys"
import { emptyVault, migrate, type VaultData } from "./model"
import type { Remote } from "./sync"

type Stored = NonNullable<Remote>
type Save = (remote: Remote, blob: EnvelopeV2) => Promise<Stored>
export type Opened = { vaultKey: CryptoKey; header: Header; data: VaultData; remote: Stored }

export class WrongPasswordError extends Error {
  constructor() { super("รหัสผ่านหลักไม่ถูกต้อง") }
}

/** A brand-new vault, protected by `master` and a fresh recovery code. */
export async function createVault(master: MasterKeys, save: Save): Promise<Opened & { recoveryCode: string }> {
  const vaultKey = await newVaultKey()
  const recoveryCode = newRecoveryCode()
  const header = await newHeader(vaultKey, master, recoveryCode)
  const data = emptyVault()
  const remote = await save(null, await sealV2(header, vaultKey, data))
  return { vaultKey, header, data, remote, recoveryCode }
}

/**
 * Opens a stored vault with the master password. A v1 vault (two-password era) is decrypted
 * with the old scheme and reported as `legacy`, so the caller can upgrade it.
 */
export async function openVault(remote: Stored, password: string): Promise<
  | ({ legacy: false; master: MasterKeys } & Opened)
  | { legacy: true; data: VaultData; remote: Stored }
> {
  const blob = remote.blob as unknown
  if (isEnvelopeV2(blob)) {
    // Derive from the stored salt so a vault keeps opening even if the address is re-cased.
    const master = await deriveMasterKeys(password, unb64(blob.salt))
    let vaultKey: CryptoKey
    try { vaultKey = await unlockWithMaster(blob, master) } catch { throw new WrongPasswordError() }
    return { legacy: false, master, vaultKey, header: headerOf(blob), data: migrate(await openV2(blob, vaultKey)), remote }
  }
  if (isEnvelope(blob)) {
    try { return { legacy: true, data: migrate((await unseal(blob, password)).data), remote } } catch { throw new WrongPasswordError() }
  }
  throw new Error("รูปแบบตู้เซฟไม่รองรับ")
}

/** Re-encrypts legacy data under the single-password scheme (one write, version-checked). */
export async function upgradeVault(data: VaultData, remote: Stored, master: MasterKeys, save: Save): Promise<Opened & { recoveryCode: string }> {
  const vaultKey = await newVaultKey()
  const recoveryCode = newRecoveryCode()
  const header = await newHeader(vaultKey, master, recoveryCode)
  const saved = await save(remote, await sealV2(header, vaultKey, data))
  return { vaultKey, header, data, remote: saved, recoveryCode }
}

export class NoRecoveryError extends Error {
  constructor() { super("ตู้เซฟนี้ยังไม่มีรหัสกู้คืน") }
}

/**
 * Forgot-password path: the recovery code opens the vault key, which is re-wrapped for a new
 * master password and a new recovery code (the used code stops working).
 */
export async function recoverVault(remote: Stored, code: string, newPassword: string, email: string, save: Save,
  beforeSave: (master: MasterKeys) => Promise<void>) {
  const blob = remote.blob as unknown
  if (!isEnvelopeV2(blob) || !blob.keys.recovery) throw new NoRecoveryError()
  let vaultKey: CryptoKey
  try { vaultKey = await unwrap(blob.keys.recovery, await recoveryWrapKey(code)) } catch { throw new Error("รหัสกู้คืนไม่ถูกต้อง") }
  const data = migrate(await openV2(blob, vaultKey))
  const master = await deriveMasterKeys(newPassword, await emailSalt(email))
  const recoveryCode = newRecoveryCode()
  const header: Header = {
    ...headerOf(blob), salt: (await newHeader(vaultKey, master, recoveryCode)).salt,
    keys: { master: await wrap(vaultKey, master.wrap), recovery: await wrap(vaultKey, await recoveryWrapKey(recoveryCode)) },
  }
  // Move the login first: if the vault write then fails, the old recovery code still opens the
  // untouched vault and the user can simply recover again.
  await beforeSave(master)
  const saved = await save(remote, await sealV2(header, vaultKey, data))
  return { vaultKey, header, data, remote: saved, recoveryCode, master }
}

export const isLegacyBlob = (blob: unknown): blob is Envelope => isEnvelope(blob) && !isEnvelopeV2(blob)
