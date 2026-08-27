import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Web server config builder — pure TypeScript, no I/O, no React.
 *
 * Unlike `zabbixConfigBuilder`/`sysctlConfigBuilder` (a flat catalog of
 * independent directives), nginx `server {}` blocks and Apache
 * `<VirtualHost>` blocks are nested and interdependent — a `location`
 * block only makes sense inside a `server`, `ProxyPass` needs
 * `ProxyPreserveHost` alongside it to behave sanely, and an HTTP→HTTPS
 * redirect is a second, separate block, not a line inside the first. A
 * flat "check the directives you want" catalog would either produce
 * invalid nesting or force the caller to hand-assemble the skeleton
 * themselves. So this builder takes a small set of structured, named
 * inputs (a document root, a proxy target, boolean toggles for whole
 * optional blocks) and always emits one complete, correctly-nested file —
 * the same shape `firewallRuleBuilder` and `databaseConfigBuilder` use for
 * their own structured/calculated output.
 *
 * References:
 *  - nginx.org/en/docs/http/ngx_http_core_module.html (listen, server_name, root, client_max_body_size)
 *  - nginx.org/en/docs/http/ngx_http_ssl_module.html (ssl_protocols default TLSv1.2/TLSv1.3, ssl_ciphers, session cache/timeout)
 *  - nginx.org/en/docs/http/ngx_http_proxy_module.html (proxy_pass, proxy_set_header, proxy_http_version)
 *  - httpd.apache.org/docs/2.4/mod/core.html (ServerName, DocumentRoot, Directory/AllowOverride/Require)
 *  - httpd.apache.org/docs/2.4/mod/mod_proxy.html (ProxyPass/ProxyPassReverse/ProxyPreserveHost/ProxyRequests)
 *  - httpd.apache.org/docs/2.4/mod/mod_ssl.html (SSLEngine/SSLCertificateFile/SSLCertificateKeyFile)
 */

export type WebServerEngine = 'nginx' | 'apache'

export function webServerEngineLabel(engine: WebServerEngine): string {
  return engine === 'nginx' ? 'nginx' : 'Apache'
}

// ===========================================================================
// Shared advisories
// ===========================================================================

export type WebServerWarningSeverity = 'critical' | 'caution'

export interface WebServerWarning {
  severity: WebServerWarningSeverity
  code: string
  message: string
}

export const sslWithoutRedirectCode = 'ssl-without-redirect'
export const proxyMissingTargetCode = 'proxy-missing-target'

// ===========================================================================
// nginx
// ===========================================================================

export interface NginxServerInput {
  listen?: string
  serverName: string
  root?: string
  index?: string
  accessLog?: string
  errorLog?: string
  /** Empty/undefined omits the directive (nginx's own default of 1m applies). */
  clientMaxBodySize?: string
  enableGzip?: boolean
  enableSsl?: boolean
  sslCertificate?: string
  sslCertificateKey?: string
  /** Defaults to `TLSv1.2 TLsv1.3`, ngx_http_ssl_module's own current default. */
  sslProtocols?: string
  /** Emits a second `server {}` on port 80 that 301-redirects to https. Only meaningful when `enableSsl` is set. */
  redirectHttpToHttps?: boolean
  enableReverseProxy?: boolean
  proxyPassTarget?: string
  /** Emits the common browser-hardening `add_header` lines, including HSTS only when `enableSsl` is set. */
  enableSecurityHeaders?: boolean
}

function requireNonBlank(field: string, value: string | undefined): string {
  const trimmed = (value ?? '').trim()
  if (trimmed.length === 0) throw new Error(`${field} must not be blank.`)
  return trimmed
}

function looksLikeProxyTarget(field: string, value: string): void {
  if (!/^https?:\/\/[^\s]+$/i.test(value)) {
    throw new Error(`${field} must be a URL like "http://127.0.0.1:3000" (got "${value}").`)
  }
}

