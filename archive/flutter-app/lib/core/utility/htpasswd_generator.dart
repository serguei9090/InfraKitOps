/// htpasswd / HTTP Basic auth generator — pure Dart, no I/O, no Flutter.
///
/// Produces the `user:hash` lines that Apache's `mod_authn_file` and nginx's
/// `ngx_http_auth_basic_module` read, plus the `Authorization: Basic …` header
/// that the other half of a Basic-auth debugging session needs.
///
/// ## Which algorithms are here, and why
///
/// | Algorithm | Prefix    | Verdict |
/// |-----------|-----------|---------|
/// | bcrypt    | `$2a$`    | The default. Deliberately slow, per-hash salt, tunable cost. |
/// | APR1      | `$apr1$`  | Apache's own MD5 variant. 1000 MD5 rounds — weak by modern standards, but it is the only format every Apache build understands without extra modules, and it is what `htpasswd -m` writes. |
/// | SHA-1     | `{SHA}`   | **Legacy. Unsalted, single-pass, GPU-trivial.** Included only because it appears in old files and load-balancer configs; never choose it for something new. |
///
/// Plaintext and DES `crypt(3)` are deliberately *not* offered. Plaintext is
/// not a hash at all, and DES crypt truncates the password at 8 characters
/// while using a 12-bit salt — offering either would be offering a footgun.
///
/// ## APR1 correctness
///
/// [apr1Crypt] is a direct transliteration of the reference `md5crypt` /
/// `apr_md5_encode` implementation, including the two details that
/// re-implementations usually get wrong:
///
///  1. The digest buffer is zeroed before the `for (i = pwlen; i; i >>= 1)`
///     loop, so the "bit set" branch appends a **NUL byte**, not a digest byte.
///  2. The final 16 bytes are emitted in the scrambled order
///     `0,6,12 / 1,7,13 / 2,8,14 / 3,9,15 / 4,10,5 / 11`, base64-ed with the
///     `./0-9A-Za-z` alphabet, least-significant group first.
///
/// The unit tests pin the output against reference vectors produced by
/// `openssl passwd -apr1 -salt <salt> <password>`.
library;

import 'dart:convert';
import 'dart:math';

import 'package:bcrypt/bcrypt.dart';
import 'package:crypto/crypto.dart';

import '../ports/i_tool_use_case.dart';

/// bcrypt cost (log2 rounds) bounds, per the algorithm's own spec.
const int kHtpasswdMinBcryptCost = 4;
const int kHtpasswdMaxBcryptCost = 31;

/// A sane 2020s default: roughly 50–100 ms per hash on server hardware.
const int kHtpasswdDefaultBcryptCost = 12;

/// Below this, bcrypt stops being meaningfully expensive to brute-force.
const int kHtpasswdWeakBcryptCost = 10;

/// bcrypt ignores everything past the 72nd byte of the password.
const int kBcryptPasswordByteLimit = 72;

/// The password-hashing schemes this tool will emit.
enum HtpasswdAlgorithm {
  bcrypt(
    label: 'bcrypt',
    prefix: r'$2a$',
    description:
        'Deliberately slow, per-hash random salt, tunable cost factor. The right choice for anything new. '
        'Supported by Apache 2.4+ and by nginx on any platform whose crypt(3) understands \$2a\$/\$2y\$.',
    isLegacy: false,
  ),
  apr1(
    label: 'Apache MD5 (APR1)',
    prefix: r'$apr1$',
    description:
        "Apache's own salted MD5, 1000 rounds. Weak against modern GPU cracking, but it is what `htpasswd -m` "
        'writes and every Apache build understands it. Use it only for compatibility.',
    isLegacy: false,
  ),
  sha1(
    label: 'SHA-1 ({SHA}) — insecure, legacy only',
    prefix: '{SHA}',
    description:
        'INSECURE: unsalted, single-pass SHA-1. Identical passwords produce identical hashes and a commodity GPU '
        'tries billions of candidates per second. Present only for reading and reproducing legacy files — never '
        'pick this for a new deployment.',
    isLegacy: true,
  );

  const HtpasswdAlgorithm({
    required this.label,
    required this.prefix,
    required this.description,
    required this.isLegacy,
  });

  final String label;

  /// The literal marker a hash of this type starts with.
  final String prefix;

  final String description;

  /// True for schemes that must not be chosen for new work.
  final bool isLegacy;

  /// Only bcrypt has a tunable work factor.
  bool get hasCostFactor => this == HtpasswdAlgorithm.bcrypt;
}

/// One credential going into the file.
class HtpasswdEntry {
  const HtpasswdEntry({required this.username, required this.password});

  final String username;
  final String password;
}

