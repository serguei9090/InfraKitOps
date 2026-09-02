import { useBackendStore } from '@/stores/backendStore'
import { SettingsGroup, SettingsRow } from '../SettingsScaffold'

const DOCS = [
  ['Specification', 'InfraKit Studio Specification.md'],
  ['Design notes', 'design.md'],
  ['Migration plan', 'MIGRATION_PLAN.md'],
  ['Runbooks plan', 'RUNBOOK_MODULE_PLAN.md'],
  ['AI module plan', 'AI_MODULE_PLAN.md'],
  ['Settings plan', 'SETTINGS_MODULE_PLAN.md'],
] as const

export function AboutSettings() {
  const health = useBackendStore((s) => s.health)

  return (
    <>
      <SettingsGroup title="InfraKit Studio">
        <SettingsRow label="Version">
          <span className="font-mono text-xs">{__APP_VERSION__}</span>
        </SettingsRow>
        <SettingsRow label="Frontend build">
          <span className="font-mono text-xs">{import.meta.env.MODE}</span>
        </SettingsRow>
        <SettingsRow label="Backend">
          <span className="font-mono text-xs">{health?.version ?? '—'}</span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Planning docs" description="In the repository root.">
        <ul className="flex flex-col gap-1 text-sm">
          {DOCS.map(([label, file]) => (
            <li key={file} className="flex items-center justify-between">
              <span>{label}</span>
              <code className="text-xs text-muted-foreground">{file}</code>
            </li>
          ))}
        </ul>
      </SettingsGroup>
    </>
  )
}
