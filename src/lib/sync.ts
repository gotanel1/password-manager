import { createClient, type User } from "@supabase/supabase-js"
import type { Envelope } from "./crypto"
import type { EnvelopeV2 } from "./keys"

const url = import.meta.env.SUPABASE_URL as string | undefined
const anonKey = import.meta.env.SUPABASE_ANON_KEY as string | undefined

export const sb = url && anonKey ? createClient(url, anonKey) : null
export type { User }

export type Remote = { blob: Envelope | EnvelopeV2; version: number } | null

export class ConflictError extends Error {
  constructor() { super("ตู้เซฟถูกแก้ไขจากอุปกรณ์อื่น") }
}

export async function fetchVault(user: User): Promise<Remote> {
  const { data, error } = await sb!.from("vaults").select("blob, version").eq("user_id", user.id).maybeSingle()
  if (error) throw error
  return data as Remote
}

/** Optimistic concurrency: an update only lands if nobody else saved since `remote` was loaded. */
export async function saveVault(user: User, remote: Remote, blob: Envelope | EnvelopeV2): Promise<NonNullable<Remote>> {
  if (!remote) {
    const { data, error } = await sb!.from("vaults").insert({ user_id: user.id, blob, version: 1 }).select("blob, version").single()
    if (error) throw error
    return data as NonNullable<Remote>
  }
  const { data, error } = await sb!
    .from("vaults")
    .update({ blob, version: remote.version + 1 })
    .eq("user_id", user.id)
    .eq("version", remote.version)
    .select("blob, version")
  if (error && error.code !== "40001") throw error
  if (error || !data?.length) throw new ConflictError()
  return data[0] as NonNullable<Remote>
}

export async function deleteVault(user: User) {
  const { error } = await sb!.from("vaults").delete().eq("user_id", user.id)
  if (error) throw error
}

/** Points the account password at the login secret derived from the master password. */
export async function setLoginSecret(secret: string) {
  const { error } = await sb!.auth.updateUser({ password: secret })
  if (error) throw error
}

/** Sends the "forgot master password" e-mail; the link opens the recovery screen. */
export async function requestRecovery(email: string) {
  const { error } = await sb!.auth.resetPasswordForEmail(email, { redirectTo: location.origin })
  if (error) throw error
}
