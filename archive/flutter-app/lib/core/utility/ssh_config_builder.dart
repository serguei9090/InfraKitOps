/// OpenSSH configuration builder — pure Dart, no I/O, no Flutter.
///
/// Renders either a client `~/.ssh/config` or a server `sshd_config` from a
/// catalog-driven set of user-selected directives. Only directives the user
/// explicitly selected are emitted, so the result is a small reviewable diff
/// rather than a wall of restated defaults (same philosophy as the sysctl
/// config builder in this repo).
///
/// ## Sourcing of the recommended values
///
/// Everything in [kSshOptionCatalog] — legal value sets, defaults, and the
/// hardened-baseline picks — was checked against, in order of precedence:
///
///  1. `ssh_config(5)` and `sshd_config(5)` (man.openbsd.org, OpenSSH 10.x).
///     The man pages win any disagreement; they are the normative reference
///     for which values a directive actually accepts.
///  2. ssh-audit's published hardening guides (ssh-audit.com/hardening_guides)
///     for the algorithm lists.
///  3. CIS-benchmark-style guidance for the numeric limits (MaxAuthTries,
///     LoginGraceTime, ClientAlive*, MaxSessions).
///
/// Mozilla's OpenSSH guidelines (infosec.mozilla.org/guidelines/openssh) were
/// consulted and are the source of `LogLevel VERBOSE` and the logging sftp
/// subsystem, but its *algorithm lists are stale*: they still advertise
/// `ssh-rsa` (SHA-1) host key algorithms, which OpenSSH disabled by default in
/// 8.8, and omit the post-quantum key exchange entirely. Where Mozilla and the
/// man page disagree the man page is followed. See [kSshDeprecatedAlgorithms]
/// and the regression test that guards the preset against stale advice.
///
/// ## OpenSSH version caveats baked into the catalog
///
/// * `mlkem768x25519-sha256` — added 9.9, default in 10.0. Deliberately NOT in
///   the hardened baseline: naming an unknown algorithm in `KexAlgorithms`
///   makes sshd refuse to start, so it is offered as a comment instead.
/// * `sntrup761x25519-sha512@openssh.com` — 8.5+, default since 9.0. This is
///   the baseline's post-quantum pick because it is safe much further back.
/// * `RequiredRSASize` — 9.1+.
/// * `PubkeyAcceptedAlgorithms` / `HostbasedAcceptedAlgorithms` — renamed from
///   `PubkeyAcceptedKeyTypes` / `HostbasedKeyTypes` in 8.5.
/// * `KbdInteractiveAuthentication` — the preferred spelling since 8.7;
///   `ChallengeResponseAuthentication` is only a deprecated alias and is
///   intentionally absent from this catalog.
/// * `StrictHostKeyChecking accept-new` — 7.6+.
/// * `PerSourceMaxStartups` — 8.5+; `PerSourcePenalties` — 9.8+.
/// * There is no `Protocol` directive any more: SSH protocol 1 and the option
///   itself were removed in OpenSSH 7.6. Emitting `Protocol 2` is a syntax
///   error on any supported release, so it is not offered here.
library;

import '../ports/i_tool_use_case.dart';

/// Which config file is being generated.
enum SshConfigMode {
  /// A user's `~/.ssh/config` (`ssh_config(5)` syntax, `Host`/`Match` blocks).
  client('Client — ~/.ssh/config', 'config'),

  /// A daemon `sshd_config` (`sshd_config(5)` syntax, flat keyword list).
  server('Server — sshd_config', 'sshd_config');

  const SshConfigMode(this.label, this.suggestedFileName);

  final String label;

  /// Filename to suggest in a native "save as" dialog.
  final String suggestedFileName;
}

/// What kind of value a directive takes — this is what lets the UI render a
/// switch/dropdown instead of a free-text box for options that only accept a
/// fixed set of words.
enum SshValueKind {
  /// Strictly `yes` or `no`. Rendered as a switch.
  boolean,

  /// A fixed, closed set of keywords ([SshOption.allowedValues]). Rendered as
  /// a dropdown; any other value is rejected outright.
  choice,

  /// A whole number, optionally range-checked.
  integer,

  /// Genuinely free-form (paths, usernames, algorithm lists, patterns).
  freeText,
}

/// A single OpenSSH directive descriptor. The UI is built generically off a
/// list of these, so adding a directive is a one-entry data change here and
/// needs no new widget code.
class SshOption {
  const SshOption({
    required this.key,
    required this.group,
    required this.modes,
    required this.kind,
    required this.description,
    this.allowedValues = const <String>[],
    this.defaultValue,
    this.hardenedValue,
    this.hint,
    this.minValue,
    this.maxValue,
    this.versionNote,
    this.outputComment,
  });

  /// The directive name exactly as OpenSSH spells it, e.g. `PermitRootLogin`.
  final String key;

  /// UI/section grouping, e.g. `Authentication`. Also drives output ordering
  /// via [kSshClientGroupOrder] / [kSshServerGroupOrder].
  final String group;

  /// Which config file(s) this directive is valid in.
  final Set<SshConfigMode> modes;

  final SshValueKind kind;

  /// One-line explanation shown under the control.
  final String description;

  /// The complete legal value set for [SshValueKind.choice]. Empty otherwise.
  final List<String> allowedValues;

  /// OpenSSH's own default, for reference. Not emitted unless selected.
  final String? defaultValue;

  /// Value used by the "Hardened baseline" preset. Null means the directive is
  /// not part of the preset (either it is site-specific, like `AllowUsers`, or
  /// naming it could break older OpenSSH builds).
  final String? hardenedValue;

  /// Placeholder text for free-text/integer fields.
  final String? hint;

  final int? minValue;
  final int? maxValue;

  /// Minimum OpenSSH version / rename history, surfaced in the UI.
  final String? versionNote;

  /// Comment line emitted immediately above the directive in the generated
  /// file (without the leading `# `), when the directive is selected.
  final String? outputComment;

  bool appliesTo(SshConfigMode mode) => modes.contains(mode);

  /// Human label — currently the directive name itself, which is what users
  /// search for in the man page.
  String get label => key;
}

const Set<SshConfigMode> _client = {SshConfigMode.client};
const Set<SshConfigMode> _server = {SshConfigMode.server};
const Set<SshConfigMode> _both = {SshConfigMode.client, SshConfigMode.server};

const List<String> _logLevels = [
  'QUIET',
  'FATAL',
  'ERROR',
  'INFO',
  'VERBOSE',
  'DEBUG',
  'DEBUG1',
  'DEBUG2',
  'DEBUG3',
];