/// One rendered `user:hash` line.
class HtpasswdLine {
  const HtpasswdLine({required this.username, required this.hash});

  final String username;

  /// The hash portion only, e.g. `$2a$12$…`.
  final String hash;

  /// The complete file line.
  String get line => '$username:$hash';

  @override
  String toString() => line;
}

class HtpasswdGeneratorInput {
  const HtpasswdGeneratorInput({
    required this.entries,
    this.algorithm = HtpasswdAlgorithm.bcrypt,
    this.bcryptCost = kHtpasswdDefaultBcryptCost,
    this.includeHeaderComment = false,
  });

  /// Credentials in file order. Must not be empty.
  final List<HtpasswdEntry> entries;

  final HtpasswdAlgorithm algorithm;

  /// bcrypt log2 rounds. Ignored by the other algorithms.
  final int bcryptCost;

  /// Prepend a `#` header. Both `mod_authn_file` and nginx's auth_basic skip
  /// lines starting with `#`, but the default is off — a credentials file is
  /// usually cleaner without one.
  final bool includeHeaderComment;
}

class HtpasswdGeneratorResult {
  const HtpasswdGeneratorResult({
    required this.fileContent,
    required this.lines,
    this.warnings = const [],
    this.suggestedFileName = '.htpasswd',
  });

  /// The complete file text, newline-terminated.
  final String fileContent;

  /// One entry per credential, in file order. Excludes any header comment.
  final List<HtpasswdLine> lines;

  /// Non-fatal advisories (legacy algorithm, weak cost, duplicate user, …).
  final List<String> warnings;

  /// Filename to suggest in a native "save as" dialog.
  final String suggestedFileName;
}

/// Generates `.htpasswd` file content from a list of credentials.
///
/// Every hash is computed here in pure Dart; nothing is shelled out to
/// `htpasswd(1)`, so the tool works identically on every platform the app
/// ships to.
///
/// Invalid usernames throw [ArgumentError] — a username containing `:` would
/// silently corrupt the file's field separator, and a blank one produces a
/// line no server can match. Weak-but-legal choices come back as
/// [HtpasswdGeneratorResult.warnings].
class HtpasswdGenerator implements IToolUseCase<HtpasswdGeneratorInput, HtpasswdGeneratorResult> {
  const HtpasswdGenerator();

  @override
  HtpasswdGeneratorResult execute(HtpasswdGeneratorInput input) {
    if (input.entries.isEmpty) {
      throw ArgumentError('Add at least one user to generate an htpasswd file.');
    }
    if (input.algorithm.hasCostFactor) {
      _checkBcryptCost(input.bcryptCost);
    }

    final warnings = <String>[];
    final seen = <String>{};
    final lines = <HtpasswdLine>[];

    for (final entry in input.entries) {
      final error = validateHtpasswdUsername(entry.username);
      if (error != null) throw ArgumentError(error);

      if (!seen.add(entry.username)) {
        warnings.add(
          'Duplicate user "${entry.username}": most servers use the FIRST matching line, so the later one is dead weight.',
        );
      }
      if (entry.password.isEmpty) {
        warnings.add('User "${entry.username}" has an empty password.');
      }
      if (input.algorithm == HtpasswdAlgorithm.bcrypt &&
          utf8.encode(entry.password).length > kBcryptPasswordByteLimit) {
        warnings.add(
          'User "${entry.username}": bcrypt ignores everything past $kBcryptPasswordByteLimit bytes, '
          'so the tail of this password does not protect anything.',
        );
      }

      lines.add(
        HtpasswdLine(
          username: entry.username,
          hash: hashPassword(entry.password, algorithm: input.algorithm, bcryptCost: input.bcryptCost),
        ),
      );
    }

    if (input.algorithm.isLegacy) {
      warnings.add(
        '${input.algorithm.label}: this hash is unsalted and fast to brute-force. Use it only to reproduce an '
        'existing legacy file, never for a new deployment.',
      );
    }
    if (input.algorithm == HtpasswdAlgorithm.apr1) {
      warnings.add(
        'APR1 is 1000 rounds of MD5 — orders of magnitude cheaper to crack than bcrypt. Prefer bcrypt unless a '
        'legacy Apache build forces your hand.',
      );
    }
    if (input.algorithm.hasCostFactor && input.bcryptCost < kHtpasswdWeakBcryptCost) {
      warnings.add(
        'bcrypt cost ${input.bcryptCost} is low. $kHtpasswdWeakBcryptCost is the minimum worth deploying; '
        '$kHtpasswdDefaultBcryptCost is the current default.',
      );
    }

    final buffer = StringBuffer();
    if (input.includeHeaderComment) {
      buffer.writeln('# .htpasswd — generated by InfraKit Studio (${input.algorithm.label})');
      buffer.writeln('# Install with mode 0640, owned by root and readable by the web server user.');
      buffer.writeln('# Keep it OUTSIDE the document root.');
    }
    for (final line in lines) {
      buffer.writeln(line.line);
    }

    return HtpasswdGeneratorResult(
      fileContent: buffer.toString(),
      lines: List.unmodifiable(lines),
      warnings: List.unmodifiable(warnings),
    );
  }

