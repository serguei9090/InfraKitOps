import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { downloadBlob } from '@/lib/downloadFile'
import {
  JsonToCsvConverter,
  CSV_DELIMITERS,
  CSV_LINE_ENDINGS,
  CSV_ARRAY_HANDLING_LABELS,
  type CsvDelimiter,
  type CsvLineEnding,
  type CsvArrayHandling,
} from '@/core/utility/jsonToCsv'

const converter = new JsonToCsvConverter()

const DELIMITERS = Object.keys(CSV_DELIMITERS) as CsvDelimiter[]
const LINE_ENDINGS = Object.keys(CSV_LINE_ENDINGS) as CsvLineEnding[]
const ARRAY_HANDLINGS = Object.keys(CSV_ARRAY_HANDLING_LABELS) as CsvArrayHandling[]

function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="inline-flex w-fit flex-wrap rounded-lg border border-border p-0.5">
      {options.map((opt) => (
        <Button
          key={opt.value}
          type="button"
          size="sm"
          variant={value === opt.value ? 'default' : 'ghost'}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  )
}

export function JsonToCsvScreen() {
  const [json, setJson] = useState('')
  const [delimiter, setDelimiter] = useState<CsvDelimiter>('comma')
  const [lineEnding, setLineEnding] = useState<CsvLineEnding>('crlf')
  const [arrayHandling, setArrayHandling] = useState<CsvArrayHandling>('indexedColumns')
  const [includeHeader, setIncludeHeader] = useState(true)

  const result = useMemo(() => {
    if (json.trim().length === 0) return { value: null, error: null }
    try {
      return {
        value: converter.execute({ json, delimiter, lineEnding, arrayHandling, includeHeader }),
        error: null,
      }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [json, delimiter, lineEnding, arrayHandling, includeHeader])

  function download() {
    if (!result.value) return
    downloadBlob(result.value.csv, 'output.csv', 'text/csv;charset=utf-8')
  }

  return (
    <ToolDetailScaffold
      title="JSON to CSV Converter"
      copyText={result.value?.csv}
      inputPanel={
        <div className="flex max-w-xl flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="json-to-csv-input">JSON input</Label>
            <Textarea
              id="json-to-csv-input"
              rows={14}
              className="font-mono text-sm"
              placeholder='[{"a": 1, "b": 2}, {"a": 3, "b": 4}]'
              value={json}
              onChange={(e) => setJson(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Delimiter</Label>
            <SegmentedToggle
              value={delimiter}
              onChange={setDelimiter}
              options={DELIMITERS.map((d) => ({ value: d, label: CSV_DELIMITERS[d].label }))}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Line ending</Label>
            <SegmentedToggle
              value={lineEnding}
              onChange={setLineEnding}
              options={LINE_ENDINGS.map((l) => ({ value: l, label: CSV_LINE_ENDINGS[l].label }))}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Nested arrays</Label>
            <SegmentedToggle
              value={arrayHandling}
              onChange={setArrayHandling}
              options={ARRAY_HANDLINGS.map((a) => ({ value: a, label: CSV_ARRAY_HANDLING_LABELS[a] }))}
            />
          </div>

          <label className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Include header row</span>
            <Switch checked={includeHeader} onCheckedChange={(v) => setIncludeHeader(v === true)} />
          </label>
        </div>
      }
      outputPanel={
        result.error ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : !result.value ? (
          <p className="text-sm text-muted-foreground">
            Paste a JSON array of objects on the left to see the CSV here.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex gap-6 text-sm">
              <div>
                <span className="text-muted-foreground">Columns </span>
                <span className="font-semibold">{result.value.headers.length}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Rows </span>
                <span className="font-semibold">{result.value.rowCount}</span>
              </div>
            </div>
            <pre className="max-h-80 max-w-full overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs">
              {result.value.csv}
            </pre>
            <Button type="button" className="w-fit gap-1.5" onClick={download}>
              <Download className="size-4" />
              Download .csv
            </Button>
          </div>
        )
      }
    />
  )
}
