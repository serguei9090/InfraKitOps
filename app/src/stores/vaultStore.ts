/**
 * Runbooks — Vault lock state. Global for the session: one unlock, one lock.
 * The master password never leaves this call; only the resulting status is
 * kept. Not persisted. See RUNBOOK_MODULE_PLAN.md §5.2 / §7.4.
 */
import { create } from 'zustand'
import * as api from '@/adapters/backend/runbookClient'
import type { VaultSecretMeta, VaultStatus } from '@/core/runbook/runbookModel'
import { classify } from '@/core/errors/appError'
import type { AppError } from '@/core/errors/appError'

const SRC = 'Vault'

interface VaultStore {
  status: VaultStatus | null
  secrets: VaultSecretMeta[]
  /** null = fine; classified error to show inline in the Vault dialog. */
  error: AppError | null
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

function err(e: unknown): AppError {
  return classify(e, SRC)
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
      set({ status: null, loaded: true, error: err(e) })
    }
  },

  init: async (masterPassword) => {
    try {
      const status = await api.vaultInit(masterPassword)
      set({ status, error: null })
      return true
    } catch (e) {
      set({ error: err(e) })
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
      set({ error: err(e) })
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
      set({ error: err(e) })
      return false
    }
  },

  remember: async () => {
    try {
      set({ status: await api.vaultRemember(), error: null })
    } catch (e) {
      set({ error: err(e) })
    }
  },

  forget: async () => {
    try {
      set({ status: await api.vaultForget(), error: null })
    } catch (e) {
      set({ error: err(e) })
    }
  },

  lock: async () => {
    try {
      const status = await api.vaultLock()
      set({ status, secrets: [], error: null })
    } catch (e) {
      set({ error: err(e) })
    }
  },

  refreshSecrets: async () => {
    try {
      set({ secrets: await api.listSecrets(), error: null })
    } catch (e) {
      set({ error: err(e) })
    }
  },

  putSecret: async (s) => {
    try {
      await api.putSecret(s)
      set({ error: null })
      await get().refreshSecrets()
    } catch (e) {
      set({ error: err(e) })
    }
  },

  deleteSecret: async (id) => {
    try {
      await api.deleteSecret(id)
      set({ error: null })
      await get().refreshSecrets()
    } catch (e) {
      set({ error: err(e) })
    }
  },
}))
