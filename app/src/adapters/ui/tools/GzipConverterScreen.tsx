import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { GzipConverter, type GzipConversionResult, type GzipOperation } from '@/core/utility/gzipConverter'

const converter = new GzipConverter()

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function GzipConverterScreen() {
  const [operation, setOperation] = useState<GzipOperation>('compress')
  const [text, setText] = useState('')

  const result = useMemo((): { value: GzipConversionResult | null; error: string | null } => {
    if (text.trim().length === 0) return { value: null, error: null }
    try {
      const value = operation === 'compress' ? converter.compressText(text) : converter.decompressBase64(text)
      return { value, error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [text, operation])

  const copyText =
    result.value == null ? undefined : operation === 'compress' ? result.value.base64 : (result.value.textOrNull ?? result.value.base64)

  const percent = result.value?.spaceSavingPercent ?? 0
  const percentLabel = percent >= 0 ? `${percent.toFixed(1)}% smaller` : `${(-percent).toFixed(1)}% larger`

  return (
    <ToolDetailScaffold
      title="GZip Compressor / Decompressor"
      copyText={copyText}
      inputPanel={
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">Operation</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={operation === 'compress' ? 'default' : 'outline'} onClick={() => setOperation('compress')}>
                Compress
              </Button>
              <Button type="button" size="sm" variant={operation === 'decompress' ? 'default' : 'outline'} onClick={() => setOperation('decompress')}>
                Decompress
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">{operation === 'compress' ? 'Text' : 'Base64-encoded gzip stream'}</p>
            <Textarea
              className="min-h-64 font-mono text-xs"
              placeholder={operation === 'compress' ? 'Type or paste text to compress' : 'Paste a Base64-encoded gzip stream'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          {result.error ? (
            <Alert variant="destructive">
              <AlertDescription>{result.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      }
      outputPanel={
        result.value == null ? (
          <p className="text-sm text-muted-foreground">Provide some input on the left to see the result here.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              <span className="text-muted-foreground">Original</span>
              <span className="text-right font-mono">{formatBytes(result.value.originalSize)}</span>
              <span className="text-muted-foreground">Compressed</span>
              <span className="text-right font-mono">{formatBytes(result.value.compressedSize)}</span>
              <span className="text-muted-foreground">Ratio</span>
              <span className="text-right font-mono">{(result.value.compressionRatio * 100).toFixed(1)}%</span>
              <span className="text-muted-foreground">Change</span>
              <span className="text-right font-mono">{percentLabel}</span>
            </div>

            {operation === 'decompress' ? (
              result.value.textOrNull != null ? (
                <div>
                  <p className="mb-1.5 text-xs text-muted-foreground">Decompressed text</p>
                  <pre className="max-h-64 max-w-full overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-background p-4 font-mono text-xs">
                    {result.value.textOrNull}
                  </pre>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Decompressed payload is {formatBytes(result.value.outputSize)} of binary data — not valid UTF-8 text.
                </p>
              )
            ) : (
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">Base64 (gzip stream)</p>
                <pre className="max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-background p-4 font-mono text-xs">
                  {result.value.base64}
                </pre>
              </div>
            )}
          </div>
        )
      }
    />
  )
}
