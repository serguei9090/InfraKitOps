import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BalancedFlowScaffold } from '@/adapters/ui/shell/BalancedFlowScaffold'
import {
  SysctlConfigBuilder,
  kSysctlParameterCatalog,
  kSysctlPresetCaveat,
  kSysctlPresets,
  sysctlEffectiveOptions,
  sysctlParameterCategoryLabel,
  sysctlParameterCategoryValues,
  sysctlResolvePreset,
  type OutputMode,
  type SysctlParameter,
} from '@/core/tuning/sysctlConfigBuilder'

const builder = new SysctlConfigBuilder()

export function SysctlConfigBuilderScreen() {
  const [mode, setMode] = useState<OutputMode>('permanent')
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ memoryManagement: true })

  const result = useMemo(() => {
    try {
      return { value: builder.execute({ selectedValues, mode }), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [selectedValues, mode])

  const q = query.trim().toLowerCase()
  function matches(p: SysctlParameter): boolean {
    return (
      q.length === 0 ||
      p.key.toLowerCase().includes(q) ||
      p.label.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    )
  }

  function toggleParam(parameter: SysctlParameter, checked: boolean) {
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

  function applyPreset(presetId: string) {
    const preset = kSysctlPresets.find((p) => p.id === presetId)
    if (!preset) return
    setSelectedValues((prev) => ({ ...prev, ...sysctlResolvePreset(preset) }))
  }

  const selectedCount = Object.keys(selectedValues).length

  return (
    <BalancedFlowScaffold
      title="Kernel Parameter Config Builder"
      copyText={result.value ?? undefined}
      resultsLabel="PARAMETER CATALOG"
      previewLabel="GENERATED SNIPPET"
      configPanel={
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div>
            <p className="mb-2 text-sm font-medium">Change type</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={mode === 'temporary' ? 'default' : 'outline'} onClick={() => setMode('temporary')}>
                Temporary
              </Button>
              <Button type="button" size="sm" variant={mode === 'permanent' ? 'default' : 'outline'} onClick={() => setMode('permanent')}>
                Permanent
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Temporary applies now via sysctl -w and is lost on reboot. Permanent writes a sysctl.d snippet applied
              with sysctl -p / --system.
            </p>
          </div>

          <div>
            <p className="mb-1 text-sm font-medium">Presets</p>
            <p className="mb-2 text-xs text-muted-foreground">{kSysctlPresetCaveat}</p>
            <div className="flex flex-wrap gap-2">
              {kSysctlPresets.map((preset) => (
                <Button key={preset.id} type="button" size="sm" variant="outline" title={preset.description} onClick={() => applyPreset(preset.id)}>
                  {preset.name}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sysctl-search">Search parameters</Label>
            <Input
              id="sysctl-search"
              placeholder={`Search ${kSysctlParameterCatalog.length} parameters by key or description…`}
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
              {selectedCount} parameter{selectedCount === 1 ? '' : 's'} selected — only these appear in the output
            </p>
            {selectedCount > 0 ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedValues({})}>
                Clear
              </Button>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            {sysctlParameterCategoryValues.map((category) => {
              const params = kSysctlParameterCatalog.filter((p) => p.category === category && matches(p))
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
                    <span className="flex-1 text-sm font-semibold">{sysctlParameterCategoryLabel(category)}</span>
                    <span className="text-xs text-muted-foreground">{params.length}</span>
                    {selectedInCategory > 0 ? <Badge variant="secondary">{selectedInCategory}</Badge> : null}
                  </button>
                  {isOpen ? (
                    <div className="flex flex-col gap-3 border-t border-border/60 px-3 py-3">
                      {params.map((parameter) => (
                        <ParameterRow
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
            {q.length > 0 && sysctlParameterCategoryValues.every((c) => kSysctlParameterCatalog.filter((p) => p.category === c && matches(p)).length === 0) ? (
              <p className="py-4 text-sm text-muted-foreground">No parameters match "{query}".</p>
            ) : null}
          </div>
        </div>
      }
      previewPanel={
        result.error ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : (
          <pre className="max-w-full overflow-x-auto whitespace-pre rounded-lg border border-border/60 bg-background p-4 font-mono text-xs">
            {result.value}
          </pre>
        )
      }
    />
  )
}

function ParameterRow({
  parameter,
  checked,
  value,
  onToggle,
  onChange,
}: {
  parameter: SysctlParameter
  checked: boolean
  value: string
  onToggle: (checked: boolean) => void
  onChange: (value: string) => void
}) {
  const options = sysctlEffectiveOptions(parameter)

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
                <SelectValue placeholder="Select a value" />
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
