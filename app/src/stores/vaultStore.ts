/**
 * Runbooks — Vault lock state. Global for the session: one unlock, one lock.
 * The master password never leaves this call; only the resulting status is
 * kept. Not persisted. See RUNBOOK_MODULE_PLAN.md §5.2 / §7.4.
 */
import { create } from 'zustand'
import * as api from '@/adapters/backend/runbookClient'
import type { VaultSecretMeta, VaultStatus } from '@/core/runbook/runbookModel'

interface VaultStore {
  status: VaultStatus | null
  secrets: VaultSecretMeta[]
  /** null = fine; string = last error to show. */
  error: string | null
  loaded: boolean

  refresh: () => Promise<void>
  init: (masterPassword: string) => Promise<boolean>
  unlock: (masterPassword: string) => Promise<boolean>
  unlockWithKeyring: () => Promise<boolean>
  remember: () => Promise<void>
  forget: () => Promise<void>
  lock: () => Promise<void>
  refreshSecrets: () => Promise<void>
  putSecret: (s: { id?: string; name: string; kind: string; notes?: string; value: string }) => Promise<void>
  deleteSecret: (id: string) => Promise<void>
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  status: null,
  secrets: [],
  error: null,
  loaded: false,

  refresh: async () => {
    try {
      const status = await api.vaultStatus()
      set({ status, loaded: true, error: null })
      if (status.unlocked) await get().refreshSecrets()
      else set({ secrets: [] })
    } catch (e) {
      set({ status: null, loaded: true, error: msg(e) })
    }
  },

  init: async (masterPassword) => {
    try {
      const status = await api.vaultInit(masterPassword)
      set({ status, error: null })
      return true
    } catch (e) {
      set({ error: msg(e) })
      return false
    }
  },

  unlock: async (masterPassword) => {
    try {
      const status = await api.vaultUnlock(masterPassword)
      set({ status, error: null })
      await get().refreshSecrets()
      return true
    } catch (e) {
      set({ error: msg(e) })
      return false
    }
  },

  unlockWithKeyring: async () => {
    try {
      const status = await api.vaultUnlockKeyring()
      set({ status, error: null })
      await get().refreshSecrets()
      return true
    } catch (e) {
      set({ error: msg(e) })
      return false
    }
  },

  remember: async () => {
    try {
      set({ status: await api.vaultRemember(), error: null })
    } catch (e) {
      set({ error: msg(e) })
    }
  },

  forget: async () => {
    try {
      set({ status: await api.vaultForget(), error: null })
    } catch (e) {
      set({ error: msg(e) })
    }
  },

  lock: async () => {
    try {
      const status = await api.vaultLock()
      set({ status, secrets: [], error: null })
    } catch (e) {
      set({ error: msg(e) })
    }
  },

  refreshSecrets: async () => {
    try {
      set({ secrets: await api.listSecrets(), error: null })
    } catch (e) {
      set({ error: msg(e) })
    }
  },

  putSecret: async (s) => {
    await api.putSecret(s)
    await get().refreshSecrets()
  },

  deleteSecret: async (id) => {
    await api.deleteSecret(id)
    await get().refreshSecrets()
  },
}))