export class NginxConfigBuilder implements IToolUseCase<NginxServerInput, { config: string; warnings: WebServerWarning[] }> {
  execute(input: NginxServerInput): { config: string; warnings: WebServerWarning[] } {
    const serverName = requireNonBlank('server_name', input.serverName)
    const listen = (input.listen?.trim() || '80')
    const root = input.root?.trim() || '/var/www/html'
    const index = input.index?.trim() || 'index.html index.htm'
    const enableSsl = input.enableSsl ?? false
    const redirectHttpToHttps = (input.redirectHttpToHttps ?? false) && enableSsl
    const enableReverseProxy = input.enableReverseProxy ?? false
    const enableGzip = input.enableGzip ?? false
    const enableSecurityHeaders = input.enableSecurityHeaders ?? false
    const sslProtocols = input.sslProtocols?.trim() || 'TLSv1.2 TLSv1.3'

    let sslCertificate = ''
    let sslCertificateKey = ''
    if (enableSsl) {
      sslCertificate = requireNonBlank('ssl_certificate', input.sslCertificate)
      sslCertificateKey = requireNonBlank('ssl_certificate_key', input.sslCertificateKey)
    }

    let proxyPassTarget = ''
    if (enableReverseProxy) {
      proxyPassTarget = requireNonBlank('proxy_pass target', input.proxyPassTarget)
      looksLikeProxyTarget('proxy_pass target', proxyPassTarget)
    }

    const warnings: WebServerWarning[] = []
    if (enableSsl && !redirectHttpToHttps) {
      warnings.push({
        severity: 'caution',
        code: sslWithoutRedirectCode,
        message: 'SSL is enabled but HTTP→HTTPS redirect is off — port 80 keeps serving this site in plaintext alongside 443.',
      })
    }

    const lines: string[] = []
    lines.push('# nginx config — generated by InfraKit Studio')
    lines.push('# References: nginx.org/en/docs/http/ngx_http_core_module.html, ngx_http_ssl_module.html, ngx_http_proxy_module.html')
    lines.push('')

    if (redirectHttpToHttps) {
      lines.push('server {')
      lines.push('    listen 80;')
      lines.push(`    server_name ${serverName};`)
      lines.push('    return 301 https://$host$request_uri;')
      lines.push('}')
      lines.push('')
    }

    lines.push('server {')
    lines.push(`    listen ${listen}${enableSsl && !listen.includes('ssl') ? ' ssl' : ''};`)
    lines.push(`    server_name ${serverName};`)
    lines.push('')
    lines.push(`    root ${root};`)
    lines.push(`    index ${index};`)
    if (input.accessLog?.trim()) lines.push(`    access_log ${input.accessLog.trim()};`)
    if (input.errorLog?.trim()) lines.push(`    error_log ${input.errorLog.trim()};`)
    if (input.clientMaxBodySize?.trim()) lines.push(`    client_max_body_size ${input.clientMaxBodySize.trim()};`)
    if (enableGzip) lines.push('    gzip on;')

    if (enableSsl) {
      lines.push('')
      lines.push(`    ssl_certificate ${sslCertificate};`)
      lines.push(`    ssl_certificate_key ${sslCertificateKey};`)
      lines.push(`    ssl_protocols ${sslProtocols};`)
      lines.push('    ssl_prefer_server_ciphers on;')
      lines.push('    ssl_session_cache shared:SSL:10m;')
      lines.push('    ssl_session_timeout 5m;')
    }

    if (enableSecurityHeaders) {
      lines.push('')
      lines.push('    add_header X-Frame-Options SAMEORIGIN always;')
      lines.push('    add_header X-Content-Type-Options nosniff always;')
      lines.push('    add_header Referrer-Policy "no-referrer-when-downgrade" always;')
      if (enableSsl) {
        lines.push('    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;')
      }
    }

    lines.push('')
    if (enableReverseProxy) {
      lines.push('    location / {')
      lines.push(`        proxy_pass ${proxyPassTarget};`)
      lines.push('        proxy_http_version 1.1;')
      lines.push('        proxy_set_header Host $host;')
      lines.push('        proxy_set_header X-Real-IP $remote_addr;')
      lines.push('        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;')
      lines.push('        proxy_set_header X-Forwarded-Proto $scheme;')
      lines.push('    }')
    } else {
      lines.push('    location / {')
      lines.push('        try_files $uri $uri/ =404;')
      lines.push('    }')
    }

    lines.push('}')

    return { config: lines.join('\n') + '\n', warnings }
  }
}

// ===========================================================================
// Apache
// ===========================================================================

export type ApacheAllowOverride = 'None' | 'All' | 'FileInfo' | 'AuthConfig'

export const kApacheAllowOverrideValues: ApacheAllowOverride[] = ['None', 'All', 'FileInfo', 'AuthConfig']

