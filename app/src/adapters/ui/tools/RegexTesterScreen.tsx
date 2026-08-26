import { useMemo, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import {
  RegexTester,
  groupLabel,
  didParticipate,
  type RegexTesterResult,
  type RegexMatchResult,
} from '@/core/utility/regexTester'

const tester = new RegexTester()

export function RegexTesterScreen() {
  const [pattern, setPattern] = useState('')
  const [subject, setSubject] = useState('')
  const [caseInsensitive, setCaseInsensitive] = useState(false)
  const [multiLine, setMultiLine] = useState(false)
  const [dotAll, setDotAll] = useState(false)
  const [unicode, setUnicode] = useState(false)

  const result = useMemo<RegexTesterResult>(() => {
    try {
      return tester.execute({ pattern, subject, caseInsensitive, multiLine, dotAll, unicode })
    } catch (e) {
      return {
        isValid: false,
        errorMessage: `Unexpected error: ${e instanceof Error ? e.message : String(e)}`,
        matches: [],
        explanation: [],
        warnings: [],
        subjectTruncated: false,
        matchesTruncated: false,
      }
    }
  }, [pattern, subject, caseInsensitive, multiLine, dotAll, unicode])

  const copyText = useMemo(() => {
    if (!result.isValid || result.matches.length === 0) return undefined
    const lines: string[] = []
    for (const m of result.matches) {
      lines.push(`[${m.index}] ${m.start}-${m.end}: ${m.text}`)
      for (const g of m.groups) {
        lines.push(`    group ${groupLabel(g)}: ${didParticipate(g) ? g.value : '(did not participate)'}`)
      }
    }
    return lines.join('\n')
  }, [result])

  return (
    <ToolDetailScaffold
      title="Regex Tester & Explainer"
      copyText={copyText}
      inputPanel={
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pattern">Pattern</Label>
            <Input
              id="pattern"
              className="font-mono"
              placeholder={String.raw`e.g. (?<year>\d{4})-\d{2}-\d{2}`}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Flags</Label>
            <div className="flex flex-col gap-2">
              <FlagCheckbox label="i — case-insensitive" checked={caseInsensitive} onCheckedChange={setCaseInsensitive} />
              <FlagCheckbox label="m — multiline" checked={multiLine} onCheckedChange={setMultiLine} />
              <FlagCheckbox label="s — dot all" checked={dotAll} onCheckedChange={setDotAll} />
              <FlagCheckbox label="u — unicode" checked={unicode} onCheckedChange={setUnicode} />
            </div>
            <p className="text-xs text-muted-foreground">
              Unicode property escapes (<code className="font-mono">\p{'{...}'}</code>) and named backreferences (
              <code className="font-mono">\k&lt;name&gt;</code>) only work correctly with the "u" flag enabled —
              without it they silently degrade to literal character matches.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="subject">Subject</Label>
            <Textarea
              id="subject"
              className="min-h-40 font-mono"
              placeholder="Paste text to match against"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
        </div>
      }
      outputPanel={<OutputPanel result={result} subject={subject} />}
    />
  )
}

function FlagCheckbox({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} />
      {label}
    </label>
  )
}

function OutputPanel({ result, subject }: { result: RegexTesterResult; subject: string }) {
  if (!result.isValid) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <XCircle className="size-4 text-destructive" />
          <p className="text-sm font-medium">Invalid pattern</p>
        </div>
        <p className="text-sm text-destructive">{result.errorMessage ?? 'Enter a pattern to see matches.'}</p>
        {result.explanation.length > 0 ? <Explanation result={result} /> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-4 text-primary" />
        <p className="text-sm font-medium">
          {result.matches.length} match{result.matches.length === 1 ? '' : 'es'}
        </p>
      </div>

      {result.warnings.map((w, i) => (
        <Alert key={i} variant="destructive">
          <AlertDescription>{w}</AlertDescription>
        </Alert>
      ))}

      {subject.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">
            SUBJECT (MATCHES HIGHLIGHTED)
          </p>
          <div className="rounded-lg border border-border/60 p-3 font-mono text-sm whitespace-pre-wrap break-all">
            <HighlightedSubject subject={subject} matches={result.matches} />
          </div>
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">MATCHES</p>
        {result.matches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matches.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {result.matches.map((m) => (
              <MatchCard key={m.index} match={m} />
            ))}
          </div>
        )}
      </div>

      <Explanation result={result} />
    </div>
  )
}

function HighlightedSubject({ subject, matches }: { subject: string; matches: RegexMatchResult[] }) {
  const spans: React.ReactNode[] = []
  let cursor = 0
  for (const m of matches) {
    if (m.start > subject.length || m.end > subject.length) continue
    if (m.start < cursor) continue
    if (m.start > cursor) spans.push(<span key={`${cursor}-t`}>{subject.substring(cursor, m.start)}</span>)
    spans.push(
      <span key={`${m.start}-m`} className="rounded bg-primary/20 font-semibold text-primary">
        {subject.substring(m.start, m.end)}
      </span>,
    )
    cursor = m.end
  }
  if (cursor < subject.length) spans.push(<span key="tail">{subject.substring(cursor)}</span>)
  return <>{spans}</>
}

function MatchCard({ match }: { match: RegexMatchResult }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <p className="text-xs font-medium text-primary">
        Match {match.index} — offsets {match.start}-{match.end}
      </p>
      <p className="mt-1 font-mono text-sm">{match.text.length === 0 ? '(empty match)' : match.text}</p>
      {match.groups.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1 border-t border-border/60 pt-2">
          {match.groups.map((g) => (
            <p key={g.index} className="text-xs">
              <span className="text-muted-foreground">group {groupLabel(g)}: </span>
              <span className={didParticipate(g) ? 'font-mono' : 'font-mono italic text-muted-foreground'}>
                {didParticipate(g) ? g.value : '(did not participate)'}
              </span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Explanation({ result }: { result: RegexTesterResult }) {
  if (result.explanation.length === 0) return null
  return (
    <div>
      <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">PATTERN BREAKDOWN</p>
      <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 p-3">
        {result.explanation.map((token, i) => (
          <p key={i} className="text-xs" style={{ paddingLeft: token.depth * 16 }}>
            <span className="font-mono font-semibold text-primary">{token.token}</span>{' '}
            <span className="text-muted-foreground">{token.description}</span>
          </p>
        ))}
      </div>
    </div>
  )
}
