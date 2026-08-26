import { useState, useMemo } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { DataFormatConverter, type DataFormat } from '@/core/utility/dataFormatConverter'
import { Base64Converter, type Base64Operation } from '@/core/utility/base64Converter'
import { WebEncoder, type WebEncodingOperation } from '@/core/utility/webEncoders'
import {
  RadixConverter,
  RomanNumeralConverter,
  TimestampConverter,
  type NumberBase,
  type RomanNumeralOperation,
  type EpochUnit,
  type TimestampDirection,
} from '@/core/utility/radixDateConverter'

const dataFormatConverter = new DataFormatConverter()
const base64Converter = new Base64Converter()
const webEncoder = new WebEncoder()
const radixConverter = new RadixConverter()
const romanConverter = new RomanNumeralConverter()
const timestampConverter = new TimestampConverter()

const DATA_FORMATS: { value: DataFormat; label: string }[] = [
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'toml', label: 'TOML' },
  { value: 'xml', label: 'XML' },
]

const NUMBER_BASES: { value: NumberBase; label: string }[] = [
  { value: 'binary', label: 'Binary' },
  { value: 'octal', label: 'Octal' },
  { value: 'decimal', label: 'Decimal' },
  { value: 'hexadecimal', label: 'Hexadecimal' },
]

type ConverterTab = 'dataFormat' | 'base64' | 'url' | 'html' | 'radix' | 'roman' | 'timestamp'

const TAB_LABELS: Record<ConverterTab, string> = {
  dataFormat: 'Data Format',
  base64: 'Base64',
  url: 'URL',
  html: 'HTML Entities',
  radix: 'Radix',
  roman: 'Roman Numeral',
  timestamp: 'Epoch ↔ ISO-8601',
}

function errorMessageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Small local segmented-button toggle -- no shadcn equivalent installed. */
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

function OutputBlock({ error, output }: { error: string | null; output: string | undefined }) {
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!output) return <p className="text-sm text-muted-foreground">Output will appear here.</p>
  return (
    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-background p-3 font-mono text-sm">
      {output}
    </pre>
  )
}

