import { useMemo, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StepperWorkspaceScaffold } from '@/adapters/ui/shell/StepperWorkspaceScaffold'
import { ConfigValidateButton } from '@/adapters/ui/config/ConfigValidateButton'
import {
  FirewallRuleBuilder,
  PortRange,
  firewallActionValidAsPolicy,
  firewallPresetFor,
  firewallPresetToRule,
  kFirewallServicePresets,
  type FirewallAction,
  type FirewallDialect,
  type FirewallDirection,
  type FirewallProtocol,
  type FirewallRule,
  type FirewallServicePreset,
} from '@/core/config/firewallRuleBuilder'

const builder = new FirewallRuleBuilder()

const ALL_DIALECTS: FirewallDialect[] = ['ufw', 'nftables']
const ALL_ACTIONS: FirewallAction[] = ['allow', 'deny', 'reject', 'limit']
const ALL_DIRECTIONS: FirewallDirection[] = ['inbound', 'outbound']
const ALL_PROTOCOLS: FirewallProtocol[] = ['tcp', 'udp', 'any']
const POLICY_ACTIONS = ALL_ACTIONS.filter(firewallActionValidAsPolicy)

const dialectLabels: Record<FirewallDialect, string> = { ufw: 'UFW', nftables: 'nftables' }
const actionLabels: Record<FirewallAction, string> = { allow: 'Allow', deny: 'Deny (drop)', reject: 'Reject', limit: 'Rate-limit' }
const directionLabels: Record<FirewallDirection, string> = { inbound: 'Inbound', outbound: 'Outbound' }
const protocolLabels: Record<FirewallProtocol, string> = { tcp: 'TCP', udp: 'UDP', any: 'TCP + UDP' }

interface RuleRowState {
  id: number
  action: FirewallAction
  direction: FirewallDirection
  protocol: FirewallProtocol
  port: string
  source: string
  comment: string
}

function rowFromRule(id: number, rule?: FirewallRule): RuleRowState {
  return {
    id,
    action: rule?.action ?? 'allow',
    direction: rule?.direction ?? 'inbound',
    protocol: rule?.protocol ?? 'tcp',
    port: rule?.ports ? rule.ports.ufwText : '',
    source: rule?.source ?? '',
    comment: rule?.comment ?? '',
  }
}

