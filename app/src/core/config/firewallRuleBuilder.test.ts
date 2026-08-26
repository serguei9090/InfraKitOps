import { describe, expect, it } from 'vitest'
import {
  FirewallRuleBuilder,
  PortRange,
  firewallRuleSetPermitsSsh,
  firewallPresetFor,
  firewallPresetToRule,
  isAnyAddress,
  isValidCidr,
  isIpv6Cidr,
  sshLockoutCode,
  openByDefaultCode,
  flushRulesetCode,
  limitNotTcpCode,
  addressFamilyMismatchCode,
  noRulesCode,
  rejectPolicyCode,
  type FirewallRule,
} from './firewallRuleBuilder'

describe('FirewallRuleBuilder', () => {
  const builder = new FirewallRuleBuilder()

  describe('UFW dialect', () => {
    it('renders a multi-rule set as ufw commands in order', () => {
      const result = builder.execute({
        dialect: 'ufw',
        includeHeader: false,
        rules: [
          { action: 'allow', protocol: 'tcp', ports: undefined, comment: 'ssh' },
          {
            action: 'deny',
            direction: 'inbound',
            protocol: 'udp',
            source: '10.0.0.0/8',
            comment: 'block internal udp',
          },
        ],
      })

      expect(result.script).toContain('ufw default deny incoming')
      expect(result.script).toContain('ufw default allow outgoing')
      expect(result.script).toContain("ufw allow in proto tcp from any to any comment 'ssh'")
      expect(result.script).toContain("ufw deny in proto udp from 10.0.0.0/8 to any comment 'block internal udp'")
      expect(result.script).toContain('ufw --force enable')
      expect(result.ruleCount).toBe(2)
      expect(result.suggestedFileName).toBe('apply-firewall.sh')
    })

    it('renders a port and a port range in ufw colon syntax', () => {
      const result = builder.execute({
        dialect: 'ufw',
        includeHeader: false,
        policy: { incoming: 'deny' },
        rules: [
          { action: 'allow', ports: PortRange.single(22) },
          { action: 'allow', ports: new PortRange(8000, 8010) },
        ],
      })

      expect(result.script).toContain('port 22')
      expect(result.script).toContain('port 8000:8010')
      expect(result.script).not.toContain('8000-8010')
    })

    it('renders a CIDR source in ufw "from" syntax', () => {
      const result = builder.execute({
        dialect: 'ufw',
        includeHeader: false,
        rules: [{ action: 'allow', source: '203.0.113.0/24' }],
      })

      expect(result.script).toContain('from 203.0.113.0/24 to any')
    })

    it('ufwRuleCommand omits proto for "any" and quotes the sanitized comment', () => {
      const line = FirewallRuleBuilder.ufwRuleCommand({
        action: 'allow',
        protocol: 'any',
        comment: 'has "quotes"',
      })
      expect(line).not.toContain('proto')
      expect(line).toContain("comment 'has quotes'")
    })
  })

  describe('nftables dialect', () => {
    it('renders a multi-rule set into input/output chains', () => {
      const result = builder.execute({
        dialect: 'nftables',
        includeHeader: false,
        rules: [
          { action: 'allow', direction: 'inbound', ports: undefined },
          { action: 'deny', direction: 'outbound', protocol: 'udp', comment: 'block outbound udp' },
        ],
      })

      expect(result.script).toContain('flush ruleset')
      expect(result.script).toContain('table inet filter {')
      expect(result.script).toContain('chain input {')
      expect(result.script).toContain('chain output {')
      expect(result.script).toContain('accept')
      expect(result.script).toContain('meta l4proto udp')
      expect(result.script).toContain('drop')
      expect(result.suggestedFileName).toBe('nftables.conf')
    })

    it('renders a port and a port range in nft dash syntax', () => {
      const result = builder.execute({
        dialect: 'nftables',
        includeHeader: false,
        policy: { incoming: 'deny' },
        rules: [
          { action: 'allow', ports: PortRange.single(22) },
          { action: 'allow', ports: new PortRange(8000, 8010) },
        ],
      })

      expect(result.script).toContain('dport 22')
      expect(result.script).toContain('dport 8000-8010')
      expect(result.script).not.toContain('8000:8010')
    })

    it('renders a CIDR source with "ip saddr" (v4) or "ip6 saddr" (v6)', () => {
      const v4 = FirewallRuleBuilder.nftRuleStatement({ action: 'allow', source: '10.0.0.0/8' })
      expect(v4).toContain('ip saddr 10.0.0.0/8')

      const v6 = FirewallRuleBuilder.nftRuleStatement({ action: 'allow', source: '2001:db8::/32' })
      expect(v6).toContain('ip6 saddr 2001:db8::/32')
    })
  })

  describe('SSH lockout warning — the critical safety check', () => {
    it('fires when the default incoming policy denies and no rule permits inbound SSH', () => {
      const result = builder.execute({
        policy: { incoming: 'deny' },
        rules: [
          // Unrelated rule — a specific, non-SSH port, so it must not
          // satisfy the lockout check (undefined port would mean "every
          // port", which WOULD cover SSH and defeat this test).
          { action: 'allow', ports: PortRange.single(80), protocol: 'tcp', comment: 'http' },
        ],
      })

      expect(result.hasCriticalWarning).toBe(true)
      const lockout = result.warnings.filter((w) => w.code === sshLockoutCode)
      expect(lockout).toHaveLength(1)
      expect(lockout[0].severity).toBe('critical')
      expect(lockout[0].message).toContain('LOCKOUT')
      // Critical warnings sort first.
      expect(result.warnings[0].code).toBe(sshLockoutCode)
    })

    it('fires with a reject-by-default policy too (reject also blocks incoming)', () => {
      const result = builder.execute({
        policy: { incoming: 'reject' },
        rules: [],
      })

      expect(result.warnings.some((w) => w.code === sshLockoutCode)).toBe(true)
    })

    it('does NOT fire when an allow rule permits inbound TCP 22', () => {
      const result = builder.execute({
        policy: { incoming: 'deny' },
        rules: [{ action: 'allow', direction: 'inbound', protocol: 'tcp', comment: 'ssh' }],
      })

      expect(result.hasCriticalWarning).toBe(false)
      expect(result.warnings.some((w) => w.code === sshLockoutCode)).toBe(false)
    })

    it('does NOT fire when the allow rule is protocol "any" (covers TCP+UDP, so still covers SSH)', () => {
      const result = builder.execute({
        policy: { incoming: 'deny' },
        rules: [{ action: 'allow', protocol: 'any', ports: PortRange.single(22) }],
      })

      expect(result.warnings.some((w) => w.code === sshLockoutCode)).toBe(false)
    })

    it('does NOT fire when a rate-limit rule (limit permits traffic) covers SSH', () => {
      const result = builder.execute({
        policy: { incoming: 'deny' },
        rules: [{ action: 'limit', protocol: 'tcp', ports: PortRange.single(22) }],
      })

      expect(result.warnings.some((w) => w.code === sshLockoutCode)).toBe(false)
    })

    it('still fires when SSH is only permitted OUTBOUND, not inbound', () => {
      const result = builder.execute({
        policy: { incoming: 'deny' },
        rules: [{ action: 'allow', direction: 'outbound', protocol: 'tcp' }],
      })

      expect(result.warnings.some((w) => w.code === sshLockoutCode)).toBe(true)
    })

    it('still fires when the allow rule is on a different port', () => {
      const result = builder.execute({
        policy: { incoming: 'deny' },
        rules: [{ action: 'allow', protocol: 'tcp', ports: PortRange.single(443) }],
      })

      expect(result.warnings.some((w) => w.code === sshLockoutCode)).toBe(true)
    })

    it('does not fire when the default incoming policy already allows', () => {
      const result = builder.execute({
        policy: { incoming: 'allow' },
        rules: [],
      })

      expect(result.warnings.some((w) => w.code === sshLockoutCode)).toBe(false)
      // But the "open by default" caution should fire instead.
      expect(result.warnings.some((w) => w.code === openByDefaultCode)).toBe(true)
    })

    it('respects a custom sshPort for both the rule set input and firewallRuleSetPermitsSsh', () => {
      const result = builder.execute({
        policy: { incoming: 'deny' },
        sshPort: 2222,
        rules: [{ action: 'allow', protocol: 'tcp', ports: PortRange.single(2222) }],
      })
      expect(result.warnings.some((w) => w.code === sshLockoutCode)).toBe(false)

      expect(
        firewallRuleSetPermitsSsh([{ action: 'allow', protocol: 'tcp', ports: undefined }], 2222),
      ).toBe(true)
      expect(
        firewallRuleSetPermitsSsh([{ action: 'allow', protocol: 'tcp', ports: PortRange.single(22) }], 2222),
      ).toBe(false)
    })
  })

  describe('invalid input is rejected', () => {
    it('PortRange.parse rejects a non-numeric value', () => {
      expect(() => PortRange.parse('ssh')).toThrow()
    })

    it('PortRange.parse rejects an out-of-range port', () => {
      expect(() => PortRange.parse('0')).toThrow()
      expect(() => PortRange.parse('65536')).toThrow()
    })

    it('PortRange constructor rejects an inverted range', () => {
      expect(() => new PortRange(100, 50)).toThrow()
    })

    it('PortRange.parse rejects a malformed range', () => {
      expect(() => PortRange.parse('1:2:3')).toThrow()
      expect(() => PortRange.parse('')).toThrow()
    })

    it('an invalid CIDR source is rejected at execute time', () => {
      expect(() =>
        builder.execute({ rules: [{ action: 'allow', source: 'not-an-address' }] }),
      ).toThrow()
    })

    it('an invalid CIDR destination is rejected', () => {
      expect(() =>
        builder.execute({ rules: [{ action: 'allow', destination: '999.999.999.999' }] }),
      ).toThrow()
    })

    it('an invalid interface name is rejected', () => {
      expect(() =>
        builder.execute({ rules: [{ action: 'allow', interfaceName: 'eth0; rm -rf /' }] }),
      ).toThrow()
    })

    it('a rate-limit default policy is rejected (limit has no policy form)', () => {
      expect(() => builder.execute({ policy: { incoming: 'limit' } })).toThrow()
    })

    it('an out-of-range sshPort is rejected', () => {
      expect(() => builder.execute({ sshPort: 0 })).toThrow()
      expect(() => builder.execute({ sshPort: 70000 })).toThrow()
    })
  })

  describe('other warnings', () => {
    it('warns (caution) when a rate-limit rule is not TCP', () => {
      const result = builder.execute({
        policy: { incoming: 'deny' },
        rules: [
          { action: 'allow', ports: PortRange.single(22) },
          { action: 'limit', protocol: 'udp', ports: PortRange.single(53) },
        ],
      })

      const warning = result.warnings.find((w) => w.code === limitNotTcpCode)!
      expect(warning.severity).toBe('caution')
    })

    it('warns when a rule mixes IPv4 and IPv6 addresses', () => {
      const result = builder.execute({
        policy: { incoming: 'allow' },
        rules: [{ action: 'allow', source: '10.0.0.0/8', destination: '2001:db8::/32' }],
      })

      expect(result.warnings.some((w) => w.code === addressFamilyMismatchCode)).toBe(true)
    })

    it('warns about flush ruleset for nftables only', () => {
      const ufwResult = builder.execute({ dialect: 'ufw', policy: { incoming: 'allow' } })
      expect(ufwResult.warnings.some((w) => w.code === flushRulesetCode)).toBe(false)

      const nftResult = builder.execute({ dialect: 'nftables', policy: { incoming: 'allow' } })
      expect(nftResult.warnings.some((w) => w.code === flushRulesetCode)).toBe(true)
    })

    it('warns that an nftables reject policy is downgraded to drop', () => {
      const result = builder.execute({
        dialect: 'nftables',
        policy: { incoming: 'reject' },
      })
      expect(result.warnings.some((w) => w.code === rejectPolicyCode)).toBe(true)
      expect(result.script).toContain('policy drop')
    })

    it('warns when the rule list is empty', () => {
      const result = builder.execute({ policy: { incoming: 'allow' } })
      expect(result.warnings.some((w) => w.code === noRulesCode)).toBe(true)
    })
  })

  describe('address / CIDR validation helpers', () => {
    it('isAnyAddress recognizes the "no restriction" spellings', () => {
      expect(isAnyAddress('')).toBe(true)
      expect(isAnyAddress('any')).toBe(true)
      expect(isAnyAddress('0.0.0.0/0')).toBe(true)
      expect(isAnyAddress('::/0')).toBe(true)
      expect(isAnyAddress('10.0.0.0/8')).toBe(false)
    })

    it('isValidCidr accepts valid IPv4/IPv6 and rejects garbage', () => {
      expect(isValidCidr('10.0.0.0/8')).toBe(true)
      expect(isValidCidr('192.168.1.5')).toBe(true)
      expect(isValidCidr('2001:db8::/32')).toBe(true)
      expect(isValidCidr('999.1.1.1')).toBe(false)
      expect(isValidCidr('10.0.0.0/33')).toBe(false)
      expect(isValidCidr('not-an-ip')).toBe(false)
      expect(isValidCidr('010.0.0.1')).toBe(false)
    })

    it('isIpv6Cidr distinguishes address families', () => {
      expect(isIpv6Cidr('10.0.0.0/8')).toBe(false)
      expect(isIpv6Cidr('2001:db8::/32')).toBe(true)
    })
  })

  describe('preset catalog', () => {
    it('firewallPresetFor is case-insensitive and returns null for unknown labels', () => {
      expect(firewallPresetFor('ssh')).not.toBeNull()
      expect(firewallPresetFor('SSH')).not.toBeNull()
      expect(firewallPresetFor('nonexistent-service')).toBeNull()
    })

    it('toRule builds a single-port allow rule from a preset', () => {
      const preset = firewallPresetFor('HTTPS')!
      const rule: FirewallRule = firewallPresetToRule(preset)
      expect(rule.action).toBe('allow')
      expect(rule.ports!.equals(PortRange.single(443))).toBe(true)
      expect(rule.protocol).toBe('tcp')
    })
  })
})
