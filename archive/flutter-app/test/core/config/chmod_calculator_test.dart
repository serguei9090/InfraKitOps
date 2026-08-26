import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/config/chmod_calculator.dart';

void main() {
  const calc = ChmodCalculator();

  group('octal -> symbolic -> octal round-trip', () {
    for (final octal in ['644', '755', '600', '777']) {
      test('$octal round-trips through parse/symbolic/parse', () {
        final permissions = calc.parseOctal(octal);
        expect(permissions.octal, octal);

        final symbolic = permissions.symbolic;
        final reparsed = calc.parseSymbolic(symbolic);
        expect(reparsed.octal, octal);
        expect(reparsed.symbolic, symbolic);
      });
    }

    test('644 renders as rw-r--r--', () {
      expect(calc.parseOctal('644').symbolic, 'rw-r--r--');
    });

    test('755 renders as rwxr-xr-x', () {
      expect(calc.parseOctal('755').symbolic, 'rwxr-xr-x');
    });

    test('600 renders as rw-------', () {
      expect(calc.parseOctal('600').symbolic, 'rw-------');
    });

    test('777 renders as rwxrwxrwx', () {
      expect(calc.parseOctal('777').symbolic, 'rwxrwxrwx');
    });
  });

  group('structured <-> octal/symbolic round-trip', () {
    test('building the structured permissions directly matches parse', () {
      const permissions = ChmodPermissions(
        owner: PermissionTriad(read: true, write: true, execute: true),
        group: PermissionTriad(read: true, execute: true),
        other: PermissionTriad(read: true, execute: true),
      );

      expect(permissions.octal, '755');
      expect(permissions.symbolic, 'rwxr-xr-x');
      expect(calc.parseOctal('755'), permissions);
      expect(calc.parseSymbolic('rwxr-xr-x'), permissions);
    });

    test('PermissionTriad.fromDigit round-trips through .digit', () {
      for (var d = 0; d <= 7; d++) {
        expect(PermissionTriad.fromDigit(d).digit, d);
      }
    });
  });

  group('special bits', () {
    test('4755 is setuid with lowercase s (owner execute is on)', () {
      final permissions = calc.parseOctal('4755');
      expect(permissions.setUid, isTrue);
      expect(permissions.setGid, isFalse);
      expect(permissions.sticky, isFalse);
      expect(permissions.octalFull, '4755');
      expect(permissions.octalPreferred, '4755');
      expect(permissions.symbolic, 'rwsr-xr-x');

      // Round-trips back through symbolic parsing.
      final reparsed = calc.parseSymbolic('rwsr-xr-x');
      expect(reparsed, permissions);
      expect(reparsed.octalFull, '4755');
    });

    test('2755 is setgid with lowercase s (group execute is on)', () {
      final permissions = calc.parseOctal('2755');
      expect(permissions.setGid, isTrue);
      expect(permissions.setUid, isFalse);
      expect(permissions.sticky, isFalse);
      expect(permissions.octalFull, '2755');
      expect(permissions.symbolic, 'rwxr-sr-x');

      final reparsed = calc.parseSymbolic('rwxr-sr-x');
      expect(reparsed, permissions);
      expect(reparsed.octalFull, '2755');
    });

    test('1777 is sticky with lowercase t (other execute is on)', () {
      final permissions = calc.parseOctal('1777');
      expect(permissions.sticky, isTrue);
      expect(permissions.setUid, isFalse);
      expect(permissions.setGid, isFalse);
      expect(permissions.octalFull, '1777');
      expect(permissions.symbolic, 'rwxrwxrwt');

      final reparsed = calc.parseSymbolic('rwxrwxrwt');
      expect(reparsed, permissions);
      expect(reparsed.octalFull, '1777');
    });

    test('uppercase S when setuid/setgid is set but execute bit is off', () {
      // 4644: setuid on, but owner execute bit is off => uppercase S.
      final setuidNoExec = calc.parseOctal('4644');
      expect(setuidNoExec.setUid, isTrue);
      expect(setuidNoExec.owner.execute, isFalse);
      expect(setuidNoExec.symbolic, 'rwSr--r--');
      expect(calc.parseSymbolic('rwSr--r--'), setuidNoExec);

      // 2644: setgid on, group execute bit off => uppercase S.
      final setgidNoExec = calc.parseOctal('2644');
      expect(setgidNoExec.setGid, isTrue);
      expect(setgidNoExec.group.execute, isFalse);
      expect(setgidNoExec.symbolic, 'rw-r-Sr--');
      expect(calc.parseSymbolic('rw-r-Sr--'), setgidNoExec);
    });

    test('uppercase T when sticky is set but other execute bit is off', () {
      // 1644: sticky on, other execute bit off => uppercase T.
      final stickyNoExec = calc.parseOctal('1644');
      expect(stickyNoExec.sticky, isTrue);
      expect(stickyNoExec.other.execute, isFalse);
      expect(stickyNoExec.symbolic, 'rw-r--r-T');
      expect(calc.parseSymbolic('rw-r--r-T'), stickyNoExec);
    });

    test('octalPreferred omits the special digit when no special bit is set', () {
      expect(calc.parseOctal('755').octalPreferred, '755');
      expect(calc.parseOctal('0755').octalPreferred, '755');
    });

    test('all three special bits combine (7777)', () {
      final permissions = calc.parseOctal('7777');
      expect(permissions.setUid, isTrue);
      expect(permissions.setGid, isTrue);
      expect(permissions.sticky, isTrue);
      expect(permissions.symbolic, 'rwsrwsrwt');
      expect(calc.parseSymbolic('rwsrwsrwt'), permissions);
    });
  });

  group('parse() notation auto-detection', () {
    test('all-digit text is treated as octal', () {
      expect(calc.parse('755'), calc.parseOctal('755'));
    });

    test('non-digit text is treated as symbolic', () {
      expect(calc.parse('rwxr-xr-x'), calc.parseSymbolic('rwxr-xr-x'));
    });

    test('a leading file-type character is accepted (10-char symbolic)', () {
      expect(calc.parse('-rwxr-xr-x'), calc.parseSymbolic('rwxr-xr-x'));
      expect(calc.parse('drwxr-xr-x'), calc.parseSymbolic('rwxr-xr-x'));
    });

    test('short octal is left-padded like chmod itself', () {
      expect(calc.parseOctal('44').octal, '044');
      expect(calc.parseOctal('44'), calc.parseOctal('044'));
    });
  });

  group('invalid input is rejected cleanly', () {
    test('empty mode', () {
      expect(() => calc.parse(''), throwsFormatException);
      expect(() => calc.parse('   '), throwsFormatException);
      expect(() => calc.parseOctal(''), throwsFormatException);
    });

    test('octal digit above 7', () {
      expect(() => calc.parseOctal('789'), throwsFormatException);
      expect(() => calc.parse('789'), throwsFormatException);
    });

    test('too many octal digits', () {
      expect(() => calc.parseOctal('12345'), throwsFormatException);
    });

    test('octal that is not a number', () {
      expect(() => calc.parseOctal('abc'), throwsFormatException);
    });

    test('symbolic mode of the wrong length', () {
      expect(() => calc.parseSymbolic('rwxr-xr'), throwsFormatException);
      expect(() => calc.parseSymbolic('rwxr-xr-xrwx'), throwsFormatException);
    });

    test('symbolic mode with an invalid read character', () {
      expect(() => calc.parseSymbolic('zwxr-xr-x'), throwsFormatException);
    });

    test('symbolic mode with an invalid write character', () {
      expect(() => calc.parseSymbolic('rzxr-xr-x'), throwsFormatException);
    });

    test('symbolic mode with an invalid execute/special character', () {
      expect(() => calc.parseSymbolic('rwzr-xr-x'), throwsFormatException);
    });

    test('PermissionTriad.fromDigit rejects out-of-range digits', () {
      expect(() => PermissionTriad.fromDigit(-1), throwsArgumentError);
      expect(() => PermissionTriad.fromDigit(8), throwsArgumentError);
    });
  });

  group('describe', () {
    test('plain 644 describes each class without special-bit sentences', () {
      final description = calc.describe(calc.parseOctal('644'));
      expect(description, contains('Owner can read and write'));
      expect(description, contains('Group can read'));
      expect(description, contains('Others can read'));
      expect(description, isNot(contains('setuid')));
      expect(description, isNot(contains('setgid')));
      expect(description, isNot(contains('sticky')));
    });

    test('000 describes as no access for everyone', () {
      final description = calc.describe(calc.parseOctal('000'));
      expect(description, contains('Owner has no access'));
      expect(description, contains('Group has no access'));
      expect(description, contains('Others has no access'));
    });

    test('4755 mentions setuid', () {
      expect(calc.describe(calc.parseOctal('4755')), contains('setuid is set'));
    });

    test('2755 mentions setgid', () {
      expect(calc.describe(calc.parseOctal('2755')), contains('setgid is set'));
    });

    test('1777 mentions the sticky bit', () {
      expect(calc.describe(calc.parseOctal('1777')), contains('sticky bit is set'));
    });
  });

  group('execute (IToolUseCase) and fromPermissions', () {
    test('produces the ready-to-paste command with the given path', () {
      final result = calc.execute(const ChmodInput(mode: '755', path: 'deploy.sh'));
      expect(result.command, 'chmod 755 deploy.sh');
      expect(result.octal, '755');
      expect(result.octalFull, '0755');
      expect(result.symbolic, 'rwxr-xr-x');
    });

    test('blank path falls back to "filename"', () {
      final result = calc.execute(const ChmodInput(mode: '644', path: '   '));
      expect(result.command, 'chmod 644 filename');
    });

    test('the special-digit form is used in the command when set', () {
      final result = calc.execute(const ChmodInput(mode: '4755', path: 'suid-bin'));
      expect(result.command, 'chmod 4755 suid-bin');
    });

    test('fromPermissions matches execute for an equivalent structured input', () {
      final permissions = calc.parseOctal('2755');
      final viaFromPermissions = calc.fromPermissions(permissions, path: 'x');
      final viaExecute = calc.execute(const ChmodInput(mode: '2755', path: 'x'));
      expect(viaFromPermissions.command, viaExecute.command);
      expect(viaFromPermissions.symbolic, viaExecute.symbolic);
    });
  });
}