/// Hardened cipher list. Authenticated-encryption first, then CTR. No CBC —
/// CBC in SSH is vulnerable to the classic plaintext-recovery attack and is
/// not in OpenSSH's own defaults. Source: ssh-audit hardening guides; every
/// entry is also in the `ssh_config(5)` default list.
const String kHardenedCiphers =
    'chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,'
    'aes128-gcm@openssh.com,aes256-ctr,aes192-ctr,aes128-ctr';

/// Hardened MAC list: encrypt-then-MAC only, SHA-2 only. Excludes every
/// `hmac-sha1*` variant, `hmac-md5*`, and the 64-bit-tag `umac-64*`.
/// Source: ssh-audit hardening guides.
const String kHardenedMacs =
    'hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,'
    'umac-128-etm@openssh.com';

/// Hardened key exchange list.
///
/// Leads with the hybrid post-quantum `sntrup761x25519-sha512@openssh.com`
/// (8.5+, OpenSSH's own default since 9.0) rather than `mlkem768x25519-sha256`
/// (9.9+, default in 10.0): an unrecognised name here is a hard startup
/// failure, so the newer algorithm is suggested in a comment instead.
/// Excludes every SHA-1 group exchange (`diffie-hellman-group1-sha1`,
/// `-group14-sha1`, `-group-exchange-sha1`).
const String kHardenedKexAlgorithms =
    'sntrup761x25519-sha512@openssh.com,curve25519-sha256,'
    'curve25519-sha256@libssh.org,diffie-hellman-group18-sha512,'
    'diffie-hellman-group16-sha512,diffie-hellman-group-exchange-sha256';

/// Hardened host key / public key algorithm list: Ed25519 (incl. FIDO tokens)
/// and RSA with SHA-2 signatures. Notably absent is `ssh-rsa`, the SHA-1
/// signature algorithm OpenSSH disabled by default in 8.8 — this is where
/// Mozilla's published list is out of date. Source: ssh-audit hardening
/// guides, cross-checked against the `sshd_config(5)` defaults.
const String kHardenedHostKeyAlgorithms =
    'ssh-ed25519-cert-v01@openssh.com,sk-ssh-ed25519-cert-v01@openssh.com,'
    'rsa-sha2-512-cert-v01@openssh.com,rsa-sha2-256-cert-v01@openssh.com,'
    'ssh-ed25519,sk-ssh-ed25519@openssh.com,rsa-sha2-512,rsa-sha2-256';

const String _kexComment =
    'OpenSSH 9.9+/10.0 users may prepend mlkem768x25519-sha256 (PQ default in 10.0)';

/// Substrings that identify a broken, deprecated, or removed SSH algorithm.
///
/// Matched case-insensitively against each comma/whitespace-separated token of
/// an algorithm list. Used to warn when a user pastes legacy advice into a
/// crypto field, and asserted against in the hardened-preset regression test.
const List<String> kSshDeprecatedAlgorithms = [
  'ssh-rsa', // SHA-1 RSA signatures; disabled by default in OpenSSH 8.8.
  'ssh-dss', // DSA; disabled in 9.8, removed entirely in 10.0.
  '-cbc', // All CBC modes (aes*-cbc, 3des-cbc, rijndael-cbc@lysator.liu.se).
  'arcfour', // RC4.
  'blowfish',
  'cast128',
  '3des',
  'hmac-md5',
  'hmac-sha1',
  'hmac-ripemd160',
  'umac-64', // 64-bit authentication tag.
  'diffie-hellman-group1-sha1',
  'diffie-hellman-group14-sha1',
  'diffie-hellman-group-exchange-sha1',
  'rijndael',
  'none@openssh.com',
];

/// Section order for the client file (also the order directives are emitted).
const List<String> kSshClientGroupOrder = [
  'Connection',
  'Authentication',
  'Host key verification',
  'Cryptography',
  'Forwarding',
  'Multiplexing',
  'Diagnostics',
];

/// Section order for the server file.
const List<String> kSshServerGroupOrder = [
  'Network',
  'Authentication',
  'Access control',
  'Cryptography',
  'Forwarding & features',
  'Sessions & limits',
  'Logging',
];

