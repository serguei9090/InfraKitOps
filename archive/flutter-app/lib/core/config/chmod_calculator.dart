import '../ports/i_tool_use_case.dart';

/// The read/write/execute triad for one class of user (owner, group, other).
class PermissionTriad {
  const PermissionTriad({this.read = false, this.write = false, this.execute = false});

  /// Builds a triad from a single octal digit (0-7).
  factory PermissionTriad.fromDigit(int digit) {
    if (digit < 0 || digit > 7) {
      throw ArgumentError('Octal digit $digit is out of range (allowed 0-7)');
    }
    return PermissionTriad(read: digit & 4 != 0, write: digit & 2 != 0, execute: digit & 1 != 0);
  }

  final bool read;
  final bool write;
  final bool execute;

  int get digit => (read ? 4 : 0) | (write ? 2 : 0) | (execute ? 1 : 0);

  PermissionTriad copyWith({bool? read, bool? write, bool? execute}) =>
      PermissionTriad(read: read ?? this.read, write: write ?? this.write, execute: execute ?? this.execute);

  @override
  bool operator ==(Object other) =>
      other is PermissionTriad && other.read == read && other.write == write && other.execute == execute;

  @override
  int get hashCode => digit.hashCode;

  @override
  String toString() => '${read ? 'r' : '-'}${write ? 'w' : '-'}${execute ? 'x' : '-'}';
}

/// The full Unix mode: three triads plus the three special bits.
///
/// This is the canonical representation the calculator converts to and from;
/// octal text and symbolic text are both just renderings of it.
class ChmodPermissions {
  const ChmodPermissions({
    this.owner = const PermissionTriad(),
    this.group = const PermissionTriad(),
    this.other = const PermissionTriad(),
    this.setUid = false,
    this.setGid = false,
    this.sticky = false,
  });

  final PermissionTriad owner;
  final PermissionTriad group;
  final PermissionTriad other;

  /// setuid (octal 4000): run with the file owner's identity.
  final bool setUid;

  /// setgid (octal 2000): run with the file group's identity; on a directory,
  /// new entries inherit that group.
  final bool setGid;

  /// sticky / restricted-deletion bit (octal 1000).
  final bool sticky;

  int get specialDigit => (setUid ? 4 : 0) | (setGid ? 2 : 0) | (sticky ? 1 : 0);

  /// Three-digit octal, e.g. `755`. Special bits are not represented here.
  String get octal => '${owner.digit}${group.digit}${other.digit}';

  /// Four-digit octal including the special bits, e.g. `4755`.
  String get octalFull => '$specialDigit$octal';

  /// The shortest octal string that still round-trips: three digits when no
  /// special bit is set, four otherwise.
  String get octalPreferred => specialDigit == 0 ? octal : octalFull;

  /// Nine-character symbolic form, e.g. `rwxr-xr-x` or `rwsr-sr-t`.
  ///
  /// The special bits reuse the execute slot: lowercase `s`/`t` when the
  /// execute bit is also set, uppercase `S`/`T` when it is not (which is how
  /// `ls` signals the unusual "special bit without execute" combination).
  String get symbolic {
    return _triadSymbolic(owner, special: setUid, specialChar: 's') +
        _triadSymbolic(group, special: setGid, specialChar: 's') +
        _triadSymbolic(other, special: sticky, specialChar: 't');
  }

  static String _triadSymbolic(PermissionTriad triad, {required bool special, required String specialChar}) {
    final r = triad.read ? 'r' : '-';
    final w = triad.write ? 'w' : '-';
    final String x;
    if (special) {
      x = triad.execute ? specialChar : specialChar.toUpperCase();
    } else {
      x = triad.execute ? 'x' : '-';
    }
    return '$r$w$x';
  }

