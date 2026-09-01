/**
 * Auth endpoints (multi-user mode). Only meaningful when /health reports
 * authMode: "on". See USER_MANAGEMENT_PLAN.md U1.
 */
import { backendGet, backendRequest } from './backendClient'
import type { AuditEntry, AuthUser, Role } from '@/core/auth/authModel'

const arr = <T,>(v: T[] | null | undefined): T[] => v ?? []

interface AuthResult {
  token: string
  user: AuthUser
}

export const getSetupStatus = () =>
  backendGet<{ needsBootstrap: boolean }>('/auth/setup-status')

export const bootstrap = (token: string, username: string, password: string) =>
  backendRequest<AuthResult>('POST', '/auth/bootstrap', { token, username, password })

export const login = (username: string, password: string) =>
  backendRequest<AuthResult>('POST', '/auth/login', { username, password })

export const logout = () => backendRequest<unknown>('POST', '/auth/logout')

export const getMe = () => backendGet<AuthUser>('/auth/me')

export const changePassword = (current: string, next: string) =>
  backendRequest<{ token: string }>('POST', '/auth/change-password', { current, next })

// --- admin ---

export const listUsers = () =>
  backendGet<{ users: AuthUser[] | null }>('/users').then((r) => arr(r.users))

export const createUser = (body: {
  username: string
  password: string
  email?: string
  role: Role
}) => backendRequest<AuthUser>('POST', '/users', body)

export const patchUser = (
  id: string,
  patch: Partial<{
    email: string
    role: Role
    allowedModules: string[] | null
    disabled: boolean
    password: string
    mustChangePw: boolean
  }>,
) => backendRequest<AuthUser>('PATCH', `/users/${id}`, patch)

export const deleteUser = (id: string) => backendRequest<unknown>('DELETE', `/users/${id}`)

export const listAudit = (limit = 200) =>
  backendGet<{ entries: AuditEntry[] | null }>(`/audit?limit=${limit}`).then((r) => arr(r.entries))