/// The full directive catalog. Order within a group is the emission order.
const List<SshOption> kSshOptionCatalog = [
  // ------------------------------------------------------------------
  // CLIENT — Connection
  // ------------------------------------------------------------------
  SshOption(
    key: 'HostName',
    group: 'Connection',
    modes: _client,
    kind: SshValueKind.freeText,
    description: 'Real hostname or address to connect to. Defaults to the name given on the command line.',
    hint: 'web-01.internal.example.com',
  ),
  SshOption(
    key: 'User',
    group: 'Connection',
    modes: _client,
    kind: SshValueKind.freeText,
    description: 'Remote login user. Defaults to the local username.',
    hint: 'deploy',
  ),
  SshOption(
    key: 'Port',
    group: 'Connection',
    modes: _client,
    kind: SshValueKind.integer,
    description: 'Port on the remote host.',
    defaultValue: '22',
    hint: '22',
    minValue: 1,
    maxValue: 65535,
  ),
  SshOption(
    key: 'AddressFamily',
    group: 'Connection',
    modes: _client,
    kind: SshValueKind.choice,
    allowedValues: ['any', 'inet', 'inet6'],
    description: 'Address family to use. inet = IPv4 only, inet6 = IPv6 only.',
    defaultValue: 'any',
  ),
  SshOption(
    key: 'ConnectTimeout',
    group: 'Connection',
    modes: _client,
    kind: SshValueKind.integer,
    description: 'Seconds to wait for the TCP connection before giving up. Default is the system TCP timeout.',
    hint: '10',
    minValue: 1,
    maxValue: 86400,
  ),
  SshOption(
    key: 'ConnectionAttempts',
    group: 'Connection',
    modes: _client,
    kind: SshValueKind.integer,
    description: 'Number of connection attempts before exiting.',
    defaultValue: '1',
    hint: '1',
    minValue: 1,
    maxValue: 1000,
  ),
  SshOption(
    key: 'ProxyJump',
    group: 'Connection',
    modes: _client,
    kind: SshValueKind.freeText,
    description: 'Bastion to tunnel through: [user@]host[:port], comma-separated for a chain. OpenSSH 7.3+.',
    hint: 'jump@bastion.example.com:22',
    versionNote: 'OpenSSH 7.3+',
  ),
  SshOption(
    key: 'ProxyCommand',
    group: 'Connection',
    modes: _client,
    kind: SshValueKind.freeText,
    description: 'Shell command used instead of a direct socket. Prefer ProxyJump for plain bastion hops.',
    hint: 'ssh -W %h:%p bastion',
  ),
  SshOption(
    key: 'ServerAliveInterval',
    group: 'Connection',
    modes: _client,
    kind: SshValueKind.integer,
    description: 'Seconds of inactivity before sending an encrypted keepalive. 0 disables.',
    defaultValue: '0',
    hardenedValue: '60',
    hint: '60',
    minValue: 0,
    maxValue: 86400,
  ),
  SshOption(
    key: 'ServerAliveCountMax',
    group: 'Connection',
    modes: _client,
    kind: SshValueKind.integer,
    description: 'Unanswered keepalives tolerated before the client disconnects.',
    defaultValue: '3',
    hardenedValue: '3',
    hint: '3',
    minValue: 1,
    maxValue: 1000,
  ),
  SshOption(
    key: 'TCPKeepAlive',
    group: 'Connection',
    modes: _client,
    kind: SshValueKind.boolean,
    description: 'Send TCP-level keepalives. Spoofable, unlike ServerAliveInterval.',
    defaultValue: 'yes',
  ),
  SshOption(
    key: 'Compression',
    group: 'Connection',
    modes: _client,
    kind: SshValueKind.boolean,
    description: 'Compress the session. Rarely worth it on modern links; leave off.',
    defaultValue: 'no',
    hardenedValue: 'no',
  ),
  SshOption(
    key: 'RequestTTY',
    group: 'Connection',
    modes: _client,
    kind: SshValueKind.choice,
    allowedValues: ['no', 'yes', 'force', 'auto'],
    description: 'Whether to request a pseudo-terminal for the session.',
    defaultValue: 'auto',
  ),

  // ------------------------------------------------------------------
  // CLIENT — Authentication
  // ------------------------------------------------------------------
  SshOption(
    key: 'IdentityFile',
    group: 'Authentication',
    modes: _client,
    kind: SshValueKind.freeText,
    description: 'Private key to offer. Pair with IdentitiesOnly so the agent does not offer every other key first.',
    hint: '~/.ssh/id_ed25519',
  ),
  SshOption(
    key: 'IdentitiesOnly',
    group: 'Authentication',
    modes: _client,
    kind: SshValueKind.boolean,
    description: 'Offer only the keys named here, not everything in the agent. Avoids MaxAuthTries lockouts and key enumeration.',
    defaultValue: 'no',
    hardenedValue: 'yes',
  ),
  SshOption(
    key: 'CertificateFile',
    group: 'Authentication',
    modes: _client,
    kind: SshValueKind.freeText,
    description: 'User certificate to present alongside the matching private key.',
    hint: '~/.ssh/id_ed25519-cert.pub',
  ),
  SshOption(
    key: 'AddKeysToAgent',
    group: 'Authentication',
    modes: _client,
    kind: SshValueKind.choice,
    allowedValues: ['no', 'yes', 'ask', 'confirm'],
    description: 'Add a key to ssh-agent after it is first used. "confirm" prompts on every later use.',
    defaultValue: 'no',
    hardenedValue: 'yes',
    versionNote: 'OpenSSH 7.2+',
  ),
  SshOption(
    key: 'PubkeyAuthentication',
    group: 'Authentication',
    modes: _client,
    kind: SshValueKind.choice,
    allowedValues: ['yes', 'no', 'unbound', 'host-bound'],
    description: 'Try public key authentication. host-bound/unbound select the session-binding extension.',
    defaultValue: 'yes',
    hardenedValue: 'yes',
  ),
  SshOption(
    key: 'PasswordAuthentication',
    group: 'Authentication',
    modes: _both,
    kind: SshValueKind.boolean,
    description: 'Allow password authentication. Turn it off once keys work — it is the main brute-force surface.',
    defaultValue: 'yes',
    hardenedValue: 'no',
  ),
  SshOption(
    key: 'KbdInteractiveAuthentication',
    group: 'Authentication',
    modes: _both,
    kind: SshValueKind.boolean,
    description: 'Keyboard-interactive (PAM) authentication. Leaving this on can re-open password login through PAM.',
    defaultValue: 'yes',
    hardenedValue: 'no',
    versionNote: 'Preferred spelling since OpenSSH 8.7; ChallengeResponseAuthentication is a deprecated alias',
  ),
  SshOption(
    key: 'PreferredAuthentications',
    group: 'Authentication',
    modes: _client,
    kind: SshValueKind.freeText,
    description: 'Order in which authentication methods are tried.',
    defaultValue: 'gssapi-with-mic,hostbased,publickey,keyboard-interactive,password',
    hardenedValue: 'publickey',
    hint: 'publickey',
  ),
  SshOption(
    key: 'GSSAPIAuthentication',
    group: 'Authentication',
    modes: _both,
    kind: SshValueKind.boolean,
    description: 'Kerberos/GSSAPI authentication. Leave off unless you actually run Kerberos.',
    defaultValue: 'no',
    hardenedValue: 'no',
  ),

  // ------------------------------------------------------------------
  // CLIENT — Host key verification
  // ------------------------------------------------------------------
  SshOption(
    key: 'StrictHostKeyChecking',
    group: 'Host key verification',
    modes: _client,
    kind: SshValueKind.choice,
    allowedValues: ['yes', 'accept-new', 'ask', 'no', 'off'],
    description:
        'How unknown/changed host keys are handled. "accept-new" trusts first use but still refuses changed keys; '
        '"yes" is stricter (nothing is auto-added). Never use "no"/"off".',
    defaultValue: 'ask',
    hardenedValue: 'accept-new',
    versionNote: '"accept-new" requires OpenSSH 7.6+',
  ),
  SshOption(
    key: 'UserKnownHostsFile',
    group: 'Host key verification',
    modes: _client,
    kind: SshValueKind.freeText,
    description: 'Where verified host keys are stored. Whitespace-separated for multiple files.',
    defaultValue: '~/.ssh/known_hosts ~/.ssh/known_hosts2',
    hint: '~/.ssh/known_hosts',
  ),
  SshOption(
    key: 'HashKnownHosts',
    group: 'Host key verification',
    modes: _client,
    kind: SshValueKind.boolean,
    description: 'Hash hostnames in known_hosts so a leaked file does not enumerate your infrastructure.',
    defaultValue: 'no',
    hardenedValue: 'yes',
  ),
  SshOption(
    key: 'VerifyHostKeyDNS',
    group: 'Host key verification',
    modes: _client,
    kind: SshValueKind.choice,
    allowedValues: ['yes', 'no', 'ask'],
    description: 'Verify host keys against SSHFP DNS records. Only meaningful with DNSSEC.',
    defaultValue: 'no',
  ),
  SshOption(
    key: 'UpdateHostKeys',
    group: 'Host key verification',
    modes: _client,
    kind: SshValueKind.choice,
    allowedValues: ['yes', 'no', 'ask'],
    description: 'Accept additional/rotated host keys the server advertises after authentication.',
    defaultValue: 'yes',
    hardenedValue: 'yes',
  ),

  // ------------------------------------------------------------------
  // Cryptography (both files, identical spelling and identical picks)
  // ------------------------------------------------------------------
  SshOption(
    key: 'HostKeyAlgorithms',
    group: 'Cryptography',
    modes: _both,
    kind: SshValueKind.freeText,
    description: 'Host key signature algorithms to accept/offer. Excludes ssh-rsa (SHA-1) and DSA.',
    hardenedValue: kHardenedHostKeyAlgorithms,
    hint: kHardenedHostKeyAlgorithms,
  ),
  SshOption(
    key: 'KexAlgorithms',
    group: 'Cryptography',
    modes: _both,
    kind: SshValueKind.freeText,
    description: 'Key exchange algorithms. An unrecognised name here is a hard startup failure — check ssh -Q kex first.',
    hardenedValue: kHardenedKexAlgorithms,
    hint: kHardenedKexAlgorithms,
    outputComment: _kexComment,
  ),
  SshOption(
    key: 'Ciphers',
    group: 'Cryptography',
    modes: _both,
    kind: SshValueKind.freeText,
    description: 'Symmetric ciphers. AEAD first, CTR fallback, no CBC.',
    hardenedValue: kHardenedCiphers,
    hint: kHardenedCiphers,
  ),
  SshOption(
    key: 'MACs',
    group: 'Cryptography',
    modes: _both,
    kind: SshValueKind.freeText,
    description: 'Message authentication codes. Encrypt-then-MAC (-etm) SHA-2 only.',
    hardenedValue: kHardenedMacs,
    hint: kHardenedMacs,
  ),
  SshOption(
    key: 'PubkeyAcceptedAlgorithms',
    group: 'Cryptography',
    modes: _both,
    kind: SshValueKind.freeText,
    description: 'Public key signature algorithms accepted for user authentication.',
    hardenedValue: kHardenedHostKeyAlgorithms,
    hint: kHardenedHostKeyAlgorithms,
    versionNote: 'OpenSSH 8.5+ (was PubkeyAcceptedKeyTypes)',
  ),
  SshOption(
    key: 'CASignatureAlgorithms',
    group: 'Cryptography',
    modes: _both,
    kind: SshValueKind.freeText,
    description: 'Signature algorithms accepted on SSH certificates.',
    hardenedValue: 'sk-ssh-ed25519@openssh.com,ssh-ed25519,rsa-sha2-512,rsa-sha2-256',
    hint: 'ssh-ed25519,rsa-sha2-512,rsa-sha2-256',
  ),
  SshOption(
    key: 'RequiredRSASize',
    group: 'Cryptography',
    modes: _both,
    kind: SshValueKind.integer,
    description: 'Minimum accepted RSA key length in bits. Can only be raised above the 1024 default.',
    defaultValue: '1024',
    hardenedValue: '3072',
    hint: '3072',
    minValue: 1024,
    maxValue: 16384,
    versionNote: 'OpenSSH 9.1+',
  ),

  // ------------------------------------------------------------------
  // CLIENT — Forwarding
  // ------------------------------------------------------------------
  SshOption(
    key: 'ForwardAgent',
    group: 'Forwarding',
    modes: _client,
    kind: SshValueKind.boolean,
    description: 'Expose your agent socket on the remote host. Anyone with root there can use your keys — prefer ProxyJump.',
    defaultValue: 'no',
    hardenedValue: 'no',
  ),
  SshOption(
    key: 'ForwardX11',
    group: 'Forwarding',
    modes: _client,
    kind: SshValueKind.boolean,
    description: 'Forward X11 connections. Grants the remote host input/screen access to your display.',
    defaultValue: 'no',
    hardenedValue: 'no',
  ),
  SshOption(
    key: 'ForwardX11Trusted',
    group: 'Forwarding',
    modes: _client,
    kind: SshValueKind.boolean,
    description: 'Give forwarded X11 clients full, unrestricted access to your X server.',
    defaultValue: 'no',
    hardenedValue: 'no',
  ),
  SshOption(
    key: 'PermitLocalCommand',
    group: 'Forwarding',
    modes: _client,
    kind: SshValueKind.boolean,
    description: 'Allow LocalCommand / the ~C escape to run local commands.',
    defaultValue: 'no',
    hardenedValue: 'no',
  ),
  SshOption(
    key: 'ExitOnForwardFailure',
    group: 'Forwarding',
    modes: _client,
    kind: SshValueKind.boolean,
    description: 'Abort the connection if a requested forward cannot be set up, instead of continuing silently.',
    defaultValue: 'no',
  ),

  // ------------------------------------------------------------------
  // CLIENT — Multiplexing
  // ------------------------------------------------------------------
  SshOption(
    key: 'ControlMaster',
    group: 'Multiplexing',
    modes: _client,
    kind: SshValueKind.choice,
    allowedValues: ['no', 'yes', 'ask', 'auto', 'autoask'],
    description: 'Share one TCP connection across sessions. "auto" reuses an existing master or creates one.',
    defaultValue: 'no',
  ),
  SshOption(
    key: 'ControlPath',
    group: 'Multiplexing',
    modes: _client,
    kind: SshValueKind.freeText,
    description: 'Control socket path. Must be unique per user/host/port — use %C or %r@%h:%p.',
    hint: '~/.ssh/cm-%C',
  ),
  SshOption(
    key: 'ControlPersist',
    group: 'Multiplexing',
    modes: _client,
    kind: SshValueKind.freeText,
    description: 'How long an idle master stays open: no, yes (forever), 0, or a time such as 10m.',
    defaultValue: 'no',
    hint: '10m',
  ),

  // ------------------------------------------------------------------
  // CLIENT — Diagnostics
  // ------------------------------------------------------------------
  SshOption(
    key: 'LogLevel',
    group: 'Diagnostics',
    modes: _client,
    kind: SshValueKind.choice,
    allowedValues: _logLevels,
    description: 'Client verbosity. DEBUG levels can print sensitive details — do not leave them on.',
    defaultValue: 'INFO',
  ),

  // ------------------------------------------------------------------
  // SERVER — Network
  // ------------------------------------------------------------------
  SshOption(
    key: 'Port',
    group: 'Network',
    modes: _server,
    kind: SshValueKind.integer,
    description: 'Port sshd listens on. Moving off 22 only reduces log noise; it is not a security control.',
    defaultValue: '22',
    hint: '22',
    minValue: 1,
    maxValue: 65535,
  ),
  SshOption(
    key: 'ListenAddress',
    group: 'Network',
    modes: _server,
    kind: SshValueKind.freeText,
    description: 'Bind to a specific address (or address:port). Default is every local address.',
    hint: '10.0.0.5',
  ),
  SshOption(
    key: 'AddressFamily',
    group: 'Network',
    modes: _server,
    kind: SshValueKind.choice,
    allowedValues: ['any', 'inet', 'inet6'],
    description: 'Address family sshd uses.',
    defaultValue: 'any',
  ),
  SshOption(
    key: 'HostKey',
    group: 'Network',
    modes: _server,
    kind: SshValueKind.freeText,
    description: 'Host private key file. Repeat the directive for each key type you serve.',
    hint: '/etc/ssh/ssh_host_ed25519_key',
  ),

  // ------------------------------------------------------------------
  // SERVER — Authentication
  // ------------------------------------------------------------------
  SshOption(
    key: 'PermitRootLogin',
    group: 'Authentication',
    modes: _server,
    kind: SshValueKind.choice,
    allowedValues: ['yes', 'prohibit-password', 'forced-commands-only', 'no'],
    description:
        'Whether root may log in directly. "no" is the auditable choice (people log in as themselves, then sudo). '
        '"without-password" is a deprecated alias for prohibit-password.',
    defaultValue: 'prohibit-password',
    hardenedValue: 'no',
  ),
  SshOption(
    key: 'PubkeyAuthentication',
    group: 'Authentication',
    modes: _server,
    kind: SshValueKind.boolean,
    description: 'Accept public key authentication. Must stay on if you disable passwords.',
    defaultValue: 'yes',
    hardenedValue: 'yes',
  ),
  SshOption(
    key: 'PermitEmptyPasswords',
    group: 'Authentication',
    modes: _server,
    kind: SshValueKind.boolean,
    description: 'Allow accounts with empty passwords to log in. Always no.',
    defaultValue: 'no',
    hardenedValue: 'no',
  ),
  SshOption(
    key: 'HostbasedAuthentication',
    group: 'Authentication',
    modes: _server,
    kind: SshValueKind.boolean,
    description: 'Trust the client host rather than the user. Almost never wanted.',
    defaultValue: 'no',
    hardenedValue: 'no',
  ),
  SshOption(
    key: 'IgnoreRhosts',
    group: 'Authentication',
    modes: _server,
    kind: SshValueKind.choice,
    allowedValues: ['yes', 'shosts-only', 'no'],
    description: 'Ignore ~/.rhosts and ~/.shosts during host-based authentication.',
    defaultValue: 'yes',
    hardenedValue: 'yes',
  ),
  SshOption(
    key: 'AuthenticationMethods',
    group: 'Authentication',
    modes: _server,
    kind: SshValueKind.freeText,
    description:
        'Methods that must all succeed, comma-separated; space-separated alternatives. '
        '"publickey,keyboard-interactive" is 2FA; "publickey" alone is keys-only.',
    defaultValue: 'any',
    hardenedValue: 'publickey',
    hint: 'publickey',
  ),
  SshOption(
    key: 'AuthorizedKeysFile',
    group: 'Authentication',
    modes: _server,
    kind: SshValueKind.freeText,
    description: 'Where user public keys are read from. Point this outside \$HOME to stop users adding their own keys.',
    defaultValue: '.ssh/authorized_keys .ssh/authorized_keys2',
    hint: '/etc/ssh/authorized_keys.d/%u',
  ),
  SshOption(
    key: 'TrustedUserCAKeys',
    group: 'Authentication',
    modes: _server,
    kind: SshValueKind.freeText,
    description: 'CA public keys trusted to sign user certificates.',
    hint: '/etc/ssh/user_ca.pub',
  ),
  SshOption(
    key: 'UsePAM',
    group: 'Authentication',
    modes: _server,
    kind: SshValueKind.boolean,
    description: 'Run PAM account and session modules. Most distributions require this for correct session setup.',
    defaultValue: 'no',
    hardenedValue: 'yes',
  ),
  SshOption(
    key: 'StrictModes',
    group: 'Authentication',
    modes: _server,
    kind: SshValueKind.boolean,
    description: 'Refuse to use key files whose ownership/permissions are too loose.',
    defaultValue: 'yes',
    hardenedValue: 'yes',
  ),
  SshOption(
    key: 'MaxAuthTries',
    group: 'Authentication',
    modes: _server,
    kind: SshValueKind.integer,
    description: 'Failed attempts allowed per connection. CIS asks for 4 or less; 3 is tighter. Agents with many keys may need IdentitiesOnly on the client.',
    defaultValue: '6',
    hardenedValue: '3',
    hint: '3',
    minValue: 1,
    maxValue: 100,
  ),
  SshOption(
    key: 'LoginGraceTime',
    group: 'Authentication',
    modes: _server,
    kind: SshValueKind.integer,
    description: 'Seconds to complete authentication before disconnect. CIS asks for 60 or less.',
    defaultValue: '120',
    hardenedValue: '30',
    hint: '30',
    minValue: 0,
    maxValue: 3600,
  ),

  // ------------------------------------------------------------------
  // SERVER — Access control
  // ------------------------------------------------------------------
  SshOption(
    key: 'AllowUsers',
    group: 'Access control',
    modes: _server,
    kind: SshValueKind.freeText,
    description: 'Space-separated allowlist of user patterns (USER or USER@HOST). If set, everyone else is refused.',
    hint: 'deploy ops admin@10.0.0.*',
  ),
  SshOption(
    key: 'AllowGroups',
    group: 'Access control',
    modes: _server,
    kind: SshValueKind.freeText,
    description: 'Space-separated allowlist of group patterns. Usually easier to maintain than AllowUsers.',
    hint: 'sshusers',
  ),
  SshOption(
    key: 'DenyUsers',
    group: 'Access control',
    modes: _server,
    kind: SshValueKind.freeText,
    description: 'Space-separated denylist of user patterns. Evaluated before the Allow* lists.',
    hint: 'guest',
  ),
  SshOption(
    key: 'DenyGroups',
    group: 'Access control',
    modes: _server,
    kind: SshValueKind.freeText,
    description: 'Space-separated denylist of group patterns.',
    hint: 'nologin',
  ),

  // ------------------------------------------------------------------
  // SERVER — Forwarding & features
  // ------------------------------------------------------------------
  SshOption(
    key: 'X11Forwarding',
    group: 'Forwarding & features',
    modes: _server,
    kind: SshValueKind.boolean,
    description: 'Allow X11 forwarding. Off unless the box actually serves GUI apps.',
    defaultValue: 'no',
    hardenedValue: 'no',
  ),
  SshOption(
    key: 'AllowAgentForwarding',
    group: 'Forwarding & features',
    modes: _server,
    kind: SshValueKind.boolean,
    description: 'Allow clients to forward their agent onto this host. Disable on anything shared or internet-facing.',
    defaultValue: 'yes',
    hardenedValue: 'no',
  ),
  SshOption(
    key: 'AllowTcpForwarding',
    group: 'Forwarding & features',
    modes: _server,
    kind: SshValueKind.choice,
    allowedValues: ['yes', 'all', 'no', 'local', 'remote'],
    description: 'Port forwarding policy. "no" stops users pivoting through this host; set "local" if only -L is needed.',
    defaultValue: 'yes',
    hardenedValue: 'no',
  ),
  SshOption(
    key: 'GatewayPorts',
    group: 'Forwarding & features',
    modes: _server,
    kind: SshValueKind.choice,
    allowedValues: ['no', 'yes', 'clientspecified'],
    description: 'Let remote forwards bind non-loopback addresses, exposing them to the network.',
    defaultValue: 'no',
    hardenedValue: 'no',
  ),
  SshOption(
    key: 'PermitTunnel',
    group: 'Forwarding & features',
    modes: _server,
    kind: SshValueKind.choice,
    allowedValues: ['no', 'yes', 'point-to-point', 'ethernet'],
    description: 'Allow tun(4) device forwarding (a full VPN over SSH).',
    defaultValue: 'no',
    hardenedValue: 'no',
  ),
  SshOption(
    key: 'PermitUserEnvironment',
    group: 'Forwarding & features',
    modes: _server,
    kind: SshValueKind.boolean,
    description: 'Honour ~/.ssh/environment and environment= in authorized_keys. Can be used to bypass restrictions.',
    defaultValue: 'no',
    hardenedValue: 'no',
  ),
  SshOption(
    key: 'Compression',
    group: 'Forwarding & features',
    modes: _server,
    kind: SshValueKind.choice,
    allowedValues: ['yes', 'delayed', 'no'],
    description: 'Server-side compression. "delayed" is a legacy alias for post-authentication compression.',
    defaultValue: 'yes',
    hardenedValue: 'no',
  ),
  SshOption(
    key: 'PrintMotd',
    group: 'Forwarding & features',
    modes: _server,
    kind: SshValueKind.boolean,
    description: 'Print /etc/motd on login. Usually already handled by PAM, so distributions set this to no.',
    defaultValue: 'yes',
  ),
  SshOption(
    key: 'Banner',
    group: 'Forwarding & features',
    modes: _server,
    kind: SshValueKind.freeText,
    description: 'File shown before authentication. Use a legal notice, never version or host details.',
    hint: '/etc/issue.net',
  ),
  SshOption(
    key: 'Subsystem',
    group: 'Forwarding & features',
    modes: _server,
    kind: SshValueKind.freeText,
    description:
        'Subsystem definition. internal-sftp with -f/-l makes SFTP file access auditable; '
        'omit the whole directive to disable SFTP.',
    hardenedValue: 'sftp internal-sftp -f AUTHPRIV -l INFO',
    hint: 'sftp internal-sftp -f AUTHPRIV -l INFO',
  ),

  // ------------------------------------------------------------------
  // SERVER — Sessions & limits
  // ------------------------------------------------------------------
  SshOption(
    key: 'MaxSessions',
    group: 'Sessions & limits',
    modes: _server,
    kind: SshValueKind.integer,
    description: 'Multiplexed sessions permitted per network connection.',
    defaultValue: '10',
    hardenedValue: '4',
    hint: '4',
    minValue: 1,
    maxValue: 1000,
  ),
  SshOption(
    key: 'MaxStartups',
    group: 'Sessions & limits',
    modes: _server,
    kind: SshValueKind.freeText,
    description: 'Unauthenticated connections allowed, as start:rate:full random-early-drop.',
    defaultValue: '10:30:100',
    hardenedValue: '10:30:60',
    hint: '10:30:60',
  ),
  SshOption(
    key: 'PerSourceMaxStartups',
    group: 'Sessions & limits',
    modes: _server,
    kind: SshValueKind.freeText,
    description: 'Unauthenticated connections allowed per source address.',
    defaultValue: 'none',
    hint: '10',
    versionNote: 'OpenSSH 8.5+',
  ),
  SshOption(
    key: 'PerSourcePenalties',
    group: 'Sessions & limits',
    modes: _server,
    kind: SshValueKind.freeText,
    description: 'Temporarily block source addresses that keep failing. Not in the preset: unknown on OpenSSH < 9.8, which refuses to start.',
    hint: 'yes',
    versionNote: 'OpenSSH 9.8+',
  ),
  SshOption(
    key: 'ClientAliveInterval',
    group: 'Sessions & limits',
    modes: _server,
    kind: SshValueKind.integer,
    description: 'Seconds of inactivity before sshd probes the client. With ClientAliveCountMax this is the idle timeout.',
    defaultValue: '0',
    hardenedValue: '300',
    hint: '300',
    minValue: 0,
    maxValue: 86400,
  ),
  SshOption(
    key: 'ClientAliveCountMax',
    group: 'Sessions & limits',
    modes: _server,
    kind: SshValueKind.integer,
    description: 'Unanswered probes before sshd drops the session.',
    defaultValue: '3',
    hardenedValue: '2',
    hint: '2',
    minValue: 1,
    maxValue: 1000,
  ),
  SshOption(
    key: 'TCPKeepAlive',
    group: 'Sessions & limits',
    modes: _server,
    kind: SshValueKind.boolean,
    description: 'Send TCP-level keepalives. ClientAliveInterval is the one that actually reaps idle sessions.',
    defaultValue: 'yes',
  ),

  // ------------------------------------------------------------------
  // SERVER — Logging
  // ------------------------------------------------------------------
  SshOption(
    key: 'LogLevel',
    group: 'Logging',
    modes: _server,
    kind: SshValueKind.choice,
    allowedValues: _logLevels,
    description: 'VERBOSE additionally logs the key fingerprint used for each login, which is what makes key use auditable.',
    defaultValue: 'INFO',
    hardenedValue: 'VERBOSE',
  ),
  SshOption(
    key: 'SyslogFacility',
    group: 'Logging',
    modes: _server,
    kind: SshValueKind.choice,
    allowedValues: [
      'AUTH',
      'AUTHPRIV',
      'DAEMON',
      'USER',
      'LOCAL0',
      'LOCAL1',
      'LOCAL2',
      'LOCAL3',
      'LOCAL4',
      'LOCAL5',
      'LOCAL6',
      'LOCAL7',
    ],
    description: 'Syslog facility used for sshd messages.',
    defaultValue: 'AUTH',
  ),
];

