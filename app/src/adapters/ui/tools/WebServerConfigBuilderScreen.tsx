import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { BalancedFlowScaffold } from '@/adapters/ui/shell/BalancedFlowScaffold'
import {
  ApacheConfigBuilder,
  NginxConfigBuilder,
  kApacheAllowOverrideValues,
  webServerEngineLabel,
  type ApacheAllowOverride,
  type ApacheVHostInput,
  type NginxServerInput,
  type WebServerEngine,
  type WebServerWarning,
} from '@/core/config/webServerConfigBuilder'

const nginxBuilder = new NginxConfigBuilder()
const apacheBuilder = new ApacheConfigBuilder()

const kDefaultNginxInput: NginxServerInput = {
  serverName: 'example.com',
  listen: '80',
  root: '/var/www/html',
  index: 'index.html index.htm',
}

const kDefaultApacheInput: ApacheVHostInput = {
  serverName: 'example.com',
  port: '80',
  documentRoot: '/var/www/html',
  allowOverride: 'None',
  requireAllGranted: true,
}

export function WebServerConfigBuilderScreen() {
  const [engine, setEngine] = useState<WebServerEngine>('nginx')
  const [nginxInput, setNginxInput] = useState<NginxServerInput>(kDefaultNginxInput)
  const [apacheInput, setApacheInput] = useState<ApacheVHostInput>(kDefaultApacheInput)

  function updateNginx(patch: Partial<NginxServerInput>) {
    setNginxInput((prev) => ({ ...prev, ...patch }))
  }
  function updateApache(patch: Partial<ApacheVHostInput>) {
    setApacheInput((prev) => ({ ...prev, ...patch }))
  }

  const result = useMemo(() => {
    try {
      const { config, warnings } = engine === 'nginx' ? nginxBuilder.execute(nginxInput) : apacheBuilder.execute(apacheInput)
      return { config, warnings, error: null as string | null }
    } catch (e) {
      return { config: null, warnings: [] as WebServerWarning[], error: e instanceof Error ? e.message : String(e) }
    }
  }, [engine, nginxInput, apacheInput])

  return (
    <BalancedFlowScaffold
      title="Web Server Config Builder"
      copyText={result.config ?? undefined}
      configLabel="INPUT"
      resultsLabel="ADVISORIES"
      previewLabel={engine === 'nginx' ? 'nginx server block' : 'Apache VirtualHost'}
      configPanel={
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-sm font-medium">Web server</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={engine === 'nginx' ? 'default' : 'outline'} onClick={() => setEngine('nginx')}>
                nginx
              </Button>
              <Button type="button" size="sm" variant={engine === 'apache' ? 'default' : 'outline'} onClick={() => setEngine('apache')}>
                Apache (httpd)
              </Button>
            </div>
          </div>
          {engine === 'nginx' ? <NginxForm state={nginxInput} onChange={updateNginx} /> : <ApacheForm state={apacheInput} onChange={updateApache} />}
        </div>
      }
      resultsPanel={
        result.error ? (
          <p className="text-sm text-muted-foreground">Fix the input error on the left to see advisories.</p>
        ) : result.warnings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No advisories — {webServerEngineLabel(engine)} config looks consistent.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {result.warnings.map((w, i) => (
              <div
                key={i}
                className={`rounded-lg border px-3 py-2 text-sm ${w.severity === 'critical' ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border/60 bg-card text-muted-foreground'}`}
              >
                {w.message}
              </div>
            ))}
          </div>
        )
      }
      previewPanel={
        result.error ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : (
          <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-background p-4 font-mono text-xs">
            {result.config}
          </pre>
        )
      }
    />
  )
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div>
        <Label className="font-normal">{label}</Label>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function NginxForm({ state, onChange }: { state: NginxServerInput; onChange: (patch: Partial<NginxServerInput>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nginx-server-name">server_name</Label>
          <Input id="nginx-server-name" value={state.serverName} onChange={(e) => onChange({ serverName: e.target.value })} placeholder="example.com" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nginx-listen">listen</Label>
          <Input id="nginx-listen" value={state.listen ?? ''} onChange={(e) => onChange({ listen: e.target.value })} placeholder="80" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nginx-root">root</Label>
          <Input id="nginx-root" value={state.root ?? ''} onChange={(e) => onChange({ root: e.target.value })} placeholder="/var/www/html" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nginx-index">index</Label>
          <Input id="nginx-index" value={state.index ?? ''} onChange={(e) => onChange({ index: e.target.value })} placeholder="index.html index.htm" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nginx-access-log">access_log</Label>
          <Input id="nginx-access-log" className="font-mono text-xs" value={state.accessLog ?? ''} onChange={(e) => onChange({ accessLog: e.target.value })} placeholder="/var/log/nginx/access.log" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nginx-error-log">error_log</Label>
          <Input id="nginx-error-log" className="font-mono text-xs" value={state.errorLog ?? ''} onChange={(e) => onChange({ errorLog: e.target.value })} placeholder="/var/log/nginx/error.log" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nginx-max-body">client_max_body_size</Label>
          <Input id="nginx-max-body" value={state.clientMaxBodySize ?? ''} onChange={(e) => onChange({ clientMaxBodySize: e.target.value })} placeholder="1m (nginx default)" />
        </div>
      </div>

      <ToggleRow label="Enable gzip" checked={state.enableGzip ?? false} onChange={(v) => onChange({ enableGzip: v })} />

      <div className="border-t border-border/60 pt-3">
        <ToggleRow
          label="Enable SSL"
          description="Adds ssl_certificate/ssl_certificate_key/ssl_protocols and session cache settings."
          checked={state.enableSsl ?? false}
          onChange={(v) => onChange({ enableSsl: v, listen: v && (state.listen ?? '80') === '80' ? '443' : state.listen })}
        />
        {state.enableSsl ? (
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nginx-ssl-cert">ssl_certificate</Label>
              <Input id="nginx-ssl-cert" className="font-mono text-xs" value={state.sslCertificate ?? ''} onChange={(e) => onChange({ sslCertificate: e.target.value })} placeholder="/etc/letsencrypt/live/example.com/fullchain.pem" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nginx-ssl-key">ssl_certificate_key</Label>
              <Input id="nginx-ssl-key" className="font-mono text-xs" value={state.sslCertificateKey ?? ''} onChange={(e) => onChange({ sslCertificateKey: e.target.value })} placeholder="/etc/letsencrypt/live/example.com/privkey.pem" />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="nginx-ssl-protocols">ssl_protocols</Label>
              <Input id="nginx-ssl-protocols" value={state.sslProtocols ?? ''} onChange={(e) => onChange({ sslProtocols: e.target.value })} placeholder="TLSv1.2 TLSv1.3" />
            </div>
            <div className="sm:col-span-2">
              <ToggleRow
                label="Redirect HTTP → HTTPS"
                description="Adds a second server{} on port 80 that 301s to https."
                checked={state.redirectHttpToHttps ?? false}
                onChange={(v) => onChange({ redirectHttpToHttps: v })}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-border/60 pt-3">
        <ToggleRow
          label="Reverse proxy"
          description="Replaces the static location / with proxy_pass and the standard forwarding headers."
          checked={state.enableReverseProxy ?? false}
          onChange={(v) => onChange({ enableReverseProxy: v })}
        />
        {state.enableReverseProxy ? (
          <div className="mt-2 flex flex-col gap-1.5">
            <Label htmlFor="nginx-proxy-target">proxy_pass target</Label>
            <Input id="nginx-proxy-target" className="font-mono text-xs" value={state.proxyPassTarget ?? ''} onChange={(e) => onChange({ proxyPassTarget: e.target.value })} placeholder="http://127.0.0.1:3000" />
          </div>
        ) : null}
      </div>

      <div className="border-t border-border/60 pt-3">
        <ToggleRow
          label="Security headers"
          description="X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and HSTS when SSL is on."
          checked={state.enableSecurityHeaders ?? false}
          onChange={(v) => onChange({ enableSecurityHeaders: v })}
        />
      </div>
    </div>
  )
}

function ApacheForm({ state, onChange }: { state: ApacheVHostInput; onChange: (patch: Partial<ApacheVHostInput>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="apache-server-name">ServerName</Label>
          <Input id="apache-server-name" value={state.serverName} onChange={(e) => onChange({ serverName: e.target.value })} placeholder="example.com" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="apache-server-alias">ServerAlias</Label>
          <Input id="apache-server-alias" value={state.serverAlias ?? ''} onChange={(e) => onChange({ serverAlias: e.target.value })} placeholder="www.example.com" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="apache-port">Port</Label>
          <Input id="apache-port" value={state.port ?? ''} onChange={(e) => onChange({ port: e.target.value })} placeholder="80" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="apache-document-root">DocumentRoot</Label>
          <Input id="apache-document-root" value={state.documentRoot ?? ''} onChange={(e) => onChange({ documentRoot: e.target.value })} placeholder="/var/www/html" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="apache-error-log">ErrorLog</Label>
          <Input id="apache-error-log" className="font-mono text-xs" value={state.errorLog ?? ''} onChange={(e) => onChange({ errorLog: e.target.value })} placeholder="/var/log/apache2/error.log" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="apache-custom-log">CustomLog</Label>
          <Input id="apache-custom-log" className="font-mono text-xs" value={state.customLog ?? ''} onChange={(e) => onChange({ customLog: e.target.value })} placeholder="/var/log/apache2/access.log" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="apache-allow-override">AllowOverride</Label>
          <Select value={state.allowOverride ?? 'None'} onValueChange={(v) => onChange({ allowOverride: (v ?? 'None') as ApacheAllowOverride })}>
            <SelectTrigger id="apache-allow-override" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kApacheAllowOverrideValues.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ToggleRow
        label="Require all granted"
        description='Off emits "Require all denied" instead — useful as a scaffold you intend to lock down further.'
        checked={state.requireAllGranted ?? true}
        onChange={(v) => onChange({ requireAllGranted: v })}
      />

      <div className="border-t border-border/60 pt-3">
        <ToggleRow
          label="Enable SSL"
          description="Adds SSLEngine on plus SSLCertificateFile/SSLCertificateKeyFile."
          checked={state.enableSsl ?? false}
          onChange={(v) => onChange({ enableSsl: v, port: v && (state.port ?? '80') === '80' ? '443' : state.port })}
        />
        {state.enableSsl ? (
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="apache-ssl-cert">SSLCertificateFile</Label>
              <Input id="apache-ssl-cert" className="font-mono text-xs" value={state.sslCertificateFile ?? ''} onChange={(e) => onChange({ sslCertificateFile: e.target.value })} placeholder="/etc/letsencrypt/live/example.com/fullchain.pem" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="apache-ssl-key">SSLCertificateKeyFile</Label>
              <Input id="apache-ssl-key" className="font-mono text-xs" value={state.sslCertificateKeyFile ?? ''} onChange={(e) => onChange({ sslCertificateKeyFile: e.target.value })} placeholder="/etc/letsencrypt/live/example.com/privkey.pem" />
            </div>
            <div className="sm:col-span-2">
              <ToggleRow
                label="Redirect HTTP → HTTPS"
                description="Adds a second VirtualHost *:80 that redirects to https."
                checked={state.redirectHttpToHttps ?? false}
                onChange={(v) => onChange({ redirectHttpToHttps: v })}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-border/60 pt-3">
        <ToggleRow
          label="Reverse proxy"
          description="Adds ProxyRequests Off, ProxyPreserveHost On, ProxyPass and ProxyPassReverse."
          checked={state.enableReverseProxy ?? false}
          onChange={(v) => onChange({ enableReverseProxy: v })}
        />
        {state.enableReverseProxy ? (
          <div className="mt-2 flex flex-col gap-1.5">
            <Label htmlFor="apache-proxy-target">ProxyPass target</Label>
            <Input id="apache-proxy-target" className="font-mono text-xs" value={state.proxyPassTarget ?? ''} onChange={(e) => onChange({ proxyPassTarget: e.target.value })} placeholder="http://127.0.0.1:3000" />
          </div>
        ) : null}
      </div>
    </div>
  )
}
