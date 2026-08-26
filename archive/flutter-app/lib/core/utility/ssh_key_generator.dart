import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

import '../ports/i_tool_use_case.dart';

/// Key algorithms this tool can be asked to generate.
enum SshKeyType {
  ed25519('Ed25519'),
  rsa4096('RSA-4096');

  const SshKeyType(this.label);

  final String label;
}

class SshKeyGenInput {
  const SshKeyGenInput({required this.keyType, this.comment = ''});

  final SshKeyType keyType;

  /// Free-text comment appended to the public key line (e.g. `user@host`).
  /// May be empty. Any newlines are stripped since the public key must stay
  /// a single line and the comment is also embedded as a length-prefixed
  /// field inside the private key container.
  final String comment;
}

/// Which on-disk container the private key material was encoded into.
enum SshPrivateKeyFormat {
  /// Unencrypted OpenSSH `openssh-key-v1` PEM container — directly usable by
  /// dropping it into `~/.ssh/` (after `chmod 600` on POSIX systems).
  opensshV1,
}

class SshKeyGenResult {
  const SshKeyGenResult({
    required this.keyType,
    required this.publicKeyLine,
    required this.privateKeyPem,
    required this.privateKeyFormat,
  });

  final SshKeyType keyType;

  /// Standard OpenSSH wire-format public key line, e.g.
  /// `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... comment`.
  final String publicKeyLine;

  /// PEM-armored private key text in [privateKeyFormat].
  final String privateKeyPem;

  final SshPrivateKeyFormat privateKeyFormat;
}

/// Generates SSH key pairs and renders them in standard OpenSSH text formats.
///
/// This is a pure-Dart core component: no Flutter, no file I/O. It hands back
/// text the adapter layer can display and let the user copy into their own
/// `~/.ssh/` files.
///
/// ## Output formats
/// - Public key: hand-rolled standard OpenSSH wire format — the string
///   `"ssh-ed25519"` and the 32-byte public key, each length-prefixed with a
///   4-byte big-endian length, concatenated and base64-encoded. This is the
///   exact format `ssh-keygen`/`authorized_keys`/`~/.ssh/config` expect.
/// - Private key: hand-rolled unencrypted `openssh-key-v1` PEM container
///   (cipher "none", kdf "none"). The byte layout used here
///   (magic `"openssh-key-v1\0"`, cipher/kdf/kdfoptions strings, key count,
///   the public key blob, then a checkint-doubled, sequentially-padded
///   private section holding keytype/pubkey/`seed+pubkey`/comment) was
///   verified field-by-field against real `ssh-keygen -t ed25519` output
///   during development, not guessed.
///
/// ## Known limitation: RSA-4096 is not implemented
/// The `cryptography` package (v2.9.0, as vendored in this project's pub
/// cache) ships pure-Dart RSA algorithm classes (`DartRsaPss`,
/// `DartRsaSsaPkcs1v15`), but their `newKeyPair` — along with `sign` and
/// `verify` — unconditionally `throw UnimplementedError()`
/// (see `lib/src/dart/rsa_pss.dart` and `lib/src/dart/rsa_ssa_pkcs1v15.dart`
/// in the package source). The only implementation that actually generates
/// RSA keys is `BrowserCryptography`, which delegates to the Web Crypto API
/// and is only available inside a browser's secure (HTTPS) context — never
/// on a Flutter desktop/mobile build such as this one. There is therefore no
/// working pure-Dart path to RSA-4096 key generation available to this app
/// today. Rather than fake it or ship something subtly broken,
/// `execute` throws an [UnsupportedError] with a clear explanation whenever
/// [SshKeyType.rsa4096] is requested; callers (the UI) should catch this and
/// show it as a documented limitation, and point users at
/// `ssh-keygen -t rsa -b 4096` for RSA keys in the meantime.
class SshKeyGenerator implements IToolUseCase<SshKeyGenInput, Future<SshKeyGenResult>> {
  const SshKeyGenerator();

  @override
  Future<SshKeyGenResult> execute(SshKeyGenInput input) async {
    switch (input.keyType) {
      case SshKeyType.ed25519:
        return _generateEd25519(input.comment);
      case SshKeyType.rsa4096:
        throw UnsupportedError(
          'RSA-4096 key generation is not available in this build: the '
          '`cryptography` package\'s pure-Dart RSA implementation throws '
          'UnimplementedError on every non-browser platform (RSA keygen only '
          'works via Web Crypto in a browser\'s secure/HTTPS context). Use '
          '"ssh-keygen -t rsa -b 4096" on the command line instead, or pick '
          'Ed25519 here.',
        );
    }
  }