/// Group section order for [mode].
List<String> sshGroupsForMode(SshConfigMode mode) =>
    mode == SshConfigMode.client ? kSshClientGroupOrder : kSshServerGroupOrder;

/// All catalog options valid in [mode], in emission order (group order first,
/// then catalog order within the group).
List<SshOption> sshOptionsForMode(SshConfigMode mode) {
  final groups = sshGroupsForMode(mode);
  final result = <SshOption>[];
  for (final group in groups) {
    for (final option in kSshOptionCatalog) {
      if (option.appliesTo(mode) && option.group == group) result.add(option);
    }
  }
  return List.unmodifiable(result);
}

/// Catalog options in [mode] belonging to [group], in emission order.
List<SshOption> sshOptionsInGroup(SshConfigMode mode, String group) =>
    List.unmodifiable(kSshOptionCatalog.where((o) => o.appliesTo(mode) && o.group == group));

/// The descriptor for [key] in [mode], or null if the directive is not in the
/// catalog for that file.
SshOption? sshOptionFor(SshConfigMode mode, String key) {
  for (final option in kSshOptionCatalog) {
    if (option.appliesTo(mode) && option.key == key) return option;
  }
  return null;
}

/// The "Hardened baseline" preset for [mode]: every catalog option that has a
/// [SshOption.hardenedValue], mapped to that value.
///
/// For [SshConfigMode.client] these belong in the `Host *` defaults block.
/// Site-specific directives (AllowUsers, HostName, Port, …) are deliberately
/// excluded — the preset is a starting point, not a finished config, and the
/// UI says so.
Map<String, String> sshHardenedBaseline(SshConfigMode mode) {
  return {
    for (final option in sshOptionsForMode(mode))
      if (option.hardenedValue != null) option.key: option.hardenedValue!,
  };
}