export function FirewallRuleBuilderScreen() {
  const [dialect, setDialect] = useState<FirewallDialect>('ufw')
  const [incoming, setIncoming] = useState<FirewallAction>('deny')
  const [outgoing, setOutgoing] = useState<FirewallAction>('allow')
  const [forward, setForward] = useState<FirewallAction>('deny')
  const [includeHeader, setIncludeHeader] = useState(true)
  const [allowLoopback, setAllowLoopback] = useState(true)
  const [allowEstablished, setAllowEstablished] = useState(true)
  const [allowIcmp, setAllowIcmp] = useState(true)
  const [sshPort, setSshPort] = useState('22')
  const nextId = useRef(1)

  // Seed with an SSH allow rule so the default state of the screen is
  // already lockout-safe — the critical warning is something a user has to
  // remove a rule to trigger, not start out with.
  const [rows, setRows] = useState<RuleRowState[]>(() => {
    const preset = firewallPresetFor('SSH')
    return [rowFromRule(0, preset ? firewallPresetToRule(preset) : undefined)]
  })

  function addRow(rule?: FirewallRule) {
    setRows((prev) => [...prev, rowFromRule(nextId.current++, rule)])
  }

  function removeRow(id: number) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  function updateRow(id: number, patch: Partial<RuleRowState>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const result = useMemo(() => {
    try {
      const rules: FirewallRule[] = rows.map((row) => ({
        action: row.action,
        direction: row.direction,
        protocol: row.protocol,
        ports: row.port.trim().length === 0 ? undefined : PortRange.parse(row.port.trim()),
        source: row.source.trim().length === 0 ? undefined : row.source.trim(),
        comment: row.comment.trim().length === 0 ? undefined : row.comment.trim(),
      }))
      const parsedSshPort = Number.parseInt(sshPort.trim(), 10)
      const value = builder.execute({
        dialect,
        rules,
        policy: { incoming, outgoing, forward },
        sshPort: Number.isFinite(parsedSshPort) ? parsedSshPort : 22,
        includeHeader,
        allowLoopback,
        allowEstablished,
        allowIcmp,
      })
      return { value, error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [rows, dialect, incoming, outgoing, forward, sshPort, includeHeader, allowLoopback, allowEstablished, allowIcmp])

  const activeStep = rows.length === 0 ? 0 : result.error ? 1 : 2

  return (
    <StepperWorkspaceScaffold
      title="Firewall Rule Builder"
      copyText={result.value?.script}
      steps={[{ label: 'Set Dialect & Policy' }, { label: 'Add Rules' }, { label: 'Review & Copy' }]}
      activeStep={activeStep}
      builderLabel="DIALECT, POLICY & RULES"
      outputLabel="GENERATED SCRIPT"
      builderPanel={
        <div className="flex flex-col gap-5">
          <div>
            <p className="mb-2 text-sm font-medium">Dialect</p>
            <div className="flex gap-2">
              {ALL_DIALECTS.map((d) => (
                <Button key={d} type="button" size="sm" variant={dialect === d ? 'default' : 'outline'} onClick={() => setDialect(d)}>
                  {dialectLabels[d]}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Default policy</p>
            <div className="flex flex-wrap gap-3">
              <PolicySelect label="Incoming" value={incoming} onChange={setIncoming} />
              <PolicySelect label="Outgoing" value={outgoing} onChange={setOutgoing} />
              {dialect === 'nftables' ? <PolicySelect label="Forward" value={forward} onChange={setForward} /> : null}
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              <Label htmlFor="ssh-port">SSH port</Label>
              <Input id="ssh-port" className="max-w-32" inputMode="numeric" value={sshPort} onChange={(e) => setSshPort(e.target.value)} />
            </div>
          </div>

          {dialect === 'nftables' ? (
            <div className="flex flex-col gap-3">
              <ToggleRow label="Accept loopback traffic" checked={allowLoopback} onCheckedChange={setAllowLoopback} />
              <ToggleRow label="Accept established/related connections" checked={allowEstablished} onCheckedChange={setAllowEstablished} />
              <ToggleRow label="Accept ICMP / ICMPv6" checked={allowIcmp} onCheckedChange={setAllowIcmp} />
            </div>
          ) : null}
          <ToggleRow label="Include explanatory header comment" checked={includeHeader} onCheckedChange={setIncludeHeader} />

          <div>
            <p className="mb-2 text-sm font-medium">Quick-add a common service</p>
            <div className="flex flex-wrap gap-2">
              {kFirewallServicePresets.map((preset: FirewallServicePreset) => (
                <Button
                  key={preset.label}
                  type="button"
                  size="sm"
                  variant="outline"
                  title={preset.exposureNote ? `${preset.description} — ${preset.exposureNote}` : preset.description}
                  onClick={() => addRow(firewallPresetToRule(preset))}
                >
                  <Plus className="size-3.5" /> {preset.label}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">Rules</p>
              <Button type="button" size="sm" variant="ghost" onClick={() => addRow()}>
                <Plus className="size-4" /> Add rule
              </Button>
            </div>
            {rows.length === 0 ? <p className="text-xs text-muted-foreground">No rules yet — add one above.</p> : null}
            <div className="flex flex-col gap-3">
              {rows.map((row) => (
                <RuleRow key={row.id} row={row} onChange={(patch) => updateRow(row.id, patch)} onRemove={() => removeRow(row.id)} />
              ))}
            </div>
          </div>
        </div>
      }
      outputPanel={
        <div className="flex flex-col gap-3">
          {result.error ? (
            <p className="text-sm text-destructive">{result.error}</p>
          ) : result.value ? (
            <>
              {result.value.warnings.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {result.value.warnings.map((warning, i) => (
                    <Alert key={i} variant={warning.severity === 'critical' ? 'destructive' : 'default'}>
                      <AlertTitle>{warning.severity === 'critical' ? 'LOCKOUT RISK' : 'Advisory'}</AlertTitle>
                      <AlertDescription>{warning.message}</AlertDescription>
                    </Alert>
                  ))}
                </div>
              ) : null}
              <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-background p-4 font-mono text-xs">
                {result.value.script}
              </pre>
              {dialect === 'nftables' ? <ConfigValidateButton kind="nftables" text={result.value.script} /> : null}
            </>
          ) : null}
        </div>
      }
    />
  )
}

function PolicySelect({ label, value, onChange }: { label: string; value: FirewallAction; onChange: (v: FirewallAction) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as FirewallAction)}>
        <SelectTrigger className="w-40" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {POLICY_ACTIONS.map((a) => (
            <SelectItem key={a} value={a}>
              {actionLabels[a]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function ToggleRow({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}

function RuleRow({
  row,
  onChange,
  onRemove,
}: {
  row: RuleRowState
  onChange: (patch: Partial<RuleRowState>) => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Action</Label>
          <Select value={row.action} onValueChange={(v) => onChange({ action: v as FirewallAction })}>
            <SelectTrigger className="w-32" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {actionLabels[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Direction</Label>
          <Select value={row.direction} onValueChange={(v) => onChange({ direction: v as FirewallDirection })}>
            <SelectTrigger className="w-32" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_DIRECTIONS.map((d) => (
                <SelectItem key={d} value={d}>
                  {directionLabels[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Protocol</Label>
          <Select value={row.protocol} onValueChange={(v) => onChange({ protocol: v as FirewallProtocol })}>
            <SelectTrigger className="w-32" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_PROTOCOLS.map((p) => (
                <SelectItem key={p} value={p}>
                  {protocolLabels[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" size="icon-sm" variant="ghost" className="ml-auto" onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Port / range</Label>
          <Input className="w-32" placeholder="22 or 8000-8010" value={row.port} onChange={(e) => onChange({ port: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Source (CIDR)</Label>
          <Input className="w-48" placeholder="any, 10.0.0.0/8" value={row.source} onChange={(e) => onChange({ source: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Comment</Label>
          <Input className="w-48" value={row.comment} onChange={(e) => onChange({ comment: e.target.value })} />
        </div>
      </div>
    </div>
  )
}