  ChmodPermissions copyWith({
    PermissionTriad? owner,
    PermissionTriad? group,
    PermissionTriad? other,
    bool? setUid,
    bool? setGid,
    bool? sticky,
  }) {
    return ChmodPermissions(
      owner: owner ?? this.owner,
      group: group ?? this.group,
      other: other ?? this.other,
      setUid: setUid ?? this.setUid,
      setGid: setGid ?? this.setGid,
      sticky: sticky ?? this.sticky,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is ChmodPermissions &&
      other.owner == owner &&
      other.group == group &&
      other.other == this.other &&
      other.setUid == setUid &&
      other.setGid == setGid &&
      other.sticky == sticky;

  @override
  int get hashCode => Object.hash(owner, group, other, setUid, setGid, sticky);

  @override
  String toString() => '$octalFull ($symbolic)';
}

/// Input for [ChmodCalculator]: a mode in either notation, plus the path the
/// generated command should target.
class ChmodInput {
  const ChmodInput({required this.mode, this.path = 'filename'});

  /// Either octal (`755`, `4755`, `0644`) or symbolic (`rwxr-xr-x`,
  /// `-rwxr-xr-x`). The notation is detected automatically.
  final String mode;

  final String path;
}

/// Everything the UI renders for one mode.
class ChmodResult {
  const ChmodResult({
    required this.permissions,
    required this.octal,
    required this.octalFull,
    required this.symbolic,
    required this.command,
    required this.description,
  });

  final ChmodPermissions permissions;

  /// Three-digit octal, e.g. `755`.
  final String octal;

  /// Four-digit octal, e.g. `0755` / `4755`.
  final String octalFull;

  /// Nine-character symbolic form, e.g. `rwxr-xr-x`.
  final String symbolic;

  /// The ready-to-paste command, e.g. `chmod 755 filename`.
  final String command;

  /// Plain-English summary of what the mode allows.
  final String description;
}

/// Converts between octal, symbolic and structured Unix permissions, and
/// explains what a mode actually allows.
///
/// Pure Dart — no packages, no I/O, no Flutter.
class ChmodCalculator implements IToolUseCase<ChmodInput, ChmodResult> {
  const ChmodCalculator();

  @override
  ChmodResult execute(ChmodInput input) => fromPermissions(parse(input.mode), path: input.path);

  /// Builds a result from an already-structured mode.
  ChmodResult fromPermissions(ChmodPermissions permissions, {String path = 'filename'}) {
    final target = path.trim().isEmpty ? 'filename' : path.trim();
    return ChmodResult(
      permissions: permissions,
      octal: permissions.octal,
      octalFull: permissions.octalFull,
      symbolic: permissions.symbolic,
      command: 'chmod ${permissions.octalPreferred} $target',
      description: describe(permissions),
    );
  }

  /// Parses either notation, choosing by shape: anything that is only digits
  /// is octal, anything else is treated as symbolic.
  ChmodPermissions parse(String mode) {
    final text = mode.trim();
    if (text.isEmpty) {
      throw const FormatException('Mode is empty — enter octal (e.g. 755) or symbolic (e.g. rwxr-xr-x)');
    }
    if (RegExp(r'^[0-9]+$').hasMatch(text)) return parseOctal(text);
    return parseSymbolic(text);
  }

  /// Parses 1-4 octal digits. Short forms are left-padded the way `chmod`
  /// itself pads them (`44` means `044`).
  ChmodPermissions parseOctal(String mode) {
    final text = mode.trim();
    if (text.isEmpty) {
      throw const FormatException('Octal mode is empty');
    }
    if (!RegExp(r'^[0-7]{1,4}$').hasMatch(text)) {
      if (RegExp(r'^[0-9]+$').hasMatch(text)) {
        if (text.length > 4) {
          throw FormatException('Octal mode "$text" has ${text.length} digits (expected 1-4, e.g. 755 or 4755)');
        }
        throw FormatException('Octal mode "$text" contains a digit above 7 — octal digits are 0-7');
      }
      throw FormatException('Octal mode "$text" is not a number (expected 1-4 octal digits, e.g. 755)');
    }

    final padded = text.padLeft(4, '0');
    final special = int.parse(padded[0]);

    return ChmodPermissions(
      owner: PermissionTriad.fromDigit(int.parse(padded[1])),
      group: PermissionTriad.fromDigit(int.parse(padded[2])),
      other: PermissionTriad.fromDigit(int.parse(padded[3])),
      setUid: special & 4 != 0,
      setGid: special & 2 != 0,
      sticky: special & 1 != 0,
    );
  }

  /// Parses a 9-character symbolic mode, optionally prefixed by the
  /// file-type character `ls -l` prints (`-rwxr-xr-x`, `drwxr-xr-x`).
  ChmodPermissions parseSymbolic(String mode) {
    var text = mode.trim();
    if (text.length == 10) {
      // Drop the leading file-type character; it is not part of the mode.
      text = text.substring(1);
    }
    if (text.length != 9) {
      throw FormatException(
        'Symbolic mode "${mode.trim()}" must be 9 characters '
        '(e.g. rwxr-xr-x), or 10 with a leading file-type character',
      );
    }

    final owner = _parseTriad(text.substring(0, 3), mode, 'owner', 's');
    final group = _parseTriad(text.substring(3, 6), mode, 'group', 's');
    final other = _parseTriad(text.substring(6, 9), mode, 'other', 't');

    return ChmodPermissions(
      owner: owner.triad,
      group: group.triad,
      other: other.triad,
      setUid: owner.special,
      setGid: group.special,
      sticky: other.special,
    );
  }

  _ParsedTriad _parseTriad(String text, String fullMode, String who, String specialChar) {
    final r = text[0];
    final w = text[1];
    final x = text[2];

    if (r != 'r' && r != '-') {
      throw FormatException('Invalid $who read character "$r" in "${fullMode.trim()}" (expected "r" or "-")');
    }
    if (w != 'w' && w != '-') {
      throw FormatException('Invalid $who write character "$w" in "${fullMode.trim()}" (expected "w" or "-")');
    }

    final upper = specialChar.toUpperCase();
    late final bool execute;
    late final bool special;
    switch (x) {
      case 'x':
        execute = true;
        special = false;
      case '-':
        execute = false;
        special = false;
      default:
        if (x == specialChar) {
          execute = true;
          special = true;
        } else if (x == upper) {
          execute = false;
          special = true;
        } else {
          throw FormatException(
            'Invalid $who execute character "$x" in "${fullMode.trim()}" '
            '(expected "x", "-", "$specialChar" or "$upper")',
          );
        }
    }

    return _ParsedTriad(
      PermissionTriad(read: r == 'r', write: w == 'w', execute: execute),
      special,
    );
  }

  /// Plain-English summary of what [permissions] allows.
  String describe(ChmodPermissions permissions) {
    final sentences = <String>[
      'Owner ${_triadPhrase(permissions.owner)}.',
      'Group ${_triadPhrase(permissions.group)}.',
      'Others ${_triadPhrase(permissions.other)}.',
    ];

    if (permissions.setUid) {
      sentences.add(
        'setuid is set: the file runs with the permissions of its owner '
        '${permissions.owner.execute ? '' : '(but the owner execute bit is off, so it has no effect on execution) '}'
        'rather than the user who started it.',
      );
    }
    if (permissions.setGid) {
      sentences.add(
        'setgid is set: the file runs with the permissions of its group'
        '${permissions.group.execute ? '' : ' (but the group execute bit is off)'}; '
        'on a directory, new entries inherit that group.',
      );
    }
    if (permissions.sticky) {
      sentences.add(
        'The sticky bit is set: inside a directory, only a file\'s owner '
        '(or root) can delete or rename it'
        '${permissions.other.execute ? '' : ' (the other execute bit is off, so the directory is not traversable by others)'}.',
      );
    }

    return sentences.join(' ');
  }

  String _triadPhrase(PermissionTriad triad) {
    final verbs = <String>[
      if (triad.read) 'read',
      if (triad.write) 'write',
      if (triad.execute) 'execute',
    ];
    if (verbs.isEmpty) return 'has no access';
    if (verbs.length == 1) return 'can ${verbs.first}';
    return 'can ${verbs.sublist(0, verbs.length - 1).join(', ')} and ${verbs.last}';
  }
}

class _ParsedTriad {
  const _ParsedTriad(this.triad, this.special);

  final PermissionTriad triad;
  final bool special;
}