/// Returns the deprecated/broken algorithm names found in an algorithm list.
///
/// Tokenises on commas and whitespace and matches each token against
/// [kSshDeprecatedAlgorithms] case-insensitively. Leading `+`/`-`/`^` list
/// modifiers are stripped first. Empty when the list is clean.
List<String> sshDeprecatedAlgorithmsIn(String value) {
  final found = <String>[];
  for (final rawToken in value.split(RegExp(r'[,\s]+'))) {
    final token = rawToken.replaceFirst(RegExp(r'^[+\-^]'), '').trim().toLowerCase();
    if (token.isEmpty) continue;
    for (final bad in kSshDeprecatedAlgorithms) {
      if (token.contains(bad) && !found.contains(rawToken)) {
        found.add(rawToken);
        break;
      }
    }
  }
  return found;
}

/// One `Host` block in a client config.
class SshHostBlock {
  const SshHostBlock({required this.pattern, this.values = const {}, this.comment});

  /// The `Host` pattern list, e.g. `prod-web-1` or `web-* db-*`. Multiple
  /// space-separated patterns are legal; the value must be non-empty and
  /// single-line.
  final String pattern;

  /// Selected directives for this block, keyed by exact directive name.
  final Map<String, String> values;

  /// Optional comment rendered above the `Host` line.
  final String? comment;
}

