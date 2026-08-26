import { useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { HashCalculator, type HashCalculatorInput, type HashDigestResult } from '@/core/utility/hashCalculator'

const calculator = new HashCalculator()

const defaultInput: HashCalculatorInput = { text: '', hmacSecretKey: '' }

export function HashCalculatorScreen() {
  const [input, setInput] = useState<HashCalculatorInput>(defaultInput)

  const result = useMemo(() => {
    try {
      return {
        value: calculator.execute({
          text: input.text,
          hmacSecretKey: input.hmacSecretKey && input.hmacSecretKey.length > 0 ? input.hmacSecretKey : undefined,
        }),
        error: null,
      }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [input])

  const allDigestsText = result.value
    ? [...result.value.digests, ...result.value.hmacDigests].map((d) => `${d.algorithmLabel}: ${d.hex}`).join('\n')
    : ''

  return (
    <ToolDetailScaffold
      title="Hash & Checksum Calculator"
      copyText={allDigestsText.length > 0 ? allDigestsText : undefined}
      inputPanel={
        <div className="flex max-w-lg flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hash-input">Input</Label>
            <Textarea
              id="hash-input"
              rows={8}
              placeholder="Enter text to hash..."
              value={input.text}
              onChange={(e) => setInput((s) => ({ ...s, text: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hash-hmac-key">HMAC secret key (optional)</Label>
            <Input
              id="hash-hmac-key"
              placeholder="Leave blank to skip HMAC generation"
              value={input.hmacSecretKey ?? ''}
              onChange={(e) => setInput((s) => ({ ...s, hmacSecretKey: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              When set, HMAC-MD5 / HMAC-SHA-1 / HMAC-SHA-256 / HMAC-SHA-512 are computed for this key alongside
              the plain digests.
            </p>
          </div>
        </div>
      }
      outputPanel={
        result.error ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : result.value ? (
          <div className="flex flex-col gap-6">
            <DigestTable title="Digests" digests={result.value.digests} />
            {result.value.hmacDigests.length > 0 ? (
              <DigestTable title="HMAC digests" digests={result.value.hmacDigests} />
            ) : null}
          </div>
        ) : null
      }
    />
  )
}

function DigestTable({ title, digests }: { title: string; digests: HashDigestResult[] }) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  async function handleCopy(index: number, hex: string) {
    await navigator.clipboard.writeText(hex)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex((i) => (i === index ? null : i)), 1000)
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium">{title}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-32">Algorithm</TableHead>
            <TableHead>Digest</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {digests.map((d, i) => (
            <TableRow key={d.algorithmLabel}>
              <TableCell className="align-top font-medium">{d.algorithmLabel}</TableCell>
              <TableCell className="whitespace-normal break-all font-mono text-xs">{d.hex}</TableCell>
              <TableCell className="align-top">
                <Button variant="ghost" size="icon-sm" onClick={() => handleCopy(i, d.hex)}>
                  <Copy className="size-3.5" />
                  <span className="sr-only">{copiedIndex === i ? 'Copied' : `Copy ${d.algorithmLabel}`}</span>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
