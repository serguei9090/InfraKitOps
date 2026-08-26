import { useMemo, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { JWT_SIGNATURE_NOTICE, JwtParser, formatJwtDuration, type JwtParseResult } from '@/core/utility/jwtParser'

const parser = new JwtParser()

export function JwtParserScreen() {
  const [token, setToken] = useState('')

  const result: JwtParseResult | null = useMemo(() => {
    if (token.trim().length === 0) return null
    return parser.execute({ token })
  }, [token])

  const copyText =
    result != null && result.isValidStructure ? `HEADER\n${result.headerJson}\n\nPAYLOAD\n${result.payloadJson}` : undefined

  return (
    <ToolDetailScaffold
      title="JWT Parser & Debugger"
      copyText={copyText}
      inputPanel={
        <div className="flex max-w-xl flex-col gap-1.5">
          <Label htmlFor="jwt-token">Token</Label>
          <p className="text-xs text-muted-foreground">
            Paste a JWT (header.payload.signature). A &quot;Bearer &quot; prefix and line-wrapped whitespace are
            stripped automatically.
          </p>
          <Textarea
            id="jwt-token"
            rows={12}
            className="font-mono text-xs"
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
      }
      outputPanel={
        <div className="flex flex-col gap-4">
          <Alert variant="destructive">
            <ShieldAlert />
            <AlertTitle>Signature NOT verified</AlertTitle>
            <AlertDescription>{JWT_SIGNATURE_NOTICE}</AlertDescription>
          </Alert>

          {result == null ? (
            <p className="text-sm text-muted-foreground">Enter a token above to decode it here.</p>
          ) : !result.isValidStructure ? (
            <p className="text-sm text-destructive">{result.errorMessage ?? 'This token could not be decoded.'}</p>
          ) : (
            <DecodedTokenView result={result} />
          )}
        </div>
      }
    />
  )
}

function DecodedTokenView({ result }: { result: JwtParseResult }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge result={result} />
        {result.isUnsignedAlgorithm ? (
          <Badge variant="destructive" title="alg is &quot;none&quot; or the signature segment is empty — the classic unsecured-JWT forgery vector (CVE-2015-9235 family).">
            Unsigned (alg: none)
          </Badge>
        ) : null}
        {result.algorithm ? <Badge variant="outline">alg {result.algorithm}</Badge> : null}
        {result.tokenType ? <Badge variant="outline">typ {result.tokenType}</Badge> : null}
        {result.keyId ? <Badge variant="outline">kid {result.keyId}</Badge> : null}
      </div>

      {result.registeredClaims.length > 0 ? (
        <div>
          <p className="mb-2 text-sm font-medium">Registered claims</p>
          <Table>
            <TableBody>
              {result.registeredClaims.map((claim) => (
                <TableRow key={claim.name}>
                  <TableCell className="w-40 align-top">
                    <p className="text-sm font-semibold">{claim.label}</p>
                    <p className="font-mono text-xs text-muted-foreground">{claim.name}</p>
                  </TableCell>
                  <TableCell className="align-top">
                    <p className={claim.dateTime ? 'font-mono text-sm font-medium' : 'text-sm font-medium'}>
                      {claim.displayValue}
                    </p>
                    <p className="text-xs text-muted-foreground">{claim.meaning}</p>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <div>
        <p className="mb-1.5 text-sm font-medium">Header</p>
        <JsonBlock json={result.headerJson} />
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium">Payload</p>
        <JsonBlock json={result.payloadJson} />
      </div>
    </div>
  )
}

function StatusBadge({ result }: { result: JwtParseResult }) {
  let label: string
  let variant: 'default' | 'secondary' | 'destructive'

  if (result.temporalStatus === 'expired') {
    variant = 'destructive'
    label = result.timeUntilExpiryMs != null ? `Expired ${formatJwtDuration(result.timeUntilExpiryMs)} ago` : 'Expired'
  } else if (result.temporalStatus === 'notYetValid') {
    variant = 'secondary'
    label =
      result.timeUntilValidMs != null
        ? `Not yet valid — usable in ${formatJwtDuration(result.timeUntilValidMs)}`
        : 'Not yet valid'
  } else {
    variant = 'default'
    label =
      result.timeUntilExpiryMs != null
        ? `Valid — expires in ${formatJwtDuration(result.timeUntilExpiryMs)}`
        : 'Valid (no expiry claim)'
  }

  return <Badge variant={variant}>{label}</Badge>
}

function JsonBlock({ json }: { json: string }) {
  return (
    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-background p-3 font-mono text-xs">
      {json}
    </pre>
  )
}
