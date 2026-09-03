/**
 * Per-user synced settings (DEPLOY_PLAN.md D5). Only meaningful when
 * authMode: "on" — a hosted deploy where one person uses several browsers.
 * The blob is a flat `{ <zustand persist name>: <serialized value> }` map.
 */
import { backendGet, backendRequest } from './backendClient'

export type SettingsBlob = Record<string, string>

export const getUserSettings = () =>
  backendGet<{ data: SettingsBlob }>('/settings/user').then((r) => r.data ?? {})

/** Merge a patch into the server blob. A `null` value deletes that key. */
export const putUserSettings = (patch: Record<string, string | null>) =>
  backendRequest<{ data: SettingsBlob }>('PUT', '/settings/user', patch).then((r) => r.data ?? {})
