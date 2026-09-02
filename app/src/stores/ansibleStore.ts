/**
 * Ansible Manager module — thin backend cache + live-run buffer. Not persisted.
 * See ANSIBLE_MODULE_PLAN.md.
 */
import { create } from 'zustand'
import * as api from '@/adapters/backend/ansibleClient'
import type {
  AnsibleSettings,
  HostState,
  InventoryResult,
  Job,
  LiveRun,
  PlayNode,
  Project,
  ProjectTree,
  Run,
  RunRecap,
  RunSpec,
  RunStatus,
  TaskNode,
} from '@/core/ansible/ansibleModel'
import { reportError } from '@/stores/errorStore'

const SRC = 'Ansible'

export type Section = 'projects' | 'inventory' | 'jobs' | 'history'

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const HOST_EVENTS: Record<string, HostState> = {
  'ansible-runner-ok': 'ok',
  'ansible-runner-failed': 'failed',
  'ansible-runner-skipped': 'skipped',
  'ansible-runner-unreachable': 'unreachable',
  'ansible-item-ok': 'ok',
  'ansible-item-failed': 'failed',
}

const emptyLive = (projectId: string): LiveRun => ({
  projectId,
  runId: null,
  status: 'starting',
  plays: [],
  console: [],
  recap: null,
  abort: () => {},
})

/**
 * Fold one SSE (or replayed NDJSON) event into a LiveRun, returning a new one.
 * `cur` carries the mutable "current task uuid" across calls in a stream.
 */
function foldEvent(live: LiveRun, name: string, d: Record<string, unknown>, cur: { taskUuid: string }): LiveRun {
  const next: LiveRun = {
    ...live,
    plays: live.plays.map((p) => ({ ...p, tasks: [...p.tasks] })),
    console: [...live.console],
  }
  const curPlay = (): PlayNode | undefined => next.plays.at(-1)
  const curTask = (): TaskNode | undefined => curPlay()?.tasks.find((t) => t.uuid === cur.taskUuid)

  switch (name) {
    case 'run-start':
      next.runId = (d.runId as number) ?? null
      next.status = 'running'
      break
    case 'ansible-play-start':
      next.plays.push({
        name: String(d.play ?? 'play'),
        hosts: Array.isArray(d.hosts) ? (d.hosts as string[]) : [],
        tasks: [],
      })
      break
    case 'ansible-task-start': {
      cur.taskUuid = String(d.uuid ?? `t${next.plays.length}-${(curPlay()?.tasks.length ?? 0)}`)
      curPlay()?.tasks.push({
        uuid: cur.taskUuid,
        name: String(d.task ?? 'task'),
        action: String(d.action ?? ''),
        hosts: {},
      })
      break
    }
    case 'stdout':
    case 'stderr':
      next.console.push({ stream: name, text: String(d.text ?? '') })
      break
    case 'run-end':
      next.status = (d.status as LiveRun['status']) ?? 'ok'
      break
    case 'ansible-stats':
      next.recap = { hosts: (d.hosts as RunRecap['hosts']) ?? {} }
      break
    case 'error':
      next.status = 'error'
      next.error = String(d.error ?? 'run failed')
      break
    default: {
      const state = HOST_EVENTS[name]
      if (state) {
        const t = curTask()
        const host = String(d.host ?? '')
        if (t && host) {
          t.hosts[host] = {
            state,
            changed: Boolean(d.changed),
            diff: d.diff,
            msg: typeof d.msg === 'string' ? d.msg : undefined,
          }
        }
      }
    }
  }
  return next
}

/** Rebuild a finished run's tree from its stored NDJSON `events` blob. */
function replayEvents(run: Run): LiveRun {
  let live: LiveRun = { ...emptyLive(run.projectId), runId: run.id, status: run.status as RunStatus }
  const cur = { taskUuid: '' }
  for (const line of (run.events ?? '').split('\n')) {
    if (!line.trim()) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    const e = typeof obj.e === 'string' ? `ansible-${obj.e.replace(/_/g, '-')}` : 'message'
    live = foldEvent(live, e, obj, cur)
  }
  if (run.recap) {
    try {
      live.recap = JSON.parse(run.recap) as RunRecap
    } catch {
      /* ignore */
    }
  }
  live.status = run.status as RunStatus
  return live
}

