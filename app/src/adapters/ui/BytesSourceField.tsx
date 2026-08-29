import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/**
 * A byte-input that the user fills EITHER by typing/pasting text OR by
 * uploading a file — a "Paste text ⇄ Upload file" toggle over a `<Textarea>`
 * and a drop zone. Emits a `BytesSource` discriminated union so the consumer
 * can turn it into raw bytes with `bytesSourceToBytes()`.
 *
 * Companion to `FileDropField` (text-only, for inputs that are always a
 * pasted document). Use this one for tools whose input is arbitrary bytes:
 * Base64 file encode, and later GZip / hashing.
 */

export type BytesSource =
  | { kind: 'text'; text: string }
  | { kind: 'file'; bytes: Uint8Array; name: string; size: number }

export const EMPTY_BYTES_SOURCE: BytesSource = { kind: 'text', text: '' }

export function bytesSourceIsEmpty(src: BytesSource): boolean {
  return src.kind === 'text' ? src.text.trim().length === 0 : src.bytes.length === 0
}

/** UTF-8-encodes the text case; passes file bytes straight through. */
export function bytesSourceToBytes(src: BytesSource): Uint8Array {
  return src.kind === 'text' ? new TextEncoder().encode(src.text) : src.bytes
}

interface BytesSourceFieldProps {
  value: BytesSource
  onChange: (next: BytesSource) => void
  /** `accept` attribute for the file picker, e.g. `.png,.pdf`. */
  accept?: string
  textPlaceholder?: string
  rows?: number
  /** Extra classes for the inner `<textarea>`. */
  className?: string
  id?: string
  /** Files larger than this are rejected with a message. Default 25 MiB. */
  maxBytes?: number
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024
const EMPTY_FILE: BytesSource = { kind: 'file', bytes: new Uint8Array(), name: '', size: 0 }

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export function BytesSourceField({
  value,
  onChange,
  accept,
  textPlaceholder,
  rows = 12,
  className,
  id,
  maxBytes = DEFAULT_MAX_BYTES,
}: BytesSourceFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'text' | 'file'>(value.kind)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Remember the side we're not showing so a toggle doesn't discard input.
  const textStash = useRef(value.kind === 'text' ? value.text : '')
  const fileStash = useRef<BytesSource | null>(value.kind === 'file' ? value : null)

  function switchTo(next: 'text' | 'file') {
    if (next === mode) return
    if (value.kind === 'text') textStash.current = value.text
    else fileStash.current = value
    setError(null)
    setMode(next)
    onChange(next === 'text' ? { kind: 'text', text: textStash.current } : (fileStash.current ?? EMPTY_FILE))
  }

  async function load(file: File) {
    if (file.size > maxBytes) {
      setError(
        `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MiB — over the ${Math.round(maxBytes / 1024 / 1024)} MiB limit.`,
      )
      return
    }
    setError(null)
    try {
      const buffer = await file.arrayBuffer()
      onChange({ kind: 'file', bytes: new Uint8Array(buffer), name: file.name, size: file.size })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex w-fit rounded-lg border border-border p-0.5">
        <Button
          type="button"
          size="sm"
          variant={mode === 'text' ? 'default' : 'ghost'}
          onClick={() => switchTo('text')}
        >
          Paste text
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'file' ? 'default' : 'ghost'}
          onClick={() => switchTo('file')}
        >
          Upload file
        </Button>
      </div>

      {mode === 'text' ? (
        <Textarea
          id={id}
          rows={rows}
          value={value.kind === 'text' ? value.text : ''}
          onChange={(e) => onChange({ kind: 'text', text: e.target.value })}
          placeholder={textPlaceholder}
          className={cn('font-mono text-xs', className)}
        />
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files?.[0]
            if (f) void load(f)
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors',
            dragOver ? 'border-primary bg-primary/5' : 'border-border/60',
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void load(f)
              e.target.value = ''
            }}
          />
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
            <FileUp className="size-4" />
            Choose file…
          </Button>
          <p className="min-w-0 max-w-full truncate text-xs text-muted-foreground">
            {value.kind === 'file' && value.size > 0 ? (
              <span className="text-foreground">
                {value.name} · {formatBytes(value.size)}
              </span>
            ) : (
              'or drop a file here'
            )}
          </p>
        </div>
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