  /// Hashes one password in [algorithm]'s htpasswd encoding (prefix included).
  ///
  /// [salt] is only honoured by [HtpasswdAlgorithm.apr1] and exists so tests
  /// can pin the output against a reference vector; leave it null in
  /// production so a fresh random salt is drawn. bcrypt always generates its
  /// own salt, and SHA-1 has none — that is the whole problem with it.
  String hashPassword(
    String password, {
    HtpasswdAlgorithm algorithm = HtpasswdAlgorithm.bcrypt,
    int bcryptCost = kHtpasswdDefaultBcryptCost,
    String? salt,
  }) {
    switch (algorithm) {
      case HtpasswdAlgorithm.bcrypt:
        _checkBcryptCost(bcryptCost);
        return BCrypt.hashpw(password, BCrypt.gensalt(logRounds: bcryptCost));
      case HtpasswdAlgorithm.apr1:
        return apr1Crypt(password, salt: salt);
      case HtpasswdAlgorithm.sha1:
        return '{SHA}${base64.encode(sha1.convert(utf8.encode(password)).bytes)}';
    }
  }

  static void _checkBcryptCost(int cost) {
    if (cost < kHtpasswdMinBcryptCost || cost > kHtpasswdMaxBcryptCost) {
      throw ArgumentError.value(
        cost,
        'bcryptCost',
        'Must be between $kHtpasswdMinBcryptCost and $kHtpasswdMaxBcryptCost',
      );
    }
  }
}

/// Checks an htpasswd username, returning a human-readable reason it is
/// unusable, or null when it is fine.
///
/// Exposed separately so the UI can show an inline field error without having
/// to catch an exception.
String? validateHtpasswdUsername(String username) {
  if (username.isEmpty) return 'Username must not be empty.';
  if (username.contains(':')) {
    return 'Username must not contain ":" — that character separates the username from the hash, so a colon here '
        'silently corrupts the file.';
  }
  if (username.contains('\n') || username.contains('\r')) {
    return 'Username must be a single line.';
  }
  if (username.trim() != username) {
    return 'Username must not start or end with whitespace — the server will not match it.';
  }
  if (username.codeUnits.any((c) => c < 0x20 || c == 0x7f)) {
    return 'Username must not contain control characters.';
  }
  if (username.length > 255) {
    return 'Username must be at most 255 characters.';
  }
  return null;
}

// ----------------------------------------------------------------------
// HTTP Basic authorization header
// ----------------------------------------------------------------------

class BasicAuthHeaderInput {
  const BasicAuthHeaderInput({required this.username, required this.password});

  final String username;
  final String password;
}

class BasicAuthHeaderResult {
  const BasicAuthHeaderResult({required this.credentialsBase64});

  /// base64(`user:password`), UTF-8 encoded before base64 per RFC 7617.
  final String credentialsBase64;

  /// The header *value*: `Basic <base64>`.
  String get headerValue => 'Basic $credentialsBase64';

  /// The complete header line, ready to paste into a request.
  String get headerLine => 'Authorization: $headerValue';
}

/// Builds the `Authorization: Basic …` value for a username and password.
///
/// RFC 7617 leaves the credential charset up to the server but recommends
/// UTF-8, which is what browsers send and what this uses. A username
/// containing `:` is rejected: the server splits on the *first* colon, so
/// `a:b` + password `c` is indistinguishable from user `a` with password
/// `b:c`.
class BasicAuthHeaderBuilder implements IToolUseCase<BasicAuthHeaderInput, BasicAuthHeaderResult> {
  const BasicAuthHeaderBuilder();

  @override
  BasicAuthHeaderResult execute(BasicAuthHeaderInput input) {
    if (input.username.contains(':')) {
      throw ArgumentError(
        'Username must not contain ":" — HTTP Basic splits the credentials on the first colon, so the server '
        'would read the wrong username and password.',
      );
    }
    if (input.username.contains('\n') || input.password.contains('\n')) {
      throw ArgumentError('Credentials must be single-line.');
    }
    return BasicAuthHeaderResult(
      credentialsBase64: base64.encode(utf8.encode('${input.username}:${input.password}')),
    );
  }
}

// ----------------------------------------------------------------------
// APR1 (Apache MD5)
// ----------------------------------------------------------------------

