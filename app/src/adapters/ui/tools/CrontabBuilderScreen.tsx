import { useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import {
  CrontabBuilder,
  cronEvery,
  cronValues,
  cronRange,
  cronStep,
  nowLocalInstant,
  type CronFieldSpec,
  type CronFieldSpecKind,
  type CrontabInstant,
} from '@/core/config/crontabBuilder'

const builder = new CrontabBuilder()

type Mode = 'build' | 'explain'
type ColumnKey = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek'

interface ColumnMeta {
  key: ColumnKey
  label: string
  min: number
  max: number
}

const columns: ColumnMeta[] = [
  { key: 'minute', label: 'Minute', min: 0, max: 59 },
  { key: 'hour', label: 'Hour', min: 0, max: 23 },
  { key: 'dayOfMonth', label: 'Day of month', min: 1, max: 31 },
  { key: 'month', label: 'Month', min: 1, max: 12 },
  { key: 'dayOfWeek', label: 'Day of week', min: 0, max: 7 },
]

interface ColumnState {
  kind: CronFieldSpecKind
  list: string
  rangeStart: string
  rangeEnd: string
  step: string
}

function defaultColumnState(): ColumnState {
  return { kind: 'every', list: '', rangeStart: '', rangeEnd: '', step: '' }
}

const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const monthNames = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function formatRun(instant: CrontabInstant): string {
  const d = instant.date
  // JS getDay(): 0=Sunday..6=Saturday. Convert to Mon-first index for weekdayNames.
  const jsWeekday = instant.isUtc ? d.getUTCDay() : d.getDay()
  const weekday = weekdayNames[(jsWeekday + 6) % 7]
  const month = monthNames[(instant.isUtc ? d.getUTCMonth() : d.getMonth())]
  const day = instant.isUtc ? d.getUTCDate() : d.getDate()
  const year = instant.isUtc ? d.getUTCFullYear() : d.getFullYear()
  const hh = String(instant.isUtc ? d.getUTCHours() : d.getHours()).padStart(2, '0')
  const mm = String(instant.isUtc ? d.getUTCMinutes() : d.getMinutes()).padStart(2, '0')
  return `${weekday}, ${month} ${day} ${year}, ${hh}:${mm}`
}

function specFrom(state: ColumnState, meta: ColumnMeta): CronFieldSpec {
  switch (state.kind) {
    case 'every':
      return cronEvery()

    case 'list': {
      const text = state.list.trim()
      if (text.length === 0) {
        throw new Error(`Enter at least one value for ${meta.label} (e.g. 0,15,30)`)
      }
      const values: number[] = []
      for (const piece of text.split(',')) {
        const token = piece.trim()
        const value = Number(token)
        if (token.length === 0 || Number.isNaN(value)) {
          throw new Error(`"${token}" is not a number in the ${meta.label} list`)
        }
        values.push(value)
      }
      return cronValues(values)
    }

    case 'range': {
      const start = Number(state.rangeStart.trim())
      const end = Number(state.rangeEnd.trim())
      if (state.rangeStart.trim().length === 0 || state.rangeEnd.trim().length === 0 || Number.isNaN(start) || Number.isNaN(end)) {
        throw new Error(`Enter numeric start and end values for the ${meta.label} range`)
      }
      return cronRange(start, end)
    }

    case 'step': {
      const n = Number(state.step.trim())
      if (state.step.trim().length === 0 || Number.isNaN(n)) {
        throw new Error(`Enter a numeric step for ${meta.label} (e.g. 15)`)
      }
      return cronStep(n)
    }

    default:
      // 'rangeStep' is not offered by this screen's picker.
      return cronEvery()
  }
}

export function CrontabBuilderScreen() {
  const [mode, setMode] = useState<Mode>('build')
  const [fields, setFields] = useState<Record<ColumnKey, ColumnState>>(() => {
    const initial = {} as Record<ColumnKey, ColumnState>
    for (const c of columns) initial[c.key] = defaultColumnState()
    return initial
  })
  const [explainText, setExplainText] = useState('0 9 * * 1-5')

  function updateField(key: ColumnKey, patch: Partial<ColumnState>) {
    setFields((s) => ({ ...s, [key]: { ...s[key], ...patch } }))
  }

  const buildResult = useMemo(() => {
    if (mode !== 'build') return { value: null, error: null, fieldErrors: {} as Partial<Record<ColumnKey, string>> }

    const fieldErrors: Partial<Record<ColumnKey, string>> = {}
    const specs = {} as Record<ColumnKey, CronFieldSpec>

    for (const meta of columns) {
      try {
        specs[meta.key] = specFrom(fields[meta.key], meta)
      } catch (e) {
        fieldErrors[meta.key] = e instanceof Error ? e.message : String(e)
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { value: null, error: null, fieldErrors }
    }

    try {
      const value = builder.execute({
        minute: specs.minute,
        hour: specs.hour,
        dayOfMonth: specs.dayOfMonth,
        month: specs.month,
        dayOfWeek: specs.dayOfWeek,
        from: nowLocalInstant(),
      })
      return { value, error: null, fieldErrors }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e), fieldErrors }
    }
  }, [mode, fields])

  const explainResult = useMemo(() => {
    if (mode !== 'explain') return { value: null, error: null }
    const text = explainText.trim()
    if (text.length === 0) return { value: null, error: null }
    try {
      return { value: builder.describe(text, { from: nowLocalInstant() }), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [mode, explainText])

  const result = mode === 'build' ? buildResult.value : explainResult.value
  const globalError = mode === 'build' ? buildResult.error : explainResult.error

  return (
    <ToolDetailScaffold
      title="Crontab Expression Builder"
      copyText={result?.expression}
      inputPanel={
        <div className="flex max-w-md flex-col gap-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === 'build' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('build')}
            >
              Build
            </Button>
            <Button
              type="button"
              variant={mode === 'explain' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('explain')}
            >
              Explain
            </Button>
          </div>

          {mode === 'build' ? (
            <div className="flex flex-col gap-3">
              {columns.map((meta) => (
                <ColumnPicker
                  key={meta.key}
                  meta={meta}
                  state={fields[meta.key]}
                  error={buildResult.fieldErrors[meta.key]}
                  onChange={(patch) => updateField(meta.key, patch)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="explain-expression">Crontab expression</Label>
              <Input
                id="explain-expression"
                className="font-mono"
                value={explainText}
                onChange={(e) => setExplainText(e.target.value)}
                placeholder="e.g. 0 9 * * 1-5 or @daily"
              />
              <p className="text-xs text-muted-foreground">
                Five whitespace-separated fields (minute hour day-of-month month day-of-week), or a shortcut like
                @daily, @hourly, @reboot.
              </p>
            </div>
          )}

          {globalError ? <p className="text-sm text-destructive">{globalError}</p> : null}
        </div>
      }
      outputPanel={
        !result ? (
          <p className="text-sm text-muted-foreground">
            {mode === 'build'
              ? 'Fix the highlighted fields to generate an expression.'
              : 'Paste a crontab expression to explain it.'}
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            <div>
              <p className="text-xs text-muted-foreground">Expression</p>
              <pre className="mt-1.5 rounded-md border border-border/60 bg-muted/40 p-3 font-mono text-sm">
                {result.expression}
              </pre>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Meaning</p>
              <p className="mt-1.5 text-sm">{result.description}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Next 5 run times</p>
              {result.isReboot ? (
                <p className="mt-1.5 text-sm">
                  Runs once at system startup — there is no wall-clock schedule to list.
                </p>
              ) : result.nextRuns.length === 0 ? (
                <p className="mt-1.5 text-sm">This schedule never matches a real calendar date (e.g. Feb 30).</p>
              ) : (
                <div className="mt-1.5 flex flex-col divide-y divide-border/60 rounded-md border border-border/60">
                  {result.nextRuns.map((run, i) => (
                    <p key={i} className="px-3 py-2 font-mono text-sm">
                      {formatRun(run)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      }
    />
  )
}

function ColumnPicker({
  meta,
  state,
  error,
  onChange,
}: {
  meta: ColumnMeta
  state: ColumnState
  error?: string
  onChange: (patch: Partial<ColumnState>) => void
}) {
  return (
    <div className="rounded-md border border-border/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {meta.label} ({meta.min}-{meta.max})
        </p>
        <Select value={state.kind} onValueChange={(value) => onChange({ kind: value as CronFieldSpecKind })}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="every">every</SelectItem>
            <SelectItem value="list">list</SelectItem>
            <SelectItem value="range">range</SelectItem>
            <SelectItem value="step">step</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="mt-2.5">
        {state.kind === 'every' ? (
          <p className="text-xs text-muted-foreground">Matches every {meta.label.toLowerCase()} value.</p>
        ) : state.kind === 'list' ? (
          <Input
            className="font-mono"
            value={state.list}
            onChange={(e) => onChange({ list: e.target.value })}
            placeholder="e.g. 0,15,30"
          />
        ) : state.kind === 'range' ? (
          <div className="flex gap-2">
            <Input
              className="font-mono"
              value={state.rangeStart}
              onChange={(e) => onChange({ rangeStart: e.target.value })}
              placeholder="from"
            />
            <Input
              className="font-mono"
              value={state.rangeEnd}
              onChange={(e) => onChange({ rangeEnd: e.target.value })}
              placeholder="to"
            />
          </div>
        ) : (
          <Input
            className="font-mono"
            value={state.step}
            onChange={(e) => onChange({ step: e.target.value })}
            placeholder="e.g. 15"
          />
        )}
      </div>
      {error ? <p className="mt-1.5 text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
