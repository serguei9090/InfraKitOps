import { useState } from 'react'
import { ShieldCheck, Wand2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { PasswordGenerator, PassphraseGenerator } from '@/core/utility/passwordGenerator'
import { PasswordStrengthAnalyzer, type PasswordStrengthResult, type PasswordStrengthRating } from '@/core/utility/passwordStrengthAnalyzer'

const passwordGenerator = new PasswordGenerator()
const passphraseGenerator = new PassphraseGenerator()
const strengthAnalyzer = new PasswordStrengthAnalyzer()

type Mode = 'password' | 'passphrase'

export function PasswordGeneratorScreen() {
  const [mode, setMode] = useState<Mode>('password')

  // Password mode controls
  const [length, setLength] = useState(16)
  const [includeUppercase, setIncludeUppercase] = useState(true)
  const [includeLowercase, setIncludeLowercase] = useState(true)
  const [includeDigits, setIncludeDigits] = useState(true)
  const [includeSymbols, setIncludeSymbols] = useState(true)

  // Passphrase mode controls
  const [wordCount, setWordCount] = useState(4)
  const [separator, setSeparator] = useState('-')
  const [capitalizeWords, setCapitalizeWords] = useState(false)
  const [includeNumber, setIncludeNumber] = useState(false)

  const [secret, setSecret] = useState<string | null>(null)
  const [strength, setStrength] = useState<PasswordStrengthResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  function generate() {
    try {
      const value =
        mode === 'password'
          ? passwordGenerator.execute({
              length,
              includeUppercase,
              includeLowercase,
              includeDigits,
              includeSymbols,
            }).password
          : passphraseGenerator.execute({
              wordCount,
              separator,
              capitalizeWords,
              includeNumber,
            }).passphrase
      setSecret(value)
      setStrength(strengthAnalyzer.execute({ password: value }))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <ToolDetailScaffold
      title="Password & Secret Generator"
      copyText={secret ?? undefined}
      inputPanel={
        <div className="flex max-w-sm flex-col gap-4">
          <Tabs value={mode} onValueChange={(v) => setMode((v as Mode) ?? 'password')}>
            <TabsList>
              <TabsTrigger value="password">Password</TabsTrigger>
              <TabsTrigger value="passphrase">Passphrase</TabsTrigger>
            </TabsList>
            <TabsContent value="password" className="mt-4">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Length: {length}</Label>
                  <Slider value={length} min={4} max={64} step={1} onValueChange={(v) => setLength(v as number)} />
                </div>
                <ToggleRow label="Uppercase (A-Z)" checked={includeUppercase} onCheckedChange={setIncludeUppercase} />
                <ToggleRow label="Lowercase (a-z)" checked={includeLowercase} onCheckedChange={setIncludeLowercase} />
                <ToggleRow label="Digits (0-9)" checked={includeDigits} onCheckedChange={setIncludeDigits} />
                <ToggleRow label="Symbols (!@#...)" checked={includeSymbols} onCheckedChange={setIncludeSymbols} />
              </div>
            </TabsContent>
            <TabsContent value="passphrase" className="mt-4">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Word count: {wordCount}</Label>
                  <Slider value={wordCount} min={3} max={10} step={1} onValueChange={(v) => setWordCount(v as number)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="separator">Separator</Label>
                  <Input id="separator" value={separator} onChange={(e) => setSeparator(e.target.value)} />
                </div>
                <ToggleRow label="Capitalize words" checked={capitalizeWords} onCheckedChange={setCapitalizeWords} />
                <ToggleRow label="Append a random number" checked={includeNumber} onCheckedChange={setIncludeNumber} />
              </div>
            </TabsContent>
          </Tabs>

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
            <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">GENERATED SECRET</p>
            <p className="font-mono text-base break-all">{secret ?? 'Press Generate to create a secret'}</p>
          </div>
          {strength ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground">STRENGTH</p>
              <div className="flex items-center gap-2">
                <ShieldCheck className={`size-4 ${ratingColorClass(strength.rating)}`} />
                <Badge variant={ratingBadgeVariant(strength.rating)}>{ratingLabel(strength.rating)}</Badge>
                <span className="text-sm text-muted-foreground">~{strength.entropyBits.toFixed(1)} bits</span>
              </div>
              {strength.rating === 'weak' ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    This secret is weak — consider a longer length or enabling more character classes.
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
        </div>
      }
    />
  )
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}

function ratingLabel(rating: PasswordStrengthRating): string {
  switch (rating) {
    case 'weak':
      return 'Weak'
    case 'fair':
      return 'Fair'
    case 'strong':
      return 'Strong'
    case 'veryStrong':
      return 'Very strong'
  }
}

function ratingColorClass(rating: PasswordStrengthRating): string {
  switch (rating) {
    case 'weak':
      return 'text-destructive'
    case 'fair':
      return 'text-amber-500'
    case 'strong':
      return 'text-lime-600 dark:text-lime-400'
    case 'veryStrong':
      return 'text-primary'
  }
}

function ratingBadgeVariant(rating: PasswordStrengthRating): 'destructive' | 'secondary' | 'default' {
  switch (rating) {
    case 'weak':
      return 'destructive'
    case 'fair':
      return 'secondary'
    case 'strong':
    case 'veryStrong':
      return 'default'
  }
}
