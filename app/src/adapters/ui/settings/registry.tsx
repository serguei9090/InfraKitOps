import { Info, Network, Server, SlidersHorizontal, Sparkles, SquareTerminal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { GeneralSettings } from './sections/GeneralSettings'
import { AiSettings } from './sections/AiSettings'
import { RunbookSettings } from './sections/RunbookSettings'
import { NetworkSettings } from './sections/NetworkSettings'
import { BackendSettings } from './sections/BackendSettings'
import { AboutSettings } from './sections/AboutSettings'

export interface SettingsSectionDef {
  id: string
  label: string
  icon: LucideIcon
  /** `local` = client IStoragePort · `global` = backend · `info` = read-only */
  scope: 'local' | 'global' | 'info'
  element: ReactNode
}

/**
 * The Settings page's left menu. A module with settings adds one entry + its
 * panel component — nothing in SettingsScaffold changes. AI / Runbooks /
 * Network sections land in later phases (SETTINGS_MODULE_PLAN.md §6).
 */
export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, scope: 'local', element: <GeneralSettings /> },
  { id: 'ai', label: 'AI', icon: Sparkles, scope: 'global', element: <AiSettings /> },
  { id: 'runbooks', label: 'Runbooks', icon: SquareTerminal, scope: 'global', element: <RunbookSettings /> },
  { id: 'network', label: 'Network', icon: Network, scope: 'local', element: <NetworkSettings /> },
  { id: 'backend', label: 'Backend', icon: Server, scope: 'info', element: <BackendSettings /> },
  { id: 'about', label: 'About', icon: Info, scope: 'info', element: <AboutSettings /> },
]

export const DEFAULT_SECTION = 'general'
