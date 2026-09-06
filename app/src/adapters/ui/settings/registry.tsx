import { Info, Network, RadioTower, ScrollText, Server, SlidersHorizontal, Sparkles, SquareTerminal, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { GeneralSettings } from './sections/GeneralSettings'
import { AiSettings } from './sections/AiSettings'
import { RunbookSettings } from './sections/RunbookSettings'
import { NetworkSettings } from './sections/NetworkSettings'
import { MonitorSettings } from './sections/MonitorSettings'
import { BackendSettings } from './sections/BackendSettings'
import { UsersSettings } from './sections/UsersSettings'
import { AuditSettings } from './sections/AuditSettings'
import { AboutSettings } from './sections/AboutSettings'

export interface SettingsSectionDef {
  id: string
  label: string
  icon: LucideIcon
  /** `local` = client IStoragePort · `global` = backend · `info` = read-only */
  scope: 'local' | 'global' | 'info'
  /** extra terms the settings search matches against (S3c) */
  keywords?: string[]
  /** only shown to an admin in multi-user mode (U1) */
  adminOnly?: boolean
  element: ReactNode
}

/**
 * The Settings page's left menu. A module with settings adds one entry + its
 * panel component — nothing in SettingsScaffold changes. AI / Runbooks /
 * Network sections land in later phases (SETTINGS_MODULE_PLAN.md §6).
 */
export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: 'general',
    label: 'General',
    icon: SlidersHorizontal,
    scope: 'local',
    keywords: ['theme', 'dark', 'light', 'appearance', 'sidebar', 'rail', 'module', 'order', 'hide', 'reorder', 'shortcut', 'keyboard', 'keybind', 'hotkey', 'backup', 'export', 'import'],
    element: <GeneralSettings />,
  },
  {
    id: 'ai',
    label: 'AI',
    icon: Sparkles,
    scope: 'global',
    keywords: ['llm', 'model', 'connection', 'provider', 'openai', 'anthropic', 'gemini', 'ollama', 'prompt', 'task', 'temperature', 'default'],
    element: <AiSettings />,
  },
  {
    id: 'runbooks',
    label: 'Runbooks',
    icon: SquareTerminal,
    scope: 'global',
    keywords: ['history', 'retention', 'concurrent', 'vault', 'auto-lock', 'autolock', 'execution'],
    element: <RunbookSettings />,
  },
  {
    id: 'network',
    label: 'Network',
    icon: Network,
    scope: 'local',
    keywords: ['proxy', 'dns', 'interface', 'timeout', 'retry', 'geo', 'maxmind', 'ipv4', 'ipv6'],
    element: <NetworkSettings />,
  },
  {
    id: 'monitors',
    label: 'Monitors',
    icon: RadioTower,
    scope: 'global',
    keywords: ['alert', 'notify', 'webhook', 'slack', 'discord', 'smtp', 'email', 'mail', 'uptime', 'down', 'recovery', 'snooze', 'mute', 'channel'],
    element: <MonitorSettings />,
  },
  {
    id: 'backend',
    label: 'Backend',
    icon: Server,
    scope: 'info',
    keywords: ['sidecar', 'service', 'endpoint', 'token', 'reconnect', 'status', 'capabilities', 'url', 'override', 'self-hosted'],
    element: <BackendSettings />,
  },
  {
    id: 'users',
    label: 'Users',
    icon: Users,
    scope: 'global',
    adminOnly: true,
    keywords: ['account', 'role', 'admin', 'operator', 'viewer', 'permission', 'access', 'password', 'login'],
    element: <UsersSettings />,
  },
  {
    id: 'audit',
    label: 'Audit log',
    icon: ScrollText,
    scope: 'info',
    adminOnly: true,
    keywords: ['audit', 'log', 'history', 'sign-in', 'security', 'trail', 'who'],
    element: <AuditSettings />,
  },
  { id: 'about', label: 'About', icon: Info, scope: 'info', keywords: ['version', 'license', 'plan'], element: <AboutSettings /> },
]

export const DEFAULT_SECTION = 'general'