interface AnsibleStore {
  section: Section
  showRuntime: boolean
  settings: AnsibleSettings | null
  settingsError: string | null
  projects: Project[]
  loaded: boolean
  selectedId: string | null
  tree: ProjectTree | null
  jobs: Job[]
  inventory: InventoryResult | null
  inventoryError: string | null
  runs: Run[]
  live: LiveRun | null
  replaying: boolean
  lastSpec: RunSpec | null
  busySetup: boolean
  setupLog: string[]

  setSection: (s: Section) => void
  setShowRuntime: (v: boolean) => void
  refreshSettings: () => Promise<void>
  saveSettings: (patch: { workspaceDir?: string; runtime?: string }) => Promise<void>
  setupManaged: (version?: string) => void
  refreshProjects: () => Promise<void>
  select: (id: string | null) => Promise<void>
  addProject: (body: { name: string; mode: 'new' | 'existing'; path?: string }) => Promise<Project | null>
  removeProject: (id: string) => Promise<void>
  loadInventory: (src?: string) => Promise<void>
  refreshJobs: () => Promise<void>
  saveJob: (job: Partial<Job>) => Promise<Job | null>
  removeJob: (id: string) => Promise<void>
  refreshRuns: () => Promise<void>
  startRun: (spec: RunSpec) => void
  rerun: () => void
  startJobRun: (jobId: string, projectId: string) => void
  openReplay: (runId: number) => Promise<void>
  clearLive: () => void
}

