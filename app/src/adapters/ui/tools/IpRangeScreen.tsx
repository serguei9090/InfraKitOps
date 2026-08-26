import { useMemo, useState } from 'react'
import { Wand2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import {
  IpRangeTool,
  cidrOf,
  type CidrBlock,
  type Ipv4RangeResult,
  type UlaPrefixResult,
} from '@/core/utility/ipRangeTool'

const tool = new IpRangeTool()

type Mode = 'rangeToCidr' | 'cidrToRange' | 'ula'

export function IpRangeScreen() {
  const [mode, setMode] = useState<Mode>('rangeToCidr')

  // --- Range -> CIDR ---
  const [start, setStart] = useState('192.168.1.5')
  const [end, setEnd] = useState('192.168.1.10')
  const rangeResult = useMemo(() => {
    if (start.trim().length === 0 || end.trim().length === 0) return { value: null, error: null }
    try {
      return { value: tool.summarizeRange(start, end), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [start, end])

  // --- CIDR -> range ---
  const [cidr, setCidr] = useState('192.168.1.0/24')
  const cidrResult = useMemo(() => {
    if (cidr.trim().length === 0) return { value: null, error: null }
    try {
      return { value: tool.expandCidr(cidr), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [cidr])

  // --- IPv6 ULA ---
  const [subnetIdText, setSubnetIdText] = useState('')
  const [ula, setUla] = useState<UlaPrefixResult | null>(null)
  const [ulaError, setUlaError] = useState<string | null>(null)

  function runUlaGenerate() {
    const text = subnetIdText.trim()
    const subnetId = text.length === 0 ? undefined : Number(text)
    if (text.length > 0 && !Number.isFinite(subnetId)) {
      setUla(null)
      setUlaError('Subnet ID must be a whole number (0-65535).')
      return
    }
    try {
      setUla(tool.generateUla(subnetId))
      setUlaError(null)
    } catch (e) {
      setUla(null)
      setUlaError(e instanceof Error ? e.message : String(e))
    }
  }

  const copyText =
    mode === 'rangeToCidr'
      ? rangeResult.value
        ? rangeSummary(rangeResult.value)
        : undefined
      : mode === 'cidrToRange'
        ? cidrResult.value
          ? cidrSummary(cidrResult.value)
          : undefined
        : ula
          ? ulaSummary(ula)
          : undefined

  return (
    <ToolDetailScaffold
      title="IP Range / CIDR Tool"
      copyText={copyText}
      inputPanel={
        <Tabs value={mode} onValueChange={(v) => setMode((v as Mode) ?? 'rangeToCidr')}>
          <TabsList>
            <TabsTrigger value="rangeToCidr">Range → CIDR</TabsTrigger>
            <TabsTrigger value="cidrToRange">CIDR → range</TabsTrigger>
            <TabsTrigger value="ula">IPv6 ULA</TabsTrigger>
          </TabsList>
          <TabsContent value="rangeToCidr" className="mt-4">
            <div className="flex max-w-sm flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="start">Start address</Label>
                <Input id="start" className="font-mono" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="end">End address</Label>
                <Input id="end" className="font-mono" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">
                Computes the minimal set of CIDR blocks that exactly tiles this inclusive range.
              </p>
            </div>
          </TabsContent>
          <TabsContent value="cidrToRange" className="mt-4">
            <div className="flex max-w-sm flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cidr">CIDR block</Label>
                <Input id="cidr" className="font-mono" value={cidr} onChange={(e) => setCidr(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">
                A host part that is not already zeroed is masked down to the network address.
              </p>
            </div>
          </TabsContent>
          <TabsContent value="ula" className="mt-4">
            <div className="flex max-w-sm flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="subnet-id">Subnet ID (optional)</Label>
                <Input
                  id="subnet-id"
                  type="number"
                  className="font-mono"
                  placeholder="Leave blank for a random subnet ID (0-65535)"
                  value={subnetIdText}
                  onChange={(e) => setSubnetIdText(e.target.value)}
                />
              </div>
              <Button type="button" onClick={runUlaGenerate} className="gap-1.5 self-start">
                <Wand2 className="size-4" />
                Generate
              </Button>
              {ulaError ? <p className="text-sm text-destructive">{ulaError}</p> : null}
              <p className="text-xs text-muted-foreground">
                RFC 4193-shaped, not an RFC-exact derivation: the 40-bit Global ID is drawn from a secure random
                source rather than the RFC's EUI-64 + timestamp + SHA-1 ritual, which gives the same collision
                properties without needing a hardware MAC address.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      }
      outputPanel={
        mode === 'rangeToCidr' ? (
          <RangeOutput result={rangeResult} />
        ) : mode === 'cidrToRange' ? (
          <CidrOutput result={cidrResult} />
        ) : (
          <UlaOutput ula={ula} error={ulaError} />
        )
      }
    />
  )
}

function rangeSummary(r: Ipv4RangeResult): string {
  const lines = [`Range: ${r.startAddress} - ${r.endAddress}`, `Total addresses: ${r.totalAddresses}`, `CIDR blocks (${r.blocks.length}):`]
  for (const b of r.blocks) {
    lines.push(`  ${cidrOf(b)}  (${b.firstAddress} - ${b.lastAddress}, ${b.addressCount} addresses)`)
  }
  return lines.join('\n')
}

function cidrSummary(c: CidrBlock): string {
  return [
    `CIDR: ${cidrOf(c)}`,
    `Network address: ${c.networkAddress}`,
    `First address: ${c.firstAddress}`,
    `Last address: ${c.lastAddress}`,
    `Address count: ${c.addressCount}`,
  ].join('\n')
}

function ulaSummary(u: UlaPrefixResult): string {
  return [
    `Global ID: ${u.globalIdHex}`,
    `Site prefix: ${u.prefix48}`,
    `Subnet ID: ${u.subnetId}`,
    `Subnet /64: ${u.subnet64}`,
    `Example host address: ${u.exampleAddress}`,
  ].join('\n')
}

function RangeOutput({ result }: { result: { value: Ipv4RangeResult | null; error: string | null } }) {
  if (result.error) return <p className="text-sm text-destructive">{result.error}</p>
  const r = result.value
  if (!r) return <p className="text-sm text-muted-foreground">Enter a start and end address to summarize the range.</p>

  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-sm">Total addresses: {r.totalAddresses}</p>
      <p className="font-mono text-sm">Blocks: {r.blocks.length}</p>
      <Table>
        <TableBody>
          {r.blocks.map((b, i) => (
            <TableRow key={i}>
              <TableCell className="font-mono text-sm">{cidrOf(b)}</TableCell>
              <TableCell className="whitespace-normal break-all font-mono text-sm text-muted-foreground">
                {b.firstAddress} - {b.lastAddress} ({b.addressCount})
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function CidrOutput({ result }: { result: { value: CidrBlock | null; error: string | null } }) {
  if (result.error) return <p className="text-sm text-destructive">{result.error}</p>
  const c = result.value
  if (!c) return <p className="text-sm text-muted-foreground">Enter a CIDR block, e.g. 192.168.1.0/24.</p>

  return (
    <Table>
      <TableBody>
        <FieldRow label="CIDR" value={cidrOf(c)} />
        <FieldRow label="Network address" value={c.networkAddress} />
        <FieldRow label="First address" value={c.firstAddress} />
        <FieldRow label="Last address" value={c.lastAddress} />
        <FieldRow label="Address count" value={String(c.addressCount)} />
      </TableBody>
    </Table>
  )
}

function UlaOutput({ ula, error }: { ula: UlaPrefixResult | null; error: string | null }) {
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!ula) return <p className="text-sm text-muted-foreground">Press Generate to mint an IPv6 ULA prefix.</p>

  return (
    <Table>
      <TableBody>
        <FieldRow label="Global ID" value={ula.globalIdHex} />
        <FieldRow label="Site prefix (/48)" value={ula.prefix48} />
        <FieldRow label="Subnet ID" value={String(ula.subnetId)} />
        <FieldRow label="Subnet (/64)" value={ula.subnet64} />
        <FieldRow label="Example host address" value={ula.exampleAddress} />
      </TableBody>
    </Table>
  )
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <TableRow>
      <TableCell className="w-44 align-top text-xs font-medium text-muted-foreground">{label}</TableCell>
      <TableCell className="whitespace-normal break-all align-top font-mono text-sm">{value}</TableCell>
    </TableRow>
  )
}
