import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import {
  LINE_OPERATIONS,
  LINE_OPERATION_LABELS,
  TEXT_CASES,
  TEXT_CASE_META,
  TextTransformer,
  type LineOperation,
  type TextCase,
  type TextTransformResult,
} from '@/core/utility/textTransformer'

const transformer = new TextTransformer()

type Category = 'case' | 'slugify' | 'lines'

export function TextTransformerScreen() {
  const [category, setCategory] = useState<Category>('case')
  const [text, setText] = useState('')

  const [targetCase, setTargetCase] = useState<TextCase>('camel')

  const [separator, setSeparator] = useState('-')
  const [slugLowercase, setSlugLowercase] = useState(true)
  const [maxLength, setMaxLength] = useState('')

  const [lineOperation, setLineOperation] = useState<LineOperation>('sort')
  const [sortDescending, setSortDescending] = useState(false)
  const [caseInsensitive, setCaseInsensitive] = useState(false)
  const [natural, setNatural] = useState(false)
  const [numberStart, setNumberStart] = useState('1')
  const [numberSeparator, setNumberSeparator] = useState('. ')
  const [padNumbers, setPadNumbers] = useState(true)

  const result = useMemo((): { value: TextTransformResult | null; error: string | null } => {
    if (text.length === 0) return { value: null, error: null }
    try {
      let value: TextTransformResult
      if (category === 'case') {
        value = transformer.convertCase(text, targetCase)
      } else if (category === 'slugify') {
        const trimmedMax = maxLength.trim()
        const parsedMax = trimmedMax.length === 0 ? undefined : Number(trimmedMax)
        value = transformer.slugify(text, {
          separator,
          lowercase: slugLowercase,
          maxLength: parsedMax !== undefined && parsedMax >= 1 ? parsedMax : undefined,
        })
      } else {
        value = transformer.runLineOperation({
          text,
          operation: lineOperation,
          descending: sortDescending,
          caseInsensitive,
          natural,
          startNumber: Number(numberStart.trim()) || 1,
          numberSeparator,
          padNumbers,
        })
      }
      return { value, error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [text, category, targetCase, separator, slugLowercase, maxLength, lineOperation, sortDescending, caseInsensitive, natural, numberStart, numberSeparator, padNumbers])

  return (
    <ToolDetailScaffold
      title="Text Case / Slug / Line Tools"
      copyText={result.value && result.value.output.length > 0 ? result.value.output : undefined}
      inputPanel={
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">Source text</p>
            <Textarea
              className="min-h-48 font-mono text-xs"
              placeholder="Type or paste text here"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">Operation</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={category === 'case' ? 'default' : 'outline'} onClick={() => setCategory('case')}>
                Case
              </Button>
              <Button type="button" size="sm" variant={category === 'slugify' ? 'default' : 'outline'} onClick={() => setCategory('slugify')}>
                Slugify
              </Button>
              <Button type="button" size="sm" variant={category === 'lines' ? 'default' : 'outline'} onClick={() => setCategory('lines')}>
                Lines
              </Button>
            </div>
          </div>

          {category === 'case' ? (
            <div className="flex flex-col gap-1.5">
              <Label>Target case</Label>
              <Select value={targetCase} onValueChange={(v) => setTargetCase((v as TextCase | null) ?? 'camel')}>
                <SelectTrigger className="w-full" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEXT_CASES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {TEXT_CASE_META[c].label} · {TEXT_CASE_META[c].example}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {category === 'slugify' ? (
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="separator">Separator</Label>
                  <Input id="separator" value={separator} onChange={(e) => setSeparator(e.target.value)} />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="max-length">Max length (optional)</Label>
                  <Input
                    id="max-length"
                    type="number"
                    min={1}
                    value={maxLength}
                    onChange={(e) => setMaxLength(e.target.value)}
                  />
                </div>
              </div>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Lowercase</span>
                <Switch checked={slugLowercase} onCheckedChange={setSlugLowercase} />
              </label>
              <p className="text-xs text-muted-foreground">Accented letters are folded to ASCII (é → e) before slugifying.</p>
            </div>
          ) : null}

          {category === 'lines' ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Line operation</Label>
                <Select value={lineOperation} onValueChange={(v) => setLineOperation((v as LineOperation | null) ?? 'sort')}>
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LINE_OPERATIONS.map((op) => (
                      <SelectItem key={op} value={op}>
                        {LINE_OPERATION_LABELS[op]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {lineOperation === 'sort' ? (
                <>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>Descending</span>
                    <Switch checked={sortDescending} onCheckedChange={setSortDescending} />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>Case-insensitive</span>
                    <Switch checked={caseInsensitive} onCheckedChange={setCaseInsensitive} />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>Natural order (item2 before item10)</span>
                    <Switch checked={natural} onCheckedChange={setNatural} />
                  </label>
                </>
              ) : null}

              {lineOperation === 'deduplicate' ? (
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>Case-insensitive</span>
                  <Switch checked={caseInsensitive} onCheckedChange={setCaseInsensitive} />
                </label>
              ) : null}

              {lineOperation === 'number' ? (
                <>
                  <div className="flex gap-3">
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Label htmlFor="number-start">Start at</Label>
                      <Input id="number-start" type="number" value={numberStart} onChange={(e) => setNumberStart(e.target.value)} />
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Label htmlFor="number-separator">Separator</Label>
                      <Input id="number-separator" value={numberSeparator} onChange={(e) => setNumberSeparator(e.target.value)} />
                    </div>
                  </div>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>Pad numbers (right-align)</span>
                    <Switch checked={padNumbers} onCheckedChange={setPadNumbers} />
                  </label>
                </>
              ) : null}
            </div>
          ) : null}

          {result.error ? (
            <Alert variant="destructive">
              <AlertDescription>{result.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      }
      outputPanel={
        result.value == null ? (
          <p className="text-sm text-muted-foreground">Type some text on the left to see the transformed output here.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              {result.value.lineCount} line{result.value.lineCount === 1 ? '' : 's'}
            </p>
            <pre className="max-h-80 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-background p-4 font-mono text-xs">
              {result.value.output.length === 0 ? '(no output)' : result.value.output}
            </pre>
          </div>
        )
      }
    />
  )
}
