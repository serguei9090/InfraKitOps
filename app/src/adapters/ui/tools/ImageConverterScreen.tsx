import { useState } from 'react'
import { Download, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import {
  ImageConverter,
  IMAGE_OUTPUT_FORMATS,
  extensionForFormat,
  labelForFormat,
  percentSaved,
  compressionRatio,
  type ImageConversionResult,
  type ImageOutputFormat,
} from '@/core/office_media/imageConverter'

const converter = new ImageConverter()

interface SourceImage {
  name: string
  bytes: Uint8Array
  objectUrl: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function suggestedOutputName(sourceName: string, extension: string): string {
  const dot = sourceName.lastIndexOf('.')
  const stem = dot > 0 ? sourceName.slice(0, dot) : sourceName
  return `${stem}.${extension}`
}

export function ImageConverterScreen() {
  const [source, setSource] = useState<SourceImage | null>(null)
  const [targetFormat, setTargetFormat] = useState<ImageOutputFormat>('jpeg')
  const [quality, setQuality] = useState(85)
  const [maxWidth, setMaxWidth] = useState('')
  const [maxHeight, setMaxHeight] = useState('')

  const [converting, setConverting] = useState(false)
  const [result, setResult] = useState<ImageConversionResult | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFilePicked(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    if (source) URL.revokeObjectURL(source.objectUrl)
    if (resultUrl) URL.revokeObjectURL(resultUrl)
    setSource({ name: file.name, bytes, objectUrl: URL.createObjectURL(file) })
    setResult(null)
    setResultUrl(null)
    setError(null)
  }

  function parsePositiveInt(text: string): number | undefined {
    const trimmed = text.trim()
    if (trimmed.length === 0) return undefined
    const value = Number.parseInt(trimmed, 10)
    return Number.isFinite(value) && value > 0 ? value : undefined
  }

  async function handleConvert() {
    if (!source) {
      setError('Load a source image first.')
      return
    }
    setConverting(true)
    setError(null)
    try {
      const value = await converter.execute({
        sourceBytes: source.bytes,
        targetFormat,
        quality: Math.round(quality),
        maxWidth: parsePositiveInt(maxWidth),
        maxHeight: parsePositiveInt(maxHeight),
      })
      if (resultUrl) URL.revokeObjectURL(resultUrl)
      const url = URL.createObjectURL(new Blob([value.outputBytes.slice()]))
      setResult(value)
      setResultUrl(url)
    } catch (e) {
      setResult(null)
      setResultUrl(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setConverting(false)
    }
  }

  function handleDownload() {
    if (!result || !source) return
    const extension = extensionForFormat(result.outputFormat)
    const blob = new Blob([result.outputBytes.slice()], { type: `image/${extension === 'jpg' ? 'jpeg' : extension}` })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = suggestedOutputName(source.name, extension)
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const qualityLabel =
    targetFormat === 'png' ? 'Compression (not applicable)' : `Quality: ${Math.round(quality)}`
  const qualityHint =
    targetFormat === 'png'
      ? 'PNG is always lossless — the browser encoder has no quality/compression-effort knob to trade here.'
      : 'Lower values shrink the file more but lose more detail.'

  return (
    <ToolDetailScaffold
      title="Image Format Converter & Compressor"
      inputPanel={
        <div className="flex max-w-md flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="source-image">Source image</Label>
            <input
              id="source-image"
              type="file"
              accept="image/*"
              className="text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-input file:bg-transparent file:px-2.5 file:py-1 file:text-sm file:font-medium file:text-foreground"
              onChange={(e) => void handleFilePicked(e.target.files)}
            />
            {source ? (
              <p className="text-xs text-muted-foreground">
                {source.name} · {formatBytes(source.bytes.byteLength)}
              </p>
            ) : null}
          </div>

          {source ? (
            <img
              src={source.objectUrl}
              alt="Source preview"
              className="h-36 w-full rounded-lg border border-border/60 object-contain"
            />
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label>Target format</Label>
            <Select
              value={targetFormat}
              onValueChange={(v) => setTargetFormat((v as ImageOutputFormat | null) ?? 'jpeg')}
            >
              <SelectTrigger className="w-full" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_OUTPUT_FORMATS.map((format) => (
                  <SelectItem key={format} value={format}>
                    {labelForFormat(format)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{qualityLabel}</Label>
            <p className="text-xs text-muted-foreground">{qualityHint}</p>
            <Slider
              value={quality}
              min={1}
              max={100}
              step={1}
              disabled={targetFormat === 'png'}
              onValueChange={(v) => setQuality(v as number)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">Resize (optional)</p>
            <p className="text-xs text-muted-foreground">
              Leave blank to keep the original size. Aspect ratio is always preserved.
            </p>
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="max-width">Max width (px)</Label>
                <Input
                  id="max-width"
                  type="number"
                  min={1}
                  value={maxWidth}
                  onChange={(e) => setMaxWidth(e.target.value)}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="max-height">Max height (px)</Label>
                <Input
                  id="max-height"
                  type="number"
                  min={1}
                  value={maxHeight}
                  onChange={(e) => setMaxHeight(e.target.value)}
                />
              </div>
            </div>
          </div>

          <Button type="button" onClick={() => void handleConvert()} disabled={converting} className="w-fit gap-1.5">
            <Wand2 className="size-4" />
            {converting ? 'Converting…' : 'Convert'}
          </Button>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      }
      outputPanel={
        result == null || resultUrl == null ? (
          <p className="text-sm text-muted-foreground">
            Load a source image and press &quot;Convert&quot; to see the result here.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <img
              src={resultUrl}
              alt="Converted preview"
              className="h-36 w-full rounded-lg border border-border/60 object-contain"
            />

            <div className="rounded-lg border border-border/60 p-3">
              <StatRow
                label="Dimensions"
                value={`${result.sourceWidth}×${result.sourceHeight} → ${result.outputWidth}×${result.outputHeight}`}
              />
              <StatRow label="Before" value={formatBytes(result.sourceByteSize)} />
              <StatRow label="After" value={formatBytes(result.outputByteSize)} />
              <StatRow
                label="Change"
                value={
                  percentSaved(result) >= 0
                    ? `${percentSaved(result).toFixed(1)}% smaller`
                    : `${Math.abs(percentSaved(result)).toFixed(1)}% larger`
                }
              />
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${Math.min(1, Math.max(0, compressionRatio(result))) * 100}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Output is {(compressionRatio(result) * 100).toFixed(0)}% of the original size
              </p>
            </div>

            <Button type="button" onClick={handleDownload} className="w-fit gap-1.5">
              <Download className="size-4" />
              Download .{extensionForFormat(result.outputFormat)}
            </Button>
          </div>
        )
      }
    />
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  )
}
