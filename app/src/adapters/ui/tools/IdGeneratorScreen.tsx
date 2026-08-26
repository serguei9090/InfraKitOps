import { useState } from 'react'
import { Wand2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import {
  UuidUlidGenerator,
  WellKnownNamespace,
  type IdKind,
  type UuidUlidInput,
  type UuidUlidResult,
} from '@/core/utility/uuidUlidGenerator'

const generator = new UuidUlidGenerator()

const KIND_OPTIONS: { value: IdKind; label: string }[] = [
  { value: 'uuidV1', label: 'UUID v1 (time-based)' },
  { value: 'uuidV3', label: 'UUID v3 (namespace + MD5)' },
  { value: 'uuidV4', label: 'UUID v4 (random)' },
  { value: 'uuidV5', label: 'UUID v5 (namespace + SHA-1)' },
  { value: 'ulid', label: 'ULID' },
]

const NAMESPACE_PRESETS: { label: string; value: string }[] = [
  { label: 'DNS', value: WellKnownNamespace.dns },
  { label: 'URL', value: WellKnownNamespace.url },
  { label: 'OID', value: WellKnownNamespace.oid },
  { label: 'X500', value: WellKnownNamespace.x500 },
]

export function IdGeneratorScreen() {
  const [kind, setKind] = useState<IdKind>('uuidV4')
  const [namespace, setNamespace] = useState<string>(WellKnownNamespace.dns)
  const [name, setName] = useState('example.com')
  const [count, setCount] = useState(1)
  const [history, setHistory] = useState<UuidUlidResult[]>([])
  const [error, setError] = useState<string | null>(null)

  const needsNamespaceAndName = kind === 'uuidV3' || kind === 'uuidV5'

  function generate() {
    try {
      const n = Math.min(Math.max(Math.round(count) || 1, 1), 50)
      const batch: UuidUlidResult[] = []
      for (let i = 0; i < n; i++) {
        const input: UuidUlidInput = {
          kind,
          namespace: needsNamespaceAndName ? namespace.trim() : undefined,
          name: needsNamespaceAndName ? name : undefined,
        }
        batch.push(generator.execute(input))
      }
      setHistory((prev) => [...batch, ...prev].slice(0, 50))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const latest = history[0]?.value
  const copyText =
    history.length === 0 ? undefined : history.length === 1 ? history[0].value : history.map((h) => h.value).join('\n')

  return (
    <ToolDetailScaffold
      title="UUID / ULID Generator"
      copyText={copyText}
      inputPanel={
        <div className="flex max-w-sm flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kind">Identifier type</Label>
            <Select value={kind} onValueChange={(v) => setKind((v as IdKind) ?? 'uuidV4')}>
              <SelectTrigger id="kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsNamespaceAndName ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="namespace">Namespace UUID</Label>
                <Input id="namespace" className="font-mono" value={namespace} onChange={(e) => setNamespace(e.target.value)} />
                <div className="flex flex-wrap gap-1.5">
                  {NAMESPACE_PRESETS.map((p) => (
                    <Button
                      key={p.label}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setNamespace(p.value)}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  A DNS/URL/OID/X500 namespace UUID, or any custom UUID.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="count">Generate count</Label>
            <Input
              id="count"
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">1 to 50 at once.</p>
          </div>

          <Button type="button" onClick={generate} className="gap-1.5 self-start">
            <Wand2 className="size-4" />
            Generate
          </Button>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      }
      outputPanel={
        <div className="flex flex-col gap-6">
          <div>
            <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">GENERATED VALUE</p>
            <p className="font-mono text-base">{latest ?? 'Press Generate to create an identifier'}</p>
          </div>
          {history.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">RECENT</p>
              <div className="flex flex-col gap-1">
                {history.map((h, i) => (
                  <div key={i} className="flex items-baseline gap-3 text-sm">
                    <span className="w-12 shrink-0 text-xs text-muted-foreground">{kindLabel(h.kind)}</span>
                    <span className="font-mono break-all">{h.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      }
    />
  )
}

function kindLabel(kind: IdKind): string {
  switch (kind) {
    case 'uuidV1':
      return 'v1'
    case 'uuidV3':
      return 'v3'
    case 'uuidV4':
      return 'v4'
    case 'uuidV5':
      return 'v5'
    case 'ulid':
      return 'ULID'
  }
}
