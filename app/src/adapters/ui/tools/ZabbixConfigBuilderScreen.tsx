import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { GeneratorScaffold } from '@/adapters/ui/shell/GeneratorScaffold'
import {
  DirectiveCatalogEditor,
  type CatalogGroup,
  type CatalogItem,
} from '@/adapters/ui/config/DirectiveCatalogEditor'
import {
  ZabbixConfigBuilder,
  zabbixCatalogFor,
  zabbixCategoryOrderFor,
  zabbixConfigFileName,
  zabbixParameterCategoryLabel,
  type ZabbixMode,
  type ZabbixParameter,
} from '@/core/config/zabbixConfigBuilder'

const builder = new ZabbixConfigBuilder()

function itemFor(p: ZabbixParameter): CatalogItem {
  return {
    key: p.key,
    group: p.category,
    label: p.label,
    description: p.description,
    seedValue: p.defaultValue,
    warning: p.riskNote,
    control:
      p.kind === 'boolean'
        ? { kind: 'toggle' }
        : p.kind === 'enumerated'
          ? { kind: 'select', choices: p.options }
          : { kind: 'text', numeric: p.kind === 'integer', placeholder: p.defaultValue },
  }
}

export function ZabbixConfigBuilderScreen() {
  const [mode, setMode] = useState<ZabbixMode>('server')
  const [values, setValues] = useState<Record<string, string>>({})

  const groups: CatalogGroup[] = useMemo(
    () => zabbixCategoryOrderFor(mode).map((c) => ({ id: c, label: zabbixParameterCategoryLabel(c) })),
    [mode],
  )
  const items: CatalogItem[] = useMemo(() => zabbixCatalogFor(mode).map(itemFor), [mode])
  const output = useMemo(() => builder.execute({ mode, selectedValues: values }), [mode, values])

  function switchMode(next: ZabbixMode) {
    if (next === mode) return
    setMode(next)
    // Server and agent have separate directive namespaces.
    setValues({})
  }

  return (
    <GeneratorScaffold
      title="Zabbix Config Builder"
      output={{ text: output, fileName: zabbixConfigFileName(mode), mimeType: 'text/plain;charset=utf-8' }}
      formPanel={
        <DirectiveCatalogEditor
          groups={groups}
          items={items}
          values={values}
          onChange={setValues}
          searchPlaceholder={`Search ${items.length} directives by key or description…`}
          defaultOpenGroups={groups.slice(0, 2).map((g) => g.id)}
          toolbar={
            <div>
              <p className="mb-2 text-sm font-medium">Component</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === 'server' ? 'default' : 'outline'}
                  onClick={() => switchMode('server')}
                >
                  Server
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === 'agent' ? 'default' : 'outline'}
                  onClick={() => switchMode('agent')}
                >
                  Client (Agent)
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Server and agent are separate daemons with mostly non-overlapping directives — switching clears the
                current selection.
              </p>
            </div>
          }
        />
      }
    />
  )
}
