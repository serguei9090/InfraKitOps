import { useMemo, useState } from 'react'
import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { FileDropField } from '@/adapters/ui/FileDropField'
import { useOptionalBackend } from '@/adapters/backend/useOptionalBackend'
import { x509FetchViaBackend, type BackendX509FetchResult } from '@/adapters/backend/inspectClients'
import {
  X509Inspector,
  distinguishedNameFormatted,
  type CertificateInfo,
  type CertificateValidityStatus,
} from '@/core/utility/x509Inspector'

const inspector = new X509Inspector()

export function X509InspectorScreen() {
  const [pemText, setPemText] = useState('')
  const power = useOptionalBackend('x509-inspector')
  const [host, setHost] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [fetched, setFetched] = useState<BackendX509FetchResult | null>(null)

  async function fetchFromServer() {
    if (!host.trim()) return
    setFetching(true)
    setFetchError(null)
    setFetched(null)
    try {
      const res = await x509FetchViaBackend(host.trim())
      setFetched(res)
      setPemText(res.pem)
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e))
    } finally {
      setFetching(false)
    }
  }

  const result = useMemo(() => {
    if (pemText.trim().length === 0) return { value: null, error: null }
    try {
      return { value: inspector.execute({ pemText }), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [pemText])

  return (
    <ToolDetailScaffold
      title="X.509 Certificate Inspector"
      inputPanel={
        <div className="flex max-w-xl flex-col gap-4">
          {power.available ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="x509-host">Fetch from a live server</Label>
              <div className="flex gap-2">
                <Input
                  id="x509-host"
                  className="font-mono"
                  placeholder="example.com  or  example.com:8443"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void fetchFromServer()
                  }}
                />
                <Button type="button" disabled={fetching || !host.trim()} onClick={() => void fetchFromServer()}>
                  {fetching ? <Loader2 className="size-4 animate-spin" /> : 'Fetch'}
                </Button>
              </div>
              {fetchError ? <p className="text-xs text-destructive">{fetchError}</p> : null}
              {fetched ? (
                <div
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                    fetched.trusted
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  {fetched.trusted ? (
                    <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                  )}
                  <div>
                    <p className="font-medium">
                      {fetched.trusted ? 'Chain verified against system roots' : 'Chain does NOT verify'}
                    </p>
                    <p className="opacity-80">
                      {fetched.host} · {fetched.tlsVersion} · {fetched.cipherSuite} · {fetched.certCount} cert(s)
                    </p>
                    {fetched.verifyError ? <p className="mt-0.5 font-mono opacity-80">{fetched.verifyError}</p> : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
          <Label htmlFor="x509-pem">Certificate PEM text</Label>
          <p className="text-xs text-muted-foreground">
            Paste a PEM-encoded certificate. A fullchain PEM with multiple certificates works too — one bad
            block does not hide the rest.
          </p>
          <FileDropField
            id="x509-pem"
            accept=".pem,.crt,.cer,.cert,.ca-bundle,.txt"
            rows={16}
            className="font-mono text-xs"
            placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
            value={pemText}
            onChange={setPemText}
          />
          </div>
        </div>
      }
      outputPanel={
        result.error ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : result.value ? (
          <div className="flex flex-col gap-4">
            {result.value.isChain ? (
              <p className="text-xs text-muted-foreground">
                {result.value.certificates.length} of {result.value.blocksFound} certificate(s) in this bundle
                parsed successfully.
              </p>
            ) : null}
            {result.value.errors.length > 0 ? (
              <Alert variant="destructive">
                <AlertTitle>Some certificates could not be parsed</AlertTitle>
                <AlertDescription>
                  {result.value.errors.map((err) => (
                    <p key={err}>{err}</p>
                  ))}
                </AlertDescription>
              </Alert>
            ) : null}
            {result.value.certificates.map((cert) => (
              <CertificateCard key={cert.index} cert={cert} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Paste PEM text to inspect it here.</p>
        )
      }
    />
  )
}

const STATUS_LABEL: Record<CertificateValidityStatus, string> = {
  valid: 'Valid',
  notYetValid: 'Not yet valid',
  expiringSoon: 'Expires soon',
  expired: 'Expired',
}

function statusBadge(cert: CertificateInfo) {
  const days = Math.abs(cert.daysUntilExpiry)
  const daysLabel = days === 1 ? '1 day' : `${days} days`
  let label = STATUS_LABEL[cert.status]
  if (cert.status === 'expired') label = `Expired ${daysLabel} ago`
  else if (cert.status === 'expiringSoon') label = `Expires in ${daysLabel}`

  const variant = cert.status === 'expired' ? 'destructive' : cert.status === 'valid' ? 'default' : 'secondary'
  return <Badge variant={variant}>{label}</Badge>
}

function formatDate(d: Date): string {
  const two = (n: number) => n.toString().padStart(2, '0')
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`
}

function publicKeySummary(cert: CertificateInfo): string {
  const parts = [cert.publicKeyAlgorithm]
  if (cert.publicKeyBits != null) parts.push(`${cert.publicKeyBits} bits`)
  if (cert.publicKeyCurve != null) parts.push(cert.publicKeyCurve)
  if (cert.publicKeyExponent != null) parts.push(`exponent ${cert.publicKeyExponent}`)
  return parts.join(' · ')
}

function CertificateCard({ cert }: { cert: CertificateInfo }) {
  const subject = distinguishedNameFormatted(cert.subject)
  const issuer = distinguishedNameFormatted(cert.issuer)

  const rows: [string, string][] = [
    ['Subject', subject.length > 0 ? subject : '(empty)'],
    ['Issuer', issuer.length > 0 ? issuer : '(empty)'],
    ['Not before', formatDate(cert.notBefore)],
    ['Not after', formatDate(cert.notAfter)],
    ['Serial (hex)', cert.serialNumberHex],
    ['Serial (decimal)', cert.serialNumberDecimal],
    ['Version', `v${cert.version}`],
    ['Signature algorithm', cert.signatureAlgorithm],
    ['Public key', publicKeySummary(cert)],
  ]
  if (cert.subjectAlternativeNames.length > 0) {
    rows.push(['Subject alternative names', cert.subjectAlternativeNames.join(', ')])
  }
  if (cert.keyUsage.length > 0) rows.push(['Key usage', cert.keyUsage.join(', ')])
  if (cert.extendedKeyUsage.length > 0) rows.push(['Extended key usage', cert.extendedKeyUsage.join(', ')])
  if (cert.pathLengthConstraint != null) {
    rows.push(['Path length constraint', String(cert.pathLengthConstraint)])
  }
  if (cert.crlDistributionPoints.length > 0) {
    rows.push(['CRL distribution points', cert.crlDistributionPoints.join('\n')])
  }

  const fingerprints: [string, string][] = [
    ['SHA-256', cert.sha256Fingerprint],
    ['SHA-1', cert.sha1Fingerprint],
    ['MD5', cert.md5Fingerprint],
  ]

  return (
    <div className="rounded-lg border border-border/60 bg-background p-4">
      <div className="mb-1 flex items-start justify-between gap-3">
        <p className="text-base font-semibold">{cert.displayName}</p>
        {statusBadge(cert)}
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {cert.isSelfSigned ? <Badge variant="outline">Self-signed</Badge> : null}
        {cert.isCertificateAuthority ? <Badge variant="outline">CA</Badge> : null}
      </div>
      <Table>
        <TableBody>
          {rows.map(([label, value]) => (
            <TableRow key={label}>
              <TableCell className="w-48 align-top text-xs font-medium text-muted-foreground">{label}</TableCell>
              <TableCell className="whitespace-pre-wrap break-all align-top text-sm">{value}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-4 mb-1.5 text-xs font-medium text-muted-foreground">Fingerprints</p>
      <Table>
        <TableBody>
          {fingerprints.map(([label, hex]) => (
            <TableRow key={label}>
              <TableCell className="w-48 align-top text-xs font-medium text-muted-foreground">{label}</TableCell>
              <TableCell className="whitespace-pre-wrap break-all align-top font-mono text-xs">{hex}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
