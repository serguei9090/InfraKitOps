/**
 * FormFlow server store (SHARING_PLAN.md SH3). Multi-user only — the
 * single-user client keeps its local name-keyed IStoragePort repo. Sharing
 * uses the resource path `/forms/<id>` via `shareClient.ts`.
 */
import { backendGet, backendRequest } from './backendClient'

export interface FormEntry {
  id: string
  name: string
  published: boolean
  owner: string
  canEdit: boolean
  shared: boolean
}

export const listForms = () =>
  backendGet<{ forms: FormEntry[] | null }>('/forms').then((r) => r.forms ?? [])

export const getForm = (id: string) =>
  backendGet<{ form: unknown }>(`/forms/${id}`).then((r) => r.form)

export const putForm = (id: string, name: string, form: unknown) =>
  backendRequest<{ status: string }>('PUT', `/forms/${id}`, { name, form })

export const deleteForm = (id: string) =>
  backendRequest<{ status: string }>('DELETE', `/forms/${id}`)
