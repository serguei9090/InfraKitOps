import { useNavigate } from 'react-router-dom'
import { RadioTower } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMonitorStore } from '@/stores/monitorStore'
import { useBackendStore } from '@/stores/backendStore'
import type { Monitor, MonitorKind } from '@/core/monitor/monitorModel'

/**
 * "Save as monitor" — a network tool (Ping / X.509 / DNS / Whois) hands its
 * current target to the Monitors module, which opens a prefilled New-monitor
 * dialog. Hidden when no backend is connected (monitors are backend-only).
 */
export function SaveAsMonitorButton({
  kind,
  target,
  name,
  config,
  label = 'Save as monitor',
}: {
  kind: MonitorKind
  target: string
  name?: string
  config?: Record<string, unknown>
  label?: string
}) {
  const navigate = useNavigate()
  const requestNew = useMonitorStore((s) => s.requestNew)
  const backendUp = useBackendStore((s) => s.status === 'available')

  if (!backendUp || !target.trim()) return null

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => {
        const spec: Partial<Monitor> = { kind, target: target.trim(), name: (name ?? target).trim() }
        if (config) spec.config = config
        requestNew(spec)
        navigate('/tools/monitors')
      }}
    >
      <RadioTower className="size-3.5" /> {label}
    </Button>
  )
}
