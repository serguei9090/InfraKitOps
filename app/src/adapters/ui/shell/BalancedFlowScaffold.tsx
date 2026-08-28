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
    <div className="flex h-full min-h-0 flex-col">
      <ToolScaffoldHeader title={title} copyText={copyText} />
      {/* Stacked (< lg): one scroll. lg+: config band caps at half-height and
          scrolls if huge; the results/preview split scrolls independently. */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5 lg:min-h-0 lg:overflow-hidden">
        <ToolScaffoldPanel
          label={configLabel}
          bordered
          className="flex-none bg-background lg:max-h-[50vh] lg:overflow-y-auto"
        >
          {configPanel}
        </ToolScaffoldPanel>
        <div className="flex flex-1 flex-col gap-4 lg:min-h-0 lg:flex-row lg:overflow-hidden">
          <ToolScaffoldPanel label={resultsLabel} bordered scrollable className="bg-background">
            {resultsPanel}
          </ToolScaffoldPanel>
          <ToolScaffoldPanel label={previewLabel} bordered scrollable className="bg-card">
            {previewPanel}
          </ToolScaffoldPanel>
        </div>
      </div>
    </div>
  )
}
