import { useState } from 'react'
import { Terminal, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAnsibleStore } from '@/stores/ansibleStore'

const COMMON_MODULES = [
  'command',
  'shell',
  'ping',
  'setup',
  'ansible.builtin.copy',
  'ansible.builtin.file',
  'ansible.builtin.service',
  'ansible.builtin.package',
  'ansible.builtin.systemd',
  'ansible.builtin.user',
]

export function AdhocView() {
  const selectedId = useAnsibleStore((s) => s.selectedId)
  const tree = useAnsibleStore((s) => s.tree)
  const startAdhoc = useAnsibleStore((s) => s.startAdhoc)

  const [pattern, setPattern] = useState('all')
  const [module, setModule] = useState('command')
  const [args, setArgs] = useState('')
  const [inventory, setInventory] = useState('')
  const [become, setBecome] = useState(false)

  if (!selectedId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a project on the Projects tab first
      </div>
    )
  }

  const inventories = tree?.inventories ?? []
  const argsHint = module === 'command' || module === 'shell' ? 'uptime' : 'name=nginx state=started'

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="flex items-center gap-2 text-base font-semibold">
        <Zap className="size-4" /> Ad-hoc command
      </div>
      <p className="text-sm text-muted-foreground">
        Run one module against a host pattern — no playbook. Streams into the run view like a play with a
        single task.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Host pattern</Label>
          <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="all / web* / host," />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Module</Label>
          <div className="flex gap-1.5">
            <Input
              className="flex-1"
              value={module}
              onChange={(e) => setModule(e.target.value)}
              list="adhoc-modules"
            />
            <datalist id="adhoc-modules">
              {COMMON_MODULES.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Module args (-a)</Label>
        <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder={argsHint} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Inventory</Label>
          {inventories.length > 0 ? (
            <Select
              value={inventory || '(default)'}
              onValueChange={(v) => setInventory(v && v !== '(default)' ? v : '')}
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="(default)">(project default)</SelectItem>
                {inventories.map((i) => (
                  <SelectItem key={i} value={i}>
                    {i}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              className="h-8 text-xs"
              value={inventory}
              onChange={(e) => setInventory(e.target.value)}
              placeholder="path or host,"
            />
          )}
        </div>
        <label className="flex items-end gap-1.5 pb-1.5 text-xs">
          <Checkbox checked={become} onCheckedChange={(c) => setBecome(c === true)} />
          --become
        </label>
      </div>

      <Button
        onClick={() =>
          startAdhoc({
            projectId: selectedId,
            pattern,
            module,
            args,
            inventory: inventory || undefined,
            become,
          })
        }
        disabled={!module.trim()}
      >
        <Terminal className="size-4" /> Run
      </Button>
    </div>
  )
}
