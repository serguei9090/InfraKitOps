import { useState } from 'react'
import { FileSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { useOptionalBackend } from '@/adapters/backend/useOptionalBackend'
import { pdfInspect, type BackendPdfInfo } from '@/adapters/backend/pdfClient'
import { PdfInspector, type PdfInspectionResult } from '@/core/office_media/pdfInspector'

const inspector = new PdfInspector()

interface SourceFile {
  name: string
  bytes: Uint8Array
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatDate(date: Date | undefined): string | null {
  if (date === undefined) return null
  return date.toLocaleString()
}

export function PdfInspectorScreen() {
  const [sourceFile, setSourceFile] = useState<SourceFile | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PdfInspectionResult | null>(null)
  const [backendInfo, setBackendInfo] = useState<BackendPdfInfo | null>(null)
  const power = useOptionalBackend('pdf-inspector')

  async function inspect(file: SourceFile) {
    setIsBusy(true)
    setError(null)
    setResult(null)
    setBackendInfo(null)
    try {
      const value = await inspector.execute({ bytes: file.bytes })
      setResult(value)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsBusy(false)
    }
    if (power.available) {
      try {
        setBackendInfo(await pdfInspect(file.bytes))
      } catch {
        /* backend inspection is a bonus — client result already shown */
      }
    }
  }

  async function handleFilePicked(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    const buffer = await file.arrayBuffer()
    const picked: SourceFile = { name: file.name, bytes: new Uint8Array(buffer) }
    setSourceFile(picked)
    void inspect(picked)
  }

  return (
    <ToolDetailScaffold
      title="PDF Inspector"
      inputPanel={
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pdf-source-file">PDF file</Label>
            <input
              id="pdf-source-file"
              type="file"
              accept="application/pdf,.pdf"
              className="text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-input file:bg-transparent file:px-2.5 file:py-1 file:text-sm file:font-medium file:text-foreground"
              onChange={(e) => void handleFilePicked(e.target.files)}
            />
            {sourceFile ? (
              <p className="text-xs text-muted-foreground">
                {sourceFile.name} · {formatBytes(sourceFile.bytes.byteLength)}
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            className="w-fit gap-1.5"
            disabled={isBusy || !sourceFile}
            onClick={() => sourceFile && void inspect(sourceFile)}
          >
            <FileSearch className="size-4" />
            {isBusy ? 'Inspecting…' : 'Re-inspect'}
          </Button>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      }
      outputPanel={
        result == null ? (
          <p className="text-sm text-muted-foreground">
            Choose a PDF on the left to see its page count, metadata and encryption status here.
          </p>
        ) : !result.isReadable ? (
          <Alert variant="destructive">
            <AlertDescription>
              This file could not be read as a PDF. File size: {formatBytes(result.fileSizeBytes)}.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-6">
            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">DOCUMENT</p>
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-muted-foreground">Page count</TableCell>
                    <TableCell className="text-right font-mono">{result.pageCount}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">File size</TableCell>
                    <TableCell className="text-right font-mono">{formatBytes(result.fileSizeBytes)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">Encrypted</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={result.isEncrypted ? 'destructive' : 'secondary'}>
                        {result.isEncrypted ? 'Yes' : 'No'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">METADATA</p>
              {result.info.title === undefined &&
              result.info.author === undefined &&
              result.info.subject === undefined &&
              result.info.keywords === undefined &&
              result.info.creator === undefined &&
              result.info.producer === undefined ? (
                <p className="text-sm text-muted-foreground">No document-info metadata is set on this file.</p>
              ) : (
                <Table>
                  <TableBody>
                    {result.info.title !== undefined ? (
                      <TableRow>
                        <TableCell className="text-muted-foreground">Title</TableCell>
                        <TableCell className="text-right break-all">{result.info.title}</TableCell>
                      </TableRow>
                    ) : null}
                    {result.info.author !== undefined ? (
                      <TableRow>
                        <TableCell className="text-muted-foreground">Author</TableCell>
                        <TableCell className="text-right break-all">{result.info.author}</TableCell>
                      </TableRow>
                    ) : null}
                    {result.info.subject !== undefined ? (
                      <TableRow>
                        <TableCell className="text-muted-foreground">Subject</TableCell>
                        <TableCell className="text-right break-all">{result.info.subject}</TableCell>
                      </TableRow>
                    ) : null}
                    {result.info.keywords !== undefined ? (
                      <TableRow>
                        <TableCell className="text-muted-foreground">Keywords</TableCell>
                        <TableCell className="text-right break-all">{result.info.keywords}</TableCell>
                      </TableRow>
                    ) : null}
                    {result.info.creator !== undefined ? (
                      <TableRow>
                        <TableCell className="text-muted-foreground">Creator</TableCell>
                        <TableCell className="text-right break-all">{result.info.creator}</TableCell>
                      </TableRow>
                    ) : null}
                    {result.info.producer !== undefined ? (
                      <TableRow>
                        <TableCell className="text-muted-foreground">Producer</TableCell>
                        <TableCell className="text-right break-all">{result.info.producer}</TableCell>
                      </TableRow>
                    ) : null}
                    {formatDate(result.info.creationDate) !== null ? (
                      <TableRow>
                        <TableCell className="text-muted-foreground">Created</TableCell>
                        <TableCell className="text-right">{formatDate(result.info.creationDate)}</TableCell>
                      </TableRow>
                    ) : null}
                    {formatDate(result.info.modificationDate) !== null ? (
                      <TableRow>
                        <TableCell className="text-muted-foreground">Modified</TableCell>
                        <TableCell className="text-right">{formatDate(result.info.modificationDate)}</TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              )}
            </div>

            {backendInfo ? (
              <div>
                <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">
                  STRUCTURE · pdfcpu backend
                </p>
                <Table>
                  <TableBody>
                    <TableRow>
                      <TableCell className="text-muted-foreground">PDF version</TableCell>
                      <TableCell className="text-right font-mono">{backendInfo.version}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-muted-foreground">Validation</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={backendInfo.valid ? 'secondary' : 'destructive'}>
                          {backendInfo.valid ? 'Valid' : 'Issues found'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                    {!backendInfo.valid && backendInfo.validationMessage ? (
                      <TableRow>
                        <TableCell className="text-muted-foreground">Validator says</TableCell>
                        <TableCell className="text-right break-all text-xs">{backendInfo.validationMessage}</TableCell>
                      </TableRow>
                    ) : null}
                    {backendInfo.pageSizes.length > 0 ? (
                      <TableRow>
                        <TableCell className="text-muted-foreground">Page sizes</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {backendInfo.pageSizes.join(', ')}
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {(
                      [
                        ['Linearized (fast web view)', backendInfo.linearized],
                        ['Tagged (accessible)', backendInfo.tagged],
                        ['Has AcroForm', backendInfo.form],
                        ['Digitally signed', backendInfo.signatures],
                        ['Watermarked', backendInfo.watermarked],
                        ['Has bookmarks', backendInfo.bookmarks],
                        ['Cross-reference streams', backendInfo.usingXRefStreams],
                      ] as [string, boolean][]
                    ).map(([label, value]) => (
                      <TableRow key={label}>
                        <TableCell className="text-muted-foreground">{label}</TableCell>
                        <TableCell className="text-right">{value ? 'Yes' : 'No'}</TableCell>
                      </TableRow>
                    ))}
                    {backendInfo.encrypted ? (
                      <TableRow>
                        <TableCell className="text-muted-foreground">Permission flags</TableCell>
                        <TableCell className="text-right font-mono">
                          0x{(backendInfo.permissions & 0xffff).toString(16).padStart(4, '0')}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            ) : power.available ? (
              <p className="text-xs text-muted-foreground">Fetching structural detail from the backend…</p>
            ) : null}
          </div>
        )
      }
    />
  )
}
