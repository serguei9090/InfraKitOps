import { useState } from 'react'
import { AlertCircle, CheckCircle2, FileWarning, QrCode as QrCodeIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import {
  QrDecoder,
  formatLabel,
  isDecoded,
  payloadFields,
  payloadKindLabel,
  type QrDecodeResult,
} from '@/core/office_media/qrDecoder'

const decoder = new QrDecoder()

interface SourceFile {
  name: string
  byteSize: number
  objectUrl: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function QrReaderScreen() {
  const [file, setFile] = useState<SourceFile | null>(null)
  const [result, setResult] = useState<QrDecodeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDecoding, setIsDecoding] = useState(false)

  async function handleFilePicked(files: FileList | null) {
    const picked = files?.[0]
    if (!picked) return

    if (file) URL.revokeObjectURL(file.objectUrl)
    setFile({ name: picked.name, byteSize: picked.size, objectUrl: URL.createObjectURL(picked) })
    setError(null)
    setResult(null)
    setIsDecoding(true)

    try {
      const buffer = await picked.arrayBuffer()
      const decoded = await decoder.execute(new Uint8Array(buffer))
      setResult(decoded)
    } catch (e) {
      setResult(null)
      setError(`Could not read this file: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setIsDecoding(false)
    }
  }

  return (
    <ToolDetailScaffold
      title="QR Code Reader"
      copyText={result && isDecoded(result) ? result.text : undefined}
      inputPanel={
        <div className="flex max-w-md flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qr-image-file">Image</Label>
            <input
              id="qr-image-file"
              type="file"
              accept="image/*"
              className="text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-input file:bg-transparent file:px-2.5 file:py-1 file:text-sm file:font-medium file:text-foreground"
              onChange={(e) => void handleFilePicked(e.target.files)}
            />
            <p className="text-xs text-muted-foreground">PNG, JPEG, GIF, BMP or WebP</p>
            {file ? (
              <p className="text-xs text-muted-foreground">
                {file.name} · {formatBytes(file.byteSize)}
              </p>
            ) : null}
          </div>

          {file ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">Preview</p>
              <div className="flex max-h-64 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-background">
                <img src={file.objectUrl} alt="" className="max-h-64 max-w-full object-contain" />
              </div>
            </div>
          ) : null}
        </div>
      }
      outputPanel={<OutputPanel isDecoding={isDecoding} error={error} result={result} hasFile={file != null} />}
    />
  )
}

function OutputPanel({
  isDecoding,
  error,
  result,
  hasFile,
}: {
  isDecoding: boolean
  error: string | null
  result: QrDecodeResult | null
  hasFile: boolean
}) {
  if (isDecoding) {
    return <p className="text-sm text-muted-foreground">Reading image...</p>
  }

  if (error) {
    return <StatusCard icon={AlertCircle} tone="destructive" message={error} />
  }

  if (!result) {
    return hasFile ? null : (
      <p className="text-sm text-muted-foreground">Choose an image on the left to look for a QR code in it.</p>
    )
  }

  if (result.status === 'unreadableImage') {
    return <StatusCard icon={FileWarning} tone="destructive" message={result.message ?? 'This file could not be read as an image.'} />
  }

  if (result.status === 'notFound') {
    return <StatusCard icon={QrCodeIcon} tone="muted" message={result.message ?? 'No QR code was found in this image.'} />
  }

  const payload = result.payload

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary" className="gap-1">
          <CheckCircle2 className="size-3.5" />
          {formatLabel(result)}
        </Badge>
        {result.symbolVersion != null ? <Badge variant="outline">Version {result.symbolVersion}</Badge> : null}
        {result.errorCorrectionLevel ? <Badge variant="outline">EC level {result.errorCorrectionLevel}</Badge> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Decoded text</p>
        <pre className="max-h-48 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-background p-3 font-mono text-xs">
          {result.text}
        </pre>
      </div>

      {payload && payload.kind !== 'plainText' ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">{payloadKindLabel(payload)} details</p>
          <div className="flex flex-col divide-y divide-border/60 rounded-lg border border-border/60 bg-background">
            {payloadFields(payload).map((field) => (
              <div key={field.label} className="flex items-start gap-3 px-3 py-2 text-sm">
                <span className="w-32 shrink-0 text-muted-foreground">{field.label}</span>
                <span className="min-w-0 flex-1 break-all">{field.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">Use the copy button in the top bar to copy the decoded text.</p>
    </div>
  )
}

function StatusCard({
  icon: Icon,
  tone,
  message,
}: {
  icon: typeof AlertCircle
  tone: 'destructive' | 'muted'
  message: string
}) {
  return (
    <div
      className={
        tone === 'destructive'
          ? 'flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive'
          : 'flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/50 p-3 text-sm text-muted-foreground'
      }
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
