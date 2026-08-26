import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ToolScaffoldHeader, ToolScaffoldPanel } from './ToolDetailScaffold'

export interface StepperStep {
  label: string
}

interface StepperWorkspaceScaffoldProps {
  title: string
  steps: StepperStep[]
  /** Index into `steps` of the currently active step. Earlier steps render as complete. */
  activeStep: number
  /** Card for defining/manipulating dynamic inputs (e.g. an "Add Rule" table). */
  builderPanel: ReactNode
  /** Full-width terminal-style card at the bottom (generated script/commands). */
  outputPanel: ReactNode
  builderLabel?: string
  outputLabel?: string
  /** Text to copy when the toolbar's copy button is pressed. Undefined hides it. */
  copyText?: string
}

/**
 * T3 "Stepper Workspace" layout archetype: a horizontal step progress bar,
 * a card for dynamic input manipulation (add/edit/remove rows), and a
 * full-width terminal-styled output card. Use for builders that guide a
 * user through a multi-step process or manage a growing table of rows
 * (e.g. Firewall Command/Rule Builder, SSH Config Builder, PDF Split &
 * Merge) — where `ToolDetailScaffold` (T1)'s static two-column split can't
 * express sequence or row-by-row growth.
 */
export function StepperWorkspaceScaffold({
  title,
  steps,
  activeStep,
  builderPanel,
  outputPanel,
  builderLabel = 'DEFINE RULES / STEPS',
  outputLabel = 'TERMINAL OUTPUT / GENERATED SCRIPT',
  copyText,
}: StepperWorkspaceScaffoldProps) {
  return (
    <div className="flex h-full flex-col">
      <ToolScaffoldHeader title={title} copyText={copyText} />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-5">
        <StepperBar steps={steps} activeStep={activeStep} />
        <ToolScaffoldPanel label={builderLabel} bordered className="flex-none bg-background">
          {builderPanel}
        </ToolScaffoldPanel>
        <ToolScaffoldPanel label={outputLabel} bordered className="flex-1 bg-card">
          {outputPanel}
        </ToolScaffoldPanel>
      </div>
    </div>
  )
}

function StepperBar({ steps, activeStep }: { steps: StepperStep[]; activeStep: number }) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((step, i) => {
        const isComplete = i < activeStep
        const isActive = i === activeStep
        return (
          <div key={step.label} className="flex flex-1 items-center gap-2 last:flex-none">
            <div
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium',
                isActive && 'bg-primary/15 text-primary',
                isComplete && 'text-foreground',
                !isActive && !isComplete && 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border text-xs',
                  isActive && 'border-primary text-primary',
                  isComplete && 'border-foreground/40 bg-foreground/10',
                  !isActive && !isComplete && 'border-border',
                )}
              >
                {isComplete ? <Check className="size-3" /> : i + 1}
              </span>
              {step.label}
            </div>
            {i < steps.length - 1 ? <div className="h-px flex-1 bg-border/60" /> : null}
          </div>
        )
      })}
    </div>
  )
}
