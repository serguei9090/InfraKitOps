/**
 * Prompt Library — bulk entry / display helpers for `kind: 'select'` variable
 * options. Framework-free, same rule as the rest of `src/core/**`.
 */
import type { VariableOption } from './promptModel'

/** The picker text for an option — its `label`, or the raw `value`. */
export function optionLabel(option: VariableOption): string {
  return option.label && option.label.trim() ? option.label : option.value
}

/**
 * Parse a bulk-entry textarea into options. One option per line; blank lines
 * skipped; duplicate values dropped. A `|` or `=` splits `value` from `label`:
 *
 *   prod                → { value: 'prod' }
 *   prod | Production    → { value: 'prod', label: 'Production' }
 *   prod = Production    → { value: 'prod', label: 'Production' }
 */
export function parseOptionLines(text: string): VariableOption[] {
  const out: VariableOption[] = []
  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const sep = trimmed.match(/\s*[|=]\s*/)
    let value = trimmed
    let label: string | undefined
    if (sep && sep.index != null) {
      value = trimmed.slice(0, sep.index).trim()
      label = trimmed.slice(sep.index + sep[0].length).trim() || undefined
    }
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(label && label !== value ? { value, label } : { value })
  }
  return out
}

/** Serialise options back to bulk-entry lines (round-trips `parseOptionLines`). */
export function optionsToLines(options: VariableOption[]): string {
  return options
    .map((o) => (o.label && o.label !== o.value ? `${o.value} | ${o.label}` : o.value))
    .join('\n')
}

/** A named, ready-made option list for the "Dropdown" authoring sheet. */
export interface PresetOptionSet {
  id: string
  label: string
  options: VariableOption[]
}

/** Common infra enums, one click to seed. Order matters (rendered as-is). */
export const PRESET_OPTION_SETS: readonly PresetOptionSet[] = [
  {
    id: 'environment',
    label: 'Environments',
    options: [
      { value: 'prod', label: 'Production' },
      { value: 'staging', label: 'Staging' },
      { value: 'dev', label: 'Development' },
      { value: 'local', label: 'Local' },
    ],
  },
  {
    id: 'log-level',
    label: 'Log levels',
    options: [
      { value: 'trace' },
      { value: 'debug' },
      { value: 'info' },
      { value: 'warn' },
      { value: 'error' },
      { value: 'fatal' },
    ],
  },
  {
    id: 'os-family',
    label: 'OS families',
    options: [
      { value: 'linux', label: 'Linux' },
      { value: 'windows', label: 'Windows' },
      { value: 'darwin', label: 'macOS' },
    ],
  },
  {
    id: 'severity',
    label: 'Severity',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'critical', label: 'Critical' },
    ],
  },
  {
    id: 'protocol',
    label: 'Protocols',
    options: [{ value: 'tcp', label: 'TCP' }, { value: 'udp', label: 'UDP' }, { value: 'icmp', label: 'ICMP' }],
  },
  {
    id: 'cloud',
    label: 'Cloud providers',
    options: [
      { value: 'aws', label: 'AWS' },
      { value: 'gcp', label: 'GCP' },
      { value: 'azure', label: 'Azure' },
      { value: 'onprem', label: 'On-prem' },
    ],
  },
]
