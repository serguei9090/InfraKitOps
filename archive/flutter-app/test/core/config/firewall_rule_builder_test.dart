import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/config/firewall_rule_builder.dart';

void main() {
  const builder = FirewallRuleBuilder();

  group('UFW dialect', () {
    test('renders a multi-rule set as ufw commands in order', () {
      final result = builder.execute(
        const FirewallRuleSetInput(
          dialect: FirewallDialect.ufw,
          includeHeader: false,
          rules: [
            FirewallRule(
              action: FirewallAction.allow,
              protocol: FirewallProtocol.tcp,
              ports: null,
              comment: 'ssh',
            ),
            FirewallRule(
              action: FirewallAction.deny,
              direction: FirewallDirection.inbound,
              protocol: FirewallProtocol.udp,
              source: '10.0.0.0/8',
              comment: 'block internal udp',
            ),
          ],
        ),
      );

      expect(result.script, contains('ufw default deny incoming'));
      expect(result.script, contains('ufw default allow outgoing'));
      expect(result.script, contains("ufw allow in proto tcp from any to any comment 'ssh'"));
      expect(
        result.script,
        contains("ufw deny in proto udp from 10.0.0.0/8 to any comment 'block internal udp'"),
      );
      expect(result.script, contains('ufw --force enable'));
      expect(result.ruleCount, 2);
      expect(result.suggestedFileName, 'apply-firewall.sh');
    });

    test('renders a port and a port range in ufw colon syntax', () {
      final result = builder.execute(
        FirewallRuleSetInput(
          dialect: FirewallDialect.ufw,
          includeHeader: false,
          policy: const FirewallPolicy(incoming: FirewallAction.deny),
          rules: [
            FirewallRule(action: FirewallAction.allow, ports: PortRange.single(22)),
            FirewallRule(action: FirewallAction.allow, ports: PortRange(8000, 8010)),
          ],
        ),
      );

      expect(result.script, contains('port 22'));
      expect(result.script, contains('port 8000:8010'));
      expect(result.script, isNot(contains('8000-8010')));
    });

    test('renders a CIDR source in ufw "from" syntax', () {
      final result = builder.execute(
        const FirewallRuleSetInput(
          dialect: FirewallDialect.ufw,
          includeHeader: false,
          rules: [
            FirewallRule(action: FirewallAction.allow, source: '203.0.113.0/24'),
          ],
        ),
      );

      expect(result.script, contains('from 203.0.113.0/24 to any'));
    });

    test('ufwRuleCommand omits proto for FirewallProtocol.any and quotes the sanitized comment', () {
      final line = FirewallRuleBuilder.ufwRuleCommand(
        const FirewallRule(action: FirewallAction.allow, protocol: FirewallProtocol.any, comment: 'has "quotes"'),
      );
      expect(line, isNot(contains('proto')));
      expect(line, contains("comment 'has quotes'"));
    });
  });

  group('nftables dialect', () {
    test('renders a multi-rule set into input/output chains', () {
      final result = builder.execute(
        const FirewallRuleSetInput(
          dialect: FirewallDialect.nftables,
          includeHeader: false,
          rules: [
            FirewallRule(action: FirewallAction.allow, direction: FirewallDirection.inbound, ports: null),
            FirewallRule(
              action: FirewallAction.deny,
              direction: FirewallDirection.outbound,
              protocol: FirewallProtocol.udp,
              comment: 'block outbound udp',
            ),
          ],
        ),
      );

      expect(result.script, contains('flush ruleset'));
      expect(result.script, contains('table inet filter {'));
      expect(result.script, contains('chain input {'));
      expect(result.script, contains('chain output {'));
      expect(result.script, contains('accept'));
      expect(result.script, contains('meta l4proto udp'));
      expect(result.script, contains('drop'));
      expect(result.suggestedFileName, 'nftables.conf');
    });

    test('renders a port and a port range in nft dash syntax', () {
      final result = builder.execute(
        FirewallRuleSetInput(
          dialect: FirewallDialect.nftables,
          includeHeader: false,
          policy: const FirewallPolicy(incoming: FirewallAction.deny),
          rules: [
            FirewallRule(action: FirewallAction.allow, ports: PortRange.single(22)),
            FirewallRule(action: FirewallAction.allow, ports: PortRange(8000, 8010)),
          ],
        ),
      );

      expect(result.script, contains('dport 22'));
      expect(result.script, contains('dport 8000-8010'));
      expect(result.script, isNot(contains('8000:8010')));
    });

    test('renders a CIDR source with "ip saddr" (v4) or "ip6 saddr" (v6)', () {
      final v4 = FirewallRuleBuilder.nftRuleStatement(
        const FirewallRule(action: FirewallAction.allow, source: '10.0.0.0/8'),
      );
      expect(v4, contains('ip saddr 10.0.0.0/8'));

      final v6 = FirewallRuleBuilder.nftRuleStatement(
        const FirewallRule(action: FirewallAction.allow, source: '2001:db8::/32'),
      );
      expect(v6, contains('ip6 saddr 2001:db8::/32'));
    });
  });

  group('SSH lockout warning — the critical safety check', () {
    test('fires when the default incoming policy denies and no rule permits inbound SSH', () {
      final result = builder.execute(
        FirewallRuleSetInput(
          policy: const FirewallPolicy(incoming: FirewallAction.deny),
          rules: [
            // Unrelated rule — a specific, non-SSH port, so it must not
            // satisfy the lockout check (a null port would mean "every
            // port", which WOULD cover SSH and defeat this test).
            FirewallRule(action: FirewallAction.allow, ports: PortRange.single(80), protocol: FirewallProtocol.tcp, comment: 'http'),
          ],
        ),
      );

      expect(result.hasCriticalWarning, isTrue);
      final lockout = result.warnings.where((w) => w.code == FirewallWarning.sshLockoutCode);
      expect(lockout, hasLength(1));
      expect(lockout.first.severity, FirewallWarningSeverity.critical);
      expect(lockout.first.message, contains('LOCKOUT'));
      // Critical warnings sort first.
      expect(result.warnings.first.code, FirewallWarning.sshLockoutCode);
    });

    test('fires with a reject-by-default policy too (reject also blocks incoming)', () {
      final result = builder.execute(
        const FirewallRuleSetInput(
          policy: FirewallPolicy(incoming: FirewallAction.reject),
          rules: [],
        ),
      );

      expect(
        result.warnings.any((w) => w.code == FirewallWarning.sshLockoutCode),
        isTrue,
      );
    });

    test('does NOT fire when an allow rule permits inbound TCP 22', () {
      final result = builder.execute(
        const FirewallRuleSetInput(
          policy: FirewallPolicy(incoming: FirewallAction.deny),
          rules: [
            FirewallRule(action: FirewallAction.allow, direction: FirewallDirection.inbound, protocol: FirewallProtocol.tcp, comment: 'ssh'),
          ],
        ),
      );

      expect(result.hasCriticalWarning, isFalse);
      expect(result.warnings.any((w) => w.code == FirewallWarning.sshLockoutCode), isFalse);
    });

    test('does NOT fire when the allow rule is protocol "any" (covers TCP+UDP, so still covers SSH)', () {
      final result = builder.execute(
        FirewallRuleSetInput(
          policy: const FirewallPolicy(incoming: FirewallAction.deny),
          rules: [FirewallRule(action: FirewallAction.allow, protocol: FirewallProtocol.any, ports: PortRange.single(22))],
        ),
      );

      expect(result.warnings.any((w) => w.code == FirewallWarning.sshLockoutCode), isFalse);
    });

    test('does NOT fire when a rate-limit rule (limit permits traffic) covers SSH', () {
      final result = builder.execute(
        FirewallRuleSetInput(
          policy: const FirewallPolicy(incoming: FirewallAction.deny),
          rules: [FirewallRule(action: FirewallAction.limit, protocol: FirewallProtocol.tcp, ports: PortRange.single(22))],
        ),
      );

      expect(result.warnings.any((w) => w.code == FirewallWarning.sshLockoutCode), isFalse);
    });

    test('still fires when SSH is only permitted OUTBOUND, not inbound', () {
      final result = builder.execute(
        const FirewallRuleSetInput(
          policy: FirewallPolicy(incoming: FirewallAction.deny),
          rules: [
            FirewallRule(action: FirewallAction.allow, direction: FirewallDirection.outbound, protocol: FirewallProtocol.tcp),
          ],
        ),
      );

      expect(result.warnings.any((w) => w.code == FirewallWarning.sshLockoutCode), isTrue);
    });

    test('still fires when the allow rule is on a different port', () {
      final result = builder.execute(
        FirewallRuleSetInput(
          policy: const FirewallPolicy(incoming: FirewallAction.deny),
          rules: [FirewallRule(action: FirewallAction.allow, protocol: FirewallProtocol.tcp, ports: PortRange.single(443))],
        ),
      );

      expect(result.warnings.any((w) => w.code == FirewallWarning.sshLockoutCode), isTrue);
    });

    test('does not fire when the default incoming policy already allows', () {
      final result = builder.execute(
        const FirewallRuleSetInput(
          policy: FirewallPolicy(incoming: FirewallAction.allow),
          rules: [],
        ),
      );

      expect(result.warnings.any((w) => w.code == FirewallWarning.sshLockoutCode), isFalse);
      // But the "open by default" caution should fire instead.
      expect(result.warnings.any((w) => w.code == FirewallWarning.openByDefaultCode), isTrue);
    });

    test('respects a custom sshPort for both the rule set input and firewallRuleSetPermitsSsh', () {
      final result = builder.execute(
        FirewallRuleSetInput(
          policy: const FirewallPolicy(incoming: FirewallAction.deny),
          sshPort: 2222,
          rules: [FirewallRule(action: FirewallAction.allow, protocol: FirewallProtocol.tcp, ports: PortRange.single(2222))],
        ),
      );
      expect(result.warnings.any((w) => w.code == FirewallWarning.sshLockoutCode), isFalse);

      expect(
        firewallRuleSetPermitsSsh(
          [const FirewallRule(action: FirewallAction.allow, protocol: FirewallProtocol.tcp, ports: null)],
          sshPort: 2222,
        ),
        isTrue,
      );
      expect(
        firewallRuleSetPermitsSsh(
          [FirewallRule(action: FirewallAction.allow, protocol: FirewallProtocol.tcp, ports: PortRange.single(22))],
          sshPort: 2222,
        ),
        isFalse,
      );
    });
  });

  group('invalid input is rejected', () {
    test('PortRange.parse rejects a non-numeric value', () {
      expect(() => PortRange.parse('ssh'), throwsArgumentError);
    });

    test('PortRange.parse rejects an out-of-range port', () {
      expect(() => PortRange.parse('0'), throwsArgumentError);
      expect(() => PortRange.parse('65536'), throwsArgumentError);
    });

    test('PortRange constructor rejects an inverted range', () {
      expect(() => PortRange(100, 50), throwsArgumentError);
    });

    test('PortRange.parse rejects a malformed range', () {
      expect(() => PortRange.parse('1:2:3'), throwsArgumentError);
      expect(() => PortRange.parse(''), throwsArgumentError);
    });

    test('an invalid CIDR source is rejected at execute time', () {
      expect(
        () => builder.execute(
          const FirewallRuleSetInput(
            rules: [FirewallRule(action: FirewallAction.allow, source: 'not-an-address')],
          ),
        ),
        throwsArgumentError,
      );
    });

    test('an invalid CIDR destination is rejected', () {
      expect(
        () => builder.execute(
          const FirewallRuleSetInput(
            rules: [FirewallRule(action: FirewallAction.allow, destination: '999.999.999.999')],
          ),
        ),
        throwsArgumentError,
      );
    });

    test('an invalid interface name is rejected', () {
      expect(
        () => builder.execute(
          const FirewallRuleSetInput(
            rules: [FirewallRule(action: FirewallAction.allow, interfaceName: 'eth0; rm -rf /')],
          ),
        ),
        throwsArgumentError,
      );
    });

    test('a rate-limit default policy is rejected (limit has no policy form)', () {
      expect(
        () => builder.execute(
          const FirewallRuleSetInput(policy: FirewallPolicy(incoming: FirewallAction.limit)),
        ),
        throwsArgumentError,
      );
    });

    test('an out-of-range sshPort is rejected', () {
      expect(
        () => builder.execute(const FirewallRuleSetInput(sshPort: 0)),
        throwsArgumentError,
      );
      expect(
        () => builder.execute(const FirewallRuleSetInput(sshPort: 70000)),
        throwsArgumentError,
      );
    });
  });

  group('other warnings', () {
    test('warns (caution) when a rate-limit rule is not TCP', () {
      final result = builder.execute(
        FirewallRuleSetInput(
          policy: const FirewallPolicy(incoming: FirewallAction.deny),
          rules: [
            FirewallRule(action: FirewallAction.allow, ports: PortRange.single(22)),
            FirewallRule(action: FirewallAction.limit, protocol: FirewallProtocol.udp, ports: PortRange.single(53)),
          ],
        ),
      );

      final warning = result.warnings.firstWhere((w) => w.code == FirewallWarning.limitNotTcpCode);
      expect(warning.severity, FirewallWarningSeverity.caution);
    });

    test('warns when a rule mixes IPv4 and IPv6 addresses', () {
      final result = builder.execute(
        const FirewallRuleSetInput(
          policy: FirewallPolicy(incoming: FirewallAction.allow),
          rules: [
            FirewallRule(action: FirewallAction.allow, source: '10.0.0.0/8', destination: '2001:db8::/32'),
          ],
        ),
      );

      expect(result.warnings.any((w) => w.code == FirewallWarning.addressFamilyMismatchCode), isTrue);
    });

    test('warns about flush ruleset for nftables only', () {
      final ufwResult = builder.execute(
        const FirewallRuleSetInput(dialect: FirewallDialect.ufw, policy: FirewallPolicy(incoming: FirewallAction.allow)),
      );
      expect(ufwResult.warnings.any((w) => w.code == FirewallWarning.flushRulesetCode), isFalse);

      final nftResult = builder.execute(
        const FirewallRuleSetInput(dialect: FirewallDialect.nftables, policy: FirewallPolicy(incoming: FirewallAction.allow)),
      );
      expect(nftResult.warnings.any((w) => w.code == FirewallWarning.flushRulesetCode), isTrue);
    });

    test('warns that an nftables reject policy is downgraded to drop', () {
      final result = builder.execute(
        const FirewallRuleSetInput(
          dialect: FirewallDialect.nftables,
          policy: FirewallPolicy(incoming: FirewallAction.reject),
        ),
      );
      expect(result.warnings.any((w) => w.code == FirewallWarning.rejectPolicyCode), isTrue);
      expect(result.script, contains('policy drop'));
    });

    test('warns when the rule list is empty', () {
      final result = builder.execute(
        const FirewallRuleSetInput(policy: FirewallPolicy(incoming: FirewallAction.allow)),
      );
      expect(result.warnings.any((w) => w.code == FirewallWarning.noRulesCode), isTrue);
    });
  });

  group('address / CIDR validation helpers', () {
    test('isAnyAddress recognizes the "no restriction" spellings', () {
      expect(isAnyAddress(''), isTrue);
      expect(isAnyAddress('any'), isTrue);
      expect(isAnyAddress('0.0.0.0/0'), isTrue);
      expect(isAnyAddress('::/0'), isTrue);
      expect(isAnyAddress('10.0.0.0/8'), isFalse);
    });

    test('isValidCidr accepts valid IPv4/IPv6 and rejects garbage', () {
      expect(isValidCidr('10.0.0.0/8'), isTrue);
      expect(isValidCidr('192.168.1.5'), isTrue);
      expect(isValidCidr('2001:db8::/32'), isTrue);
      expect(isValidCidr('999.1.1.1'), isFalse);
      expect(isValidCidr('10.0.0.0/33'), isFalse);
      expect(isValidCidr('not-an-ip'), isFalse);
      expect(isValidCidr('010.0.0.1'), isFalse, reason: 'leading zero is ambiguous octal/decimal');
    });

    test('isIpv6Cidr distinguishes address families', () {
      expect(isIpv6Cidr('10.0.0.0/8'), isFalse);
      expect(isIpv6Cidr('2001:db8::/32'), isTrue);
    });
  });

  group('preset catalog', () {
    test('firewallPresetFor is case-insensitive and returns null for unknown labels', () {
      expect(firewallPresetFor('ssh'), isNotNull);
      expect(firewallPresetFor('SSH'), isNotNull);
      expect(firewallPresetFor('nonexistent-service'), isNull);
    });

    test('toRule builds a single-port allow rule from a preset', () {
      final preset = firewallPresetFor('HTTPS')!;
      final rule = preset.toRule();
      expect(rule.action, FirewallAction.allow);
      expect(rule.ports, PortRange.single(443));
      expect(rule.protocol, FirewallProtocol.tcp);
    });
  });
}
