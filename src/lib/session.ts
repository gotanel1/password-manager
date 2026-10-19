import { unb64 } from "./crypto"
import {
  deriveMasterKeys, newRecoveryCode, recoveryWrapKey, sealV2, unlockWithMaster, wrap, type EnvelopeV2, type Header,
} from "./keys"
import type { VaultData } from "./model"
import { WrongPasswordError } from "./vaultkeys"
import { ConflictError, type Remote } from "./sync"

export type SyncState = "saved" | "saving" | "error"
type Stored = NonNullable<Remote>

/** One unlocked vault. Queued work never reads another account/session's refs. */
export class VaultSession {
  private tail: Promise<unknown> = Promise.resolve()
  private closing = false
  private conflict = false
  private pending = 0
  private error: unknown = null

  get hasError() { return this.error !== null }

  constructor(
    private vaultKey: CryptoKey | null,
    private header: Header,
    public data: VaultData,
    private remote: Stored,
    private save: (remote: Stored, blob: EnvelopeV2) => Promise<Stored>,
    private changed: (data: VaultData) => void = () => {},
    private status: (state: SyncState) => void = () => {},
  ) {}

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error("ตู้เซฟถูกล็อกแล้ว"))
    this.pending++
    this.status("saving")
    const run = this.tail.then(async () => {
      if (this.conflict) throw new ConflictError()
      return operation()
    }).catch((error: unknown) => {
      // A mistyped password changed nothing, so it isn't a failed save.
      if (!(error instanceof WrongPasswordError)) this.error = error
      if (error instanceof ConflictError) this.conflict = true
      throw error
    }).finally(() => {
      this.pending--
      this.status(this.error ? "error" : this.pending ? "saving" : "saved")
    })
    this.tail = run.catch(() => {})
    return run
  }

  /** Writes `header` + `data` and only adopts them once the server confirms. */
  private async commit(header: Header, data: VaultData) {
    this.remote = await this.save(this.remote, await sealV2(header, this.vaultKey!, data))
    this.header = header
    this.error = null
  }

  update(fn: (data: VaultData) => VaultData) {
    return this.enqueue(async () => {
      const next = fn(this.data)
      await this.commit(this.header, next)
      this.data = next
      this.changed(next)
    })
  }

  /**
   * Re-wraps the vault key for a new master password and moves the login to the new secret.
   * The vault is written first with both old and new slots, so whichever password the server
   * ends up accepting can still open it; the old slot is dropped once the login change succeeds.
   */
  changeMaster(oldPassword: string, newPassword: string, setLogin: (secret: string) => Promise<void>) {
    return this.enqueue(async () => {
      const salt = unb64(this.header.salt)
      const oldM = await deriveMasterKeys(oldPassword, salt)
      // A wrong old password is rejected before any write.
      await unlockWithMaster(this.header, oldM).catch(() => { throw new WrongPasswordError() })
      const newM = await deriveMasterKeys(newPassword, salt)
      const vk = this.vaultKey!
      const { masterPrev: _drop, ...slots } = this.header.keys
      const both: Header = { ...this.header, keys: { ...slots, master: await wrap(vk, newM.wrap), masterPrev: await wrap(vk, oldM.wrap) } }
      await this.commit(both, this.data)
      // If this throws, the server may still have applied the change (e.g. a lost response), so
      // keep both slots: the vault keeps opening with whichever password the login ended up on.
      await setLogin(newM.login)
      const single: Header = { ...both, keys: { ...slots, master: both.keys.master } }
      try {
        await this.commit(single, this.data)
      } catch (e) {
        // The login has moved, so the old slot must not be written again: the next save drops it.
        this.header = single
        if (e instanceof ConflictError) this.conflict = true
      }
    })
  }

  /** Replaces the recovery code; the old one stops working once this is saved. */
  rotateRecovery() {
    return this.enqueue(async () => {
      const code = newRecoveryCode()
      await this.commit({ ...this.header, keys: { ...this.header.keys, recovery: await wrap(this.vaultKey!, await recoveryWrapKey(code)) } }, this.data)
      return code
    })
  }

  /** The vault key, for wrapping it to this device's passkey; null once the session is closing. */
  vaultKeyForDevice() {
    return this.closing ? null : this.vaultKey
  }

  backup() {
    return this.enqueue(async () => {
      if (this.error) throw this.error
      return this.remote.blob
    })
  }

  close() {
    this.closing = true
    // Hide the UI immediately; finish already admitted operations with their own key/account.
    return this.tail.then(() => {
      this.vaultKey = null
      this.data = { v: 2, items: [], folders: [], generatorHistory: [] }
    })
  }
}
