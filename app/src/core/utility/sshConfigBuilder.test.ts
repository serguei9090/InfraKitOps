import { describe, expect, it } from 'vitest'
import {
  SSH_HARDENED_CIPHERS,
  SSH_HARDENED_HOST_KEY_ALGORITHMS,
  SSH_HARDENED_KEX_ALGORITHMS,
  SSH_HARDENED_MACS,
  SSH_OPTION_CATALOG,
  SshConfigBuilder,
  sshDeprecatedAlgorithmsIn,
  sshGroupsForMode,
  sshHardenedBaseline,
  sshOptionFor,
  sshOptionsForMode,
} from './sshConfigBuilder'

describe('SshConfigBuilder', () => {
  const builder = new SshConfigBuilder()

  /**
   * Everything after the leading `#` header comment block, so assertions on
   * directive layout are not coupled to header wording.
   */
  function body(config: string): string {
    return config
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n')
      .trim()
  }

  describe('client config', () => {
    it('renders a Host block with indented directives in catalog order', () => {
      const result = builder.execute({
        hostBlocks: [
          {
            pattern: 'prod-web-1',
            values: {
              HostName: '203.0.113.10',
              User: 'deploy',
              Port: '2222',
              IdentityFile: '~/.ssh/id_ed25519',
              IdentitiesOnly: 'yes',
              ProxyJump: 'bastion',
            },
          },
        ],
      })

      expect(body(result.configText)).toBe(
        'Host prod-web-1\n' +
          '    HostName 203.0.113.10\n' +
          '    User deploy\n' +
          '    Port 2222\n' +
          '    ProxyJump bastion\n' +
          '    IdentityFile ~/.ssh/id_ed25519\n' +
          '    IdentitiesOnly yes',
      )
      expect(result.suggestedFileName).toBe('config')
    })

    it('renders multiple Host blocks separated by a blank line, in order', () => {
      const result = builder.execute({
        hostBlocks: [
          { pattern: 'alpha', values: { HostName: 'alpha.example.com', User: 'root' } },
          { pattern: 'beta', values: { HostName: 'beta.example.com', Port: '22' } },
          { pattern: 'web-* db-*', values: { User: 'ops' } },
        ],
      })

      expect(body(result.configText)).toBe(
        'Host alpha\n' +
          '    HostName alpha.example.com\n' +
          '    User root\n' +
          '\n' +
          'Host beta\n' +
          '    HostName beta.example.com\n' +
          '    Port 22\n' +
          '\n' +
          'Host web-* db-*\n' +
          '    User ops',
      )
    })

    it('Host * defaults are emitted last, after every named block', () => {
      const result = builder.execute({
        hostBlocks: [{ pattern: 'alpha', values: { HostName: 'alpha.example.com' } }],
        globalDefaults: { HashKnownHosts: 'yes', ForwardAgent: 'no' },
      })

      const text = result.configText
      expect(text.indexOf('Host alpha')).toBeLessThan(text.indexOf('Host *'))
      expect(text).toContain('Host *\n    HashKnownHosts yes\n    ForwardAgent no')
    })

    it('header carries the ~/.ssh/config 600 permission reminder', () => {
      const result = builder.execute({
        hostBlocks: [{ pattern: 'h', values: { HostName: 'h.example.com' } }],
      })

      expect(result.configText.startsWith('# ~/.ssh/config')).toBe(true)
      expect(result.configText).toContain('chmod 700 ~/.ssh')
      expect(result.configText).toContain('600')
    })

    it('includeHeader false emits directives only', () => {
      const result = builder.execute({
        hostBlocks: [{ pattern: 'h', values: { HostName: 'h.example.com' } }],
        includeHeader: false,
      })

      expect(result.configText).toBe('Host h\n    HostName h.example.com\n')
    })

    it('unselected options are absent from the output', () => {
      const result = builder.execute({
        hostBlocks: [{ pattern: 'minimal', values: { HostName: 'example.com' } }],
        includeHeader: false,
      })

      // Nothing beyond what was asked for — no restated OpenSSH defaults.
      expect(result.configText).toBe('Host minimal\n    HostName example.com\n')
      for (const option of sshOptionsForMode('client')) {
        if (option.key === 'HostName') continue
        expect(body(result.configText)).not.toContain(option.key)
      }
    })

    it('booleans always render as yes/no', () => {
      const result = builder.execute({
        hostBlocks: [{ pattern: 'h', values: { TCPKeepAlive: 'YES', ForwardX11: 'No' } }],
        includeHeader: false,
      })

      expect(result.configText).toContain('    TCPKeepAlive yes\n')
      expect(result.configText).toContain('    ForwardX11 no\n')
    })

    it('a block comment renders above the Host line', () => {
      const result = builder.execute({
        hostBlocks: [{ pattern: 'h', values: { HostName: 'h.example.com' }, comment: 'staging cluster' }],
        includeHeader: false,
      })

      expect(result.configText).toBe('# staging cluster\nHost h\n    HostName h.example.com\n')
    })
  })

  describe('server config', () => {
    it('renders a flat, unindented directive list in catalog order', () => {
      const result = builder.execute({
        mode: 'server',
        includeHeader: false,
        serverValues: {
          Port: '22',
          PermitRootLogin: 'no',
          PasswordAuthentication: 'no',
          KbdInteractiveAuthentication: 'no',
          MaxAuthTries: '3',
          AllowGroups: 'sshusers',
          X11Forwarding: 'no',
          LogLevel: 'VERBOSE',
        },
      })

      expect(result.configText).toBe(
        // Catalog order, not the order keys were supplied: directives are
        // emitted by group order then position within the catalog, so the
        // shared client/server auth options precede the server-only
        // PermitRootLogin even though it was listed first above.
        'Port 22\n' +
          'PasswordAuthentication no\n' +
          'KbdInteractiveAuthentication no\n' +
          'PermitRootLogin no\n' +
          'MaxAuthTries 3\n' +
          'AllowGroups sshusers\n' +
          'X11Forwarding no\n' +
          'LogLevel VERBOSE\n',
      )
      expect(result.suggestedFileName).toBe('sshd_config')
    })

    it('header tells the user to validate with sshd -t before restarting', () => {
      const result = builder.execute({
        mode: 'server',
        serverValues: { PermitRootLogin: 'no' },
      })

      expect(result.configText.startsWith('# sshd_config')).toBe(true)
      expect(result.configText).toContain('sshd -t')
      expect(result.configText).toContain('/etc/ssh/sshd_config')
    })

    it('unselected options are absent from the output', () => {
      const result = builder.execute({
        mode: 'server',
        includeHeader: false,
        serverValues: { PermitRootLogin: 'no' },
      })

      expect(result.configText).toBe('PermitRootLogin no\n')
      for (const option of sshOptionsForMode('server')) {
        if (option.key === 'PermitRootLogin') continue
        expect(result.configText).not.toContain(option.key)
      }
    })

    it('warns when passwords are off but keyboard-interactive is left unset', () => {
      const result = builder.execute({
        mode: 'server',
        serverValues: { PasswordAuthentication: 'no' },
      })

      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings[0]).toContain('KbdInteractiveAuthentication')
    })

    it('there is no Protocol directive in the catalog (removed in OpenSSH 7.6)', () => {
      const keys = SSH_OPTION_CATALOG.map((o) => o.key)
      expect(keys).not.toContain('Protocol')
      // Nor the deprecated pre-8.7 / pre-8.5 spellings.
      expect(keys).not.toContain('ChallengeResponseAuthentication')
      expect(keys).not.toContain('PubkeyAcceptedKeyTypes')
      expect(keys).not.toContain('HostbasedKeyTypes')
    })
  })

  describe('enum / typed value enforcement', () => {
    it('a choice option rejects a value outside its allowed set', () => {
      expect(() =>
        builder.execute({ mode: 'server', serverValues: { PermitRootLogin: 'without-password' } }),
      ).toThrow()
      expect(() =>
        builder.execute({ hostBlocks: [{ pattern: 'h', values: { StrictHostKeyChecking: 'maybe' } }] }),
      ).toThrow()
      expect(() => builder.execute({ mode: 'server', serverValues: { LogLevel: 'TRACE' } })).toThrow()
    })

    it('a choice option never emits a value outside its allowed set', () => {
      for (const option of SSH_OPTION_CATALOG) {
        if (option.kind !== 'choice') continue
        const mode = option.modes.includes('server') ? 'server' : 'client'

        for (const legal of option.allowedValues ?? []) {
          const result = builder.execute(
            mode === 'server'
              ? { mode, includeHeader: false, serverValues: { [option.key]: legal.toUpperCase() } }
              : {
                  includeHeader: false,
                  hostBlocks: [{ pattern: 'h', values: { [option.key]: legal.toUpperCase() } }],
                },
          )
          // Canonical spelling from the catalog, not whatever case was typed.
          expect(result.configText).toContain(`${option.key} ${legal}\n`)
        }

        expect(() =>
          builder.execute(
            mode === 'server'
              ? { mode, serverValues: { [option.key]: '__illegal__' } }
              : { hostBlocks: [{ pattern: 'h', values: { [option.key]: '__illegal__' } }] },
          ),
        ).toThrow()
      }
    })

    it('booleans reject anything other than yes/no', () => {
      for (const bad of ['true', '1', 'on', 'enabled', '']) {
        expect(() =>
          builder.execute({ mode: 'server', serverValues: { X11Forwarding: bad } }),
        ).toThrow()
      }
    })

    it('integers are parsed and range-checked', () => {
      expect(() =>
        builder.execute({ hostBlocks: [{ pattern: 'h', values: { Port: 'twenty-two' } }] }),
      ).toThrow()
      expect(() => builder.execute({ hostBlocks: [{ pattern: 'h', values: { Port: '0' } }] })).toThrow()
      expect(() =>
        builder.execute({ hostBlocks: [{ pattern: 'h', values: { Port: '65536' } }] }),
      ).toThrow()
      expect(() =>
        builder.execute({ mode: 'server', serverValues: { RequiredRSASize: '1023' } }),
      ).toThrow()
    })

    it('rejects unknown directives and directives from the wrong file', () => {
      expect(() =>
        builder.execute({ hostBlocks: [{ pattern: 'h', values: { NotADirective: 'x' } }] }),
      ).toThrow()
      // Server-only directive placed in a client Host block.
      expect(() =>
        builder.execute({ hostBlocks: [{ pattern: 'h', values: { PermitRootLogin: 'no' } }] }),
      ).toThrow()
      // Client-only directive placed in sshd_config.
      expect(() =>
        builder.execute({ mode: 'server', serverValues: { ProxyJump: 'bastion' } }),
      ).toThrow()
    })

    it('rejects malformed Host patterns and empty input', () => {
      expect(() => builder.execute({})).toThrow()
      expect(() => builder.execute({ mode: 'server' })).toThrow()
      expect(() =>
        builder.execute({ hostBlocks: [{ pattern: '   ', values: { HostName: 'x' } }] }),
      ).toThrow()
      expect(() => builder.execute({ hostBlocks: [{ pattern: '*', values: { HostName: 'x' } }] })).toThrow()
      expect(() =>
        builder.execute({ hostBlocks: [{ pattern: 'h', values: { HostName: 'a\nb' } }] }),
      ).toThrow()
    })
  })

  describe('hardened baseline', () => {
    /**
     * Regression guard. If someone later pastes in stale hardening advice
     * (Mozilla's published lists still contain ssh-rsa, and CBC/SHA-1
     * snippets are all over the internet), this test fails loudly rather
     * than the app quietly emitting broken crypto.
     */
    const forbidden = [
      'ssh-rsa',
      'ssh-dss',
      'hmac-sha1',
      'hmac-md5',
      'arcfour',
      '-cbc',
      '3des',
      'blowfish',
      'cast128',
      'umac-64',
      'diffie-hellman-group1-sha1',
      'diffie-hellman-group14-sha1',
      'diffie-hellman-group-exchange-sha1',
      'protocol 2',
    ]

    function assertNoDeprecatedAlgorithms(config: string): void {
      const lower = config.toLowerCase()
      for (const bad of forbidden) {
        expect(lower).not.toContain(bad)
      }
    }

    it('client preset emits no deprecated algorithm', () => {
      const preset = sshHardenedBaseline('client')
      expect(Object.keys(preset).length).toBeGreaterThan(0)

      const result = builder.execute({
        hostBlocks: [{ pattern: 'prod', values: { HostName: 'prod.example.com', User: 'deploy' } }],
        globalDefaults: preset,
      })

      assertNoDeprecatedAlgorithms(result.configText)
      expect(result.warnings).toEqual([])
    })

    it('server preset emits no deprecated algorithm', () => {
      const preset = sshHardenedBaseline('server')
      expect(Object.keys(preset).length).toBeGreaterThan(0)

      const result = builder.execute({ mode: 'server', serverValues: preset })

      assertNoDeprecatedAlgorithms(result.configText)
      expect(result.warnings).toEqual([])
    })

    it('the declared hardened constants themselves are clean', () => {
      for (const list of [
        SSH_HARDENED_CIPHERS,
        SSH_HARDENED_MACS,
        SSH_HARDENED_KEX_ALGORITHMS,
        SSH_HARDENED_HOST_KEY_ALGORITHMS,
      ]) {
        expect(sshDeprecatedAlgorithmsIn(list)).toEqual([])
      }
      for (const option of SSH_OPTION_CATALOG) {
        const hardened = option.hardenedValue
        if (hardened == null) continue
        expect(sshDeprecatedAlgorithmsIn(hardened)).toEqual([])
      }
    })

    it('server preset locks down the things that matter', () => {
      const preset = sshHardenedBaseline('server')

      expect(preset.PermitRootLogin).toBe('no')
      expect(preset.PasswordAuthentication).toBe('no')
      expect(preset.KbdInteractiveAuthentication).toBe('no')
      expect(preset.PermitEmptyPasswords).toBe('no')
      expect(preset.PubkeyAuthentication).toBe('yes')
      expect(preset.X11Forwarding).toBe('no')
      expect(preset.AllowAgentForwarding).toBe('no')
      expect(preset.AllowTcpForwarding).toBe('no')
      expect(preset.LogLevel).toBe('VERBOSE')
      expect(preset.MaxAuthTries).toBe('3')
      expect(preset.RequiredRSASize).toBe('3072')
      // Site-specific directives stay out of the preset.
      expect('AllowUsers' in preset).toBe(false)
      expect('AllowGroups' in preset).toBe(false)
      expect('Port' in preset).toBe(false)
      expect('ListenAddress' in preset).toBe(false)
      // Version-fragile directives stay out too.
      expect('PerSourcePenalties' in preset).toBe(false)
    })

    it('client preset locks down the things that matter', () => {
      const preset = sshHardenedBaseline('client')

      expect(preset.PasswordAuthentication).toBe('no')
      expect(preset.IdentitiesOnly).toBe('yes')
      expect(preset.HashKnownHosts).toBe('yes')
      expect(preset.ForwardAgent).toBe('no')
      expect(preset.ForwardX11).toBe('no')
      expect(preset.StrictHostKeyChecking).toBe('accept-new')
      expect('HostName' in preset).toBe(false)
      expect('User' in preset).toBe(false)
    })

    it('the KEX list leads with the widely supported PQ algorithm', () => {
      // mlkem768x25519-sha256 is 9.9+/10.0 and would break older sshd on
      // startup, so it must be suggested as a comment, not baked in.
      expect(SSH_HARDENED_KEX_ALGORITHMS.startsWith('sntrup761x25519-sha512@openssh.com')).toBe(true)
      expect(SSH_HARDENED_KEX_ALGORITHMS).not.toContain('mlkem768x25519-sha256')

      const result = builder.execute({
        mode: 'server',
        includeHeader: false,
        serverValues: sshHardenedBaseline('server'),
      })
      expect(result.configText).toContain('# OpenSSH 9.9+/10.0 users may prepend mlkem768x25519-sha256')
    })
  })

  describe('deprecated algorithm detection', () => {
    it('flags legacy tokens inside an algorithm list', () => {
      expect(sshDeprecatedAlgorithmsIn('aes256-cbc,aes128-ctr')).toEqual(['aes256-cbc'])
      expect(sshDeprecatedAlgorithmsIn('ssh-ed25519,ssh-rsa')).toEqual(['ssh-rsa'])
      expect(sshDeprecatedAlgorithmsIn('hmac-sha2-256,hmac-sha1-etm@openssh.com')).toEqual([
        'hmac-sha1-etm@openssh.com',
      ])
      expect(sshDeprecatedAlgorithmsIn('+arcfour256')).toEqual(['+arcfour256'])
    })

    it('does not false-positive on modern names', () => {
      expect(sshDeprecatedAlgorithmsIn('rsa-sha2-512,rsa-sha2-256,ssh-ed25519')).toEqual([])
      expect(sshDeprecatedAlgorithmsIn('diffie-hellman-group18-sha512')).toEqual([])
      expect(sshDeprecatedAlgorithmsIn('diffie-hellman-group-exchange-sha256')).toEqual([])
      expect(sshDeprecatedAlgorithmsIn('hmac-sha2-512-etm@openssh.com,umac-128-etm@openssh.com')).toEqual([])
      expect(sshDeprecatedAlgorithmsIn('mlkem768x25519-sha256')).toEqual([])
    })

    it('a user-supplied legacy list warns but still generates', () => {
      const result = builder.execute({
        mode: 'server',
        serverValues: { Ciphers: 'aes256-cbc,aes128-ctr' },
      })

      expect(result.configText).toContain('Ciphers aes256-cbc,aes128-ctr')
      expect(result.warnings.join('')).toContain('aes256-cbc')
    })
  })

  describe('catalog integrity', () => {
    it('every option is valid in at least one mode and has a description', () => {
      for (const option of SSH_OPTION_CATALOG) {
        expect(option.modes.length).toBeGreaterThan(0)
        expect(option.description.trim().length).toBeGreaterThan(0)
        expect(option.key.trim()).toBe(option.key)
        if (option.kind === 'choice') {
          expect((option.allowedValues ?? []).length).toBeGreaterThan(0)
        } else {
          expect(option.allowedValues ?? []).toEqual([])
        }
        if (option.kind === 'boolean') {
          expect([undefined, 'yes', 'no']).toContain(option.defaultValue)
          expect([undefined, 'yes', 'no']).toContain(option.hardenedValue)
        }
        if (option.kind === 'choice' && option.hardenedValue != null) {
          expect(option.allowedValues).toContain(option.hardenedValue)
        }
      }
    })

    it('no duplicate key within a mode, and every option lands in a known group', () => {
      for (const mode of ['client', 'server'] as const) {
        const keys = sshOptionsForMode(mode).map((o) => o.key)
        expect(new Set(keys).size).toBe(keys.length)
        expect(keys.length).toBeGreaterThan(0)
        for (const option of sshOptionsForMode(mode)) {
          expect(sshGroupsForMode(mode)).toContain(option.group)
          expect(sshOptionFor(mode, option.key)).toBeDefined()
        }
      }
    })

    it('sshOptionFor respects mode boundaries', () => {
      expect(sshOptionFor('server', 'PermitRootLogin')).toBeDefined()
      expect(sshOptionFor('client', 'PermitRootLogin')).toBeUndefined()
      expect(sshOptionFor('client', 'ProxyJump')).toBeDefined()
      expect(sshOptionFor('server', 'ProxyJump')).toBeUndefined()
      expect(sshOptionFor('client', 'Ciphers')).toBeDefined()
      expect(sshOptionFor('server', 'Ciphers')).toBeDefined()
    })
  })
})
