import { createContext, useContext } from "react"
import type { VaultData, analyze } from "./lib/model"
import type { Prefs } from "./lib/prefs"

export type VaultApi = {
  email: string
  data: VaultData
  /** Applies a change locally, then encrypts and syncs it. */
  update: (fn: (d: VaultData) => VaultData) => Promise<void>
  /** Resolves false if the browser refused clipboard access. */
  copy: (label: string, text: string) => Promise<boolean>
  toast: (message: string) => void
  prefs: Prefs
  setPrefs: (p: Prefs) => void
  analysis: ReturnType<typeof analyze>
  lock: () => void
  signOut: (everywhere?: boolean) => void
  changeMaster: (oldPassword: string, newPassword: string) => Promise<string | null>
  /** Issues a new recovery code (the old one stops working); null if it could not be saved. */
  rotateRecovery: () => Promise<string | null>
  importBackup: (file: File, password: string) => Promise<string>
  exportBackup: () => void
  deleteVault: () => Promise<void>
}

export const VaultContext = createContext<VaultApi | null>(null)
export const useVault = () => useContext(VaultContext)!