class SshConfigBuilderInput {
  const SshConfigBuilderInput({
    this.mode = SshConfigMode.client,
    this.hostBlocks = const [],
    this.globalDefaults = const {},
    this.serverValues = const {},
    this.includeHeader = true,
  });

  final SshConfigMode mode;

  /// Client mode: per-host blocks, emitted in list order.
  final List<SshHostBlock> hostBlocks;

  /// Client mode: the `Host *` defaults block.
  ///
  /// Emitted LAST. `ssh_config(5)` is first-match-wins per parameter, so a
  /// `Host *` block placed at the top would shadow every specific block below
  /// it — a very common way to write a config that silently does the wrong
  /// thing.
  final Map<String, String> globalDefaults;

  /// Server mode: the flat directive set.
  final Map<String, String> serverValues;

  /// Whether to emit the explanatory/permissions header comment.
  final bool includeHeader;
}

class SshConfigBuilderResult {
  const SshConfigBuilderResult({
    required this.configText,
    required this.suggestedFileName,
    this.warnings = const [],
  });

  /// The rendered config file text.
  final String configText;

  /// `config` or `sshd_config`, for the save dialog.
  final String suggestedFileName;

  /// Non-fatal advisories, e.g. a deprecated algorithm in a crypto list.
  /// Never blocks generation — legacy interop is sometimes genuinely needed.
  final List<String> warnings;
}

