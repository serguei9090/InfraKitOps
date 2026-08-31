import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { StepSpec } from '@/core/runbook/runbookModel'
import { SecretPicker } from './SecretPicker'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
type Http = NonNullable<StepSpec['http']>

interface Props {
  step: StepSpec
  onChange: (patch: Partial<StepSpec>) => void
}

export function HttpStepForm({ step, onChange }: Props) {
  const http: Http = step.http ?? { method: 'GET', url: '', headers: [] }

  function patch(p: Partial<Http>) {
    onChange({ http: { ...http, ...p } })
  }

  return (
    <div className="flex flex-col gap-2 p-3 text-xs">
      <div className="flex gap-2">
        <Select value={http.method || 'GET'} onValueChange={(v) => v && patch({ method: v })}>
          <SelectTrigger size="sm" className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={http.url}
          onChange={(e) => patch({ url: e.target.value })}
          placeholder="https://api.example.com/health/{{SERVICE}}"
          className="h-7 flex-1 font-mono"
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground">headers</span>
        {(http.headers ?? []).map((h, i) => (
          <div key={i} className="flex gap-1.5">
            <Input
              value={h.k}
              onChange={(e) =>
                patch({ headers: http.headers.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)) })
              }
              placeholder="Header"
              className="h-7 w-40"
            />
            <Input
              value={h.v}
              onChange={(e) =>
                patch({ headers: http.headers.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)) })
              }
              placeholder="value  (use {{ARG}})"
              className="h-7 flex-1 font-mono"
            />
            <button
              type="button"
              aria-label="Remove header"
              onClick={() => patch({ headers: http.headers.filter((_, j) => j !== i) })}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        <Button
          size="xs"
          variant="ghost"
          className="self-start"
          onClick={() => patch({ headers: [...(http.headers ?? []), { k: '', v: '' }] })}
        >
          <Plus className="size-3" /> header
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">auth</span>
        <Select
          value={http.auth?.kind ?? 'none'}
          onValueChange={(v) =>
            v && patch({ auth: v === 'none' ? undefined : { kind: v as 'bearer' | 'basic', secretId: http.auth?.secretId ?? '' } })
          }
        >
          <SelectTrigger size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">none</SelectItem>
            <SelectItem value="bearer">bearer</SelectItem>
            <SelectItem value="basic">basic</SelectItem>
          </SelectContent>
        </Select>
        {http.auth && (
          <div className="w-56">
            <SecretPicker
              value={http.auth.secretId}
              onChange={(id) => patch({ auth: { ...http.auth!, secretId: id } })}
              placeholder={http.auth.kind === 'basic' ? 'user:pass secret' : 'token secret'}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">expect status</span>
        <Input
          value={(http.expectStatus ?? []).join(', ')}
          onChange={(e) =>
            patch({
              expectStatus: e.target.value
                .split(',')
                .map((s) => Number(s.trim()))
                .filter((n) => !Number.isNaN(n)),
            })
          }
          placeholder="200, 204"
          className="h-7 w-32"
        />
      </div>

      {(http.method === 'POST' || http.method === 'PUT' || http.method === 'PATCH') && (
        <Textarea
          value={http.body ?? ''}
          onChange={(e) => patch({ body: e.target.value })}
          placeholder='{"restart": "{{SERVICE}}"}'
          className="min-h-20 resize-y bg-transparent font-mono text-[12px]"
        />
      )}
    </div>
  )
}