/// The crypt(3) base64 alphabet — note it is NOT standard base64, and the
/// digits come before the letters.
const String kCryptBase64Alphabet = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const String _apr1Magic = r'$apr1$';

/// APR1 salts are at most 8 characters from [kCryptBase64Alphabet].
const int kApr1SaltLength = 8;

/// Generates a random APR1-compatible salt.
String generateApr1Salt([Random? random]) {
  final rng = random ?? Random.secure();
  return String.fromCharCodes(
    List.generate(kApr1SaltLength, (_) => kCryptBase64Alphabet.codeUnitAt(rng.nextInt(kCryptBase64Alphabet.length))),
  );
}

/// Computes an Apache APR1 (`$apr1$salt$hash`) password hash.
///
/// [salt] must consist of [kCryptBase64Alphabet] characters and is truncated
/// to [kApr1SaltLength]; a random one is drawn when it is null. A full
/// `$apr1$salt$hash` string may also be passed as [salt], so an existing hash
/// can be reproduced (which is how you verify a password against one).
String apr1Crypt(String password, {String? salt}) {
  final saltText = _normalizeApr1Salt(salt);
  final pw = utf8.encode(password);
  final sp = utf8.encode(saltText);
  final magic = utf8.encode(_apr1Magic);

  // MD5(password + salt + password) — the "alternate" digest whose bytes are
  // folded in below.
  final alternate = md5.convert(<int>[...pw, ...sp, ...pw]).bytes;

  final context = <int>[...pw, ...magic, ...sp];
  for (var remaining = pw.length; remaining > 0; remaining -= 16) {
    context.addAll(alternate.take(remaining > 16 ? 16 : remaining));
  }

  // The reference implementation zeroes the digest buffer at this point, so
  // the "bit is set" branch contributes a NUL byte. Getting this wrong is the
  // classic way an APR1 re-implementation ends up subtly incompatible.
  for (var i = pw.length; i != 0; i >>= 1) {
    context.add(i.isOdd ? 0 : pw[0]);
  }

  var digest = md5.convert(context).bytes;

  // 1000 deliberately awkward rounds. The odd/3/7 pattern is load-bearing:
  // it is what makes the hash unreproducible by a naive MD5 loop.
  for (var i = 0; i < 1000; i++) {
    final round = <int>[];
    round.addAll(i.isOdd ? pw : digest);
    if (i % 3 != 0) round.addAll(sp);
    if (i % 7 != 0) round.addAll(pw);
    round.addAll(i.isOdd ? digest : pw);
    digest = md5.convert(round).bytes;
  }

  final encoded = StringBuffer()
    ..write(_to64((digest[0] << 16) | (digest[6] << 8) | digest[12], 4))
    ..write(_to64((digest[1] << 16) | (digest[7] << 8) | digest[13], 4))
    ..write(_to64((digest[2] << 16) | (digest[8] << 8) | digest[14], 4))
    ..write(_to64((digest[3] << 16) | (digest[9] << 8) | digest[15], 4))
    ..write(_to64((digest[4] << 16) | (digest[10] << 8) | digest[5], 4))
    ..write(_to64(digest[11], 2));

  return '$_apr1Magic$saltText\$$encoded';
}

/// Verifies [password] against an existing `$apr1$…` hash by recomputing it
/// with the salt embedded in [hash].
bool apr1Verify(String password, String hash) {
  if (!hash.startsWith(_apr1Magic)) return false;
  try {
    return apr1Crypt(password, salt: hash) == hash;
  } on ArgumentError {
    return false;
  }
}

String _normalizeApr1Salt(String? salt) {
  if (salt == null) return generateApr1Salt();

  var text = salt;
  if (text.startsWith(_apr1Magic)) {
    text = text.substring(_apr1Magic.length);
    final end = text.indexOf(r'$');
    if (end >= 0) text = text.substring(0, end);
  }
  if (text.length > kApr1SaltLength) text = text.substring(0, kApr1SaltLength);
  if (text.isEmpty) {
    throw ArgumentError('APR1 salt must not be empty.');
  }
  for (final unit in text.codeUnits) {
    if (!kCryptBase64Alphabet.codeUnits.contains(unit)) {
      throw ArgumentError('APR1 salt may only contain the characters "$kCryptBase64Alphabet" (got "$salt").');
    }
  }
  return text;
}

/// crypt(3)-style base64: [count] characters, least-significant 6 bits first.
String _to64(int value, int count) {
  final buffer = StringBuffer();
  var remaining = value;
  for (var i = 0; i < count; i++) {
    buffer.writeCharCode(kCryptBase64Alphabet.codeUnitAt(remaining & 0x3f));
    remaining >>= 6;
  }
  return buffer.toString();
}