/// Renders a client `~/.ssh/config` or server `sshd_config` from selected
/// catalog directives.
///
/// Pure text generation, no filesystem access: writing the result is the
/// adapter layer's job.
///
/// Every value is validated against its [SshOption] descriptor before it is
/// emitted, so a [SshValueKind.choice] directive can never reach the output
/// with a value outside [SshOption.allowedValues], and a
/// [SshValueKind.boolean] directive can only ever emit `yes` or `no`.
/// Violations throw [ArgumentError].
class SshConfigBuilder implements IToolUseCase<SshConfigBuilderInput, SshConfigBuilderResult> {
  const SshConfigBuilder();

  static const String _indent = '    ';

  @override
  SshConfigBuilderResult execute(SshConfigBuilderInput input) {
    final warnings = <String>[];
    final text = switch (input.mode) {
      SshConfigMode.client => _renderClient(input, warnings),
      SshConfigMode.server => _renderServer(input, warnings),
    };

    return SshConfigBuilderResult(
      configText: text,
      suggestedFileName: input.mode.suggestedFileName,
      warnings: List.unmodifiable(warnings),
    );
  }

  // ------------------------------------------------------------------
  // Client
  // ------------------------------------------------------------------

  String _renderClient(SshConfigBuilderInput input, List<String> warnings) {
    if (input.hostBlocks.isEmpty && input.globalDefaults.isEmpty) {
      throw ArgumentError('Add at least one Host block, or some Host * defaults, to generate a client config.');
    }

    final sections = <String>[];

    for (final block in input.hostBlocks) {
      final pattern = block.pattern.trim();
      if (pattern.isEmpty) {
        throw ArgumentError('Every Host block needs a pattern (for example "web-01" or "web-*").');
      }
      if (pattern.contains('\n')) {
        throw ArgumentError('A Host pattern must be a single line (got "$pattern").');
      }
      if (pattern == '*') {
        throw ArgumentError('Use the "Global defaults (Host *)" section for the Host * block, not a named host.');
      }

      final lines = _renderDirectives(
        SshConfigMode.client,
        block.values,
        warnings,
        indent: _indent,
        context: 'Host $pattern',
      );

      final buffer = StringBuffer();
      if (block.comment != null && block.comment!.trim().isNotEmpty) {
        for (final line in block.comment!.trim().split('\n')) {
          buffer.writeln('# ${line.trim()}');
        }
      }
      buffer.write('Host $pattern');
      if (lines.isEmpty) {
        warnings.add('Host block "$pattern" has no options selected, so it does nothing.');
      } else {
        buffer.write('\n${lines.join('\n')}');
      }
      sections.add(buffer.toString());
    }

    if (input.globalDefaults.isNotEmpty) {
      final lines = _renderDirectives(
        SshConfigMode.client,
        input.globalDefaults,
        warnings,
        indent: _indent,
        context: 'Host *',
      );
      if (lines.isNotEmpty) {
        sections.add(
          '# Defaults for every host. ssh_config is first-match-wins, so this\n'
          '# block MUST stay at the bottom or it will shadow the blocks above.\n'
          'Host *\n${lines.join('\n')}',
        );
      }
    }

    final buffer = StringBuffer();
    if (input.includeHeader) {
      buffer.writeln('# ~/.ssh/config — generated by InfraKit Studio');
      buffer.writeln('#');
      buffer.writeln('# Install:');
      buffer.writeln('#   mkdir -p ~/.ssh && chmod 700 ~/.ssh');
      buffer.writeln('#   install -m 600 config ~/.ssh/config      # must be 600; ssh refuses a world/group-writable config');
      buffer.writeln('#');
      buffer.writeln('# Check what ssh actually resolves for a host:  ssh -G <host>');
      buffer.writeln('# Verify every directive against your build:    ssh -V ; ssh -Q kex ; ssh -Q cipher ; ssh -Q mac');
      buffer.writeln('#');
    }
    buffer.write(sections.join('\n\n'));
    buffer.write('\n');
    return buffer.toString();
  }