export interface ApacheVHostInput {
  /** Port the VirtualHost binds, e.g. `80` or `443`. Rendered as `*:PORT`. */
  port?: string
  serverName: string
  serverAlias?: string
  documentRoot?: string
  errorLog?: string
  customLog?: string
  allowOverride?: ApacheAllowOverride
  /** `Require all granted` when true (default), `Require all denied` when false. */
  requireAllGranted?: boolean
  enableSsl?: boolean
  sslCertificateFile?: string
  sslCertificateKeyFile?: string
  /** Emits a second `<VirtualHost *:80>` that redirects to https. Only meaningful when `enableSsl` is set. */
  redirectHttpToHttps?: boolean
  enableReverseProxy?: boolean
  proxyPassTarget?: string
}

export class ApacheConfigBuilder implements IToolUseCase<ApacheVHostInput, { config: string; warnings: WebServerWarning[] }> {
  execute(input: ApacheVHostInput): { config: string; warnings: WebServerWarning[] } {
    const serverName = requireNonBlank('ServerName', input.serverName)
    const port = input.port?.trim() || '80'
    const documentRoot = input.documentRoot?.trim() || '/var/www/html'
    const allowOverride = input.allowOverride ?? 'None'
    const requireAllGranted = input.requireAllGranted ?? true
    const enableSsl = input.enableSsl ?? false
    const redirectHttpToHttps = (input.redirectHttpToHttps ?? false) && enableSsl
    const enableReverseProxy = input.enableReverseProxy ?? false

    let sslCertificateFile = ''
    let sslCertificateKeyFile = ''
    if (enableSsl) {
      sslCertificateFile = requireNonBlank('SSLCertificateFile', input.sslCertificateFile)
      sslCertificateKeyFile = requireNonBlank('SSLCertificateKeyFile', input.sslCertificateKeyFile)
    }

    let proxyPassTarget = ''
    if (enableReverseProxy) {
      proxyPassTarget = requireNonBlank('ProxyPass target', input.proxyPassTarget)
      looksLikeProxyTarget('ProxyPass target', proxyPassTarget)
    }

    const warnings: WebServerWarning[] = []
    if (enableSsl && !redirectHttpToHttps) {
      warnings.push({
        severity: 'caution',
        code: sslWithoutRedirectCode,
        message: 'SSL is enabled but HTTP→HTTPS redirect is off — port 80 keeps serving this site in plaintext alongside the SSL vhost.',
      })
    }

    const lines: string[] = []
    lines.push('# Apache VirtualHost — generated by InfraKit Studio')
    lines.push('# References: httpd.apache.org/docs/2.4/mod/core.html, mod_ssl.html, mod_proxy.html')
    lines.push('')

    if (redirectHttpToHttps) {
      lines.push('<VirtualHost *:80>')
      lines.push(`    ServerName ${serverName}`)
      lines.push(`    Redirect permanent / https://${serverName}/`)
      lines.push('</VirtualHost>')
      lines.push('')
    }

    lines.push(`<VirtualHost *:${port}>`)
    lines.push(`    ServerName ${serverName}`)
    if (input.serverAlias?.trim()) lines.push(`    ServerAlias ${input.serverAlias.trim()}`)
    lines.push(`    DocumentRoot ${documentRoot}`)
    if (input.errorLog?.trim()) lines.push(`    ErrorLog ${input.errorLog.trim()}`)
    if (input.customLog?.trim()) lines.push(`    CustomLog ${input.customLog.trim()} combined`)

    lines.push('')
    lines.push(`    <Directory ${documentRoot}>`)
    lines.push(`        AllowOverride ${allowOverride}`)
    lines.push(`        Require all ${requireAllGranted ? 'granted' : 'denied'}`)
    lines.push('    </Directory>')

    if (enableSsl) {
      lines.push('')
      lines.push('    SSLEngine on')
      lines.push(`    SSLCertificateFile ${sslCertificateFile}`)
      lines.push(`    SSLCertificateKeyFile ${sslCertificateKeyFile}`)
    }

    if (enableReverseProxy) {
      lines.push('')
      lines.push('    ProxyRequests Off')
      lines.push('    ProxyPreserveHost On')
      lines.push(`    ProxyPass / ${proxyPassTarget}/`)
      lines.push(`    ProxyPassReverse / ${proxyPassTarget}/`)
    }

    lines.push('</VirtualHost>')

    return { config: lines.join('\n') + '\n', warnings }
  }
}
