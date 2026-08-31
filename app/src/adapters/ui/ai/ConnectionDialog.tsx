import { useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { testConnection } from '@/adapters/backend/llmClient'
import { useLlmStore } from '@/stores/llmStore'
import {
  ALL_PROVIDERS,
  PROVIDER_DEFAULT_URL,
  PROVIDER_KEYLESS_OK,
  PROVIDER_LABEL,
  type LlmConnection,
  type LlmModel,
  type ProviderKind,
} from '@/core/llm/llmModel'
import { SecretPicker } from '@/adapters/ui/runbook/SecretPicker'
import { InlineError } from '@/adapters/ui/errors/InlineError'
import { classify, type AppError } from '@/core/errors/appError'

type Draft = Partial<LlmConnection>

interface Props {
  draft: Draft | null
  onClose: () => void
}

export function ConnectionDialog({ draft, onClose }: Props) {
  const putConnection = useLlmStore((s) => s.putConnection)
  const [d, setD] = useState<Draft | null>(draft)
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'err'; models?: LlmModel[]; error?: AppError }>({
    state: 'idle',
  })

  if (!d) return null
  const provider = (d.provider ?? 'ollama') as ProviderKind
  const keyless = PROVIDER_KEYLESS_OK[provider]

  async function runTest(id: string) {
    setTest({ state: 'running' })
    try {
      const r = await testConnection(id)
      if (r.ok) setTest({ state: 'ok', models: r.models })
      else setTest({ state: 'err', error: classify({ error: r.error, code: r.code, hint: r.hint }, 'AI Hub') })
    } catch (e) {
      setTest({ state: 'err', error: classify(e, 'AI Hub') })
    }
  }

  return (
    <Dialog open={draft != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-xl flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{draft?.id ? 'Edit connection' : 'New connection'}</DialogTitle>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={async (e) => {
            e.preventDefault()
            const saved = await putConnection(d)
            if (saved) onClose()
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={d.name ?? ''}
                onChange={(e) => setD((c) => ({ ...c!, name: e.target.value }))}
                placeholder="Local Ollama"
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:gap-2">
              <div className="sm:w-44 sm:shrink-0">
                <Label className="text-xs">Provider</Label>
                <Select
                  value={provider}
                  onValueChange={(v) =>
                    v && setD((c) => ({ ...c!, provider: v as ProviderKind, authSecretId: undefined }))
                  }
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue>{(v) => PROVIDER_LABEL[v as ProviderKind] ?? v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_PROVIDERS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PROVIDER_LABEL[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 flex-1">
                <Label className="text-xs">Base URL</Label>
                <Input
                  value={d.baseUrl ?? ''}
                  onChange={(e) => setD((c) => ({ ...c!, baseUrl: e.target.value }))}
                  placeholder={PROVIDER_DEFAULT_URL[provider]}
                  className="w-full font-mono text-xs"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">
                API key {keyless && <span className="text-muted-foreground">(optional)</span>}
              </Label>
              <SecretPicker
                by="id"
                value={d.authSecretId ?? ''}
                onChange={(id) => setD((c) => ({ ...c!, authSecretId: id }))}
                kinds={['api-key', 'token', 'password', 'other']}
                placeholder={keyless ? 'none — local runtime' : 'pick the key from the Vault'}
              />
            </div>

            <div>
              <Label className="text-xs">Default model</Label>
              <div className="flex gap-2">
                <Input
                  value={d.defaultModel ?? ''}
                  onChange={(e) => setD((c) => ({ ...c!, defaultModel: e.target.value }))}
                  placeholder={test.models?.[0]?.id ?? 'llama3.1:8b'}
                  className="min-w-0 flex-1 font-mono text-xs"
                  list="conn-models"
                />
                <datalist id="conn-models">
                  {(test.models ?? []).map((m) => (
                    <option key={m.id} value={m.id} />
                  ))}
                </datalist>
                {d.id && (
                  <Button type="button" size="sm" variant="outline" onClick={() => void runTest(d.id!)}>
                    {test.state === 'running' ? <Loader2 className="size-3.5 animate-spin" /> : 'Test'}
                  </Button>
                )}
              </div>
              {test.state === 'ok' && (
                <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-500">
                  <CheckCircle2 className="size-3.5" /> {test.models?.length ?? 0} models available
                </p>
              )}
              {test.state === 'err' && <InlineError error={test.error} className="mt-1.5" />}
              {!d.id && (
                <p className="mt-1 text-xs text-muted-foreground">Save first, then Test to pull the model list.</p>
              )}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button type="submit" disabled={!d.name}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