export const useAnsibleStore = create<AnsibleStore>((set, get) => ({
  section: 'projects',
  showRuntime: false,
  settings: null,
  settingsError: null,
  projects: [],
  loaded: false,
  selectedId: null,
  tree: null,
  jobs: [],
  inventory: null,
  inventoryError: null,
  runs: [],
  live: null,
  replaying: false,
  lastSpec: null,
  busySetup: false,
  setupLog: [],

  setSection: (section) => {
    set({ section })
    if (section === 'jobs') void get().refreshJobs()
    if (section === 'inventory') void get().loadInventory()
    if (section === 'history') void get().refreshRuns()
  },
  setShowRuntime: (showRuntime) => set({ showRuntime }),

  refreshSettings: async () => {
    try {
      set({ settings: await api.getSettings(), settingsError: null })
    } catch (e) {
      set({ settingsError: msg(e) })
    }
  },

  saveSettings: async (patch) => {
    try {
      set({ settings: await api.putSettings(patch), settingsError: null })
    } catch (e) {
      reportError(e, SRC)
    }
  },

  setupManaged: (version) => {
    if (get().busySetup) return
    set({ busySetup: true, setupLog: [] })
    api.setupManagedRuntime(version, {
      onEvent: (name, data) => {
        const d = data as Record<string, unknown>
        if (name === 'stdout') {
          set((s) => ({ setupLog: [...s.setupLog, String(d.text ?? '')] }))
        } else if (name === 'done') {
          set({ busySetup: false })
          void get().refreshSettings()
        } else if (name === 'error') {
          set((s) => ({ busySetup: false, setupLog: [...s.setupLog, `error: ${String(d.error ?? '')}`] }))
          void get().refreshSettings()
        }
      },
      onClose: () => set({ busySetup: false }),
      onError: (err) => {
        reportError(err, SRC)
        set({ busySetup: false })
      },
    })
  },

  refreshProjects: async () => {
    try {
      const projects = await api.listProjects()
      set({ projects, loaded: true })
      const sel = get().selectedId
      if (sel && !projects.some((p) => p.id === sel)) set({ selectedId: null, tree: null })
      else if (!sel && projects.length) void get().select(projects[0].id)
    } catch (e) {
      set({ loaded: true, settingsError: msg(e) })
    }
  },

  select: async (id) => {
    set({ selectedId: id, tree: null, inventory: null, inventoryError: null })
    if (!id) return
    try {
      set({ tree: await api.projectTree(id) })
    } catch (e) {
      reportError(e, SRC)
    }
    void get().refreshRuns()
    void get().refreshJobs()
  },

  addProject: async (body) => {
    try {
      const p = await api.createProject(body)
      await get().refreshProjects()
      await get().select(p.id)
      return p
    } catch (e) {
      reportError(e, SRC)
      return null
    }
  },

  removeProject: async (id) => {
    try {
      await api.deleteProject(id)
      if (get().selectedId === id) set({ selectedId: null, tree: null })
      await get().refreshProjects()
    } catch (e) {
      reportError(e, SRC)
    }
  },

  loadInventory: async (src) => {
    const id = get().selectedId
    if (!id) return
    set({ inventoryError: null })
    try {
      set({ inventory: await api.readInventory(id, src) })
    } catch (e) {
      set({ inventory: null, inventoryError: msg(e) })
    }
  },

  refreshJobs: async () => {
    const id = get().selectedId
    if (!id) {
      set({ jobs: [] })
      return
    }
    try {
      set({ jobs: await api.listJobs(id) })
    } catch (e) {
      set({ settingsError: msg(e) })
    }
  },

  saveJob: async (job) => {
    try {
      const saved = await api.putJob({ ...job, projectId: job.projectId ?? get().selectedId ?? '' })
      await get().refreshJobs()
      return saved
    } catch (e) {
      reportError(e, SRC)
      return null
    }
  },

  removeJob: async (id) => {
    try {
      await api.deleteJob(id)
      await get().refreshJobs()
    } catch (e) {
      reportError(e, SRC)
    }
  },

  refreshRuns: async () => {
    try {
      set({ runs: await api.listRuns(get().selectedId ?? undefined) })
    } catch (e) {
      set({ settingsError: msg(e) })
    }
  },

  startRun: (spec) => {
    set({ lastSpec: spec })
    streamRun(set, get, spec, () => api.openRunStream(spec, streamHandlers(set, get, spec.projectId)))
  },

  rerun: () => {
    const s = get().lastSpec
    if (s) get().startRun(s)
  },

  startJobRun: (jobId, projectId) => {
    set({ lastSpec: null })
    streamRun(set, get, { projectId } as RunSpec, () =>
      api.openJobRunStream(jobId, streamHandlers(set, get, projectId)),
    )
  },

  openReplay: async (runId) => {
    get().live?.abort()
    try {
      const run = await api.getRun(runId)
      set({ live: { ...replayEvents(run), abort: () => {} }, replaying: true })
    } catch (e) {
      reportError(e, SRC)
    }
  },

  clearLive: () => {
    get().live?.abort()
    set({ live: null, replaying: false })
    void get().refreshRuns()
  },
}))

type Set = (partial: Partial<AnsibleStore> | ((s: AnsibleStore) => Partial<AnsibleStore>)) => void
type Get = () => AnsibleStore

function streamHandlers(set: Set, get: Get, projectId: string) {
  const cur = { taskUuid: '' }
  return {
    onEvent: (name: string, data: unknown) => {
      const d = (data ?? {}) as Record<string, unknown>
      set((s) => {
        if (!s.live || s.live.projectId !== projectId) return s
        return { live: foldEvent(s.live, name, d, cur) }
      })
    },
    onClose: () => {
      set((s) => {
        if (!s.live) return s
        if (s.live.status === 'starting' || s.live.status === 'running') {
          return { live: { ...s.live, status: 'ok' as const } }
        }
        return s
      })
      void get().refreshRuns()
    },
    onError: (err: Error) => {
      set((s) => (s.live ? { live: { ...s.live, status: 'error' as const, error: err.message } } : s))
    },
  }
}

function streamRun(set: Set, get: Get, spec: RunSpec, open: () => () => void) {
  get().live?.abort()
  set({ live: emptyLive(spec.projectId), replaying: false })
  const abort = open()
  set((s) => (s.live ? { live: { ...s.live, abort } } : s))
}
