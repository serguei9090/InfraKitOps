/**
 * Monitors module — backend client. Backend-mandatory; every call goes through
 * the shared `/api/v1` helpers. See MONITORS_MODULE_PLAN.md.
 */
import { backendGet, backendRequest } from './backendClient'
import type { Monitor, MonitorSample } from '@/core/monitor/monitorModel'

const arr = <T,>(v: T[] | null | undefined): T[] => v ?? []

export const listMonitors = () =>
  backendGet<{ monitors: Monitor[] | null }>('/monitors').then((r) => arr(r.monitors))

export const getMonitor = (id: string) =>
  backendGet<{ monitor: Monitor }>(`/monitors/${id}`).then((r) => r.monitor)

export const saveMonitor = (m: Partial<Monitor>) =>
  backendRequest<{ monitor: Monitor }>(
    m.id ? 'PUT' : 'POST',
    m.id ? `/monitors/${m.id}` : '/monitors',
    m,
  ).then((r) => r.monitor)

export const deleteMonitor = (id: string) =>
  backendRequest<{ status: string }>('DELETE', `/monitors/${id}`)

export const monitorSamples = (id: string, since = 0, limit = 0) =>
  backendGet<{ samples: MonitorSample[] | null }>(
    `/monitors/${id}/samples?since=${since}${limit ? `&limit=${limit}` : ''}`,
  ).then((r) => arr(r.samples))

export const pauseMonitor = (id: string, paused: boolean) =>
  backendRequest<{ monitor: Monitor }>('POST', `/monitors/${id}/${paused ? 'pause' : 'resume'}`).then(
    (r) => r.monitor,
  )

export const checkMonitor = (id: string) =>
  backendRequest<{ sample: MonitorSample; monitor: Monitor }>('POST', `/monitors/${id}/check`)
