import { describe, expect, it } from 'vitest'
import { ApacheConfigBuilder, NginxConfigBuilder, sslWithoutRedirectCode, webServerEngineLabel } from './webServerConfigBuilder'

describe('NginxConfigBuilder', () => {
  const builder = new NginxConfigBuilder()

  it('renders a minimal static server block with sane defaults', () => {
    const { config, warnings } = builder.execute({ serverName: 'example.com' })
    expect(config).toContain('server {')
    expect(config).toContain('listen 80;')
    expect(config).toContain('server_name example.com;')
    expect(config).toContain('root /var/www/html;')
    expect(config).toContain('try_files $uri $uri/ =404;')
    expect(config).not.toContain('proxy_pass')
    expect(warnings).toEqual([])
  })

  it('requires serverName', () => {
    expect(() => builder.execute({ serverName: '  ' })).toThrow(/server_name/)
  })

  it('requires cert + key when SSL is enabled', () => {
    expect(() => builder.execute({ serverName: 'x.com', enableSsl: true })).toThrow(/ssl_certificate/)
  })

  it('emits an SSL server block with the ngx_http_ssl_module defaults', () => {
    const { config } = builder.execute({
      serverName: 'x.com',
      listen: '443',
      enableSsl: true,
      sslCertificate: '/etc/ssl/x.com.crt',
      sslCertificateKey: '/etc/ssl/x.com.key',
    })
    expect(config).toContain('listen 443 ssl;')
    expect(config).toContain('ssl_certificate /etc/ssl/x.com.crt;')
    expect(config).toContain('ssl_certificate_key /etc/ssl/x.com.key;')
    expect(config).toContain('ssl_protocols TLSv1.2 TLSv1.3;')
    expect(config).toContain('ssl_session_cache shared:SSL:10m;')
  })

  it('warns when SSL is on without an HTTP->HTTPS redirect', () => {
    const { warnings } = builder.execute({
      serverName: 'x.com',
      enableSsl: true,
      sslCertificate: 'c',
      sslCertificateKey: 'k',
    })
    expect(warnings.some((w) => w.code === sslWithoutRedirectCode)).toBe(true)
  })

  it('emits a leading redirect server block when redirectHttpToHttps is set', () => {
    const { config, warnings } = builder.execute({
      serverName: 'x.com',
      enableSsl: true,
      sslCertificate: 'c',
      sslCertificateKey: 'k',
      redirectHttpToHttps: true,
    })
    expect(config).toContain('return 301 https://$host$request_uri;')
    expect(warnings.some((w) => w.code === sslWithoutRedirectCode)).toBe(false)
  })

  it('ignores redirectHttpToHttps when SSL is not enabled', () => {
    const { config } = builder.execute({ serverName: 'x.com', redirectHttpToHttps: true })
    expect(config).not.toContain('return 301')
  })

  it('requires a proxy target when reverse proxy is enabled, and validates its shape', () => {
    expect(() => builder.execute({ serverName: 'x.com', enableReverseProxy: true })).toThrow(/proxy_pass target/)
    expect(() => builder.execute({ serverName: 'x.com', enableReverseProxy: true, proxyPassTarget: 'not-a-url' })).toThrow(
      /proxy_pass target/,
    )
  })

  it('emits a proxy location block with the standard forwarding headers', () => {
    const { config } = builder.execute({ serverName: 'x.com', enableReverseProxy: true, proxyPassTarget: 'http://127.0.0.1:3000' })
    expect(config).toContain('proxy_pass http://127.0.0.1:3000;')
    expect(config).toContain('proxy_set_header Host $host;')
    expect(config).toContain('proxy_set_header X-Forwarded-Proto $scheme;')
    expect(config).not.toContain('try_files')
  })

  it('includes HSTS only when both security headers and SSL are enabled', () => {
    const sslOnly = builder.execute({ serverName: 'x.com', enableSsl: true, sslCertificate: 'c', sslCertificateKey: 'k' })
    expect(sslOnly.config).not.toContain('Strict-Transport-Security')

    const both = builder.execute({
      serverName: 'x.com',
      enableSsl: true,
      sslCertificate: 'c',
      sslCertificateKey: 'k',
      enableSecurityHeaders: true,
    })
    expect(both.config).toContain('Strict-Transport-Security')
    expect(both.config).toContain('X-Frame-Options SAMEORIGIN')

    const headersNoSsl = builder.execute({ serverName: 'x.com', enableSecurityHeaders: true })
    expect(headersNoSsl.config).toContain('X-Content-Type-Options nosniff')
    expect(headersNoSsl.config).not.toContain('Strict-Transport-Security')
  })
})

