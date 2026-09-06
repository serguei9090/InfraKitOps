/**
 * Monitors module — backend client. Backend-mandatory; every call goes through
 * the shared `/api/v1` helpers. See MONITORS_MODULE_PLAN.md.
 */
import { backendGet, backendRequest } from './backendClient'
import { openStream, type StreamHandlers } from './sseClient'
import type {
  Monitor,
  MonitorIncident,
  MonitorReport,
  MonitorSample,
  MonitorSettings,
  MonitorSummary,
  SeriesPeriod,
  SeriesPoint,
} from '@/core/monitor/monitorModel'

const arr = <T,>(v: T[] | null | undefined): T[] => v ?? []

export const listMonitors = (tag?: string) =>
  backendGet<{ monitors: Monitor[] | null }>(`/monitors${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`).then(
    (r) => arr(r.monitors),
  )

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

// --- M5: reporting -----------------------------------------------

export const monitorIncidents = (id: string, since = 0) =>
  backendGet<{ incidents: MonitorIncident[] | null }>(
    `/monitors/${id}/incidents${since ? `?since=${since}` : ''}`,
  ).then((r) => arr(r.incidents))

export const monitorSummary = () =>
  backendGet<{
    monitors: Record<string, MonitorSummary['monitors'][string]> | null
    tags: Record<string, MonitorSummary['tags'][string]> | null
  }>('/monitors/summary').then((r) => ({ monitors: r.monitors ?? {}, tags: r.tags ?? {} }))

export const monitorSeries = (id: string, opts: { from?: number; to?: number; period?: string } = {}) => {
  const q = new URLSearchParams()
  if (opts.from) q.set('from', String(Math.round(opts.from)))
  if (opts.to) q.set('to', String(Math.round(opts.to)))
  if (opts.period) q.set('period', opts.period)
  const qs = q.toString()
  return backendGet<{ period: SeriesPeriod; points: SeriesPoint[] | null }>(
    `/monitors/${id}/series${qs ? `?${qs}` : ''}`,
  ).then((r) => ({ period: r.period, points: arr(r.points) }))
}

export const monitorReport = (id: string) =>
  backendGet<{ report: MonitorReport }>(`/monitors/${id}/report`).then((r) => r.report)

export const pauseMonitor = (id: string, paused: boolean) =>
  backendRequest<{ monitor: Monitor }>('POST', `/monitors/${id}/${paused ? 'pause' : 'resume'}`).then(
    (r) => r.monitor,
  )

export const checkMonitor = (id: string) =>
  backendRequest<{ sample: MonitorSample; monitor: Monitor }>('POST', `/monitors/${id}/check`)

export const checkAllMonitors = () =>
  backendRequest<{ checking: number }>('POST', '/monitors/check-all')

export const muteMonitor = (id: string, untilMs: number) =>
  backendRequest<{ monitor: Monitor }>('POST', `/monitors/${id}/mute`, { untilMs }).then((r) => r.monitor)

export const unmuteMonitor = (id: string) =>
  backendRequest<{ monitor: Monitor }>('POST', `/monitors/${id}/unmute`).then((r) => r.monitor)

// --- alert settings ------------------------------------------------

export const getMonitorSettings = () =>
  backendGet<{ settings: MonitorSettings }>('/monitors/settings').then((r) => r.settings)

export const putMonitorSettings = (s: MonitorSettings) =>
  backendRequest<{ settings: MonitorSettings }>('PUT', '/monitors/settings', s).then((r) => r.settings)

export const testMonitorChannel = (channel?: string) =>
  backendRequest<{ status: string }>('POST', '/monitors/settings/test', { channel: channel ?? '' })

/** Live status-change events. Returns an abort function. */
export function openMonitorStream(handlers: StreamHandlers): () => void {
  return openStream('/monitors/stream', {}, handlers)
}