  // ------------------------------------------------------------------
  // Server
  // ------------------------------------------------------------------

  String _renderServer(SshConfigBuilderInput input, List<String> warnings) {
    if (input.serverValues.isEmpty) {
      throw ArgumentError('Select at least one sshd_config directive to generate a server config.');
    }

    final lines = _renderDirectives(
      SshConfigMode.server,
      input.serverValues,
      warnings,
      indent: '',
      context: 'sshd_config',
    );

    if (input.serverValues.containsKey('PasswordAuthentication') &&
        input.serverValues['PasswordAuthentication']!.trim().toLowerCase() == 'no' &&
        !input.serverValues.containsKey('KbdInteractiveAuthentication')) {
      warnings.add(
        'PasswordAuthentication no without KbdInteractiveAuthentication no: on PAM systems '
        'password login can still succeed through keyboard-interactive. Set both.',
      );
    }
    if (input.serverValues['PermitRootLogin']?.trim().toLowerCase() == 'yes') {
      warnings.add('PermitRootLogin yes allows direct root login — prefer "no" or "prohibit-password".');
    }

    final buffer = StringBuffer();
    if (input.includeHeader) {
      buffer.writeln('# sshd_config — generated by InfraKit Studio');
      buffer.writeln('#');
      buffer.writeln('# Install:');
      buffer.writeln('#   install -o root -g root -m 600 sshd_config /etc/ssh/sshd_config');
      buffer.writeln('#   sshd -t                 # validate BEFORE restarting — a typo here locks you out');
      buffer.writeln('#   systemctl reload ssh    # or: systemctl reload sshd');
      buffer.writeln('#');
      buffer.writeln('# Keep your current SSH session open and confirm a NEW session works');
      buffer.writeln('# before closing it. Check the effective config with:  sshd -T');
      buffer.writeln('#');
      buffer.writeln('# Many distributions end sshd_config with an Include of /etc/ssh/sshd_config.d/*.conf,');
      buffer.writeln('# and the FIRST value obtained wins — a drop-in can silently override the lines below.');
      buffer.writeln('#');
    }
    buffer.write(lines.join('\n'));
    buffer.write('\n');
    return buffer.toString();
  }

  // ------------------------------------------------------------------
  // Shared directive rendering + validation
  // ------------------------------------------------------------------

  List<String> _renderDirectives(
    SshConfigMode mode,
    Map<String, String> values,
    List<String> warnings, {
    required String indent,
    required String context,
  }) {
    final ordered = sshOptionsForMode(mode);
    final known = {for (final o in ordered) o.key};

    for (final key in values.keys) {
      if (!known.contains(key)) {
        throw ArgumentError('"$key" is not a known ${mode == SshConfigMode.client ? 'ssh_config' : 'sshd_config'} directive in this catalog ($context).');
      }
    }

    final lines = <String>[];
    for (final option in ordered) {
      final raw = values[option.key];
      if (raw == null) continue; // Not selected -> never emitted.

      final value = _validate(option, raw, context);

      if (_isAlgorithmList(option)) {
        final bad = sshDeprecatedAlgorithmsIn(value);
        if (bad.isNotEmpty) {
          warnings.add('$context: ${option.key} contains deprecated or broken algorithms: ${bad.join(', ')}.');
        }
      }

      if (option.outputComment != null) {
        lines.add('$indent# ${option.outputComment}');
      }
      lines.add('$indent${option.key} $value');
    }
    return lines;
  }

  bool _isAlgorithmList(SshOption option) =>
      option.group == 'Cryptography' && option.kind == SshValueKind.freeText;

  /// Canonicalises and range/enum-checks one value. Throws [ArgumentError] on
  /// anything the directive cannot legally take.
  String _validate(SshOption option, String raw, String context) {
    final value = raw.trim();
    if (value.isEmpty) {
      throw ArgumentError('$context: ${option.key} needs a value.');
    }
    if (value.contains('\n')) {
      throw ArgumentError('$context: ${option.key} must be a single line.');
    }

    switch (option.kind) {
      case SshValueKind.boolean:
        final lower = value.toLowerCase();
        if (lower != 'yes' && lower != 'no') {
          throw ArgumentError('$context: ${option.key} must be "yes" or "no" (got "$value").');
        }
        return lower;

      case SshValueKind.choice:
        for (final allowed in option.allowedValues) {
          if (allowed.toLowerCase() == value.toLowerCase()) return allowed;
        }
        throw ArgumentError(
          '$context: ${option.key} must be one of ${option.allowedValues.join(', ')} (got "$value").',
        );

      case SshValueKind.integer:
        final parsed = int.tryParse(value);
        if (parsed == null) {
          throw ArgumentError('$context: ${option.key} must be a whole number (got "$value").');
        }
        final min = option.minValue;
        final max = option.maxValue;
        if (min != null && parsed < min) {
          throw ArgumentError('$context: ${option.key} must be at least $min (got $parsed).');
        }
        if (max != null && parsed > max) {
          throw ArgumentError('$context: ${option.key} must be at most $max (got $parsed).');
        }
        return '$parsed';

      case SshValueKind.freeText:
        if (value.startsWith('#')) {
          throw ArgumentError('$context: ${option.key} value must not start with "#".');
        }
        return value;
    }
  }
}
