/**
 * Ansible Manager module — thin backend cache + live-run buffer. Not persisted.
 * See ANSIBLE_MODULE_PLAN.md.
 */
import { create } from 'zustand'
import * as api from '@/adapters/backend/ansibleClient'
import type {
  AnsibleSettings,
  HostState,
  LiveRun,
  PlayNode,
  Project,
  ProjectTree,
  Run,
  RunRecap,
  RunSpec,
  TaskNode,
} from '@/core/ansible/ansibleModel'
import { reportError } from '@/stores/errorStore'

const SRC = 'Ansible'

export type Section = 'projects' | 'history'

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

interface AnsibleStore {
  section: Section
  showRuntime: boolean
  settings: AnsibleSettings | null
  settingsError: string | null
  projects: Project[]
  loaded: boolean
  selectedId: string | null
  tree: ProjectTree | null
  runs: Run[]
  live: LiveRun | null
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
  refreshRuns: () => Promise<void>
  startRun: (spec: RunSpec) => void
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
  runs: [],
  live: null,
  busySetup: false,
  setupLog: [],

  setSection: (section) => set({ section }),
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
    set({ selectedId: id, tree: null })
    if (!id) return
    try {
      set({ tree: await api.projectTree(id) })
    } catch (e) {
      reportError(e, SRC)
    }
    void get().refreshRuns()
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

  refreshRuns: async () => {
    try {
      set({ runs: await api.listRuns(get().selectedId ?? undefined) })
    } catch (e) {
      set({ settingsError: msg(e) })
    }
  },

  startRun: (spec) => {
    get().live?.abort()
    const live: LiveRun = {
      projectId: spec.projectId,
      runId: null,
      status: 'starting',
      plays: [],
      console: [],
      recap: null,
      abort: () => {},
    }

    let curTaskUuid = ''
    const abort = api.openRunStream(spec, {
      onEvent: (name, data) => {
        const d = data as Record<string, unknown>
        set((s) => {
          if (!s.live || s.live.projectId !== spec.projectId) return s
          const next: LiveRun = { ...s.live, plays: s.live.plays.map((p) => ({ ...p, tasks: [...p.tasks] })), console: [...s.live.console] }
          const curPlay = (): PlayNode | undefined => next.plays.at(-1)
          const curTask = (): TaskNode | undefined => curPlay()?.tasks.find((t) => t.uuid === curTaskUuid)

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
              curTaskUuid = String(d.uuid ?? `${Date.now()}`)
              const p = curPlay()
              if (p) {
                p.tasks.push({
                  uuid: curTaskUuid,
                  name: String(d.task ?? 'task'),
                  action: String(d.action ?? ''),
                  hosts: {},
                })
              }
              break
            }
            case 'stdout':
            case 'stderr':
              next.console.push({ stream: name, text: String(d.text ?? '') })
              break
            case 'run-end':
              next.status = ((d.status as LiveRun['status']) ?? 'ok')
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
          return { live: next }
        })
      },
      onClose: () => {
        set((s) => {
          if (!s.live) return s
          if (s.live.status === 'starting' || s.live.status === 'running') {
            return { live: { ...s.live, status: 'ok' } }
          }
          return s
        })
        void get().refreshRuns()
      },
      onError: (err) => {
        set((s) => (s.live ? { live: { ...s.live, status: 'error', error: err.message } } : s))
      },
    })
    live.abort = abort
    set({ live })
  },

  clearLive: () => {
    get().live?.abort()
    set({ live: null })
    void get().refreshRuns()
  },
}))
