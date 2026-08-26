import { useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import {
  BCRYPT_DEFAULT_LOG_ROUNDS,
  BCRYPT_MIN_LOG_ROUNDS,
  BcryptHasher,
  BcryptVerifier,
} from '@/core/utility/bcryptTool'

const hasher = new BcryptHasher()
const verifier = new BcryptVerifier()

// bcrypt cost grows exponentially; anything above 16 gets impractically slow
// for an interactive UI, so the slider caps here even though the algorithm
// (and the core's validation) allows up to 31.
const SLIDER_MAX_LOG_ROUNDS = 16

type BcryptMode = 'hash' | 'verify'

export function BcryptScreen() {
  const [mode, setMode] = useState<BcryptMode>('hash')

  // Hash mode state
  const [hashPlaintext, setHashPlaintext] = useState('')
  const [logRounds, setLogRounds] = useState(BCRYPT_DEFAULT_LOG_ROUNDS)
  const [hashOutput, setHashOutput] = useState<string | null>(null)
  const [hashError, setHashError] = useState<string | null>(null)

  // Verify mode state
  const [verifyPlaintext, setVerifyPlaintext] = useState('')
  const [verifyHash, setVerifyHash] = useState('')
  const [verifyMatches, setVerifyMatches] = useState<boolean | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  function runHash() {
    setHashError(null)
    setHashOutput(null)
    try {
      const result = hasher.execute({ plaintext: hashPlaintext, logRounds })
      setHashOutput(result.hash)
    } catch (e) {
      setHashError(e instanceof Error ? e.message : String(e))
    }
  }

  function runVerify() {
    setVerifyError(null)
    setVerifyMatches(null)
    try {
      const result = verifier.execute({ plaintext: verifyPlaintext, hash: verifyHash })
      setVerifyMatches(result.matches)
    } catch (e) {
      setVerifyError(`Could not evaluate that hash: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <ToolDetailScaffold
      title="bcrypt Hash & Verify"
      copyText={mode === 'hash' ? (hashOutput ?? undefined) : undefined}
      inputPanel={
        <div className="flex max-w-sm flex-col gap-5">
          <div>
            <p className="mb-2 text-sm font-medium">Mode</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={mode === 'hash' ? 'default' : 'outline'} onClick={() => setMode('hash')}>
                Hash
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === 'verify' ? 'default' : 'outline'}
                onClick={() => setMode('verify')}
              >
                Verify
              </Button>
            </div>
          </div>

          {mode === 'hash' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bcrypt-plaintext">Plaintext</Label>
                <Input
                  id="bcrypt-plaintext"
                  placeholder="Password or secret to hash"
                  value={hashPlaintext}
                  onChange={(e) => setHashPlaintext(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') runHash()
                  }}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Cost factor (log2 rounds): {logRounds}</Label>
                <Slider
                  value={logRounds}
                  min={BCRYPT_MIN_LOG_ROUNDS}
                  max={SLIDER_MAX_LOG_ROUNDS}
                  step={1}
                  onValueChange={(v) => setLogRounds(v as number)}
                />
              </div>
              <Button type="button" className="w-fit" onClick={runHash}>
                Generate bcrypt hash
              </Button>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bcrypt-verify-plaintext">Plaintext</Label>
                <Input
                  id="bcrypt-verify-plaintext"
                  placeholder="Password to check"
                  value={verifyPlaintext}
                  onChange={(e) => setVerifyPlaintext(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bcrypt-verify-hash">Existing bcrypt hash</Label>
                <Input
                  id="bcrypt-verify-hash"
                  className="font-mono"
                  placeholder="$2a$10$..."
                  value={verifyHash}
                  onChange={(e) => setVerifyHash(e.target.value)}
                />
              </div>
              <Button type="button" className="w-fit" onClick={runVerify}>
                Verify
              </Button>
            </>
          )}
        </div>
      }
      outputPanel={
        mode === 'hash' ? (
          hashError ? (
            <p className="text-sm text-destructive">{hashError}</p>
          ) : hashOutput ? (
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">bcrypt hash</p>
              <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-background p-3 font-mono text-xs">
                {hashOutput}
              </pre>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Enter a plaintext and press &quot;Generate bcrypt hash&quot;.</p>
          )
        ) : verifyError ? (
          <p className="text-sm text-destructive">{verifyError}</p>
        ) : verifyMatches === null ? (
          <p className="text-sm text-muted-foreground">Enter a plaintext and a bcrypt hash, then press &quot;Verify&quot;.</p>
        ) : (
          <div className="flex items-center gap-3">
            {verifyMatches ? (
              <CheckCircle2 className="size-8 text-primary" />
            ) : (
              <XCircle className="size-8 text-destructive" />
            )}
            <p className={verifyMatches ? 'text-xl font-semibold text-primary' : 'text-xl font-semibold text-destructive'}>
              {verifyMatches ? 'Match' : 'No match'}
            </p>
          </div>
        )
      }
    />
  )
}
