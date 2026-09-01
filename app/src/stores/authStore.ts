/**
 * Auth state for multi-user mode (USER_MANAGEMENT_PLAN.md U1).
 *
 * - `mode` comes from GET /health. `off` → the whole layer is inert and the
 *   app behaves exactly as before.
 * - `on` + no `me` → the shell renders <LoginScreen> / <SetupScreen> instead
 *   of the normal layout.
 * - The session token lives in localStorage and is pushed into `backendClient`
 *   so every request carries it; a 401 clears it.
 */
import { create } from 'zustand'
import * as api from '@/adapters/backend/authClient'
import {
  probeBackend,
  resetBackendConnection,
  setSessionToken,
  setUnauthorizedHandler,
} from '@/adapters/backend/backendClient'
import { resetSseConnection } from '@/adapters/backend/sseClient'
import type { AuthMode, AuthUser } from '@/core/auth/authModel'

const SESSION_KEY = 'infrakit:session'

function readStoredSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}
function writeStoredSession(t: string | null) {
  try {
    if (t) localStorage.setItem(SESSION_KEY, t)
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* private mode */
  }
}

interface AuthStore {
  /** null until init() has run once */
  mode: AuthMode | null
  ready: boolean
  me: AuthUser | null
  needsBootstrap: boolean
  error: string | null
  busy: boolean

  init: () => Promise<void>
  login: (username: string, password: string) => Promise<boolean>
  bootstrapAdmin: (token: string, username: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  changePassword: (current: string, next: string) => Promise<boolean>
  refreshMe: () => Promise<void>
}

function applyToken(t: string | null) {
  setSessionToken(t)
  resetSseConnection()
  writeStoredSession(t)
}

export const useAuthStore = create<AuthStore>((set, get) => {
  // a 401 anywhere drops the session and bounces to /login
  setUnauthorizedHandler(() => {
    if (get().mode === 'on' && get().me) {
      applyToken(null)
      set({ me: null, error: 'Your session expired — sign in again.' })
    }
  })

  return {
    mode: null,
    ready: false,
    me: null,
    needsBootstrap: false,
    error: null,
    busy: false,

    init: async () => {
      // restore a stored session before the first request so it carries the token
      const stored = readStoredSession()
      if (stored) setSessionToken(stored)

      const health = await probeBackend()
      const mode: AuthMode = health?.authMode === 'on' ? 'on' : 'off'
      if (mode === 'off') {
        if (stored) applyToken(null) // stale token from a previous multi-user backend
        set({ mode, ready: true, me: null })
        return
      }

      let needsBootstrap = false
      try {
        needsBootstrap = (await api.getSetupStatus()).needsBootstrap
      } catch {
        /* ignore — treat as not-needed */
      }

      let me: AuthUser | null = null
      if (stored) {
        try {
          me = await api.getMe()
        } catch {
          applyToken(null)
        }
      }
      set({ mode, ready: true, me, needsBootstrap })
    },

    login: async (username, password) => {
      set({ busy: true, error: null })
      try {
        const r = await api.login(username, password)
        applyToken(r.token)
        resetBackendConnection()
        set({ me: r.user, busy: false, needsBootstrap: false })
        return true
      } catch (e) {
        set({ busy: false, error: e instanceof Error ? e.message : 'Sign-in failed' })
        return false
      }
    },

    bootstrapAdmin: async (token, username, password) => {
      set({ busy: true, error: null })
      try {
        const r = await api.bootstrap(token, username, password)
        applyToken(r.token)
        resetBackendConnection()
        set({ me: r.user, busy: false, needsBootstrap: false })
        return true
      } catch (e) {
        set({ busy: false, error: e instanceof Error ? e.message : 'Setup failed' })
        return false
      }
    },

    logout: async () => {
      try {
        await api.logout()
      } catch {
        /* best effort */
      }
      applyToken(null)
      resetBackendConnection()
      set({ me: null, error: null })
    },

    changePassword: async (current, next) => {
      set({ busy: true, error: null })
      try {
        const r = await api.changePassword(current, next)
        applyToken(r.token)
        set({ busy: false })
        return true
      } catch (e) {
        set({ busy: false, error: e instanceof Error ? e.message : 'Could not change the password' })
        return false
      }
    },

    refreshMe: async () => {
      try {
        set({ me: await api.getMe() })
      } catch {
        /* leave as-is */
      }
    },
  }
})
