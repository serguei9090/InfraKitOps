import type { ReactNode } from 'react'
import { HeaderValidate } from '@/adapters/ui/config/HeaderValidate'
import type { ConfigCheckKind } from '@/adapters/backend/configCheckClient'
import { ToolScaffoldHeader, ToolScaffoldPanel } from './ToolDetailScaffold'

interface GeneratorScaffoldProps {
  title: string
  /** The single-column form: mode switches, catalog editor, bespoke fields. */
  formPanel: ReactNode
  /**
   * The generated artifact, shown in the header "Preview" modal and used for
   * Copy / Download. Pass `undefined` while the form is incomplete to hide
   * those actions.
   */
  output?: {
    /** File text — the modal body, the copy payload, the download content. */
    text: string
    fileName: string
    mimeType?: string
    /** Optional advisory block rendered above the file text in the modal (execute() warnings). */
    notice?: ReactNode
    /** Label on the Preview modal + the panel. Defaults to the file name. */
    label?: string
  }
  /** Adds a header "Validate" action when the backend service is connected. */
  validate?: { kind: ConfigCheckKind; text: string }
  formLabel?: string
}

/**
 * T5 "Generator" layout archetype: a single-column form that fills the whole
 * body, with the generated file reached on demand from the header
 * (`Validate` · `Download` · `Preview` · `Copy`). Use for the config-file
 * builders — SSH, sysctl, Zabbix, RDP, Web Server, Database, Fail2ban,
 * Firewall — where the output is a *result* you grab when done, not a second
 * editor pane you watch while filling the form.
 *
 * Not for tools whose output you edit against live (Chmod Calculator, Docker
 * Run → Compose — keep T1) or that produce genuine computed results plus a
 * snippet (the sizers — keep T2 BalancedFlow).
 *
 * Built on the same `ToolScaffoldHeader` / `ToolScaffoldPanel` primitives as
 * T1–T3 so every archetype stays visually consistent.
 */
export function GeneratorScaffold({
  title,
  formPanel,
  output,
  validate,
  formLabel = 'CONFIGURATION',
}: GeneratorScaffoldProps) {
  const modalLabel = output?.label ?? output?.fileName ?? 'Generated output'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ToolScaffoldHeader
        title={title}
        copyText={output?.text}
        headerActions={validate ? <HeaderValidate kind={validate.kind} text={validate.text} /> : undefined}
        download={
          output ? { fileName: output.fileName, content: output.text, mimeType: output.mimeType } : undefined
        }
        preview={
          output
            ? {
                label: modalLabel,
                content: (
                  <div className="flex flex-col gap-3">
                    {output.notice}
                    <pre className="max-w-full overflow-x-auto rounded-lg border border-border/60 bg-background p-4 font-mono text-xs whitespace-pre-wrap break-all">
                      {output.text}
                    </pre>
                  </div>
                ),
              }
            : undefined
        }
      />
      <div className="flex flex-1 flex-col overflow-y-auto p-5 lg:min-h-0 lg:overflow-hidden">
        <ToolScaffoldPanel label={formLabel} bordered scrollable className="bg-background">
          {/* Forms read best at a fixed measure; capping here also keeps
              right-aligned controls (switches) near their labels. */}
          <div className="max-w-4xl">{formPanel}</div>
        </ToolScaffoldPanel>
      </div>
    </div>
  )
}
