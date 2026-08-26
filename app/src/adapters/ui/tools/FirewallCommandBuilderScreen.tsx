import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Copy, Plus, Trash2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import {
  FirewallCommandBuilder,
  firewallCmdProviderDescription,
  firewallCmdProviderGroup,
  firewallCmdProviderLabel,
  firewallCmdProviderNeedsGroupContext,
  firewallCmdProviderNeedsPriority,
  firewallCmdProviderNeedsRuleName,
  firewallCmdProviderSupportsDeny,
  type FirewallCmdAction,
  type FirewallCmdContext,
  type FirewallCmdProvider,
  type FirewallCmdRule,
} from '@/core/config/firewallCommandBuilder'
import { PortRange, kFirewallServicePresets, type FirewallDirection, type FirewallProtocol } from '@/core/config/firewallRuleBuilder'

const builder = new FirewallCommandBuilder()

const firewallCmdProviders: FirewallCmdProvider[] = [
  'iptables',
  'firewalld',
  'ufw',
  'windowsPowerShell',
  'windowsNetsh',
  'awsSecurityGroup',
  'gcpFirewall',
  'azureNsg',
]
const providerGroups = ['Linux', 'Windows', 'Cloud'] as const

const directions: FirewallDirection[] = ['inbound', 'outbound']
const protocols: FirewallProtocol[] = ['tcp', 'udp', 'any']

const actionLabels: Record<FirewallCmdAction, string> = { allow: 'Allow', deny: 'Deny' }
const directionLabels: Record<FirewallDirection, string> = { inbound: 'Inbound', outbound: 'Outbound' }
const protocolLabels: Record<FirewallProtocol, string> = { tcp: 'TCP', udp: 'UDP', any: 'TCP + UDP' }

interface RuleRowState {
  id: number
  action: FirewallCmdAction
  direction: FirewallDirection
  protocol: FirewallProtocol
  port: string
  source: string
  ruleName: string
  priority: string
  comment: string
}

function blankRow(id: number, overrides: Partial<Omit<RuleRowState, 'id'>> = {}): RuleRowState {
  return {
    id,
    action: 'allow',
    direction: 'inbound',
    protocol: 'tcp',
    port: '',
    source: '',
    ruleName: '',
    priority: '',
    comment: '',
    ...overrides,
  }
}

