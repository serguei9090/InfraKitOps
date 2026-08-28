import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { ConfigValidateButton } from '@/adapters/ui/config/ConfigValidateButton'
import {
  DirectiveCatalogEditor,
  type CatalogGroup,
  type CatalogItem,
  type CatalogPreset,
} from '@/adapters/ui/config/DirectiveCatalogEditor'
import {
  SysctlConfigBuilder,
  kSysctlParameterCatalog,
  kSysctlPresetCaveat,
  kSysctlPresets,
  sysctlParameterCategoryLabel,
  sysctlParameterCategoryValues,
  sysctlResolvePreset,
  type OutputMode,
  type SysctlParameter,
} from '@/core/tuning/sysctlConfigBuilder'

const builder = new SysctlConfigBuilder()

const GROUPS: CatalogGroup[] = sysctlParameterCategoryValues.map((c) => ({
  id: c,
  label: sysctlParameterCategoryLabel(c),
}))

function itemFor(p: SysctlParameter): CatalogItem {
  return {
    key: p.key,
    group: p.category,
    label: p.label,
    description: p.description,
    seedValue: p.defaultValue,
    meta: p.kernelNote,
    warning: p.riskNote,
    control:
      p.kind === 'boolean'
        ? { kind: 'toggle' }
        : p.kind === 'enumerated'
          ? { kind: 'select', choices: p.options }
          : { kind: 'text', numeric: p.kind === 'integer', placeholder: p.defaultValue },
  }
}

const ITEMS: CatalogItem[] = kSysctlParameterCatalog.map(itemFor)

const PRESETS: CatalogPreset[] = kSysctlPresets.map((preset) => ({
  id: preset.id,
  label: preset.name,
  description: preset.description,
  values: sysctlResolvePreset(preset),
}))

export function SysctlConfigBuilderScreen() {
  const [mode, setMode] = useState<OutputMode>('permanent')
  const [values, setValues] = useState<Record<string, string>>({})

  const result = useMemo(() => {
    try {
      return { value: builder.execute({ selectedValues: values, mode }), error: null as string | null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [values, mode])

  return (
    <ToolDetailScaffold
      title="Kernel Parameter Config Builder"
      copyText={result.value ?? undefined}
      inputPanel={
        <DirectiveCatalogEditor
          groups={GROUPS}
          items={ITEMS}
          values={values}
          onChange={setValues}
          presets={PRESETS}
          searchPlaceholder={`Search ${ITEMS.length} parameters by key or description…`}
          defaultOpenGroups={['memoryManagement']}
          toolbar={
            <div className="flex flex-col gap-2">
              <div>
                <p className="mb-2 text-sm font-medium">Change type</p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === 'temporary' ? 'default' : 'outline'}
                    onClick={() => setMode('temporary')}
                  >
                    Temporary
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === 'permanent' ? 'default' : 'outline'}
                    onClick={() => setMode('permanent')}
                  >
                    Permanent
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Temporary applies now via <span className="font-mono">sysctl -w</span> and is lost on reboot. Permanent
                  writes a <span className="font-mono">sysctl.d</span> snippet applied with{' '}
                  <span className="font-mono">sysctl --system</span>.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">{kSysctlPresetCaveat}</p>
            </div>
          }
        />
      }
      outputPanel={
        result.error ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-background p-4 font-mono text-xs">
              {result.value}
            </pre>
            {mode === 'permanent' && result.value ? <ConfigValidateButton kind="sysctl" text={result.value} /> : null}
          </div>
        )
      }
    />
  )
}
