import type { ReactNode } from 'react'
import { ToolScaffoldHeader, ToolScaffoldPanel } from './ToolDetailScaffold'

interface BalancedFlowScaffoldProps {
  title: string
  /** Wide top card: multi-column form fields (see `design.md`'s form grid rules). */
  configPanel: ReactNode
  /** Bottom-left card: computed metrics/tables. */
  resultsPanel: ReactNode
  /** Bottom-right card: generated file/code preview. */
  previewPanel: ReactNode
  configLabel?: string
  resultsLabel?: string
  previewLabel?: string
  /** Text to copy when the toolbar's copy button is pressed. Undefined hides it. */
  copyText?: string
}

/**
 * T2 "Balanced Flow" layout archetype: a wide configuration card across the
 * top, then a 50/50 split below for results data and a live output preview.
 * Use for sizers, planners, and complex calculators that need deep
 * configuration and produce both table data and generated files (e.g.
 * Zabbix Monitoring Sizer, Database RAM Sizer, Ceph PG Calculator) — where
 * `ToolDetailScaffold` (T1)'s plain two-column split wastes space on the
 * config side and cramps the output side.
 */
export function BalancedFlowScaffold({
  title,
  configPanel,
  resultsPanel,
  previewPanel,
  configLabel = 'CONFIGURATION INPUTS',
  resultsLabel = 'SIZING RESULTS',
  previewLabel = 'GENERATED OUTPUT (CONF)',
  copyText,
}: BalancedFlowScaffoldProps) {
  return (
    <div className="flex min-h-full flex-col">
      <ToolScaffoldHeader title={title} copyText={copyText} />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <ToolScaffoldPanel label={configLabel} bordered className="flex-none bg-background">
          {configPanel}
        </ToolScaffoldPanel>
        <div className="flex flex-1 flex-col gap-4 lg:flex-row">
          <ToolScaffoldPanel label={resultsLabel} bordered className="bg-background">
            {resultsPanel}
          </ToolScaffoldPanel>
          <ToolScaffoldPanel label={previewLabel} bordered className="bg-card">
            {previewPanel}
          </ToolScaffoldPanel>
        </div>
      </div>
    </div>
  )
}
