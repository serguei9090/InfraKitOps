import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { FileDropField } from '@/adapters/ui/FileDropField'
import {
  TextDiff,
  diffLineMarker,
  diffIsIdentical,
  type DiffMode,
  type TextDiffInput,
  type TextDiffResult,
} from '@/core/utility/textDiff'

const differ = new TextDiff()

const EMPTY_SUMMARY = { added: 0, removed: 0, changed: 0, unchanged: 0 }

export function TextDiffScreen() {
  const [left, setLeft] = useState('')
  const [right, setRight] = useState('')
  const [mode, setMode] = useState<DiffMode>('text')
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false)
  const [ignoreCase, setIgnoreCase] = useState(false)

  const result: TextDiffResult = useMemo(() => {
    const input: TextDiffInput = { left, right, mode, ignoreWhitespace, ignoreCase }
    try {
      return differ.execute(input)
    } catch (e) {
      return {
        isValid: false,
        errorMessage: e instanceof Error ? e.message : String(e),
        lines: [],
        hunks: [],
        summary: EMPTY_SUMMARY,
        warnings: [],
        truncated: false,
      }
    }
  }, [left, right, mode, ignoreWhitespace, ignoreCase])

  const rawCopyText = result.isValid ? result.lines.map((l) => `${diffLineMarker(l)} ${l.text}`).join('\n') : ''

  return (
    <ToolDetailScaffold
      title="Text & JSON Diff"
      copyText={rawCopyText.length > 0 ? rawCopyText : undefined}
      inputPanel={
        <div className="flex max-w-xl flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Mode</Label>
            <div className="inline-flex w-fit rounded-lg border border-border p-0.5">
              <Button type="button" size="sm" variant={mode === 'text' ? 'default' : 'ghost'} onClick={() => setMode('text')}>
                Text
              </Button>
              <Button type="button" size="sm" variant={mode === 'json' ? 'default' : 'ghost'} onClick={() => setMode('json')}>
                JSON (key-order-insensitive)
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={ignoreWhitespace} onCheckedChange={(v) => setIgnoreWhitespace(v === true)} />
              Ignore whitespace
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={ignoreCase} onCheckedChange={(v) => setIgnoreCase(v === true)} />
              Ignore case
            </label>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="diff-left">Left (original)</Label>
            <FileDropField
              id="diff-left"
              rows={10}
              className="font-mono text-sm"
              placeholder="Paste the original text"
              value={left}
              onChange={setLeft}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="diff-right">Right (modified)</Label>
            <FileDropField
              id="diff-right"
              rows={10}
              className="font-mono text-sm"
              placeholder="Paste the modified text"
              value={right}
              onChange={setRight}
            />
          </div>
        </div>
      }
      outputPanel={
        !result.isValid ? (
          <p className="text-sm text-destructive">{result.errorMessage ?? 'Enter text on both sides to compare.'}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {diffIsIdentical(result) ? (
                <span className="flex items-center gap-1.5 font-medium text-green-600 dark:text-green-400">
                  <CheckCircle2 className="size-4" /> Identical
                </span>
              ) : (
                <span className="font-medium">Differences found</span>
              )}
              <span className="font-mono text-primary">+{result.summary.added}</span>
              <span className="font-mono text-destructive">-{result.summary.removed}</span>
              <span className="text-muted-foreground">~{result.summary.changed} changed</span>
              <span className="text-muted-foreground">{result.summary.unchanged} unchanged</span>
            </div>
            {result.warnings.map((w) => (
              <div key={w} className="flex items-start gap-2 rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {w}
              </div>
            ))}
            {diffIsIdentical(result) ? null : (
              <div className="max-h-[520px] overflow-auto rounded-lg border border-border">
                {result.lines.map((line, i) => (
                  <div
                    key={i}
                    className={
                      'flex gap-2 px-2 py-0.5 font-mono text-xs ' +
                      (line.kind === 'added'
                        ? 'bg-primary/10'
                        : line.kind === 'removed'
                          ? 'bg-destructive/10'
                          : '')
                    }
                  >
                    <span className="w-8 shrink-0 text-right text-muted-foreground">{line.leftLineNumber ?? ''}</span>
                    <span className="w-8 shrink-0 text-right text-muted-foreground">{line.rightLineNumber ?? ''}</span>
                    <span className="w-3 shrink-0 font-bold">{diffLineMarker(line)}</span>
                    <span className="whitespace-pre-wrap break-all">{line.text.length === 0 ? ' ' : line.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      }
    />
  )
}
