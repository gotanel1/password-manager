import { newKey, seal, unseal, type Envelope, type Key } from "./crypto"
import type { VaultData } from "./model"
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
    private key: Key | null,
    public data: VaultData,
    private remote: Stored,
    private save: (remote: Stored, blob: Envelope) => Promise<Stored>,
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
      this.error = error
      if (error instanceof ConflictError) this.conflict = true
      throw error
    }).finally(() => {
      this.pending--
      this.status(this.error ? "error" : this.pending ? "saving" : "saved")
    })
    this.tail = run.catch(() => {})
    return run
  }

  update(fn: (data: VaultData) => VaultData) {
    return this.enqueue(async () => {
      const next = fn(this.data)
      const remote = await this.save(this.remote, await seal(this.key!, next))
      this.remote = remote
      this.data = next
      this.error = null
      this.changed(next)
    })
  }

  changeMaster(oldPassword: string, newPassword: string) {
    return this.enqueue(async () => {
      await unseal(this.remote.blob, oldPassword)
      const key = await newKey(newPassword)
      const remote = await this.save(this.remote, await seal(key, this.data))
      // Only swap keys after the server confirms the write.
      this.key = key
      this.remote = remote
      this.error = null
    })
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
      this.key = null
      this.data = { v: 2, items: [], folders: [], generatorHistory: [] }
    })
  }
}
