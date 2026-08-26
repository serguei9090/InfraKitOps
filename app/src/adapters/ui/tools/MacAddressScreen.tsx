import { useMemo, useState } from 'react'
import { Wand2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import {
  MacAddressTool,
  ouiDisplay,
  type MacAddressAnalysis,
  type MacGenerationOptions,
} from '@/core/utility/macAddressTool'

const tool = new MacAddressTool()

type Mode = 'analyze' | 'generate'

export function MacAddressScreen() {
  const [mode, setMode] = useState<Mode>('analyze')

  // --- Analyze mode state ---
  const [mac, setMac] = useState('00:1A:2B:3C:4D:5E')
  const analyzeResult = useMemo(() => {
    if (mac.trim().length === 0) return { value: null, error: null }
    try {
      return { value: tool.execute({ mac }), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [mac])

  // --- Generate mode state ---
  const [count, setCount] = useState(1)
  const [vendorPrefix, setVendorPrefix] = useState('')
  const [locallyAdministered, setLocallyAdministered] = useState(true)
  const [unicast, setUnicast] = useState(true)
  const [generated, setGenerated] = useState<MacAddressAnalysis[]>([])
  const [generateError, setGenerateError] = useState<string | null>(null)
  const hasPrefix = vendorPrefix.trim().length > 0

  function runGenerate() {
    try {
      const options: MacGenerationOptions = {
        count,
        locallyAdministered,
        unicast,
        vendorPrefixHex: hasPrefix ? vendorPrefix.trim() : undefined,
      }
      setGenerated(tool.generate(options))
      setGenerateError(null)
    } catch (e) {
      setGenerated([])
      setGenerateError(e instanceof Error ? e.message : String(e))
    }
  }

  const copyText =
    mode === 'analyze'
      ? analyzeResult.value
        ? analyzeSummary(analyzeResult.value)
        : undefined
      : generated.length > 0
        ? generated.map((a) => a.colonForm).join('\n')
        : undefined

  return (
    <ToolDetailScaffold
      title="MAC Address Tool"
      copyText={copyText}
      inputPanel={
        <Tabs value={mode} onValueChange={(v) => setMode((v as Mode) ?? 'analyze')}>
          <TabsList>
            <TabsTrigger value="analyze">Analyze</TabsTrigger>
            <TabsTrigger value="generate">Generate</TabsTrigger>
          </TabsList>
          <TabsContent value="analyze" className="mt-4">
            <div className="flex max-w-sm flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mac">MAC address</Label>
                <Input
                  id="mac"
                  className="font-mono"
                  placeholder="00:1A:2B:3C:4D:5E"
                  value={mac}
                  onChange={(e) => setMac(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Accepts colon (00:1A:2B:3C:4D:5E), hyphen (00-1A-2B-3C-4D-5E), Cisco dotted (001A.2B3C.4D5E) or
                bare hex (001A2B3C4D5E) notation.
              </p>
            </div>
          </TabsContent>
          <TabsContent value="generate" className="mt-4">
            <div className="flex max-w-sm flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="count">Count</Label>
                <Input
                  id="count"
                  type="number"
                  min={1}
                  max={256}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">1 to 256</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="vendor-prefix">Vendor prefix (optional)</Label>
                <Input
                  id="vendor-prefix"
                  className="font-mono"
                  placeholder="e.g. 00:50:56 (leave blank for a fully random address)"
                  value={vendorPrefix}
                  onChange={(e) => setVendorPrefix(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="ul-bit">Locally administered (U/L bit)</Label>
                  <p className="text-xs text-muted-foreground">
                    Off mints an address that looks like a real IEEE-registered OUI.
                  </p>
                </div>
                <Switch
                  id="ul-bit"
                  checked={locallyAdministered}
                  onCheckedChange={setLocallyAdministered}
                  disabled={hasPrefix}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="ig-bit">Unicast</Label>
                  <p className="text-xs text-muted-foreground">Off sets the I/G bit and mints a multicast address.</p>
                </div>
                <Switch id="ig-bit" checked={unicast} onCheckedChange={setUnicast} disabled={hasPrefix} />
              </div>
              {hasPrefix ? (
                <p className="text-xs text-muted-foreground">
                  A vendor prefix owns its own flag bits — the switches above are ignored while a prefix is set.
                </p>
              ) : null}
              <Button type="button" onClick={runGenerate} className="gap-1.5">
                <Wand2 className="size-4" />
                Generate
              </Button>
              {generateError ? <p className="text-sm text-destructive">{generateError}</p> : null}
            </div>
          </TabsContent>
        </Tabs>
      }
      outputPanel={mode === 'analyze' ? <AnalyzeOutput result={analyzeResult} /> : <GenerateOutput items={generated} />}
    />
  )
}

function analyzeSummary(a: MacAddressAnalysis): string {
  const lines = [
    `Colon:  ${a.colonForm}`,
    `Hyphen: ${a.hyphenForm}`,
    `Dotted: ${a.dottedForm}`,
    `Bare:   ${a.bareForm}`,
    `OUI:    ${ouiDisplay(a)}`,
    `Locally administered (U/L): ${a.isLocallyAdministered}`,
    `Multicast (I/G): ${a.isMulticast}`,
    `Broadcast: ${a.isBroadcast}`,
  ]
  if (a.vendor) lines.push(`Vendor (curated match): ${a.vendor.vendor}`)
  return lines.join('\n')
}

function AnalyzeOutput({ result }: { result: { value: MacAddressAnalysis | null; error: string | null } }) {
  if (result.error) return <p className="text-sm text-destructive">{result.error}</p>
  const a = result.value
  if (!a) return <p className="text-sm text-muted-foreground">Enter a MAC address to see its details.</p>

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">EVERY NOTATION</p>
        <Table>
          <TableBody>
            <FieldRow label="Colon" value={a.colonForm} />
            <FieldRow label="Hyphen" value={a.hyphenForm} />
            <FieldRow label="Cisco dotted" value={a.dottedForm} />
            <FieldRow label="Bare hex" value={a.bareForm} />
            <FieldRow label="OUI" value={ouiDisplay(a)} />
          </TableBody>
        </Table>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">FLAG BITS</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant={a.isLocallyAdministered ? 'destructive' : 'secondary'}>
            U/L: {a.isLocallyAdministered ? 'Locally administered' : 'Universally administered (real OUI)'}
          </Badge>
          <Badge variant={a.isMulticast ? 'destructive' : 'secondary'}>
            I/G: {a.isMulticast ? 'Multicast (group)' : 'Unicast'}
          </Badge>
          {a.isBroadcast ? <Badge variant="destructive">Broadcast address</Badge> : null}
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">VENDOR LOOKUP</p>
        {a.vendor ? (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <p className="text-sm font-medium">{a.vendor.vendor}</p>
            <p className="text-xs text-muted-foreground">
              {a.vendor.category === 'virtualization' ? 'Virtualization / container NIC' : 'Hardware vendor'}
            </p>
            {a.vendor.note ? <p className="mt-1 text-xs text-muted-foreground">{a.vendor.note}</p> : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {a.isLocallyAdministered
              ? 'No vendor lookup — this OUI is locally administered, so it was never issued to a real vendor by the IEEE.'
              : 'Not in the curated table.'}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Vendor lookup is a small curated subset (hypervisor/container prefixes plus a handful of common hardware
          vendors) — not the full IEEE OUI registry. A miss only means "not in our small table", never
          "unassigned".
        </p>
      </div>
    </div>
  )
}

function GenerateOutput({ items }: { items: MacAddressAnalysis[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Press Generate to mint one or more MAC addresses.</p>
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">
        {items.length} address{items.length === 1 ? '' : 'es'} generated
      </p>
      <div className="flex flex-col gap-2">
        {items.map((a, i) => (
          <div key={i} className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <p className="font-mono text-sm">{a.colonForm}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant={a.isLocallyAdministered ? 'destructive' : 'secondary'}>
                {a.isLocallyAdministered ? 'Locally administered' : 'Universally administered'}
              </Badge>
              <Badge variant={a.isMulticast ? 'destructive' : 'secondary'}>
                {a.isMulticast ? 'Multicast' : 'Unicast'}
              </Badge>
              {a.vendor ? <Badge variant="outline">{a.vendor.vendor}</Badge> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <TableRow>
      <TableCell className="w-32 align-top text-xs font-medium text-muted-foreground">{label}</TableCell>
      <TableCell className="whitespace-normal break-all align-top font-mono text-sm">{value}</TableCell>
    </TableRow>
  )
}