export function FirewallCommandBuilderScreen() {
  const [provider, setProvider] = useState<FirewallCmdProvider>('iptables')
  const [groupId, setGroupId] = useState('')
  const [resourceGroup, setResourceGroup] = useState('')
  const [nsgName, setNsgName] = useState('')
  const [network, setNetwork] = useState('')

  const nextIdRef = useRef(1)
  const [rows, setRows] = useState<RuleRowState[]>(() => [
    blankRow(0, { port: '22', source: '0.0.0.0/0', comment: 'ssh' }),
  ])

  useEffect(() => {
    if (!firewallCmdProviderSupportsDeny(provider)) {
      setRows((r) => r.map((row) => (row.action === 'deny' ? { ...row, action: 'allow' } : row)))
    }
  }, [provider])

  function addRow(overrides: Partial<Omit<RuleRowState, 'id'>> = {}) {
    setRows((r) => [...r, blankRow(nextIdRef.current++, overrides)])
  }

  function removeRow(id: number) {
    setRows((r) => r.filter((row) => row.id !== id))
  }

  function updateRow(id: number, patch: Partial<RuleRowState>) {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const generated = useMemo(() => {
    const context: FirewallCmdContext = { provider, groupId, resourceGroup, nsgName, network }
    return rows.map((row) => {
      try {
        const priorityNum = row.priority.trim() === '' ? undefined : Number(row.priority.trim())
        const rule: FirewallCmdRule = {
          action: row.action,
          direction: row.direction,
          protocol: row.protocol,
          ports: row.port.trim() === '' ? undefined : PortRange.parse(row.port.trim()),
          source: row.source.trim() === '' ? undefined : row.source.trim(),
          ruleName: row.ruleName.trim() === '' ? undefined : row.ruleName.trim(),
          priority: priorityNum != null && Number.isFinite(priorityNum) ? priorityNum : undefined,
          comment: row.comment.trim() === '' ? undefined : row.comment.trim(),
        }
        return { row, command: builder.build(rule, context), error: null as string | null }
      } catch (e) {
        return { row, command: null, error: e instanceof Error ? e.message : String(e) }
      }
    })
  }, [rows, provider, groupId, resourceGroup, nsgName, network])

  const copyText = useMemo(() => {
    const lines = generated.filter((g) => g.command != null).map((g) => g.command!.addCommand)
    return lines.length === 0 ? undefined : lines.join('\n')
  }, [generated])

  function renderContextFields() {
    if (!firewallCmdProviderNeedsGroupContext(provider)) return null
    switch (provider) {
      case 'awsSecurityGroup':
        return (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-id">Security group ID</Label>
            <Input
              id="group-id"
              placeholder="sg-0123456789abcdef0"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            />
          </div>
        )
      case 'gcpFirewall':
        return (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="network">VPC network</Label>
            <Input id="network" placeholder="default" value={network} onChange={(e) => setNetwork(e.target.value)} />
          </div>
        )
      case 'azureNsg':
        return (
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="resource-group">Resource group</Label>
              <Input
                id="resource-group"
                placeholder="my-resource-group"
                value={resourceGroup}
                onChange={(e) => setResourceGroup(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nsg-name">NSG name</Label>
              <Input id="nsg-name" placeholder="my-nsg" value={nsgName} onChange={(e) => setNsgName(e.target.value)} />
            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <ToolDetailScaffold
      title="Firewall Command Builder"
      copyText={copyText}
      inputPanel={
        <div className="flex max-w-2xl flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <Label>Target</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as FirewallCmdProvider)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(value: FirewallCmdProvider) => firewallCmdProviderLabel(value)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {providerGroups.map((group) => (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {firewallCmdProviders
                      .filter((p) => firewallCmdProviderGroup(p) === group)
                      .map((p) => (
                        <SelectItem key={p} value={p}>
                          {firewallCmdProviderLabel(p)}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{firewallCmdProviderDescription(provider)}</p>
            {renderContextFields()}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Quick-add a common service</Label>
            <div className="flex flex-wrap gap-2">
              {kFirewallServicePresets.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addRow({ port: String(preset.port), source: '0.0.0.0/0', comment: preset.label })}
                >
                  <Plus className="size-3.5" />
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Rules</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => addRow()}>
                <Plus className="size-3.5" />
                Add rule
              </Button>
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rules yet — add one above.</p>
            ) : null}
            {rows.map((row) => (
              <div key={row.id} className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex flex-col gap-1">
                    <Label>Action</Label>
                    <Select
                      value={row.action}
                      onValueChange={(v) => updateRow(row.id, { action: v as FirewallCmdAction })}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(firewallCmdProviderSupportsDeny(provider)
                          ? (['allow', 'deny'] as FirewallCmdAction[])
                          : (['allow'] as FirewallCmdAction[])
                        ).map((a) => (
                          <SelectItem key={a} value={a}>
                            {actionLabels[a]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Direction</Label>
                    <Select
                      value={row.direction}
                      onValueChange={(v) => updateRow(row.id, { direction: v as FirewallDirection })}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {directions.map((d) => (
                          <SelectItem key={d} value={d}>
                            {directionLabels[d]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Protocol</Label>
                    <Select
                      value={row.protocol}
                      onValueChange={(v) => updateRow(row.id, { protocol: v as FirewallProtocol })}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {protocols.map((p) => (
                          <SelectItem key={p} value={p}>
                            {protocolLabels[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRow(row.id)}
                    aria-label="Remove rule"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-3">
                  <div className="flex flex-col gap-1">
                    <Label>Port / range</Label>
                    <Input
                      className="w-32"
                      placeholder="22 or 8000-8010"
                      value={row.port}
                      onChange={(e) => updateRow(row.id, { port: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Source (CIDR)</Label>
                    <Input
                      className="w-44"
                      placeholder="any, 10.0.0.0/8"
                      value={row.source}
                      onChange={(e) => updateRow(row.id, { source: e.target.value })}
                    />
                  </div>
                  {firewallCmdProviderNeedsRuleName(provider) ? (
                    <div className="flex flex-col gap-1">
                      <Label>Rule name</Label>
                      <Input
                        className="w-44"
                        placeholder="auto-generated if blank"
                        value={row.ruleName}
                        onChange={(e) => updateRow(row.id, { ruleName: e.target.value })}
                      />
                    </div>
                  ) : null}
                  {firewallCmdProviderNeedsPriority(provider) ? (
                    <div className="flex flex-col gap-1">
                      <Label>Priority</Label>
                      <Input
                        className="w-24"
                        type="number"
                        placeholder="100"
                        value={row.priority}
                        onChange={(e) => updateRow(row.id, { priority: e.target.value })}
                      />
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-1">
                    <Label>Comment</Label>
                    <Input
                      className="w-48"
                      value={row.comment}
                      onChange={(e) => updateRow(row.id, { comment: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      }
      outputPanel={
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">Generated commands</p>
          {generated.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add a rule to see its commands here.</p>
          ) : (
            generated.map(({ row, command, error }) => (
              <div key={row.id} className="rounded-lg border border-border bg-background p-3">
                <p className="text-sm font-medium">{row.comment.trim() || 'Rule'}</p>
                {error ? (
                  <p className="mt-2 text-sm text-destructive">{error}</p>
                ) : command ? (
                  <div className="mt-2 flex flex-col gap-2">
                    {command.warnings.map((w, i) => (
                      <Alert key={i} variant={w.severity === 'critical' ? 'destructive' : 'default'}>
                        <AlertTriangle />
                        <AlertDescription>{w.message}</AlertDescription>
                      </Alert>
                    ))}
                    <CommandLine label="Add" command={command.addCommand} />
                    <CommandLine label="Remove" command={command.deleteCommand} />
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      }
    />
  )
}

function CommandLine({ label, command }: { label: string; command: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2">
        <pre className="flex-1 overflow-x-auto font-mono text-xs">{command}</pre>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => void navigator.clipboard.writeText(command)}
          aria-label={`Copy ${label} command`}
        >
          <Copy className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