  Future<SshKeyGenResult> _generateEd25519(String rawComment) async {
    final comment = rawComment.replaceAll('\n', ' ').replaceAll('\r', ' ').trim();

    final algorithm = Ed25519();
    final keyPair = await algorithm.newKeyPair();
    final keyPairData = await keyPair.extract();
    final seed = await keyPair.extractPrivateKeyBytes(); // 32-byte seed
    final publicKey = keyPairData.publicKey.bytes; // 32-byte public key

    final publicBlob = _ed25519PublicKeyBlob(publicKey);
    final publicKeyLine = [
      'ssh-ed25519',
      base64.encode(publicBlob),
      if (comment.isNotEmpty) comment,
    ].join(' ');

    final privateKeyPem = _buildOpenSshPrivateKeyPem(
      publicKeyBlob: publicBlob,
      seed: seed,
      publicKey: publicKey,
      comment: comment,
    );

    return SshKeyGenResult(
      keyType: SshKeyType.ed25519,
      publicKeyLine: publicKeyLine,
      privateKeyPem: privateKeyPem,
      privateKeyFormat: SshPrivateKeyFormat.opensshV1,
    );
  }

  // ---- OpenSSH wire-format helpers ----

  /// Length-prefixes `data` with a 4-byte big-endian length, per the SSH wire
  /// format ("string" type in RFC 4251 section 5).
  static List<int> _packString(List<int> data) {
    final out = Uint8List(4 + data.length);
    final view = ByteData.sublistView(out);
    view.setUint32(0, data.length, Endian.big);
    out.setRange(4, 4 + data.length, data);
    return out;
  }

  static List<int> _packUint32(int value) {
    final out = Uint8List(4);
    ByteData.sublistView(out).setUint32(0, value, Endian.big);
    return out;
  }

  /// `ssh-ed25519` public key wire blob: string "ssh-ed25519" + string pub(32).
  static List<int> _ed25519PublicKeyBlob(List<int> publicKey) {
    return [
      ..._packString(utf8.encode('ssh-ed25519')),
      ..._packString(publicKey),
    ];
  }

  /// Builds the unencrypted `openssh-key-v1` private key PEM container.
  ///
  /// See the class doc for the source of this byte layout. `seed` is the
  /// 32-byte Ed25519 private seed; OpenSSH stores the "private key" field as
  /// 64 bytes = seed(32) + publicKey(32).
  String _buildOpenSshPrivateKeyPem({
    required List<int> publicKeyBlob,
    required List<int> seed,
    required List<int> publicKey,
    required String comment,
  }) {
    final checkInt = _randomCheckInt();
    final priv64 = [...seed, ...publicKey];

    final privSection = <int>[
      ..._packUint32(checkInt),
      ..._packUint32(checkInt),
      ..._packString(utf8.encode('ssh-ed25519')),
      ..._packString(publicKey),
      ..._packString(priv64),
      ..._packString(utf8.encode(comment)),
    ];

    // "none" cipher still requires the private section to be padded to a
    // multiple of the (trivial, block-size-1-equivalent-of-8) block size,
    // with sequential bytes 1,2,3,...
    var padByte = 1;
    while (privSection.length % 8 != 0) {
      privSection.add(padByte);
      padByte++;
    }

    final body = <int>[
      ...utf8.encode('openssh-key-v1'),
      0x00,
      ..._packString(utf8.encode('none')), // cipher name
      ..._packString(utf8.encode('none')), // kdf name
      ..._packString(const []), // kdf options (empty)
      ..._packUint32(1), // number of keys
      ..._packString(publicKeyBlob),
      ..._packString(privSection),
    ];

    final b64 = base64.encode(body);
    final wrapped = StringBuffer();
    for (var i = 0; i < b64.length; i += 70) {
      wrapped.writeln(b64.substring(i, math.min(i + 70, b64.length)));
    }

    return '-----BEGIN OPENSSH PRIVATE KEY-----\n$wrapped-----END OPENSSH PRIVATE KEY-----\n';
  }

  static int _randomCheckInt() {
    // Only used to fill the "none"-cipher check-int pair; does not need to be
    // cryptographically unpredictable (there is nothing it is protecting),
    // just present and equal in both slots as the format requires.
    final random = math.Random.secure();
    return random.nextInt(0x7fffffff);
  }
}
