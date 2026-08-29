import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { FileDropField } from '@/adapters/ui/FileDropField'
import { downloadBlob } from '@/lib/downloadFile'
import {
  Base64FileDecoder,
  Base64FileEncoder,
  extensionForMimeType,
  guessMimeType,
  type Base64FileDecodeResult,
  type Base64FileEncodeResult,
  type Base64Wrapping,
} from '@/core/utility/base64FileConverter'

const encoder = new Base64FileEncoder()
const decoder = new Base64FileDecoder()

type Direction = 'encode' | 'decode'

interface BinaryFile {
  bytes: Uint8Array
  name: string
  size: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const WRAPPING_LABELS: Record<Base64Wrapping, string> = {
  plain: 'Plain',
  dataUri: 'Data URI',
  k8sSecret: 'K8s Secret',
}

export function Base64FileScreen() {
  const [direction, setDirection] = useState<Direction>('encode')

  const [encodeText, setEncodeText] = useState('')
  const [encodeFile, setEncodeFile] = useState<BinaryFile | null>(null)
  const [wrapping, setWrapping] = useState<Base64Wrapping>('plain')
  const [mimeType, setMimeType] = useState('')
  const [secretName, setSecretName] = useState('my-secret')
  const [secretKey, setSecretKey] = useState('file')

  const [decodeText, setDecodeText] = useState('')

  const encodeResult = useMemo((): { value: Base64FileEncodeResult | null; error: string | null } => {
    const bytes = encodeFile ? encodeFile.bytes : new TextEncoder().encode(encodeText)
    if (bytes.length === 0) return { value: null, error: null }
    try {
      const value = encoder.execute({
        bytes,
        wrapping,
        mimeType: mimeType.trim().length === 0 ? undefined : mimeType.trim(),
        secretName: secretName.trim().length === 0 ? 'my-secret' : secretName.trim(),
        secretKey: secretKey.trim().length === 0 ? 'file' : secretKey.trim(),
      })
      return { value, error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [encodeText, encodeFile, wrapping, mimeType, secretName, secretKey])

  const decodeResult = useMemo((): { value: Base64FileDecodeResult | null; error: string | null } => {
    if (decodeText.trim().length === 0) return { value: null, error: null }
    try {
      return { value: decoder.execute({ text: decodeText }), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [decodeText])

  function downloadDecoded() {
    const value = decodeResult.value
    if (!value) return
    const extension = extensionForMimeType(value.mimeType)
    downloadBlob(value.bytes.slice(), `decoded.${extension}`, value.mimeType ?? 'application/octet-stream')
  }

  const copyText = direction === 'encode' ? encodeResult.value?.output : undefined
  const error = direction === 'encode' ? encodeResult.error : decodeResult.error

  return (
    <ToolDetailScaffold
      title="Base64 File Encoder / Decoder"
      copyText={copyText}
      inputPanel={
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">Direction</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={direction === 'encode' ? 'default' : 'outline'} onClick={() => setDirection('encode')}>
                Encode (→ Base64)
              </Button>
              <Button type="button" size="sm" variant={direction === 'decode' ? 'default' : 'outline'} onClick={() => setDirection('decode')}>
                Decode (Base64 → file)
              </Button>
            </div>
          </div>

          {direction === 'encode' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="encode-source">Source</Label>
                <p className="text-xs text-muted-foreground">
                  Paste text (encoded as UTF-8) or drop any file — a binary file is kept as raw bytes.
                </p>
                <FileDropField
                  id="encode-source"
                  rows={14}
                  className="font-mono text-xs"
                  placeholder="Paste text to encode, or drop a file"
                  maxBytes={64 * 1024 * 1024}
                  value={encodeText}
                  onChange={setEncodeText}
                  onBinaryFile={(f) => {
                    setEncodeFile(f)
                    setMimeType(guessMimeType(f.name))
                  }}
                  binaryFile={encodeFile ? { name: encodeFile.name, size: encodeFile.size } : null}
                  onClearBinary={() => setEncodeFile(null)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Output form</Label>
                <Select value={wrapping} onValueChange={(v) => setWrapping((v as Base64Wrapping | null) ?? 'plain')}>
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(WRAPPING_LABELS) as Base64Wrapping[]).map((w) => (
                      <SelectItem key={w} value={w}>
                        {WRAPPING_LABELS[w]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {wrapping === 'dataUri' ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="mime-type">MIME type</Label>
                  <Input id="mime-type" value={mimeType} onChange={(e) => setMimeType(e.target.value)} />
                </div>
              ) : null}

              {wrapping === 'k8sSecret' ? (
                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="secret-name">Secret name</Label>
                    <Input id="secret-name" value={secretName} onChange={(e) => setSecretName(e.target.value)} />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="secret-key">Data key</Label>
                    <Input id="secret-key" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} />
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="decode-input">Base64 input</Label>
              <p className="text-xs text-muted-foreground">
                Plain Base64 or a data: URI. Line breaks, missing padding and the URL-safe alphabet are all fine.
                Drop a file that contains the Base64, or paste it.
              </p>
              <FileDropField
                id="decode-input"
                accept=".txt,.b64,.base64,.pem,.crt,.cer"
                rows={16}
                className="font-mono text-xs"
                placeholder="Paste Base64 or a data URI here"
                maxBytes={64 * 1024 * 1024}
                value={decodeText}
                onChange={setDecodeText}
              />
            </div>
          )}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      }
      outputPanel={
        direction === 'encode' ? (
          encodeResult.value == null ? (
            <p className="text-sm text-muted-foreground">Add a source on the left to see its Base64 form here.</p>
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                <span className="text-muted-foreground">Source size</span>
                <span className="text-right font-mono">{formatBytes(encodeResult.value.byteSize)}</span>
                <span className="text-muted-foreground">Encoded length</span>
                <span className="text-right font-mono">{encodeResult.value.encodedLength} chars</span>
              </div>
              <pre className="min-h-64 w-full flex-1 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-background p-4 font-mono text-xs">
                {encodeResult.value.output}
              </pre>
            </div>
          )
        ) : decodeResult.value == null ? (
          <p className="text-sm text-muted-foreground">Paste Base64 on the left to decode it back into file bytes here.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              <span className="text-muted-foreground">Decoded size</span>
              <span className="text-right font-mono">{formatBytes(decodeResult.value.byteSize)}</span>
              {decodeResult.value.mimeType ? (
                <>
                  <span className="text-muted-foreground">MIME type</span>
                  <span className="text-right font-mono">{decodeResult.value.mimeType}</span>
                </>
              ) : null}
            </div>
            <Button type="button" onClick={downloadDecoded} className="w-fit gap-1.5">
              <Download className="size-4" />
              Download decoded file
            </Button>
          </div>
        )
      }
    />
  )
}
