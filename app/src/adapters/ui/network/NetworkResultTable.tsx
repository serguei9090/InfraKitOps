import type { ReactNode } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export interface ResultColumn<Row> {
  key: string
  header: ReactNode
  cell: (row: Row) => ReactNode
  align?: 'left' | 'right'
  className?: string
}

interface NetworkResultTableProps<Row> {
  columns: ResultColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row, index: number) => string | number
  /** Shown when `rows` is empty. */
  empty?: ReactNode
  /** Optional live-count / group header line above the table. */
  caption?: ReactNode
}

/**
 * Shared results table for the T4 Network Console tools — bordered, scrolls
 * horizontally inside its own container, tabular-nums on right-aligned columns.
 * Streaming tools (N2) append into `rows` as events arrive.
 */
export function NetworkResultTable<Row>({
  columns,
  rows,
  rowKey,
  empty,
  caption,
}: NetworkResultTableProps<Row>) {
  return (
    <div className="space-y-2">
      {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key} className={cn(col.align === 'right' && 'text-right', col.className)}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-sm text-muted-foreground">
                  {empty ?? 'No rows.'}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, i) => (
                <TableRow key={rowKey(row, i)}>
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={cn(col.align === 'right' && 'text-right tabular-nums', col.className)}
                    >
                      {col.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
