import { useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { DbMemorySizer, type DbMemorySizerInput } from '@/core/tuning/dbMemorySizer'

const sizer = new DbMemorySizer()

const defaultInput: DbMemorySizerInput = {
  totalRamGb: 16,
  maxConnections: 100,
  percentForDatabase: 100,
}

type Engine = 'postgres' | 'mariadb'

export function DbMemorySizerScreen() {
  const [input, setInput] = useState<DbMemorySizerInput>(defaultInput)
  const [engine, setEngine] = useState<Engine>('postgres')

  const result = useMemo(() => {
    try {
      return { value: sizer.execute(input), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [input])

  const configText = result.value
    ? engine === 'postgres'
      ? result.value.postgres.configText
      : result.value.mariadb.configText
    : null

  function update<K extends keyof DbMemorySizerInput>(key: K, value: DbMemorySizerInput[K]) {
    setInput((s) => ({ ...s, [key]: value }))
  }

  return (
    <ToolDetailScaffold
      title="Database Memory Sizer"
      copyText={configText ?? undefined}
      inputPanel={
        <div className="flex max-w-sm flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="total-ram">Total system RAM (GB)</Label>
            <Input
              id="total-ram"
              type="number"
              min={0}
              step="any"
              value={input.totalRamGb}
              onChange={(e) => update('totalRamGb', Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="max-connections">max_connections</Label>
            <Input
              id="max-connections"
              type="number"
              min={1}
              value={input.maxConnections}
              onChange={(e) => update('maxConnections', Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Expected concurrent connections; drives the work_mem split
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Percent of RAM available to the database: {Math.round(input.percentForDatabase ?? 100)}%</Label>
            <p className="text-xs text-muted-foreground">
              Use 100% for a dedicated database server, or lower it when the box is shared with other services.
            </p>
            <Slider
              value={input.percentForDatabase ?? 100}
              min={10}
              max={100}
              step={5}
              onValueChange={(v) => update('percentForDatabase', v as number)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Engine</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={engine === 'postgres' ? 'default' : 'outline'}
                onClick={() => setEngine('postgres')}
              >
                PostgreSQL
              </Button>
              <Button
                type="button"
                variant={engine === 'mariadb' ? 'default' : 'outline'}
                onClick={() => setEngine('mariadb')}
              >
                MariaDB / MySQL
              </Button>
            </div>
          </div>
        </div>
      }
      outputPanel={
        result.error ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : result.value ? (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs text-muted-foreground">{engine === 'postgres' ? 'postgresql.conf' : 'my.cnf'}</p>
              <pre className="mt-2 max-w-full overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs">
                {configText}
              </pre>
            </div>
            <p className="text-xs text-muted-foreground">
              {engine === 'postgres'
                ? 'shared_buffers ~= 25% of usable RAM; effective_cache_size ~= 75% (a planner hint, not a real ' +
                  'allocation); work_mem splits the remaining RAM across max_connections then divides by a safety ' +
                  'factor of 4, since a single query can allocate work_mem several times over for sorts and hashes. ' +
                  'These are heuristic starting points, not a substitute for real workload tuning.'
                : 'innodb_buffer_pool_size ~= 75% of usable RAM, within the standard 70-80% guidance for a ' +
                  'dedicated InnoDB server. A heuristic starting point, not a substitute for real workload tuning.'}
            </p>
          </div>
        ) : null
      }
    />
  )
}
