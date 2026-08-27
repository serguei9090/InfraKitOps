import { useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { SubnetCalculator, type SubnetCalculatorResult } from '@/core/network/subnetCalculator'

const calculator = new SubnetCalculator()

function summaryOf(cidr: string, r: SubnetCalculatorResult): string {
  const lines = [
    `CIDR: ${cidr.trim()}`,
    `IP version: ${r.version === 'v4' ? 'IPv4' : 'IPv6'}`,
    `Prefix length: /${r.prefixLength}`,
    `Network address: ${r.networkAddress}`,
  ]
  if (r.version === 'v4') {
    lines.push(
      `Broadcast address: ${r.broadcastAddress}`,
      `Subnet mask: ${r.subnetMask}`,
      `Wildcard mask: ${r.wildcardMask}`,
      `First usable host: ${r.firstUsableAddress}`,
      `Last usable host: ${r.lastUsableAddress}`,
      `Usable host count: ${r.usableHostCount}`,
    )
  } else {
    lines.push(`First address: ${r.firstAddress}`, `Last address: ${r.lastAddress}`)
  }
  lines.push(`Total address count: ${r.totalAddressCount}`)
  return lines.join('\n')
}

export function SubnetCalculatorScreen() {
  const [cidr, setCidr] = useState('192.168.1.0/24')

  const result = useMemo(() => {
    if (cidr.trim().length === 0) return { value: null, error: null }
    try {
      return { value: calculator.execute({ cidr }), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [cidr])

  return (
    <ToolDetailScaffold
      title="IPv4/IPv6 Subnet Calculator"
      copyText={result.value ? summaryOf(cidr, result.value) : undefined}
      inputPanel={
        <div className="flex max-w-sm flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cidr">CIDR block</Label>
            <Input
              id="cidr"
              className="font-mono"
              placeholder="e.g. 192.168.1.0/24 or 2001:db8::/64"
              value={cidr}
              onChange={(e) => setCidr(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Enter an IPv4 or IPv6 address with a "/" prefix length. The IP version is detected automatically from
            the address format.
          </p>
        </div>
      }
      outputPanel={
        result.error ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : result.value ? (
          <Table>
            <TableBody>
              <FieldRow label="IP version" value={result.value.version === 'v4' ? 'IPv4' : 'IPv6'} />
              <FieldRow label="Prefix length" value={`/${result.value.prefixLength}`} />
              <FieldRow label="Network address" value={result.value.networkAddress} />
              {result.value.version === 'v4' ? (
                <>
                  <FieldRow label="Broadcast address" value={result.value.broadcastAddress!} />
                  <FieldRow label="Subnet mask" value={result.value.subnetMask!} />
                  <FieldRow label="Wildcard mask" value={result.value.wildcardMask!} />
                  <FieldRow label="First usable host" value={result.value.firstUsableAddress!} />
                  <FieldRow label="Last usable host" value={result.value.lastUsableAddress!} />
                  <FieldRow label="Usable host count" value={String(result.value.usableHostCount)} />
                </>
              ) : (
                <>
                  <FieldRow label="First address" value={result.value.firstAddress} />
                  <FieldRow label="Last address" value={result.value.lastAddress} />
                </>
              )}
              <FieldRow label="Total address count" value={String(result.value.totalAddressCount)} />
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">Enter a CIDR block to see subnet details.</p>
        )
      }
    />
  )
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <TableRow>
      <TableCell className="w-40 align-top text-xs font-medium text-muted-foreground">{label}</TableCell>
      <TableCell className="whitespace-normal break-all align-top font-mono text-sm">{value}</TableCell>
    </TableRow>
  )
}
