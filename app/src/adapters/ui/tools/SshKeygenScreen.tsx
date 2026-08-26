import { useMemo, useState } from 'react'
import { Copy, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import {
  SSH_KEY_TYPE_LABELS,
  SshKeyGenerator,
  type SshKeyGenInput,
  type SshKeyType,
} from '@/core/utility/sshKeyGenerator'

const generator = new SshKeyGenerator()

const ALL_KEY_TYPES: SshKeyType[] = ['ed25519', 'rsa4096']

const defaultInput: SshKeyGenInput = { keyType: 'ed25519', comment: '' }

export function SshKeygenScreen() {
  const [input, setInput] = useState<SshKeyGenInput>(defaultInput)
  // Bumped by the "Regenerate" button so a fresh key pair can be drawn
  // without having to touch keyType/comment first.
  const [nonce, setNonce] = useState(0)

  const result = useMemo(() => {
    try {
      return { value: generator.execute(input), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
      // nonce is intentionally a dependency purely to force recomputation.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }
  }, [input, nonce])

  return (
    <ToolDetailScaffold
      title="SSH Key Pair Generator"
      copyText={result.value?.publicKeyLine}
      inputPanel={
        <div className="flex max-w-sm flex-col gap-5">
          <div>
            <p className="mb-2 text-sm font-medium">Key type</p>
            <div className="flex gap-2">
              {ALL_KEY_TYPES.map((t) => (
                <Button
                  key={t}
                  type="button"
                  size="sm"
                  variant={input.keyType === t ? 'default' : 'outline'}
                  onClick={() => setInput((s) => ({ ...s, keyType: t }))}
                >
                  {SSH_KEY_TYPE_LABELS[t]}
                </Button>
              ))}
            </div>
            {input.keyType === 'rsa4096' ? (
              <p className="mt-2 text-xs text-destructive">
                RSA-4096 generation is not available in this build — see the note below. Ed25519 is fully
                supported.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ssh-comment">Comment (optional)</Label>
            <Input
              id="ssh-comment"
              placeholder="e.g. you@yourhost"
              value={input.comment ?? ''}
              onChange={(e) => setInput((s) => ({ ...s, comment: e.target.value }))}
            />
          </div>

          <Button type="button" className="w-fit gap-1.5" onClick={() => setNonce((n) => n + 1)}>
            <KeyRound className="size-4" />
            Regenerate
          </Button>
        </div>
      }
      outputPanel={
        <div className="flex flex-col gap-4">
          {result.error ? (
            <p className="text-sm text-destructive">{result.error}</p>
          ) : result.value ? (
            <>
              <Alert>
                <AlertTitle>Developer convenience tool</AlertTitle>
                <AlertDescription>
                  This is not a hardened HSM-grade key generator. The private key material is produced
                  in-process and shown in plain text on screen. For anything you actually depend on —
                  production servers, anything you cannot easily rotate — generate the key with
                  &quot;ssh-keygen&quot; on a trusted machine instead, or at minimum regenerate this key if you
                  have any doubt about how it was handled after being displayed here.
                </AlertDescription>
              </Alert>
              <CopyableBlock label="Public key (OpenSSH wire format)" text={result.value.publicKeyLine} />
              <CopyableBlock
                label='Private key (unencrypted OpenSSH "openssh-key-v1" PEM)'
                text={result.value.privateKeyPem}
              />
            </>
          ) : null}
        </div>
      }
    />
  )
}

function CopyableBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs" onClick={handleCopy}>
          <Copy className="size-3.5" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-background p-3 font-mono text-xs">
        {text}
      </pre>
    </div>
  )
}