describe('ApacheConfigBuilder', () => {
  const builder = new ApacheConfigBuilder()

  it('renders a minimal VirtualHost with sane defaults', () => {
    const { config, warnings } = builder.execute({ serverName: 'example.com' })
    expect(config).toContain('<VirtualHost *:80>')
    expect(config).toContain('ServerName example.com')
    expect(config).toContain('DocumentRoot /var/www/html')
    expect(config).toContain('AllowOverride None')
    expect(config).toContain('Require all granted')
    expect(config).not.toContain('ProxyPass')
    expect(warnings).toEqual([])
  })

  it('requires ServerName', () => {
    expect(() => builder.execute({ serverName: '' })).toThrow(/ServerName/)
  })

  it('Require all denied when requireAllGranted is false', () => {
    const { config } = builder.execute({ serverName: 'x.com', requireAllGranted: false })
    expect(config).toContain('Require all denied')
  })

  it('requires cert + key when SSL is enabled', () => {
    expect(() => builder.execute({ serverName: 'x.com', enableSsl: true })).toThrow(/SSLCertificateFile/)
  })

  it('emits SSLEngine on plus both cert paths', () => {
    const { config } = builder.execute({
      serverName: 'x.com',
      port: '443',
      enableSsl: true,
      sslCertificateFile: '/etc/ssl/x.crt',
      sslCertificateKeyFile: '/etc/ssl/x.key',
    })
    expect(config).toContain('<VirtualHost *:443>')
    expect(config).toContain('SSLEngine on')
    expect(config).toContain('SSLCertificateFile /etc/ssl/x.crt')
    expect(config).toContain('SSLCertificateKeyFile /etc/ssl/x.key')
  })

  it('warns when SSL is on without an HTTP->HTTPS redirect', () => {
    const { warnings } = builder.execute({
      serverName: 'x.com',
      enableSsl: true,
      sslCertificateFile: 'c',
      sslCertificateKeyFile: 'k',
    })
    expect(warnings.some((w) => w.code === sslWithoutRedirectCode)).toBe(true)
  })

  it('emits a leading redirect VirtualHost when redirectHttpToHttps is set', () => {
    const { config, warnings } = builder.execute({
      serverName: 'x.com',
      enableSsl: true,
      sslCertificateFile: 'c',
      sslCertificateKeyFile: 'k',
      redirectHttpToHttps: true,
    })
    expect(config).toContain('Redirect permanent / https://x.com/')
    expect(warnings.some((w) => w.code === sslWithoutRedirectCode)).toBe(false)
  })

  it('requires a proxy target when reverse proxy is enabled, and validates its shape', () => {
    expect(() => builder.execute({ serverName: 'x.com', enableReverseProxy: true })).toThrow(/ProxyPass target/)
    expect(() => builder.execute({ serverName: 'x.com', enableReverseProxy: true, proxyPassTarget: 'nope' })).toThrow(/ProxyPass target/)
  })

  it('emits ProxyPass/ProxyPassReverse with ProxyPreserveHost on', () => {
    const { config } = builder.execute({ serverName: 'x.com', enableReverseProxy: true, proxyPassTarget: 'http://127.0.0.1:3000' })
    expect(config).toContain('ProxyRequests Off')
    expect(config).toContain('ProxyPreserveHost On')
    expect(config).toContain('ProxyPass / http://127.0.0.1:3000/')
    expect(config).toContain('ProxyPassReverse / http://127.0.0.1:3000/')
  })
})

it('webServerEngineLabel resolves both engines', () => {
  expect(webServerEngineLabel('nginx')).toBe('nginx')
  expect(webServerEngineLabel('apache')).toBe('Apache')
})
