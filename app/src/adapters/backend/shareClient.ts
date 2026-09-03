/**
 * Targeted item sharing (SHARING_PLAN.md). Multi-user only. `base` is the
 * resource path — `/runbooks/rb_1`, `/prompts/p_2`, `/forms/f_3` — so one
 * client serves every shareable module.
 */
import { backendGet, backendRequest } from './backendClient'

export interface ShareGrant {
  granteeId: string
  canEdit: boolean
  grantedBy: string
  grantedAt: number
}

export interface PickUser {
  id: string
  username: string
}

/** id + username for every enabled user (any signed-in caller). */
export const pickUsers = () =>
  backendGet<{ users: PickUser[] | null }>('/users/pick').then((r) => r.users ?? [])

export const listShares = (base: string) =>
  backendGet<{ shares: ShareGrant[] | null }>(`${base}/shares`).then((r) => r.shares ?? [])

export const putShare = (base: string, userId: string, canEdit: boolean) =>
  backendRequest<{ shares: ShareGrant[] | null }>('PUT', `${base}/shares/${userId}`, {
    canEdit,
  }).then((r) => r.shares ?? [])

export const removeShare = (base: string, userId: string) =>
  backendRequest<{ shares: ShareGrant[] | null }>('DELETE', `${base}/shares/${userId}`).then(
    (r) => r.shares ?? [],
  )

/** Admin only — hand an item to another user (audited server-side). */
export const reassignOwner = (base: string, ownerId: string) =>
  backendRequest<{ status: string }>('PATCH', `${base}/owner`, { ownerId })
