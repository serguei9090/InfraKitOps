import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { ExifViewer, isEmptyMetadata, orientationLabel, type ExifMetadata } from '@/core/office_media/exifViewer'

const viewer = new ExifViewer()

interface SourceImage {
  name: string
  byteSize: number
  objectUrl: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function ExifViewerScreen() {
  const [source, setSource] = useState<SourceImage | null>(null)
  const [metadata, setMetadata] = useState<ExifMetadata | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleFilePicked(files: FileList | null) {
    const file = files?.[0]
    if (!file) return

    if (source) URL.revokeObjectURL(source.objectUrl)
    setSource({ name: file.name, byteSize: file.size, objectUrl: URL.createObjectURL(file) })
    setMetadata(null)
    setError(null)
    setLoading(true)

    try {
      const result = await viewer.execute(file)
      setMetadata(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const rows: [string, string][] = metadata
    ? [
        ...(metadata.cameraMake ? [['Camera make', metadata.cameraMake] as [string, string]] : []),
        ...(metadata.cameraModel ? [['Camera model', metadata.cameraModel] as [string, string]] : []),
        ...(metadata.lensModel ? [['Lens', metadata.lensModel] as [string, string]] : []),
        ...(metadata.software ? [['Software', metadata.software] as [string, string]] : []),
        ...(metadata.dateTimeOriginal ? [['Date taken', metadata.dateTimeOriginal] as [string, string]] : []),
        ...(metadata.exposureTime ? [['Exposure time', metadata.exposureTime] as [string, string]] : []),
        ...(metadata.fNumber != null ? [['Aperture', `f/${metadata.fNumber.toFixed(1)}`] as [string, string]] : []),
        ...(metadata.isoSpeed != null ? [['ISO speed', String(metadata.isoSpeed)] as [string, string]] : []),
        ...(metadata.focalLengthMm != null
          ? [['Focal length', `${metadata.focalLengthMm.toFixed(0)} mm`] as [string, string]]
          : []),
        ...(orientationLabel(metadata.orientation)
          ? [['Orientation', orientationLabel(metadata.orientation)!] as [string, string]]
          : []),
      ]
    : []

  const gps = metadata?.gps

  return (
    <ToolDetailScaffold
      title="EXIF Metadata Viewer"
      inputPanel={
        <div className="flex max-w-md flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exif-source-image">Image</Label>
            <p className="text-xs text-muted-foreground">
              JPEG, PNG, WebP, GIF, BMP or TIFF — EXIF is most common in JPEGs.
            </p>
            <input
              id="exif-source-image"
              type="file"
              accept="image/*"
              className="text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-input file:bg-transparent file:px-2.5 file:py-1 file:text-sm file:font-medium file:text-foreground"
              onChange={(e) => void handleFilePicked(e.target.files)}
            />
            {source ? (
              <p className="text-xs text-muted-foreground">
                {source.name} · {formatBytes(source.byteSize)}
              </p>
            ) : null}
          </div>

          {source ? (
            <img
              src={source.objectUrl}
              alt="Source preview"
              className="h-40 w-full rounded-lg border border-border/60 object-contain"
            />
          ) : null}
        </div>
      }
      outputPanel={
        error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Reading EXIF metadata…</p>
        ) : metadata == null ? (
          <p className="text-sm text-muted-foreground">Load an image to view its EXIF metadata here.</p>
        ) : isEmptyMetadata(metadata) ? (
          <div className="flex max-w-md flex-col gap-2 rounded-lg border border-border/60 p-5">
            <ImageOff className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">No EXIF data found</p>
            <p className="text-sm text-muted-foreground">
              This image decoded fine but carries no EXIF metadata — common for PNGs, screenshots, and images
              that have been re-saved or stripped by a web pipeline.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div>
              <p className="mb-2 text-sm font-medium">Metadata</p>
              <div className="rounded-lg border border-border/60">
                <Table>
                  <TableBody>
                    {rows.map(([label, value]) => (
                      <TableRow key={label}>
                        <TableCell className="text-muted-foreground">{label}</TableCell>
                        <TableCell className="text-right font-medium">{value}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {gps ? (
              <div>
                <p className="mb-2 text-sm font-medium">GPS location</p>
                <div className="rounded-lg border border-border/60">
                  <Table>
                    <TableBody>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Latitude</TableCell>
                        <TableCell className="text-right font-mono">{gps.latitude.toFixed(6)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Longitude</TableCell>
                        <TableCell className="text-right font-mono">{gps.longitude.toFixed(6)}</TableCell>
                      </TableRow>
                      {gps.altitudeMeters != null ? (
                        <TableRow>
                          <TableCell className="text-muted-foreground">Altitude</TableCell>
                          <TableCell className="text-right font-mono">
                            {gps.altitudeMeters.toFixed(1)} m
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}
          </div>
        )
      }
    />
  )
}
