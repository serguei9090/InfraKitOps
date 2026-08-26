import { useState } from 'react'
import { FileSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
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

  async function inspect(file: SourceFile) {
    setIsBusy(true)
    setError(null)
    setResult(null)
    try {
      const value = await inspector.execute({ bytes: file.bytes })
      setResult(value)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsBusy(false)
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
          </div>
        )
      }
    />
  )
}
