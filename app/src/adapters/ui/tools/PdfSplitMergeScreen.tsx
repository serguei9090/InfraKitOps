import { useState } from 'react'
import { ArrowDown, ArrowUp, Download, Merge, Scissors, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { StepperWorkspaceScaffold } from '@/adapters/ui/shell/StepperWorkspaceScaffold'
import { PdfMerger, PdfPageExtractor, PdfPageRangeParser } from '@/core/office_media/pdfSplitMerge'
import { PdfInspector } from '@/core/office_media/pdfInspector'

const merger = new PdfMerger()
const extractor = new PdfPageExtractor()
const rangeParser = new PdfPageRangeParser()
const inspector = new PdfInspector()

type Mode = 'merge' | 'split'

interface SourceFile {
  name: string
  bytes: Uint8Array
}

interface ExtractedFile {
  name: string
  bytes: Uint8Array
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

function downloadBytes(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes.slice()], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

async function readFiles(files: FileList): Promise<SourceFile[]> {
  const result: SourceFile[] = []
  for (const file of Array.from(files)) {
    const buffer = await file.arrayBuffer()
    result.push({ name: file.name, bytes: new Uint8Array(buffer) })
  }
  return result
}

export function PdfSplitMergeScreen() {
  const [mode, setMode] = useState<Mode>('merge')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Merge state: sources in merge order.
  const [mergeSources, setMergeSources] = useState<SourceFile[]>([])
  const [mergedResult, setMergedResult] = useState<Uint8Array | null>(null)

  // Split state.
  const [splitSource, setSplitSource] = useState<SourceFile | null>(null)
  const [rangesText, setRangesText] = useState('')
  const [extractedFiles, setExtractedFiles] = useState<ExtractedFile[]>([])

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
  }

  async function handleMergeFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return
    const picked = await readFiles(files)
    setMergeSources((s) => [...s, ...picked])
    setError(null)
    setMergedResult(null)
  }

  function moveMergeSource(index: number, delta: number) {
    setMergeSources((sources) => {
      const target = index + delta
      if (target < 0 || target >= sources.length) return sources
      const next = [...sources]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  function removeMergeSource(index: number) {
    setMergeSources((sources) => sources.filter((_, i) => i !== index))
  }

  async function runMerge() {
    setIsBusy(true)
    setError(null)
    setMergedResult(null)
    try {
      if (mergeSources.length === 0) {
        throw new Error('Add at least one source PDF')
      }
      const merged = await merger.execute(mergeSources.map((f) => f.bytes))
      setMergedResult(merged)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsBusy(false)
    }
  }

  async function handleSplitFilePicked(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    const buffer = await file.arrayBuffer()
    setSplitSource({ name: file.name, bytes: new Uint8Array(buffer) })
    setError(null)
    setExtractedFiles([])
  }

  async function runSplit() {
    setIsBusy(true)
    setError(null)
    setExtractedFiles([])
    try {
      const source = splitSource
      if (source === null) {
        throw new Error('Choose a source PDF first')
      }

      const lines = rangesText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
      if (lines.length === 0) {
        throw new Error('Enter at least one page range, e.g. "1-3,5"')
      }

      const inspection = await inspector.execute({ bytes: source.bytes })
      if (!inspection.isReadable) {
        throw new Error('This file could not be read as a PDF')
      }

      const stem = stemOf(source.name)
      const outputs: ExtractedFile[] = []
      for (let i = 0; i < lines.length; i++) {
        const pageNumbers = rangeParser.parse(lines[i], inspection.pageCount)
        const bytes = await extractor.execute({ bytes: source.bytes, pageNumbers })
        const suffix = lines.length === 1 ? '' : `-${i + 1}`
        outputs.push({ name: `${stem}-extracted${suffix}.pdf`, bytes })
      }
      setExtractedFiles(outputs)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsBusy(false)
    }
  }

  const hasSource = mode === 'merge' ? mergeSources.length > 0 : splitSource != null
  const hasResult = mode === 'merge' ? mergedResult != null : extractedFiles.length > 0
  const activeStep = !hasSource ? 0 : !hasResult ? 1 : 2

  return (
    <StepperWorkspaceScaffold
      title="PDF Split & Merge"
      steps={[{ label: 'Choose Mode & Files' }, { label: 'Configure' }, { label: 'Result & Download' }]}
      activeStep={activeStep}
      builderLabel="SOURCE FILES"
      outputLabel="RESULT"
      builderPanel={
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">Mode</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={mode === 'merge' ? 'default' : 'outline'} onClick={() => switchMode('merge')}>
                <Merge className="size-4" />
                Merge
              </Button>
              <Button type="button" size="sm" variant={mode === 'split' ? 'default' : 'outline'} onClick={() => switchMode('split')}>
                <Scissors className="size-4" />
                Split / Extract
              </Button>
            </div>
          </div>

          {mode === 'merge' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="merge-source-files">Source PDFs, in merge order</Label>
                <p className="text-xs text-muted-foreground">
                  Pick several PDFs at once, or add more later — pages merge top-to-bottom in the order below.
                </p>
                <input
                  id="merge-source-files"
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  className="text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-input file:bg-transparent file:px-2.5 file:py-1 file:text-sm file:font-medium file:text-foreground"
                  onChange={(e) => {
                    void handleMergeFilesPicked(e.target.files)
                    e.target.value = ''
                  }}
                />
              </div>

              {mergeSources.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {mergeSources.map((file, index) => (
                    <div
                      key={`${file.name}-${index}`}
                      className="flex items-center gap-2 rounded-lg border border-border/60 px-2.5 py-1.5"
                    >
                      <span className="w-5 shrink-0 text-xs text-muted-foreground">{index + 1}.</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatBytes(file.bytes.byteLength)}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={index === 0}
                        onClick={() => moveMergeSource(index, -1)}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={index === mergeSources.length - 1}
                        onClick={() => moveMergeSource(index, 1)}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => removeMergeSource(index)}>
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              <Button type="button" className="w-fit gap-1.5" disabled={isBusy || mergeSources.length === 0} onClick={() => void runMerge()}>
                <Merge className="size-4" />
                {isBusy ? 'Merging…' : 'Merge'}
              </Button>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="split-source-file">Source PDF</Label>
                <input
                  id="split-source-file"
                  type="file"
                  accept="application/pdf,.pdf"
                  className="text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-input file:bg-transparent file:px-2.5 file:py-1 file:text-sm file:font-medium file:text-foreground"
                  onChange={(e) => void handleSplitFilePicked(e.target.files)}
                />
                {splitSource ? (
                  <p className="text-xs text-muted-foreground">
                    {splitSource.name} · {formatBytes(splitSource.bytes.byteLength)}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="split-ranges">Page ranges (one output PDF per line)</Label>
                <p className="text-xs text-muted-foreground">
                  Comma-separated page numbers and/or ranges, e.g. &quot;1-3,5&quot;. Each line produces its own
                  downloadable PDF.
                </p>
                <Textarea
                  id="split-ranges"
                  className="min-h-24 font-mono text-xs"
                  placeholder={'1-3,5\n4-6'}
                  value={rangesText}
                  onChange={(e) => setRangesText(e.target.value)}
                />
              </div>

              <Button type="button" className="w-fit gap-1.5" disabled={isBusy || !splitSource} onClick={() => void runSplit()}>
                <Scissors className="size-4" />
                {isBusy ? 'Extracting…' : 'Extract'}
              </Button>
            </>
          )}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      }
      outputPanel={
        mode === 'merge' ? (
          mergedResult == null ? (
            <p className="text-sm text-muted-foreground">
              Add source PDFs and merge them to get a single combined PDF here.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                <span className="text-muted-foreground">Sources merged</span>
                <span className="text-right font-mono">{mergeSources.length}</span>
                <span className="text-muted-foreground">Output size</span>
                <span className="text-right font-mono">{formatBytes(mergedResult.byteLength)}</span>
              </div>
              <Button type="button" className="w-fit gap-1.5" onClick={() => downloadBytes(mergedResult, 'merged.pdf')}>
                <Download className="size-4" />
                Download merged.pdf
              </Button>
            </div>
          )
        ) : extractedFiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Choose a source PDF, enter one or more page ranges, then extract to get downloadable PDFs here.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {extractedFiles.map((file) => (
              <div
                key={file.name}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(file.bytes.byteLength)}</p>
                </div>
                <Button type="button" size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={() => downloadBytes(file.bytes, file.name)}>
                  <Download className="size-3.5" />
                  Download
                </Button>
              </div>
            ))}
          </div>
        )
      }
    />
  )
}
