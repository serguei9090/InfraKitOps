import { useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import {
  X509Inspector,
  distinguishedNameFormatted,
  type CertificateInfo,
  type CertificateValidityStatus,
} from '@/core/utility/x509Inspector'

const inspector = new X509Inspector()

export function X509InspectorScreen() {
  const [pemText, setPemText] = useState('')

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
        <div className="flex max-w-xl flex-col gap-1.5">
          <Label htmlFor="x509-pem">Certificate PEM text</Label>
          <p className="text-xs text-muted-foreground">
            Paste a PEM-encoded certificate. A fullchain PEM with multiple certificates works too — one bad
            block does not hide the rest.
          </p>
          <Textarea
            id="x509-pem"
            rows={16}
            className="font-mono text-xs"
            placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
            value={pemText}
            onChange={(e) => setPemText(e.target.value)}
          />
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
