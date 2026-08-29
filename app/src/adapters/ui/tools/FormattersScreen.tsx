import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { FileDropField } from '@/adapters/ui/FileDropField'
import { JsonFormatter, type JsonFormatMode } from '@/core/utility/jsonFormatter'
import { XmlFormatter } from '@/core/utility/xmlFormatter'
import { YamlFormatter } from '@/core/utility/yamlFormatter'
import { SqlFormatter } from '@/core/utility/sqlFormatter'

const jsonFormatter = new JsonFormatter()
const xmlFormatter = new XmlFormatter()
const yamlFormatter = new YamlFormatter()
const sqlFormatter = new SqlFormatter()

type FormatKind = 'json' | 'xml' | 'yaml' | 'sql'
// The four formatter core files all share this exact literal-union shape for
// their `mode` field, so one alias covers every one of them.
type Mode = JsonFormatMode

interface FormatResult {
  isValid: boolean
  output?: string
  errorMessage?: string
}

const FORMAT_LABELS: Record<FormatKind, string> = { json: 'JSON', xml: 'XML', yaml: 'YAML', sql: 'SQL' }
const FORMAT_ACCEPT: Record<FormatKind, string> = { json: '.json', xml: '.xml,.svg,.xsd', yaml: '.yaml,.yml', sql: '.sql' }

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'pretty', label: 'Pretty' },
  { value: 'minify', label: 'Minify' },
  { value: 'validate', label: 'Validate' },
]

/** One tab's independent input/mode/result state, driven by its own core formatter. */
function useFormatterState(execute: (source: string, mode: Mode) => FormatResult) {
  const [source, setSource] = useState('')
  const [mode, setMode] = useState<Mode>('pretty')

  const result = useMemo<FormatResult | null>(() => {
    if (source.trim().length === 0) return null
    try {
      return execute(source, mode)
    } catch (e) {
      return { isValid: false, errorMessage: e instanceof Error ? e.message : String(e) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, mode])

  return { source, setSource, mode, setMode, result }
}

export function FormattersScreen() {
  const [tab, setTab] = useState<FormatKind>('json')

  const json = useFormatterState((source, mode) => jsonFormatter.execute({ source, mode }))
  const xml = useFormatterState((source, mode) => xmlFormatter.execute({ source, mode }))
  const yaml = useFormatterState((source, mode) => yamlFormatter.execute({ source, mode }))
  const sql = useFormatterState((source, mode) => sqlFormatter.execute({ source, mode }))

  const active = tab === 'json' ? json : tab === 'xml' ? xml : tab === 'yaml' ? yaml : sql

  const copyText =
    active.result && active.result.isValid && active.mode !== 'validate' ? active.result.output : undefined

  return (
    <ToolDetailScaffold
      title="Formatters"
      copyText={copyText}
      inputPanel={
        <div className="flex max-w-xl flex-col gap-4">
          <Tabs value={tab} onValueChange={(v) => setTab((v as FormatKind) ?? tab)}>
            <TabsList>
              {(Object.keys(FORMAT_LABELS) as FormatKind[]).map((key) => (
                <TabsTrigger key={key} value={key}>
                  {FORMAT_LABELS[key]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="inline-flex w-fit rounded-lg border border-border p-0.5">
            {MODE_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                size="sm"
                variant={active.mode === opt.value ? 'default' : 'ghost'}
                onClick={() => active.setMode(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <FileDropField
            accept={FORMAT_ACCEPT[tab]}
            rows={16}
            className="font-mono text-sm"
            placeholder={`Paste ${FORMAT_LABELS[tab]} here`}
            value={active.source}
            onChange={active.setSource}
          />
        </div>
      }
      outputPanel={
        active.result === null ? (
          <p className="text-sm text-muted-foreground">Output will appear here.</p>
        ) : active.result.isValid ? (
          <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-background p-3 font-mono text-sm">
            {active.result.output}
          </pre>
        ) : (
          <p className="text-sm text-destructive">{active.result.errorMessage}</p>
        )
      }
    />
  )
}