export function ConvertersScreen() {
  const [tab, setTab] = useState<ConverterTab>('dataFormat')

  // --- Data format converter (JSON/YAML/TOML/XML) ---
  const [dfSource, setDfSource] = useState('')
  const [dfFrom, setDfFrom] = useState<DataFormat>('json')
  const [dfTo, setDfTo] = useState<DataFormat>('yaml')
  const dfResult = useMemo(() => {
    if (dfSource.trim().length === 0) return { value: null, error: null }
    try {
      return {
        value: dataFormatConverter.execute({ source: dfSource, sourceFormat: dfFrom, targetFormat: dfTo }),
        error: null,
      }
    } catch (e) {
      return { value: null, error: errorMessageOf(e) }
    }
  }, [dfSource, dfFrom, dfTo])

  // --- Base64 ---
  const [b64Text, setB64Text] = useState('')
  const [b64Op, setB64Op] = useState<Base64Operation>('encode')
  const b64Result = useMemo(() => {
    if (b64Text.length === 0) return { value: null, error: null }
    try {
      return { value: base64Converter.execute({ text: b64Text, operation: b64Op }), error: null }
    } catch (e) {
      return { value: null, error: errorMessageOf(e) }
    }
  }, [b64Text, b64Op])

  // --- URL percent-encoding ---
  const [urlText, setUrlText] = useState('')
  const [urlOp, setUrlOp] = useState<WebEncodingOperation>('urlEncode')
  const urlResult = useMemo(() => {
    if (urlText.length === 0) return { value: null, error: null }
    try {
      return { value: webEncoder.execute({ text: urlText, operation: urlOp }), error: null }
    } catch (e) {
      return { value: null, error: errorMessageOf(e) }
    }
  }, [urlText, urlOp])

  // --- HTML entity escaping ---
  const [htmlText, setHtmlText] = useState('')
  const [htmlOp, setHtmlOp] = useState<WebEncodingOperation>('htmlEscape')
  const htmlResult = useMemo(() => {
    if (htmlText.length === 0) return { value: null, error: null }
    try {
      return { value: webEncoder.execute({ text: htmlText, operation: htmlOp }), error: null }
    } catch (e) {
      return { value: null, error: errorMessageOf(e) }
    }
  }, [htmlText, htmlOp])

  // --- Radix ---
  const [radixValue, setRadixValue] = useState('')
  const [radixFrom, setRadixFrom] = useState<NumberBase>('decimal')
  const [radixTo, setRadixTo] = useState<NumberBase>('hexadecimal')
  const radixResult = useMemo(() => {
    if (radixValue.trim().length === 0) return { value: null, error: null }
    try {
      return {
        value: radixConverter.execute({ value: radixValue, fromBase: radixFrom, toBase: radixTo }),
        error: null,
      }
    } catch (e) {
      return { value: null, error: errorMessageOf(e) }
    }
  }, [radixValue, radixFrom, radixTo])

  // --- Roman numeral ---
  const [romanValue, setRomanValue] = useState('')
  const [romanOp, setRomanOp] = useState<RomanNumeralOperation>('toRoman')
  const romanResult = useMemo(() => {
    if (romanValue.trim().length === 0) return { value: null, error: null }
    try {
      return { value: romanConverter.execute({ value: romanValue, operation: romanOp }), error: null }
    } catch (e) {
      return { value: null, error: errorMessageOf(e) }
    }
  }, [romanValue, romanOp])

  // --- Epoch <-> ISO-8601 ---
  const [tsValue, setTsValue] = useState('')
  const [tsDirection, setTsDirection] = useState<TimestampDirection>('epochToIso')
  const [tsUnit, setTsUnit] = useState<EpochUnit>('seconds')
  const tsResult = useMemo(() => {
    if (tsValue.trim().length === 0) return { value: null, error: null }
    try {
      return {
        value: timestampConverter.execute({ value: tsValue, direction: tsDirection, unit: tsUnit }),
        error: null,
      }
    } catch (e) {
      return { value: null, error: errorMessageOf(e) }
    }
  }, [tsValue, tsDirection, tsUnit])

  function activeCopyText(): string | undefined {
    switch (tab) {
      case 'dataFormat':
        return dfResult.value?.output
      case 'base64':
        return b64Result.value?.output
      case 'url':
        return urlResult.value?.output
      case 'html':
        return htmlResult.value?.output
      case 'radix':
        return radixResult.value?.value
      case 'roman':
        return romanResult.value?.value
      case 'timestamp':
        return tsResult.value?.value
    }
  }

  return (
    <ToolDetailScaffold
      title="Converters & Encoders"
      copyText={activeCopyText()}
      inputPanel={
        <div className="flex max-w-xl flex-col gap-5">
          <Tabs value={tab} onValueChange={(v) => setTab((v as ConverterTab) ?? tab)}>
            <TabsList className="h-auto flex-wrap justify-start">
              {(Object.keys(TAB_LABELS) as ConverterTab[]).map((key) => (
                <TabsTrigger key={key} value={key}>
                  {TAB_LABELS[key]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {tab === 'dataFormat' ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label>From</Label>
                  <Select value={dfFrom} onValueChange={(v) => setDfFrom((v as DataFormat) ?? dfFrom)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATA_FORMATS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Swap formats"
                  onClick={() => {
                    setDfFrom(dfTo)
                    setDfTo(dfFrom)
                  }}
                >
                  <ArrowLeftRight className="size-4" />
                </Button>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label>To</Label>
                  <Select value={dfTo} onValueChange={(v) => setDfTo((v as DataFormat) ?? dfTo)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATA_FORMATS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="df-source">Source</Label>
                <Textarea
                  id="df-source"
                  rows={12}
                  className="font-mono text-sm"
                  placeholder="Paste source data here..."
                  value={dfSource}
                  onChange={(e) => setDfSource(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {tab === 'base64' ? (
            <div className="flex flex-col gap-3">
              <SegmentedToggle
                value={b64Op}
                onChange={setB64Op}
                options={[
                  { value: 'encode', label: 'Encode' },
                  { value: 'decode', label: 'Decode' },
                ]}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="b64-text">Text</Label>
                <Textarea
                  id="b64-text"
                  rows={8}
                  className="font-mono text-sm"
                  placeholder="Text or Base64 to convert..."
                  value={b64Text}
                  onChange={(e) => setB64Text(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {tab === 'url' ? (
            <div className="flex flex-col gap-3">
              <SegmentedToggle
                value={urlOp}
                onChange={setUrlOp}
                options={[
                  { value: 'urlEncode', label: 'Encode' },
                  { value: 'urlDecode', label: 'Decode' },
                ]}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="url-text">Text</Label>
                <Textarea
                  id="url-text"
                  rows={6}
                  placeholder="Text or percent-encoded URL..."
                  value={urlText}
                  onChange={(e) => setUrlText(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {tab === 'html' ? (
            <div className="flex flex-col gap-3">
              <SegmentedToggle
                value={htmlOp}
                onChange={setHtmlOp}
                options={[
                  { value: 'htmlEscape', label: 'Escape' },
                  { value: 'htmlUnescape', label: 'Unescape' },
                ]}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="html-text">Text</Label>
                <Textarea
                  id="html-text"
                  rows={6}
                  placeholder="HTML text or entities..."
                  value={htmlText}
                  onChange={(e) => setHtmlText(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {tab === 'radix' ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label>From base</Label>
                  <Select value={radixFrom} onValueChange={(v) => setRadixFrom((v as NumberBase) ?? radixFrom)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NUMBER_BASES.map((b) => (
                        <SelectItem key={b.value} value={b.value}>
                          {b.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Swap bases"
                  onClick={() => {
                    setRadixFrom(radixTo)
                    setRadixTo(radixFrom)
                  }}
                >
                  <ArrowLeftRight className="size-4" />
                </Button>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label>To base</Label>
                  <Select value={radixTo} onValueChange={(v) => setRadixTo((v as NumberBase) ?? radixTo)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NUMBER_BASES.map((b) => (
                        <SelectItem key={b.value} value={b.value}>
                          {b.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="radix-value">Value</Label>
                <Input
                  id="radix-value"
                  className="font-mono"
                  placeholder='Number in the "From base"...'
                  value={radixValue}
                  onChange={(e) => setRadixValue(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {tab === 'roman' ? (
            <div className="flex flex-col gap-3">
              <SegmentedToggle
                value={romanOp}
                onChange={setRomanOp}
                options={[
                  { value: 'toRoman', label: 'Decimal → Roman' },
                  { value: 'toDecimal', label: 'Roman → Decimal' },
                ]}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="roman-value">Value</Label>
                <Input
                  id="roman-value"
                  placeholder={romanOp === 'toRoman' ? 'e.g. 1994' : 'e.g. MCMXCIV'}
                  value={romanValue}
                  onChange={(e) => setRomanValue(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {tab === 'timestamp' ? (
            <div className="flex flex-col gap-3">
              <SegmentedToggle
                value={tsDirection}
                onChange={setTsDirection}
                options={[
                  { value: 'epochToIso', label: 'Epoch → ISO-8601' },
                  { value: 'isoToEpoch', label: 'ISO-8601 → Epoch' },
                ]}
              />
              <SegmentedToggle
                value={tsUnit}
                onChange={setTsUnit}
                options={[
                  { value: 'seconds', label: 'Seconds' },
                  { value: 'milliseconds', label: 'Milliseconds' },
                ]}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ts-value">Value</Label>
                <Input
                  id="ts-value"
                  placeholder={
                    tsDirection === 'epochToIso'
                      ? 'Epoch timestamp, e.g. 1704067200'
                      : 'ISO-8601 timestamp, e.g. 2024-01-01T00:00:00Z'
                  }
                  value={tsValue}
                  onChange={(e) => setTsValue(e.target.value)}
                />
              </div>
            </div>
          ) : null}
        </div>
      }
      outputPanel={
        tab === 'dataFormat' ? (
          <OutputBlock error={dfResult.error} output={dfResult.value?.output} />
        ) : tab === 'base64' ? (
          <OutputBlock error={b64Result.error} output={b64Result.value?.output} />
        ) : tab === 'url' ? (
          <OutputBlock error={urlResult.error} output={urlResult.value?.output} />
        ) : tab === 'html' ? (
          <OutputBlock error={htmlResult.error} output={htmlResult.value?.output} />
        ) : tab === 'radix' ? (
          <OutputBlock error={radixResult.error} output={radixResult.value?.value} />
        ) : tab === 'roman' ? (
          <OutputBlock error={romanResult.error} output={romanResult.value?.value} />
        ) : (
          <OutputBlock error={tsResult.error} output={tsResult.value?.value} />
        )
      }
    />
  )
}
