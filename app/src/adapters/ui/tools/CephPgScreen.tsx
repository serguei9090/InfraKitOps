import { useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { CephPgCalculator, type CephPgInput } from '@/core/tuning/cephPgCalculator'

const calculator = new CephPgCalculator()

const defaultInput: CephPgInput = {
  osdCount: 20,
  poolCount: 1,
  targetPgsPerOsd: 100,
  replicationFactor: 3,
}

export function CephPgScreen() {
  const [input, setInput] = useState<CephPgInput>(defaultInput)

  const result = useMemo(() => {
    try {
      return { value: calculator.execute(input), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [input])

  function field(key: keyof CephPgInput) {
    return {
      value: input[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setInput((s) => ({ ...s, [key]: Number(e.target.value) })),
    }
  }

  return (
    <ToolDetailScaffold
      title="Ceph PG Calculator"
      copyText={result.value ? String(result.value.roundedPgCount) : undefined}
      inputPanel={
        <div className="flex max-w-sm flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="osd-count">OSD count</Label>
            <Input id="osd-count" type="number" min={1} {...field('osdCount')} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pool-count">Pool count</Label>
            <Input id="pool-count" type="number" min={1} {...field('poolCount')} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="target-pgs">Target PGs per OSD</Label>
            <Input id="target-pgs" type="number" min={1} {...field('targetPgsPerOsd')} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="replication-factor">Replication factor</Label>
            <Input id="replication-factor" type="number" min={1} {...field('replicationFactor')} />
          </div>
        </div>
      }
      outputPanel={
        result.error ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : result.value ? (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Raw PG count</p>
              <p className="font-mono text-lg">{result.value.rawPgCount.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Rounded PG count (power of 2)</p>
              <p className="font-mono text-3xl font-semibold text-primary">{result.value.roundedPgCount}</p>
            </div>
          </div>
        ) : null
      }
    />
  )
}
