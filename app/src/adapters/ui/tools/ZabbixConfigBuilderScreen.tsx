import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BalancedFlowScaffold } from '@/adapters/ui/shell/BalancedFlowScaffold'
import {
  ZabbixConfigBuilder,
  zabbixCatalogFor,
  zabbixCategoryOrderFor,
  zabbixConfigFileName,
  zabbixEffectiveOptions,
  zabbixParameterCategoryLabel,
  type ZabbixMode,
  type ZabbixParameter,
} from '@/core/config/zabbixConfigBuilder'

const builder = new ZabbixConfigBuilder()

export function ZabbixConfigBuilderScreen() {
  const [mode, setMode] = useState<ZabbixMode>('server')
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ database: true, network: true })

  const catalog = zabbixCatalogFor(mode)
  const categoryOrder = zabbixCategoryOrderFor(mode)

  const output = useMemo(() => builder.execute({ mode, selectedValues }), [mode, selectedValues])

  const q = query.trim().toLowerCase()
  function matches(p: ZabbixParameter): boolean {
    return q.length === 0 || p.key.toLowerCase().includes(q) || p.label.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
  }

  function switchMode(next: ZabbixMode) {
    if (next === mode) return
    setMode(next)
    // Each mode has its own catalog/key namespace — carrying selections
    // across the switch would silently keep dead keys the new mode's
    // builder just ignores, so a mode switch starts from a clean slate.
    setSelectedValues({})
  }

  function toggleParam(parameter: ZabbixParameter, checked: boolean) {
    setSelectedValues((prev) => {
      const next = { ...prev }
      if (checked) next[parameter.key] = prev[parameter.key] ?? parameter.defaultValue
      else delete next[parameter.key]
      return next
    })
  }

  function updateValue(key: string, value: string) {
    setSelectedValues((prev) => ({ ...prev, [key]: value }))
  }

  const selectedCount = Object.keys(selectedValues).length

  return (
    <BalancedFlowScaffold
      title="Zabbix Config Builder"
      copyText={output}
      configLabel="INPUT"
      resultsLabel="DIRECTIVE CATALOG"
      previewLabel={zabbixConfigFileName(mode)}
      configPanel={
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-2 text-sm font-medium">Component</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={mode === 'server' ? 'default' : 'outline'} onClick={() => switchMode('server')}>
                Server
              </Button>
              <Button type="button" size="sm" variant={mode === 'agent' ? 'default' : 'outline'} onClick={() => switchMode('agent')}>
                Client (Agent)
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Server and agent are separate daemons with mostly non-overlapping config directives — switching
              clears the current selection since a server-only pick (e.g. DBHost) has nothing to apply to on an
              agent, and vice versa.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="zabbix-search">Search directives</Label>
            <Input
              id="zabbix-search"
              placeholder={`Search ${catalog.length} directives by key or description…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      }
      resultsPanel={
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {selectedCount} directive{selectedCount === 1 ? '' : 's'} selected — only these appear in the output
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {categoryOrder.map((category) => {
              const params = catalog.filter((p) => p.category === category && matches(p))
              if (params.length === 0) return null
              const isOpen = q.length > 0 || (expanded[category] ?? false)
              const selectedInCategory = params.filter((p) => p.key in selectedValues).length

              return (
                <div key={category} className="rounded-lg border border-border/60">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left"
                    onClick={() => setExpanded((prev) => ({ ...prev, [category]: !prev[category] }))}
                  >
                    {isOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                    <span className="flex-1 text-sm font-semibold">{zabbixParameterCategoryLabel(category)}</span>
                    <span className="text-xs text-muted-foreground">{params.length}</span>
                    {selectedInCategory > 0 ? <Badge variant="secondary">{selectedInCategory}</Badge> : null}
                  </button>
                  {isOpen ? (
                    <div className="flex flex-col gap-3 border-t border-border/60 px-3 py-3">
                      {params.map((parameter) => (
                        <ZabbixParameterRow
                          key={parameter.key}
                          parameter={parameter}
                          checked={parameter.key in selectedValues}
                          value={selectedValues[parameter.key] ?? parameter.defaultValue}
                          onToggle={(checked) => toggleParam(parameter, checked)}
                          onChange={(value) => updateValue(parameter.key, value)}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
            {q.length > 0 && categoryOrder.every((c) => catalog.filter((p) => p.category === c && matches(p)).length === 0) ? (
              <p className="py-4 text-sm text-muted-foreground">No directives match "{query}".</p>
            ) : null}
          </div>
        </div>
      }
      previewPanel={
        <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-background p-4 font-mono text-xs">
          {output}
        </pre>
      }
    />
  )
}

function ZabbixParameterRow({
  parameter,
  checked,
  value,
  onToggle,
  onChange,
}: {
  parameter: ZabbixParameter
  checked: boolean
  value: string
  onToggle: (checked: boolean) => void
  onChange: (value: string) => void
}) {
  const options = zabbixEffectiveOptions(parameter)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-0.5" />
        <div className="flex-1">
          <span className={`font-mono text-xs font-semibold ${checked ? 'text-primary' : ''}`}>{parameter.key}</span>
          <p className="text-xs text-muted-foreground">{parameter.description}</p>
          {parameter.riskNote ? <p className="mt-0.5 text-xs text-destructive">{parameter.riskNote}</p> : null}
        </div>
      </div>
      {checked ? (
        <div className="ml-6">
          {options.length > 0 ? (
            <Select value={value} onValueChange={(v) => onChange(String(v))}>
              <SelectTrigger className="w-full max-w-sm" size="sm">
                <SelectValue placeholder="Select a value">{(v: string) => options.find((o) => o.value === v)?.label ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              className="max-w-sm font-mono text-xs"
              value={value}
              placeholder={parameter.defaultValue}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </div>
      ) : null}
    </div>
  )
}
