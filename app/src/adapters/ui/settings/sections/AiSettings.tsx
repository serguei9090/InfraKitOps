import { useEffect, useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useBackendStore } from '@/stores/backendStore'
import { useLlmStore } from '@/stores/llmStore'
import type { LlmTask } from '@/core/llm/llmModel'
import { groupTasks } from '@/core/llm/taskGroups'
import { TaskDialog } from '@/adapters/ui/ai/TaskDialog'
import { SettingsGroup, SettingsRow } from '../SettingsScaffold'

export function AiSettings() {
  const status = useBackendStore((s) => s.status)
  const refreshBackend = useBackendStore((s) => s.refresh)

  const connections = useLlmStore((s) => s.connections)
  const models = useLlmStore((s) => s.models)
  const loadModels = useLlmStore((s) => s.loadModels)
  const tasks = useLlmStore((s) => s.tasks)
  const settings = useLlmStore((s) => s.settings)
  const refresh = useLlmStore((s) => s.refresh)
  const refreshTasks = useLlmStore((s) => s.refreshTasks)
  const refreshSettings = useLlmStore((s) => s.refreshSettings)
  const putSettings = useLlmStore((s) => s.putSettings)
  const putTask = useLlmStore((s) => s.putTask)
  const resetTask = useLlmStore((s) => s.resetTask)

  const [editing, setEditing] = useState<LlmTask | null>(null)

  useEffect(() => {
    if (status === 'unknown') void refreshBackend()
  }, [status, refreshBackend])

  useEffect(() => {
    if (status === 'available') {
      void refresh()
      void refreshTasks()
      void refreshSettings()
    }
  }, [status, refresh, refreshTasks, refreshSettings])

  const defConn = settings.defaultConnectionId ?? ''
  useEffect(() => {
    if (defConn) void loadModels(defConn)
  }, [defConn, loadModels])
  const defModels = defConn ? (models[defConn] ?? []) : []

  const grouped = useMemo(() => groupTasks(tasks), [tasks])

  if (status !== 'available') {
    return (
      <SettingsGroup title="AI">
        <p className="text-sm text-muted-foreground">
          Connect a backend (Settings → Backend) to change AI settings.
        </p>
      </SettingsGroup>
    )
  }

  return (
    <>
      <SettingsGroup
        title="Defaults"
        description="Used by every AI feature when it has no remembered pick and the task has no preference of its own."
      >
        <SettingsRow label="Connection">
          <Select
            value={defConn || '__none__'}
            onValueChange={(v) => v && void putSettings({ defaultConnectionId: v === '__none__' ? '' : String(v) })}
          >
            <SelectTrigger size="sm" className="w-48">
              <SelectValue>
                {(v) =>
                  !v || v === '__none__'
                    ? 'first connection'
                    : (connections.find((c) => c.id === v)?.name ?? 'first connection')
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">first connection</SelectItem>
              {connections.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow label="Model">
          <Select
            value={settings.defaultModel || '__none__'}
            onValueChange={(v) => v && void putSettings({ defaultModel: v === '__none__' ? '' : String(v) })}
          >
            <SelectTrigger size="sm" className="w-48">
              <SelectValue>{(v) => (!v || v === '__none__' ? 'connection default' : String(v))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">connection default</SelectItem>
              {defModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow label="Temperature" hint="Blank = provider default. Tasks with their own temperature ignore this.">
          <Input
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={settings.defaultTemperature ?? ''}
            onChange={(e) => void putSettings({ defaultTemperature: e.target.value })}
            className="h-8 w-20 text-xs"
          />
        </SettingsRow>
      </SettingsGroup>

      {grouped.map((g) => (
        <SettingsGroup
          key={g.key}
          title={`${g.label} — prompts`}
          description="The system prompt each feature sends. Customise to change its behaviour everywhere."
        >
          {g.tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-sm">
              <div className="min-w-0 flex-1">
                <span className="font-medium">{t.title}</span>
                {t.overridden && <span className="ml-1.5 text-[10px] text-primary">customised</span>}
                {(t.preferredModel || t.preferredConnectionId) && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    · {connections.find((c) => c.id === t.preferredConnectionId)?.name ?? 'default'}
                    {t.preferredModel ? ` / ${t.preferredModel}` : ''}
                  </span>
                )}
              </div>
              <Button size="xs" variant="ghost" onClick={() => setEditing({ ...t })}>
                {t.builtin && !t.overridden ? 'Customise' : 'Edit'}
              </Button>
              {t.overridden && (
                <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => void resetTask(t.id)}>
                  <RotateCcw className="size-3.5" /> Reset
                </Button>
              )}
            </div>
          ))}
        </SettingsGroup>
      ))}

      <TaskDialog
        key={editing?.id ?? 'closed'}
        draft={editing}
        onClose={() => setEditing(null)}
        onSave={async (t) => {
          await putTask(t)
          setEditing(null)
        }}
      />
    </>
  )
}
