import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/ssh_config_builder.dart';

void main() {
  const builder = SshConfigBuilder();

  /// Everything after the leading `#` header comment block, so assertions on
  /// directive layout are not coupled to header wording.
  String body(String config) =>
      config.split('\n').where((l) => !l.trimLeft().startsWith('#')).join('\n').trim();

  group('client config', () {
    test('renders a Host block with indented directives in catalog order', () {
      final result = builder.execute(
        const SshConfigBuilderInput(
          hostBlocks: [
            SshHostBlock(
              pattern: 'prod-web-1',
              values: {
                'HostName': '203.0.113.10',
                'User': 'deploy',
                'Port': '2222',
                'IdentityFile': '~/.ssh/id_ed25519',
                'IdentitiesOnly': 'yes',
                'ProxyJump': 'bastion',
              },
            ),
          ],
        ),
      );

      expect(
        body(result.configText),
        'Host prod-web-1\n'
        '    HostName 203.0.113.10\n'
        '    User deploy\n'
        '    Port 2222\n'
        '    ProxyJump bastion\n'
        '    IdentityFile ~/.ssh/id_ed25519\n'
        '    IdentitiesOnly yes',
      );
      expect(result.suggestedFileName, 'config');
    });

    test('renders multiple Host blocks separated by a blank line, in order', () {
      final result = builder.execute(
        const SshConfigBuilderInput(
          hostBlocks: [
            SshHostBlock(pattern: 'alpha', values: {'HostName': 'alpha.example.com', 'User': 'root'}),
            SshHostBlock(pattern: 'beta', values: {'HostName': 'beta.example.com', 'Port': '22'}),
            SshHostBlock(pattern: 'web-* db-*', values: {'User': 'ops'}),
          ],
        ),
      );

      expect(
        body(result.configText),
        'Host alpha\n'
        '    HostName alpha.example.com\n'
        '    User root\n'
        '\n'
        'Host beta\n'
        '    HostName beta.example.com\n'
        '    Port 22\n'
        '\n'
        'Host web-* db-*\n'
        '    User ops',
      );
    });

    test('Host * defaults are emitted last, after every named block', () {
      final result = builder.execute(
        const SshConfigBuilderInput(
          hostBlocks: [
            SshHostBlock(pattern: 'alpha', values: {'HostName': 'alpha.example.com'}),
          ],
          globalDefaults: {'HashKnownHosts': 'yes', 'ForwardAgent': 'no'},
        ),
      );

      final text = result.configText;
      expect(text.indexOf('Host alpha'), lessThan(text.indexOf('Host *')));
      expect(text, contains('Host *\n    HashKnownHosts yes\n    ForwardAgent no'));
    });

    test('header carries the ~/.ssh/config 600 permission reminder', () {
      final result = builder.execute(
        const SshConfigBuilderInput(
          hostBlocks: [SshHostBlock(pattern: 'h', values: {'HostName': 'h.example.com'})],
        ),
      );

      expect(result.configText, startsWith('# ~/.ssh/config'));
      expect(result.configText, contains('chmod 700 ~/.ssh'));
      expect(result.configText, contains('600'));
    });

    test('includeHeader false emits directives only', () {
      final result = builder.execute(
        const SshConfigBuilderInput(
          hostBlocks: [SshHostBlock(pattern: 'h', values: {'HostName': 'h.example.com'})],
          includeHeader: false,
        ),
      );

      expect(result.configText, 'Host h\n    HostName h.example.com\n');
    });

    test('unselected options are absent from the output', () {
      final result = builder.execute(
        const SshConfigBuilderInput(
          hostBlocks: [SshHostBlock(pattern: 'minimal', values: {'HostName': 'example.com'})],
          includeHeader: false,
        ),
      );

      // Nothing beyond what was asked for — no restated OpenSSH defaults.
      expect(result.configText, 'Host minimal\n    HostName example.com\n');
      for (final option in sshOptionsForMode(SshConfigMode.client)) {
        if (option.key == 'HostName') continue;
        expect(body(result.configText), isNot(contains(option.key)), reason: '${option.key} should not be emitted');
      }
    });

    test('booleans always render as yes/no', () {
      final result = builder.execute(
        const SshConfigBuilderInput(
          hostBlocks: [
            SshHostBlock(pattern: 'h', values: {'TCPKeepAlive': 'YES', 'ForwardX11': 'No'}),
          ],
          includeHeader: false,
        ),
      );

      expect(result.configText, contains('    TCPKeepAlive yes\n'));
      expect(result.configText, contains('    ForwardX11 no\n'));
    });

    test('a block comment renders above the Host line', () {
      final result = builder.execute(
        const SshConfigBuilderInput(
          hostBlocks: [
            SshHostBlock(pattern: 'h', values: {'HostName': 'h.example.com'}, comment: 'staging cluster'),
          ],
          includeHeader: false,
        ),
      );

      expect(result.configText, '# staging cluster\nHost h\n    HostName h.example.com\n');
    });
  });

  group('server config', () {
    test('renders a flat, unindented directive list in catalog order', () {
      final result = builder.execute(
        const SshConfigBuilderInput(
          mode: SshConfigMode.server,
          includeHeader: false,
          serverValues: {
            'Port': '22',
            'PermitRootLogin': 'no',
            'PasswordAuthentication': 'no',
            'KbdInteractiveAuthentication': 'no',
            'MaxAuthTries': '3',
            'AllowGroups': 'sshusers',
            'X11Forwarding': 'no',
            'LogLevel': 'VERBOSE',
          },
        ),
      );

      expect(
        result.configText,
        // Catalog order, not the order keys were supplied: directives are
        // emitted by group order then position within the catalog, so the
        // shared client/server auth options precede the server-only
        // PermitRootLogin even though it was listed first above.
        'Port 22\n'
        'PasswordAuthentication no\n'
        'KbdInteractiveAuthentication no\n'
        'PermitRootLogin no\n'
        'MaxAuthTries 3\n'
        'AllowGroups sshusers\n'
        'X11Forwarding no\n'
        'LogLevel VERBOSE\n',
      );
      expect(result.suggestedFileName, 'sshd_config');
    });

    test('header tells the user to validate with sshd -t before restarting', () {
      final result = builder.execute(
        const SshConfigBuilderInput(
          mode: SshConfigMode.server,
          serverValues: {'PermitRootLogin': 'no'},
        ),
      );

      expect(result.configText, startsWith('# sshd_config'));
      expect(result.configText, contains('sshd -t'));
      expect(result.configText, contains('/etc/ssh/sshd_config'));
    });

    test('unselected options are absent from the output', () {
      final result = builder.execute(
        const SshConfigBuilderInput(
          mode: SshConfigMode.server,
          includeHeader: false,
          serverValues: {'PermitRootLogin': 'no'},
        ),
      );

      expect(result.configText, 'PermitRootLogin no\n');
      for (final option in sshOptionsForMode(SshConfigMode.server)) {
        if (option.key == 'PermitRootLogin') continue;
        expect(result.configText, isNot(contains(option.key)));
      }
    });

    test('warns when passwords are off but keyboard-interactive is left unset', () {
      final result = builder.execute(
        const SshConfigBuilderInput(
          mode: SshConfigMode.server,
          serverValues: {'PasswordAuthentication': 'no'},
        ),
      );

      expect(result.warnings, isNotEmpty);
      expect(result.warnings.first, contains('KbdInteractiveAuthentication'));
    });

    test('there is no Protocol directive in the catalog (removed in OpenSSH 7.6)', () {
      expect(
        kSshOptionCatalog.map((o) => o.key),
        isNot(contains('Protocol')),
      );
      // Nor the deprecated pre-8.7 / pre-8.5 spellings.
      expect(kSshOptionCatalog.map((o) => o.key), isNot(contains('ChallengeResponseAuthentication')));
      expect(kSshOptionCatalog.map((o) => o.key), isNot(contains('PubkeyAcceptedKeyTypes')));
      expect(kSshOptionCatalog.map((o) => o.key), isNot(contains('HostbasedKeyTypes')));
    });
  });

  group('enum / typed value enforcement', () {
    test('a choice option rejects a value outside its allowed set', () {
      expect(
        () => builder.execute(
          const SshConfigBuilderInput(
            mode: SshConfigMode.server,
            serverValues: {'PermitRootLogin': 'without-password'},
          ),
        ),
        throwsArgumentError,
      );
      expect(
        () => builder.execute(
          const SshConfigBuilderInput(
            hostBlocks: [SshHostBlock(pattern: 'h', values: {'StrictHostKeyChecking': 'maybe'})],
          ),
        ),
        throwsArgumentError,
      );
      expect(
        () => builder.execute(
          const SshConfigBuilderInput(
            mode: SshConfigMode.server,
            serverValues: {'LogLevel': 'TRACE'},
          ),
        ),
        throwsArgumentError,
      );
    });

    test('a choice option never emits a value outside its allowed set', () {
      for (final option in kSshOptionCatalog) {
        if (option.kind != SshValueKind.choice) continue;
        final mode = option.appliesTo(SshConfigMode.server) ? SshConfigMode.server : SshConfigMode.client;

        for (final legal in option.allowedValues) {
          final result = builder.execute(
            mode == SshConfigMode.server
                ? SshConfigBuilderInput(
                    mode: mode,
                    includeHeader: false,
                    serverValues: {option.key: legal.toUpperCase()},
                  )
                : SshConfigBuilderInput(
                    includeHeader: false,
                    hostBlocks: [
                      SshHostBlock(pattern: 'h', values: {option.key: legal.toUpperCase()}),
                    ],
                  ),
          );
          // Canonical spelling from the catalog, not whatever case was typed.
          expect(result.configText, contains('${option.key} $legal\n'));
        }

        expect(
          () => builder.execute(
            mode == SshConfigMode.server
                ? SshConfigBuilderInput(mode: mode, serverValues: {option.key: '__illegal__'})
                : SshConfigBuilderInput(
                    hostBlocks: [
                      SshHostBlock(pattern: 'h', values: {option.key: '__illegal__'}),
                    ],
                  ),
          ),
          throwsArgumentError,
          reason: '${option.key} accepted an illegal value',
        );
      }
    });

    test('booleans reject anything other than yes/no', () {
      for (final bad in ['true', '1', 'on', 'enabled', '']) {
        expect(
          () => builder.execute(
            SshConfigBuilderInput(
              mode: SshConfigMode.server,
              serverValues: {'X11Forwarding': bad},
            ),
          ),
          throwsArgumentError,
          reason: 'X11Forwarding accepted "$bad"',
        );
      }
    });

    test('integers are parsed and range-checked', () {
      expect(
        () => builder.execute(
          const SshConfigBuilderInput(
            hostBlocks: [SshHostBlock(pattern: 'h', values: {'Port': 'twenty-two'})],
          ),
        ),
        throwsArgumentError,
      );
      expect(
        () => builder.execute(
          const SshConfigBuilderInput(
            hostBlocks: [SshHostBlock(pattern: 'h', values: {'Port': '0'})],
          ),
        ),
        throwsArgumentError,
      );
      expect(
        () => builder.execute(
          const SshConfigBuilderInput(
            hostBlocks: [SshHostBlock(pattern: 'h', values: {'Port': '65536'})],
          ),
        ),
        throwsArgumentError,
      );
      expect(
        () => builder.execute(
          const SshConfigBuilderInput(
            mode: SshConfigMode.server,
            serverValues: {'RequiredRSASize': '1023'},
          ),
        ),
        throwsArgumentError,
        reason: 'RequiredRSASize can only be raised above 1024',
      );
    });

    test('rejects unknown directives and directives from the wrong file', () {
      expect(
        () => builder.execute(
          const SshConfigBuilderInput(
            hostBlocks: [SshHostBlock(pattern: 'h', values: {'NotADirective': 'x'})],
          ),
        ),
        throwsArgumentError,
      );
      // Server-only directive placed in a client Host block.
      expect(
        () => builder.execute(
          const SshConfigBuilderInput(
            hostBlocks: [SshHostBlock(pattern: 'h', values: {'PermitRootLogin': 'no'})],
          ),
        ),
        throwsArgumentError,
      );
      // Client-only directive placed in sshd_config.
      expect(
        () => builder.execute(
          const SshConfigBuilderInput(
            mode: SshConfigMode.server,
            serverValues: {'ProxyJump': 'bastion'},
          ),
        ),
        throwsArgumentError,
      );
    });

    test('rejects malformed Host patterns and empty input', () {
      expect(
        () => builder.execute(const SshConfigBuilderInput()),
        throwsArgumentError,
      );
      expect(
        () => builder.execute(const SshConfigBuilderInput(mode: SshConfigMode.server)),
        throwsArgumentError,
      );
      expect(
        () => builder.execute(
          const SshConfigBuilderInput(
            hostBlocks: [SshHostBlock(pattern: '   ', values: {'HostName': 'x'})],
          ),
        ),
        throwsArgumentError,
      );
      expect(
        () => builder.execute(
          const SshConfigBuilderInput(
            hostBlocks: [SshHostBlock(pattern: '*', values: {'HostName': 'x'})],
          ),
        ),
        throwsArgumentError,
        reason: 'Host * belongs in globalDefaults so it can be emitted last',
      );
      expect(
        () => builder.execute(
          const SshConfigBuilderInput(
            hostBlocks: [SshHostBlock(pattern: 'h', values: {'HostName': 'a\nb'})],
          ),
        ),
        throwsArgumentError,
      );
    });
  });

  group('hardened baseline', () {
    /// Regression guard. If someone later pastes in stale hardening advice
    /// (Mozilla's published lists still contain ssh-rsa, and CBC/SHA-1
    /// snippets are all over the internet), this test fails loudly rather
    /// than the app quietly emitting broken crypto.
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
    ];

    void assertNoDeprecatedAlgorithms(String config) {
      final lower = config.toLowerCase();
      for (final bad in forbidden) {
        expect(lower, isNot(contains(bad)), reason: 'deprecated algorithm "$bad" leaked into the output');
      }
    }

    test('client preset emits no deprecated algorithm', () {
      final preset = sshHardenedBaseline(SshConfigMode.client);
      expect(preset, isNotEmpty);

      final result = builder.execute(
        SshConfigBuilderInput(
          hostBlocks: const [
            SshHostBlock(pattern: 'prod', values: {'HostName': 'prod.example.com', 'User': 'deploy'}),
          ],
          globalDefaults: preset,
        ),
      );

      assertNoDeprecatedAlgorithms(result.configText);
      expect(result.warnings, isEmpty);
    });

    test('server preset emits no deprecated algorithm', () {
      final preset = sshHardenedBaseline(SshConfigMode.server);
      expect(preset, isNotEmpty);

      final result = builder.execute(
        SshConfigBuilderInput(mode: SshConfigMode.server, serverValues: preset),
      );

      assertNoDeprecatedAlgorithms(result.configText);
      expect(result.warnings, isEmpty);
    });

    test('the declared hardened constants themselves are clean', () {
      for (final list in [
        kHardenedCiphers,
        kHardenedMacs,
        kHardenedKexAlgorithms,
        kHardenedHostKeyAlgorithms,
      ]) {
        expect(sshDeprecatedAlgorithmsIn(list), isEmpty, reason: list);
      }
      for (final option in kSshOptionCatalog) {
        final hardened = option.hardenedValue;
        if (hardened == null) continue;
        expect(sshDeprecatedAlgorithmsIn(hardened), isEmpty, reason: '${option.key} = $hardened');
      }
    });

    test('server preset locks down the things that matter', () {
      final preset = sshHardenedBaseline(SshConfigMode.server);

      expect(preset['PermitRootLogin'], 'no');
      expect(preset['PasswordAuthentication'], 'no');
      expect(preset['KbdInteractiveAuthentication'], 'no');
      expect(preset['PermitEmptyPasswords'], 'no');
      expect(preset['PubkeyAuthentication'], 'yes');
      expect(preset['X11Forwarding'], 'no');
      expect(preset['AllowAgentForwarding'], 'no');
      expect(preset['AllowTcpForwarding'], 'no');
      expect(preset['LogLevel'], 'VERBOSE');
      expect(preset['MaxAuthTries'], '3');
      expect(preset['RequiredRSASize'], '3072');
      // Site-specific directives stay out of the preset.
      expect(preset.containsKey('AllowUsers'), isFalse);
      expect(preset.containsKey('AllowGroups'), isFalse);
      expect(preset.containsKey('Port'), isFalse);
      expect(preset.containsKey('ListenAddress'), isFalse);
      // Version-fragile directives stay out too.
      expect(preset.containsKey('PerSourcePenalties'), isFalse);
    });

    test('client preset locks down the things that matter', () {
      final preset = sshHardenedBaseline(SshConfigMode.client);

      expect(preset['PasswordAuthentication'], 'no');
      expect(preset['IdentitiesOnly'], 'yes');
      expect(preset['HashKnownHosts'], 'yes');
      expect(preset['ForwardAgent'], 'no');
      expect(preset['ForwardX11'], 'no');
      expect(preset['StrictHostKeyChecking'], 'accept-new');
      expect(preset.containsKey('HostName'), isFalse);
      expect(preset.containsKey('User'), isFalse);
    });

    test('the KEX list leads with the widely supported PQ algorithm', () {
      // mlkem768x25519-sha256 is 9.9+/10.0 and would break older sshd on
      // startup, so it must be suggested as a comment, not baked in.
      expect(kHardenedKexAlgorithms, startsWith('sntrup761x25519-sha512@openssh.com'));
      expect(kHardenedKexAlgorithms, isNot(contains('mlkem768x25519-sha256')));

      final result = builder.execute(
        SshConfigBuilderInput(
          mode: SshConfigMode.server,
          includeHeader: false,
          serverValues: sshHardenedBaseline(SshConfigMode.server),
        ),
      );
      expect(result.configText, contains('# OpenSSH 9.9+/10.0 users may prepend mlkem768x25519-sha256'));
    });
  });

  group('deprecated algorithm detection', () {
    test('flags legacy tokens inside an algorithm list', () {
      expect(sshDeprecatedAlgorithmsIn('aes256-cbc,aes128-ctr'), ['aes256-cbc']);
      expect(sshDeprecatedAlgorithmsIn('ssh-ed25519,ssh-rsa'), ['ssh-rsa']);
      expect(sshDeprecatedAlgorithmsIn('hmac-sha2-256,hmac-sha1-etm@openssh.com'), ['hmac-sha1-etm@openssh.com']);
      expect(sshDeprecatedAlgorithmsIn('+arcfour256'), ['+arcfour256']);
    });

    test('does not false-positive on modern names', () {
      expect(sshDeprecatedAlgorithmsIn('rsa-sha2-512,rsa-sha2-256,ssh-ed25519'), isEmpty);
      expect(sshDeprecatedAlgorithmsIn('diffie-hellman-group18-sha512'), isEmpty);
      expect(sshDeprecatedAlgorithmsIn('diffie-hellman-group-exchange-sha256'), isEmpty);
      expect(sshDeprecatedAlgorithmsIn('hmac-sha2-512-etm@openssh.com,umac-128-etm@openssh.com'), isEmpty);
      expect(sshDeprecatedAlgorithmsIn('mlkem768x25519-sha256'), isEmpty);
    });

    test('a user-supplied legacy list warns but still generates', () {
      final result = builder.execute(
        const SshConfigBuilderInput(
          mode: SshConfigMode.server,
          serverValues: {'Ciphers': 'aes256-cbc,aes128-ctr'},
        ),
      );

      expect(result.configText, contains('Ciphers aes256-cbc,aes128-ctr'));
      expect(result.warnings.join(), contains('aes256-cbc'));
    });
  });

  group('catalog integrity', () {
    test('every option is valid in at least one mode and has a description', () {
      for (final option in kSshOptionCatalog) {
        expect(option.modes, isNotEmpty, reason: option.key);
        expect(option.description.trim(), isNotEmpty, reason: option.key);
        expect(option.key.trim(), option.key);
        if (option.kind == SshValueKind.choice) {
          expect(option.allowedValues, isNotEmpty, reason: option.key);
        } else {
          expect(option.allowedValues, isEmpty, reason: option.key);
        }
        if (option.kind == SshValueKind.boolean) {
          expect(['yes', 'no', null], contains(option.defaultValue), reason: option.key);
          expect(['yes', 'no', null], contains(option.hardenedValue), reason: option.key);
        }
        if (option.kind == SshValueKind.choice && option.hardenedValue != null) {
          expect(option.allowedValues, contains(option.hardenedValue), reason: option.key);
        }
      }
    });

    test('no duplicate key within a mode, and every option lands in a known group', () {
      for (final mode in SshConfigMode.values) {
        final keys = sshOptionsForMode(mode).map((o) => o.key).toList();
        expect(keys.toSet().length, keys.length, reason: 'duplicate directive in $mode');
        expect(keys, isNotEmpty);
        for (final option in sshOptionsForMode(mode)) {
          expect(sshGroupsForMode(mode), contains(option.group), reason: '${option.key} in ${option.group}');
          expect(sshOptionFor(mode, option.key), isNotNull);
        }
      }
    });

    test('sshOptionFor respects mode boundaries', () {
      expect(sshOptionFor(SshConfigMode.server, 'PermitRootLogin'), isNotNull);
      expect(sshOptionFor(SshConfigMode.client, 'PermitRootLogin'), isNull);
      expect(sshOptionFor(SshConfigMode.client, 'ProxyJump'), isNotNull);
      expect(sshOptionFor(SshConfigMode.server, 'ProxyJump'), isNull);
      expect(sshOptionFor(SshConfigMode.client, 'Ciphers'), isNotNull);
      expect(sshOptionFor(SshConfigMode.server, 'Ciphers'), isNotNull);
    });
  });
}
