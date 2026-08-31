import { Info, Server, SlidersHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { GeneralSettings } from './sections/GeneralSettings'
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
  { id: 'backend', label: 'Backend', icon: Server, scope: 'info', element: <BackendSettings /> },
  { id: 'about', label: 'About', icon: Info, scope: 'info', element: <AboutSettings /> },
]

export const DEFAULT_SECTION = 'general'
