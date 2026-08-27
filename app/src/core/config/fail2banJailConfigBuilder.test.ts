import { describe, expect, it } from 'vitest'
import {
  Fail2banJailConfigBuilder,
  fail2banActionPresetLabel,
  fail2banJailCategoryValues,
  fail2banJailPresetFor,
  kFail2banJailCatalog,
} from './fail2banJailConfigBuilder'

describe('Fail2banJailConfigBuilder', () => {
  const builder = new Fail2banJailConfigBuilder()

  it('emits DEFAULT with fallback values and a no-jails hint when nothing is configured', () => {
    const output = builder.execute({})
    expect(output).toContain('[DEFAULT]')
    expect(output).toContain('bantime = 10m')
    expect(output).toContain('findtime = 10m')
    expect(output).toContain('maxretry = 5')
    expect(output).toContain('backend = auto')
    expect(output).toContain('action = %(action_)s')
    expect(output).toContain('No jails enabled')
    // banOnly preset never emits notification fields even if supplied.
    expect(output).not.toContain('destemail')
  })

  it('overrides DEFAULT fields and validates duration syntax', () => {
    const output = builder.execute({
      defaults: { bantime: '1h', findtime: '5m', maxretry: '3', ignoreIp: '127.0.0.1/8 ::1', backend: 'systemd' },
    })
    expect(output).toContain('bantime = 1h')
    expect(output).toContain('findtime = 5m')
    expect(output).toContain('maxretry = 3')
    expect(output).toContain('backend = systemd')
    expect(output).toContain('ignoreip = 127.0.0.1/8 ::1')
  })

  it('rejects a malformed bantime', () => {
    expect(() => builder.execute({ defaults: { bantime: 'forever' } })).toThrow(/bantime/)
  })

  it('accepts -1 as a permanent ban duration', () => {
    const output = builder.execute({ defaults: { bantime: '-1' } })
    expect(output).toContain('bantime = -1')
  })

  it('rejects a non-numeric maxretry', () => {
    expect(() => builder.execute({ defaults: { maxretry: 'lots' } })).toThrow(/maxretry/)
  })

  it('rejects an implausible ignoreip token', () => {
    expect(() => builder.execute({ defaults: { ignoreIp: 'not-an-ip' } })).toThrow(/ignoreip/)
  })

  it('email action presets emit destemail/sender/mta, banOnly does not', () => {
    const withEmail = builder.execute({
      defaults: { actionPreset: 'banWithEmail', destEmail: 'ops@example.com', sender: 'fail2ban@example.com', mta: 'sendmail' },
    })
    expect(withEmail).toContain('action = %(action_mw)s')
    expect(withEmail).toContain('destemail = ops@example.com')
    expect(withEmail).toContain('sender = fail2ban@example.com')
    expect(withEmail).toContain('mta = sendmail')

    const banOnly = builder.execute({
      defaults: { actionPreset: 'banOnly', destEmail: 'ops@example.com' },
    })
    expect(banOnly).not.toContain('destemail')
  })

  it('renders only enabled jails, each as a minimal [section] block', () => {
    const output = builder.execute({
      jails: [
        { id: 'sshd', enabled: true },
        { id: 'nginx-http-auth', enabled: false },
        { id: 'postfix', enabled: true, maxretry: '2', port: 'smtp,465' },
      ],
    })
    expect(output).toContain('[sshd]')
    expect(output).toContain('[postfix]')
    expect(output).not.toContain('[nginx-http-auth]')
    expect(output).toContain('maxretry = 2')
    expect(output).toContain('port = smtp,465')
  })

  it('ignores a jail selection id not present in the catalog', () => {
    const output = builder.execute({ jails: [{ id: 'not-a-real-jail', enabled: true }] })
    expect(output).not.toContain('not-a-real-jail')
    expect(output).toContain('No jails enabled')
  })

  it('every catalog entry resolves to a known category and has a description', () => {
    for (const preset of kFail2banJailCatalog) {
      expect(fail2banJailCategoryValues).toContain(preset.category)
      expect(preset.description.length).toBeGreaterThan(0)
      expect(fail2banJailPresetFor(preset.id)).toBe(preset)
    }
  })

  it('exposes a human label for every action preset', () => {
    expect(fail2banActionPresetLabel('banOnly')).toBeTruthy()
    expect(fail2banActionPresetLabel('banWithEmail')).toBeTruthy()
    expect(fail2banActionPresetLabel('banWithEmailAndWhois')).toBeTruthy()
  })
})
