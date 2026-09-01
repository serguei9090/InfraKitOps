/**
 * Auth model — framework-free, mirrors backend/internal/auth/spec.go.
 * See USER_MANAGEMENT_PLAN.md.
 */

export type AuthMode = 'off' | 'on'

export type Role = 'admin' | 'operator' | 'viewer'

export interface AuthUser {
  id: string
  username: string
  email?: string
  role: Role
  /** null/undefined = every module the role permits */
  allowedModules?: string[]
  disabled: boolean
  mustChangePw: boolean
  createdAt: number
  updatedAt: number
}

export interface AuditEntry {
  id: number
  at: number
  userId?: string
  actor?: string
  action: string
  target?: string
  meta?: string
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  operator: 'Operator',
  viewer: 'Viewer',
}

export const ROLE_HINT: Record<Role, string> = {
  admin: 'Manage users, read the audit log, everything else',
  operator: 'Run and change everything',
  viewer: 'Read-only',
}

/** True when the user may see a module (null allowedModules = all). */
export function canSeeModule(user: AuthUser | null, moduleId: string): boolean {
  if (!user || !user.allowedModules) return true
  return user.allowedModules.includes(moduleId)
}
