import { useRef, useState, type ReactNode } from 'react'
import { FileArchive, FileUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/**
 * A text input that also accepts a file — "Choose file…" button plus a
 * drop-anywhere-on-the-textarea zone. Reads the file as text into `value`,
 * shows its name, and clears the name the moment the text is edited by hand.
 *
 * Used by the tools whose primary input is a pasted document (JSON/YAML
 * tree viewer, Formatters, Data Converter, JSONPath, JSON→CSV, Text Diff,
 * FormFlow, Base64 decode).
 *
 * Tools whose input can also be a *binary* file (Base64 encode) pass
 * `onBinaryFile` / `binaryFile` / `onClearBinary`: a dropped file that is
 * not valid UTF-8 text is handed over as raw bytes and the textbox is
 * replaced by a file chip, so the same control covers both cases without a
 * mode toggle.
 */

function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192)
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return false
  } catch {
    return true
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

interface FileDropFieldProps {
  value: string
  onChange: (text: string) => void
  /** `accept` attribute, e.g. `.json,.yaml,.yml`. */
  accept?: string
  placeholder?: string
  rows?: number
  /** Extra classes for the inner `<textarea>`. */
  className?: string
  id?: string
  'aria-label'?: string
  /** Files larger than this are rejected with a message. Default 10 MiB. */
  maxBytes?: number
  /** Called with the loaded file's name, and `null` when the text is edited by hand. */
  onFileName?: (name: string | null) => void
  /** Controls rendered on the button row, right of the file-name text (e.g. a format Select). */
  toolbar?: ReactNode
  buttonLabel?: string
  /**
   * Enables binary handling. A chosen/dropped file that is not valid UTF-8
   * text is passed here as raw bytes instead of being decoded into `value`.
   */
  onBinaryFile?: (file: { bytes: Uint8Array; name: string; size: number }) => void
  /** Non-null renders a file chip (name · size · Clear) in place of the textbox. */
  binaryFile?: { name: string; size: number } | null
  onClearBinary?: () => void
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

export function FileDropField({
  value,
  onChange,
  accept,
  placeholder,
  rows = 12,
  className,
  id,
  'aria-label': ariaLabel,
  maxBytes = DEFAULT_MAX_BYTES,
  onFileName,
  toolbar,
  buttonLabel = 'Choose file…',
  onBinaryFile,
  binaryFile,
  onClearBinary,
}: FileDropFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setLoadedName(next: string | null) {
    setName(next)
    onFileName?.(next)
  }

  function load(file: File) {
    if (file.size > maxBytes) {
      setError(
        `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MiB — over the ${Math.round(maxBytes / 1024 / 1024)} MiB limit.`,
      )
      return
    }
    setError(null)

    if (onBinaryFile) {
      file
        .arrayBuffer()
        .then((buffer) => {
          const bytes = new Uint8Array(buffer)
          if (looksBinary(bytes)) {
            onBinaryFile({ bytes, name: file.name, size: file.size })
          } else {
            onClearBinary?.()
            onChange(new TextDecoder().decode(bytes))
            setLoadedName(file.name)
          }
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      return
    }

    file
      .text()
      .then((text) => {
        onChange(text)
        setLoadedName(file.name)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) load(f)
            e.target.value = ''
          }}
        />
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
          <FileUp className="size-4" />
          {buttonLabel}
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {binaryFile ? (
            'binary file loaded'
          ) : name ? (
            <span className="text-foreground">{name}</span>
          ) : (
            'or drop a file / paste below'
          )}
        </span>
        {toolbar}
      </div>

      {binaryFile ? (
        <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
          <FileArchive className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{binaryFile.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(binaryFile.size)} · binary — using raw bytes
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onClearBinary?.()}>
            Clear
          </Button>
        </div>
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
            if (f) load(f)
          }}
          className={cn(
            'rounded-lg border border-dashed transition-colors',
            dragOver ? 'border-primary bg-primary/5' : 'border-border/60',
          )}
        >
          <Textarea
            id={id}
            aria-label={ariaLabel}
            rows={rows}
            value={value}
            onChange={(e) => {
              onChange(e.target.value)
              if (name) setLoadedName(null)
              if (error) setError(null)
            }}
            placeholder={dragOver ? 'Drop to load the file…' : placeholder}
            className={cn('border-0 bg-transparent focus-visible:ring-0', className)}
          />
        </div>
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
