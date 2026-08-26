/**
 * OpenSSH configuration builder — pure TS, no I/O, no React.
 *
 * Renders either a client `~/.ssh/config` or a server `sshd_config` from a
 * catalog-driven set of user-selected directives. Only directives the user
 * explicitly selected are emitted, so the result is a small reviewable diff
 * rather than a wall of restated defaults (same philosophy as the sysctl
 * config builder in this repo).
 *
 * Ported 1:1 from `lib/core/utility/ssh_config_builder.dart` — see that file
 * for the sourcing notes on the recommended values (`ssh_config(5)` /
 * `sshd_config(5)`, ssh-audit's hardening guides, CIS-benchmark numeric
 * limits) and the OpenSSH version caveats baked into the catalog. Nothing
 * about those citations changes in the port; only the language does.
 */

import type { IToolUseCase } from '../ports/IToolUseCase'

/** Which config file is being generated. */
export type SshConfigMode = 'client' | 'server'

export const SSH_CONFIG_MODE_LABELS: Record<SshConfigMode, string> = {
  client: 'Client — ~/.ssh/config',
  server: 'Server — sshd_config',
}

/** Filename to suggest in a native "save as" dialog. */
export const SSH_CONFIG_MODE_FILE_NAMES: Record<SshConfigMode, string> = {
  client: 'config',
  server: 'sshd_config',
}

/**
 * What kind of value a directive takes — this is what lets the UI render a
 * switch/dropdown instead of a free-text box for options that only accept a
 * fixed set of words.
 */
export type SshValueKind = 'boolean' | 'choice' | 'integer' | 'freeText'

/**
 * A single OpenSSH directive descriptor. The UI is built generically off a
 * list of these, so adding a directive is a one-entry data change here and
 * needs no new widget code.
 */
export interface SshOption {
  /** The directive name exactly as OpenSSH spells it, e.g. `PermitRootLogin`. */
  key: string
  /**
   * UI/section grouping, e.g. `Authentication`. Also drives output ordering
   * via `SSH_CLIENT_GROUP_ORDER` / `SSH_SERVER_GROUP_ORDER`.
   */
  group: string
  /** Which config file(s) this directive is valid in. */
  modes: readonly SshConfigMode[]
  kind: SshValueKind
  /** One-line explanation shown under the control. */
  description: string
  /** The complete legal value set for `choice`. Empty otherwise. */
  allowedValues?: readonly string[]
  /** OpenSSH's own default, for reference. Not emitted unless selected. */
  defaultValue?: string
  /**
   * Value used by the "Hardened baseline" preset. Undefined means the
   * directive is not part of the preset (either it is site-specific, like
   * `AllowUsers`, or naming it could break older OpenSSH builds).
   */
  hardenedValue?: string
  /** Placeholder text for free-text/integer fields. */
  hint?: string
  minValue?: number
  maxValue?: number
  /** Minimum OpenSSH version / rename history, surfaced in the UI. */
  versionNote?: string
  /**
   * Comment line emitted immediately above the directive in the generated
   * file (without the leading `# `), when the directive is selected.
   */
  outputComment?: string
}

function appliesTo(option: SshOption, mode: SshConfigMode): boolean {
  return option.modes.includes(mode)
}

const CLIENT: readonly SshConfigMode[] = ['client']
const SERVER: readonly SshConfigMode[] = ['server']
const BOTH: readonly SshConfigMode[] = ['client', 'server']

const LOG_LEVELS = ['QUIET', 'FATAL', 'ERROR', 'INFO', 'VERBOSE', 'DEBUG', 'DEBUG1', 'DEBUG2', 'DEBUG3'] as const

/**
 * Hardened cipher list. Authenticated-encryption first, then CTR. No CBC --
 * CBC in SSH is vulnerable to the classic plaintext-recovery attack and is
 * not in OpenSSH's own defaults. Source: ssh-audit hardening guides; every
 * entry is also in the `ssh_config(5)` default list.
 */
export const SSH_HARDENED_CIPHERS =
  'chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,' +
  'aes128-gcm@openssh.com,aes256-ctr,aes192-ctr,aes128-ctr'

/**
 * Hardened MAC list: encrypt-then-MAC only, SHA-2 only. Excludes every
 * `hmac-sha1*` variant, `hmac-md5*`, and the 64-bit-tag `umac-64*`.
 * Source: ssh-audit hardening guides.
 */
export const SSH_HARDENED_MACS =
  'hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,umac-128-etm@openssh.com'

/**
 * Hardened key exchange list.
 *
 * Leads with the hybrid post-quantum `sntrup761x25519-sha512@openssh.com`
 * (8.5+, OpenSSH's own default since 9.0) rather than `mlkem768x25519-sha256`
 * (9.9+, default in 10.0): an unrecognised name here is a hard startup
 * failure, so the newer algorithm is suggested in a comment instead.
 * Excludes every SHA-1 group exchange (`diffie-hellman-group1-sha1`,
 * `-group14-sha1`, `-group-exchange-sha1`).
 */
export const SSH_HARDENED_KEX_ALGORITHMS =
  'sntrup761x25519-sha512@openssh.com,curve25519-sha256,' +
  'curve25519-sha256@libssh.org,diffie-hellman-group18-sha512,' +
  'diffie-hellman-group16-sha512,diffie-hellman-group-exchange-sha256'

/**
 * Hardened host key / public key algorithm list: Ed25519 (incl. FIDO tokens)
 * and RSA with SHA-2 signatures. Notably absent is `ssh-rsa`, the SHA-1
 * signature algorithm OpenSSH disabled by default in 8.8 -- this is where
 * Mozilla's published list is out of date. Source: ssh-audit hardening
 * guides, cross-checked against the `sshd_config(5)` defaults.
 */
export const SSH_HARDENED_HOST_KEY_ALGORITHMS =
  'ssh-ed25519-cert-v01@openssh.com,sk-ssh-ed25519-cert-v01@openssh.com,' +
  'rsa-sha2-512-cert-v01@openssh.com,rsa-sha2-256-cert-v01@openssh.com,' +
  'ssh-ed25519,sk-ssh-ed25519@openssh.com,rsa-sha2-512,rsa-sha2-256'

const KEX_COMMENT = 'OpenSSH 9.9+/10.0 users may prepend mlkem768x25519-sha256 (PQ default in 10.0)'

/**
 * Substrings that identify a broken, deprecated, or removed SSH algorithm.
 *
 * Matched case-insensitively against each comma/whitespace-separated token of
 * an algorithm list. Used to warn when a user pastes legacy advice into a
 * crypto field, and asserted against in the hardened-preset regression test.
 */
export const SSH_DEPRECATED_ALGORITHMS: readonly string[] = [
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
]

/** Section order for the client file (also the order directives are emitted). */
export const SSH_CLIENT_GROUP_ORDER: readonly string[] = [
  'Connection',
  'Authentication',
  'Host key verification',
  'Cryptography',
  'Forwarding',
  'Multiplexing',
  'Diagnostics',
]

/** Section order for the server file. */
export const SSH_SERVER_GROUP_ORDER: readonly string[] = [
  'Network',
  'Authentication',
  'Access control',
  'Cryptography',
  'Forwarding & features',
  'Sessions & limits',
  'Logging',
]

/** The full directive catalog. Order within a group is the emission order. */
export const SSH_OPTION_CATALOG: readonly SshOption[] = [
  // ------------------------------------------------------------------
  // CLIENT — Connection
  // ------------------------------------------------------------------
  {
    key: 'HostName',
    group: 'Connection',
    modes: CLIENT,
    kind: 'freeText',
    description: 'Real hostname or address to connect to. Defaults to the name given on the command line.',
    hint: 'web-01.internal.example.com',
  },
  {
    key: 'User',
    group: 'Connection',
    modes: CLIENT,
    kind: 'freeText',
    description: 'Remote login user. Defaults to the local username.',
    hint: 'deploy',
  },
  {
    key: 'Port',
    group: 'Connection',
    modes: CLIENT,
    kind: 'integer',
    description: 'Port on the remote host.',
    defaultValue: '22',
    hint: '22',
    minValue: 1,
    maxValue: 65535,
  },
  {
    key: 'AddressFamily',
    group: 'Connection',
    modes: CLIENT,
    kind: 'choice',
    allowedValues: ['any', 'inet', 'inet6'],
    description: 'Address family to use. inet = IPv4 only, inet6 = IPv6 only.',
    defaultValue: 'any',
  },
  {
    key: 'ConnectTimeout',
    group: 'Connection',
    modes: CLIENT,
    kind: 'integer',
    description: 'Seconds to wait for the TCP connection before giving up. Default is the system TCP timeout.',
    hint: '10',
    minValue: 1,
    maxValue: 86400,
  },
  {
    key: 'ConnectionAttempts',
    group: 'Connection',
    modes: CLIENT,
    kind: 'integer',
    description: 'Number of connection attempts before exiting.',
    defaultValue: '1',
    hint: '1',
    minValue: 1,
    maxValue: 1000,
  },
  {
    key: 'ProxyJump',
    group: 'Connection',
    modes: CLIENT,
    kind: 'freeText',
    description: 'Bastion to tunnel through: [user@]host[:port], comma-separated for a chain. OpenSSH 7.3+.',
    hint: 'jump@bastion.example.com:22',
    versionNote: 'OpenSSH 7.3+',
  },
  {
    key: 'ProxyCommand',
    group: 'Connection',
    modes: CLIENT,
    kind: 'freeText',
    description: 'Shell command used instead of a direct socket. Prefer ProxyJump for plain bastion hops.',
    hint: 'ssh -W %h:%p bastion',
  },
  {
    key: 'ServerAliveInterval',
    group: 'Connection',
    modes: CLIENT,
    kind: 'integer',
    description: 'Seconds of inactivity before sending an encrypted keepalive. 0 disables.',
    defaultValue: '0',
    hardenedValue: '60',
    hint: '60',
    minValue: 0,
    maxValue: 86400,
  },
  {
    key: 'ServerAliveCountMax',
    group: 'Connection',
    modes: CLIENT,
    kind: 'integer',
    description: 'Unanswered keepalives tolerated before the client disconnects.',
    defaultValue: '3',
    hardenedValue: '3',
    hint: '3',
    minValue: 1,
    maxValue: 1000,
  },
  {
    key: 'TCPKeepAlive',
    group: 'Connection',
    modes: CLIENT,
    kind: 'boolean',
    description: 'Send TCP-level keepalives. Spoofable, unlike ServerAliveInterval.',
    defaultValue: 'yes',
  },
  {
    key: 'Compression',
    group: 'Connection',
    modes: CLIENT,
    kind: 'boolean',
    description: 'Compress the session. Rarely worth it on modern links; leave off.',
    defaultValue: 'no',
    hardenedValue: 'no',
  },
  {
    key: 'RequestTTY',
    group: 'Connection',
    modes: CLIENT,
    kind: 'choice',
    allowedValues: ['no', 'yes', 'force', 'auto'],
    description: 'Whether to request a pseudo-terminal for the session.',
    defaultValue: 'auto',
  },

  // ------------------------------------------------------------------
  // CLIENT — Authentication
  // ------------------------------------------------------------------
  {
    key: 'IdentityFile',
    group: 'Authentication',
    modes: CLIENT,
    kind: 'freeText',
    description: 'Private key to offer. Pair with IdentitiesOnly so the agent does not offer every other key first.',
    hint: '~/.ssh/id_ed25519',
  },
  {
    key: 'IdentitiesOnly',
    group: 'Authentication',
    modes: CLIENT,
    kind: 'boolean',
    description:
      'Offer only the keys named here, not everything in the agent. Avoids MaxAuthTries lockouts and key enumeration.',
    defaultValue: 'no',
    hardenedValue: 'yes',
  },
  {
    key: 'CertificateFile',
    group: 'Authentication',
    modes: CLIENT,
    kind: 'freeText',
    description: 'User certificate to present alongside the matching private key.',
    hint: '~/.ssh/id_ed25519-cert.pub',
  },
  {
    key: 'AddKeysToAgent',
    group: 'Authentication',
    modes: CLIENT,
    kind: 'choice',
    allowedValues: ['no', 'yes', 'ask', 'confirm'],
    description: 'Add a key to ssh-agent after it is first used. "confirm" prompts on every later use.',
    defaultValue: 'no',
    hardenedValue: 'yes',
    versionNote: 'OpenSSH 7.2+',
  },
  {
    key: 'PubkeyAuthentication',
    group: 'Authentication',
    modes: CLIENT,
    kind: 'choice',
    allowedValues: ['yes', 'no', 'unbound', 'host-bound'],
    description: 'Try public key authentication. host-bound/unbound select the session-binding extension.',
    defaultValue: 'yes',
    hardenedValue: 'yes',
  },
  {
    key: 'PasswordAuthentication',
    group: 'Authentication',
    modes: BOTH,
    kind: 'boolean',
    description: 'Allow password authentication. Turn it off once keys work — it is the main brute-force surface.',
    defaultValue: 'yes',
    hardenedValue: 'no',
  },
  {
    key: 'KbdInteractiveAuthentication',
    group: 'Authentication',
    modes: BOTH,
    kind: 'boolean',
    description: 'Keyboard-interactive (PAM) authentication. Leaving this on can re-open password login through PAM.',
    defaultValue: 'yes',
    hardenedValue: 'no',
    versionNote: 'Preferred spelling since OpenSSH 8.7; ChallengeResponseAuthentication is a deprecated alias',
  },
  {
    key: 'PreferredAuthentications',
    group: 'Authentication',
    modes: CLIENT,
    kind: 'freeText',
    description: 'Order in which authentication methods are tried.',
    defaultValue: 'gssapi-with-mic,hostbased,publickey,keyboard-interactive,password',
    hardenedValue: 'publickey',
    hint: 'publickey',
  },
  {
    key: 'GSSAPIAuthentication',
    group: 'Authentication',
    modes: BOTH,
    kind: 'boolean',
    description: 'Kerberos/GSSAPI authentication. Leave off unless you actually run Kerberos.',
    defaultValue: 'no',
    hardenedValue: 'no',
  },

  // ------------------------------------------------------------------
  // CLIENT — Host key verification
  // ------------------------------------------------------------------
  {
    key: 'StrictHostKeyChecking',
    group: 'Host key verification',
    modes: CLIENT,
    kind: 'choice',
    allowedValues: ['yes', 'accept-new', 'ask', 'no', 'off'],
    description:
      'How unknown/changed host keys are handled. "accept-new" trusts first use but still refuses changed keys; ' +
      '"yes" is stricter (nothing is auto-added). Never use "no"/"off".',
    defaultValue: 'ask',
    hardenedValue: 'accept-new',
    versionNote: '"accept-new" requires OpenSSH 7.6+',
  },
  {
    key: 'UserKnownHostsFile',
    group: 'Host key verification',
    modes: CLIENT,
    kind: 'freeText',
    description: 'Where verified host keys are stored. Whitespace-separated for multiple files.',
    defaultValue: '~/.ssh/known_hosts ~/.ssh/known_hosts2',
    hint: '~/.ssh/known_hosts',
  },
  {
    key: 'HashKnownHosts',
    group: 'Host key verification',
    modes: CLIENT,
    kind: 'boolean',
    description: 'Hash hostnames in known_hosts so a leaked file does not enumerate your infrastructure.',
    defaultValue: 'no',
    hardenedValue: 'yes',
  },
  {
    key: 'VerifyHostKeyDNS',
    group: 'Host key verification',
    modes: CLIENT,
    kind: 'choice',
    allowedValues: ['yes', 'no', 'ask'],
    description: 'Verify host keys against SSHFP DNS records. Only meaningful with DNSSEC.',
    defaultValue: 'no',
  },
  {
    key: 'UpdateHostKeys',
    group: 'Host key verification',
    modes: CLIENT,
    kind: 'choice',
    allowedValues: ['yes', 'no', 'ask'],
    description: 'Accept additional/rotated host keys the server advertises after authentication.',
    defaultValue: 'yes',
    hardenedValue: 'yes',
  },

  // ------------------------------------------------------------------
  // Cryptography (both files, identical spelling and identical picks)
  // ------------------------------------------------------------------
  {
    key: 'HostKeyAlgorithms',
    group: 'Cryptography',
    modes: BOTH,
    kind: 'freeText',
    description: 'Host key signature algorithms to accept/offer. Excludes ssh-rsa (SHA-1) and DSA.',
    hardenedValue: SSH_HARDENED_HOST_KEY_ALGORITHMS,
    hint: SSH_HARDENED_HOST_KEY_ALGORITHMS,
  },
  {
    key: 'KexAlgorithms',
    group: 'Cryptography',
    modes: BOTH,
    kind: 'freeText',
    description: 'Key exchange algorithms. An unrecognised name here is a hard startup failure — check ssh -Q kex first.',
    hardenedValue: SSH_HARDENED_KEX_ALGORITHMS,
    hint: SSH_HARDENED_KEX_ALGORITHMS,
    outputComment: KEX_COMMENT,
  },
  {
    key: 'Ciphers',
    group: 'Cryptography',
    modes: BOTH,
    kind: 'freeText',
    description: 'Symmetric ciphers. AEAD first, CTR fallback, no CBC.',
    hardenedValue: SSH_HARDENED_CIPHERS,
    hint: SSH_HARDENED_CIPHERS,
  },
  {
    key: 'MACs',
    group: 'Cryptography',
    modes: BOTH,
    kind: 'freeText',
    description: 'Message authentication codes. Encrypt-then-MAC (-etm) SHA-2 only.',
    hardenedValue: SSH_HARDENED_MACS,
    hint: SSH_HARDENED_MACS,
  },
  {
    key: 'PubkeyAcceptedAlgorithms',
    group: 'Cryptography',
    modes: BOTH,
    kind: 'freeText',
    description: 'Public key signature algorithms accepted for user authentication.',
    hardenedValue: SSH_HARDENED_HOST_KEY_ALGORITHMS,
    hint: SSH_HARDENED_HOST_KEY_ALGORITHMS,
    versionNote: 'OpenSSH 8.5+ (was PubkeyAcceptedKeyTypes)',
  },
  {
    key: 'CASignatureAlgorithms',
    group: 'Cryptography',
    modes: BOTH,
    kind: 'freeText',
    description: 'Signature algorithms accepted on SSH certificates.',
    hardenedValue: 'sk-ssh-ed25519@openssh.com,ssh-ed25519,rsa-sha2-512,rsa-sha2-256',
    hint: 'ssh-ed25519,rsa-sha2-512,rsa-sha2-256',
  },
  {
    key: 'RequiredRSASize',
    group: 'Cryptography',
    modes: BOTH,
    kind: 'integer',
    description: 'Minimum accepted RSA key length in bits. Can only be raised above the 1024 default.',
    defaultValue: '1024',
    hardenedValue: '3072',
    hint: '3072',
    minValue: 1024,
    maxValue: 16384,
    versionNote: 'OpenSSH 9.1+',
  },

  // ------------------------------------------------------------------
  // CLIENT — Forwarding
  // ------------------------------------------------------------------
  {
    key: 'ForwardAgent',
    group: 'Forwarding',
    modes: CLIENT,
    kind: 'boolean',
    description:
      'Expose your agent socket on the remote host. Anyone with root there can use your keys — prefer ProxyJump.',
    defaultValue: 'no',
    hardenedValue: 'no',
  },
  {
    key: 'ForwardX11',
    group: 'Forwarding',
    modes: CLIENT,
    kind: 'boolean',
    description: 'Forward X11 connections. Grants the remote host input/screen access to your display.',
    defaultValue: 'no',
    hardenedValue: 'no',
  },
  {
    key: 'ForwardX11Trusted',
    group: 'Forwarding',
    modes: CLIENT,
    kind: 'boolean',
    description: 'Give forwarded X11 clients full, unrestricted access to your X server.',
    defaultValue: 'no',
    hardenedValue: 'no',
  },
  {
    key: 'PermitLocalCommand',
    group: 'Forwarding',
    modes: CLIENT,
    kind: 'boolean',
    description: 'Allow LocalCommand / the ~C escape to run local commands.',
    defaultValue: 'no',
    hardenedValue: 'no',
  },
  {
    key: 'ExitOnForwardFailure',
    group: 'Forwarding',
    modes: CLIENT,
    kind: 'boolean',
    description: 'Abort the connection if a requested forward cannot be set up, instead of continuing silently.',
    defaultValue: 'no',
  },

  // ------------------------------------------------------------------
  // CLIENT — Multiplexing
  // ------------------------------------------------------------------
  {
    key: 'ControlMaster',
    group: 'Multiplexing',
    modes: CLIENT,
    kind: 'choice',
    allowedValues: ['no', 'yes', 'ask', 'auto', 'autoask'],
    description: 'Share one TCP connection across sessions. "auto" reuses an existing master or creates one.',
    defaultValue: 'no',
  },
  {
    key: 'ControlPath',
    group: 'Multiplexing',
    modes: CLIENT,
    kind: 'freeText',
    description: 'Control socket path. Must be unique per user/host/port — use %C or %r@%h:%p.',
    hint: '~/.ssh/cm-%C',
  },
  {
    key: 'ControlPersist',
    group: 'Multiplexing',
    modes: CLIENT,
    kind: 'freeText',
    description: 'How long an idle master stays open: no, yes (forever), 0, or a time such as 10m.',
    defaultValue: 'no',
    hint: '10m',
  },

  // ------------------------------------------------------------------
  // CLIENT — Diagnostics
  // ------------------------------------------------------------------
  {
    key: 'LogLevel',
    group: 'Diagnostics',
    modes: CLIENT,
    kind: 'choice',
    allowedValues: LOG_LEVELS,
    description: 'Client verbosity. DEBUG levels can print sensitive details — do not leave them on.',
    defaultValue: 'INFO',
  },

  // ------------------------------------------------------------------
  // SERVER — Network
  // ------------------------------------------------------------------
  {
    key: 'Port',
    group: 'Network',
    modes: SERVER,
    kind: 'integer',
    description: 'Port sshd listens on. Moving off 22 only reduces log noise; it is not a security control.',
    defaultValue: '22',
    hint: '22',
    minValue: 1,
    maxValue: 65535,
  },
  {
    key: 'ListenAddress',
    group: 'Network',
    modes: SERVER,
    kind: 'freeText',
    description: 'Bind to a specific address (or address:port). Default is every local address.',
    hint: '10.0.0.5',
  },
  {
    key: 'AddressFamily',
    group: 'Network',
    modes: SERVER,
    kind: 'choice',
    allowedValues: ['any', 'inet', 'inet6'],
    description: 'Address family sshd uses.',
    defaultValue: 'any',
  },
  {
    key: 'HostKey',
    group: 'Network',
    modes: SERVER,
    kind: 'freeText',
    description: 'Host private key file. Repeat the directive for each key type you serve.',
    hint: '/etc/ssh/ssh_host_ed25519_key',
  },

  // ------------------------------------------------------------------
  // SERVER — Authentication
  // ------------------------------------------------------------------
  {
    key: 'PermitRootLogin',
    group: 'Authentication',
    modes: SERVER,
    kind: 'choice',
    allowedValues: ['yes', 'prohibit-password', 'forced-commands-only', 'no'],
    description:
      'Whether root may log in directly. "no" is the auditable choice (people log in as themselves, then sudo). ' +
      '"without-password" is a deprecated alias for prohibit-password.',
    defaultValue: 'prohibit-password',
    hardenedValue: 'no',
  },
  {
    key: 'PubkeyAuthentication',
    group: 'Authentication',
    modes: SERVER,
    kind: 'boolean',
    description: 'Accept public key authentication. Must stay on if you disable passwords.',
    defaultValue: 'yes',
    hardenedValue: 'yes',
  },
  {
    key: 'PermitEmptyPasswords',
    group: 'Authentication',
    modes: SERVER,
    kind: 'boolean',
    description: 'Allow accounts with empty passwords to log in. Always no.',
    defaultValue: 'no',
    hardenedValue: 'no',
  },
  {
    key: 'HostbasedAuthentication',
    group: 'Authentication',
    modes: SERVER,
    kind: 'boolean',
    description: 'Trust the client host rather than the user. Almost never wanted.',
    defaultValue: 'no',
    hardenedValue: 'no',
  },
  {
    key: 'IgnoreRhosts',
    group: 'Authentication',
    modes: SERVER,
    kind: 'choice',
    allowedValues: ['yes', 'shosts-only', 'no'],
    description: 'Ignore ~/.rhosts and ~/.shosts during host-based authentication.',
    defaultValue: 'yes',
    hardenedValue: 'yes',
  },
  {
    key: 'AuthenticationMethods',
    group: 'Authentication',
    modes: SERVER,
    kind: 'freeText',
    description:
      'Methods that must all succeed, comma-separated; space-separated alternatives. ' +
      '"publickey,keyboard-interactive" is 2FA; "publickey" alone is keys-only.',
    defaultValue: 'any',
    hardenedValue: 'publickey',
    hint: 'publickey',
  },
  {
    key: 'AuthorizedKeysFile',
    group: 'Authentication',
    modes: SERVER,
    kind: 'freeText',
    description: "Where user public keys are read from. Point this outside $HOME to stop users adding their own keys.",
    defaultValue: '.ssh/authorized_keys .ssh/authorized_keys2',
    hint: '/etc/ssh/authorized_keys.d/%u',
  },
  {
    key: 'TrustedUserCAKeys',
    group: 'Authentication',
    modes: SERVER,
    kind: 'freeText',
    description: 'CA public keys trusted to sign user certificates.',
    hint: '/etc/ssh/user_ca.pub',
  },
  {
    key: 'UsePAM',
    group: 'Authentication',
    modes: SERVER,
    kind: 'boolean',
    description: 'Run PAM account and session modules. Most distributions require this for correct session setup.',
    defaultValue: 'no',
    hardenedValue: 'yes',
  },
  {
    key: 'StrictModes',
    group: 'Authentication',
    modes: SERVER,
    kind: 'boolean',
    description: 'Refuse to use key files whose ownership/permissions are too loose.',
    defaultValue: 'yes',
    hardenedValue: 'yes',
  },
  {
    key: 'MaxAuthTries',
    group: 'Authentication',
    modes: SERVER,
    kind: 'integer',
    description:
      'Failed attempts allowed per connection. CIS asks for 4 or less; 3 is tighter. Agents with many keys may need IdentitiesOnly on the client.',
    defaultValue: '6',
    hardenedValue: '3',
    hint: '3',
    minValue: 1,
    maxValue: 100,
  },
  {
    key: 'LoginGraceTime',
    group: 'Authentication',
    modes: SERVER,
    kind: 'integer',
    description: 'Seconds to complete authentication before disconnect. CIS asks for 60 or less.',
    defaultValue: '120',
    hardenedValue: '30',
    hint: '30',
    minValue: 0,
    maxValue: 3600,
  },

  // ------------------------------------------------------------------
  // SERVER — Access control
  // ------------------------------------------------------------------
  {
    key: 'AllowUsers',
    group: 'Access control',
    modes: SERVER,
    kind: 'freeText',
    description: 'Space-separated allowlist of user patterns (USER or USER@HOST). If set, everyone else is refused.',
    hint: 'deploy ops admin@10.0.0.*',
  },
  {
    key: 'AllowGroups',
    group: 'Access control',
    modes: SERVER,
    kind: 'freeText',
    description: 'Space-separated allowlist of group patterns. Usually easier to maintain than AllowUsers.',
    hint: 'sshusers',
  },
  {
    key: 'DenyUsers',
    group: 'Access control',
    modes: SERVER,
    kind: 'freeText',
    description: 'Space-separated denylist of user patterns. Evaluated before the Allow* lists.',
    hint: 'guest',
  },
  {
    key: 'DenyGroups',
    group: 'Access control',
    modes: SERVER,
    kind: 'freeText',
    description: 'Space-separated denylist of group patterns.',
    hint: 'nologin',
  },

  // ------------------------------------------------------------------
  // SERVER — Forwarding & features
  // ------------------------------------------------------------------
  {
    key: 'X11Forwarding',
    group: 'Forwarding & features',
    modes: SERVER,
    kind: 'boolean',
    description: 'Allow X11 forwarding. Off unless the box actually serves GUI apps.',
    defaultValue: 'no',
    hardenedValue: 'no',
  },
  {
    key: 'AllowAgentForwarding',
    group: 'Forwarding & features',
    modes: SERVER,
    kind: 'boolean',
    description: 'Allow clients to forward their agent onto this host. Disable on anything shared or internet-facing.',
    defaultValue: 'yes',
    hardenedValue: 'no',
  },
  {
    key: 'AllowTcpForwarding',
    group: 'Forwarding & features',
    modes: SERVER,
    kind: 'choice',
    allowedValues: ['yes', 'all', 'no', 'local', 'remote'],
    description: 'Port forwarding policy. "no" stops users pivoting through this host; set "local" if only -L is needed.',
    defaultValue: 'yes',
    hardenedValue: 'no',
  },
  {
    key: 'GatewayPorts',
    group: 'Forwarding & features',
    modes: SERVER,
    kind: 'choice',
    allowedValues: ['no', 'yes', 'clientspecified'],
    description: 'Let remote forwards bind non-loopback addresses, exposing them to the network.',
    defaultValue: 'no',
    hardenedValue: 'no',
  },
  {
    key: 'PermitTunnel',
    group: 'Forwarding & features',
    modes: SERVER,
    kind: 'choice',
    allowedValues: ['no', 'yes', 'point-to-point', 'ethernet'],
    description: 'Allow tun(4) device forwarding (a full VPN over SSH).',
    defaultValue: 'no',
    hardenedValue: 'no',
  },
  {
    key: 'PermitUserEnvironment',
    group: 'Forwarding & features',
    modes: SERVER,
    kind: 'boolean',
    description: 'Honour ~/.ssh/environment and environment= in authorized_keys. Can be used to bypass restrictions.',
    defaultValue: 'no',
    hardenedValue: 'no',
  },
  {
    key: 'Compression',
    group: 'Forwarding & features',
    modes: SERVER,
    kind: 'choice',
    allowedValues: ['yes', 'delayed', 'no'],
    description: 'Server-side compression. "delayed" is a legacy alias for post-authentication compression.',
    defaultValue: 'yes',
    hardenedValue: 'no',
  },
  {
    key: 'PrintMotd',
    group: 'Forwarding & features',
    modes: SERVER,
    kind: 'boolean',
    description: 'Print /etc/motd on login. Usually already handled by PAM, so distributions set this to no.',
    defaultValue: 'yes',
  },
  {
    key: 'Banner',
    group: 'Forwarding & features',
    modes: SERVER,
    kind: 'freeText',
    description: 'File shown before authentication. Use a legal notice, never version or host details.',
    hint: '/etc/issue.net',
  },
  {
    key: 'Subsystem',
    group: 'Forwarding & features',
    modes: SERVER,
    kind: 'freeText',
    description:
      'Subsystem definition. internal-sftp with -f/-l makes SFTP file access auditable; ' +
      'omit the whole directive to disable SFTP.',
    hardenedValue: 'sftp internal-sftp -f AUTHPRIV -l INFO',
    hint: 'sftp internal-sftp -f AUTHPRIV -l INFO',
  },

  // ------------------------------------------------------------------
  // SERVER — Sessions & limits
  // ------------------------------------------------------------------
  {
    key: 'MaxSessions',
    group: 'Sessions & limits',
    modes: SERVER,
    kind: 'integer',
    description: 'Multiplexed sessions permitted per network connection.',
    defaultValue: '10',
    hardenedValue: '4',
    hint: '4',
    minValue: 1,
    maxValue: 1000,
  },
  {
    key: 'MaxStartups',
    group: 'Sessions & limits',
    modes: SERVER,
    kind: 'freeText',
    description: 'Unauthenticated connections allowed, as start:rate:full random-early-drop.',
    defaultValue: '10:30:100',
    hardenedValue: '10:30:60',
    hint: '10:30:60',
  },
  {
    key: 'PerSourceMaxStartups',
    group: 'Sessions & limits',
    modes: SERVER,
    kind: 'freeText',
    description: 'Unauthenticated connections allowed per source address.',
    defaultValue: 'none',
    hint: '10',
    versionNote: 'OpenSSH 8.5+',
  },
  {
    key: 'PerSourcePenalties',
    group: 'Sessions & limits',
    modes: SERVER,
    kind: 'freeText',
    description: 'Temporarily block source addresses that keep failing. Not in the preset: unknown on OpenSSH < 9.8, which refuses to start.',
    hint: 'yes',
    versionNote: 'OpenSSH 9.8+',
  },
  {
    key: 'ClientAliveInterval',
    group: 'Sessions & limits',
    modes: SERVER,
    kind: 'integer',
    description: 'Seconds of inactivity before sshd probes the client. With ClientAliveCountMax this is the idle timeout.',
    defaultValue: '0',
    hardenedValue: '300',
    hint: '300',
    minValue: 0,
    maxValue: 86400,
  },
  {
    key: 'ClientAliveCountMax',
    group: 'Sessions & limits',
    modes: SERVER,
    kind: 'integer',
    description: 'Unanswered probes before sshd drops the session.',
    defaultValue: '3',
    hardenedValue: '2',
    hint: '2',
    minValue: 1,
    maxValue: 1000,
  },
  {
    key: 'TCPKeepAlive',
    group: 'Sessions & limits',
    modes: SERVER,
    kind: 'boolean',
    description: 'Send TCP-level keepalives. ClientAliveInterval is the one that actually reaps idle sessions.',
    defaultValue: 'yes',
  },

  // ------------------------------------------------------------------
  // SERVER — Logging
  // ------------------------------------------------------------------
  {
    key: 'LogLevel',
    group: 'Logging',
    modes: SERVER,
    kind: 'choice',
    allowedValues: LOG_LEVELS,
    description: 'VERBOSE additionally logs the key fingerprint used for each login, which is what makes key use auditable.',
    defaultValue: 'INFO',
    hardenedValue: 'VERBOSE',
  },
  {
    key: 'SyslogFacility',
    group: 'Logging',
    modes: SERVER,
    kind: 'choice',
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
  },
]

/** Group section order for `mode`. */
export function sshGroupsForMode(mode: SshConfigMode): readonly string[] {
  return mode === 'client' ? SSH_CLIENT_GROUP_ORDER : SSH_SERVER_GROUP_ORDER
}

/**
 * All catalog options valid in `mode`, in emission order (group order first,
 * then catalog order within the group).
 */
export function sshOptionsForMode(mode: SshConfigMode): SshOption[] {
  const groups = sshGroupsForMode(mode)
  const result: SshOption[] = []
  for (const group of groups) {
    for (const option of SSH_OPTION_CATALOG) {
      if (appliesTo(option, mode) && option.group === group) result.push(option)
    }
  }
  return result
}

/** Catalog options in `mode` belonging to `group`, in emission order. */
export function sshOptionsInGroup(mode: SshConfigMode, group: string): SshOption[] {
  return SSH_OPTION_CATALOG.filter((o) => appliesTo(o, mode) && o.group === group)
}

/** The descriptor for `key` in `mode`, or undefined if not in the catalog for that file. */
export function sshOptionFor(mode: SshConfigMode, key: string): SshOption | undefined {
  return SSH_OPTION_CATALOG.find((o) => appliesTo(o, mode) && o.key === key)
}

/**
 * The "Hardened baseline" preset for `mode`: every catalog option that has a
 * `hardenedValue`, mapped to that value.
 *
 * For `client` these belong in the `Host *` defaults block. Site-specific
 * directives (AllowUsers, HostName, Port, …) are deliberately excluded — the
 * preset is a starting point, not a finished config, and the UI says so.
 */
export function sshHardenedBaseline(mode: SshConfigMode): Record<string, string> {
  const result: Record<string, string> = {}
  for (const option of sshOptionsForMode(mode)) {
    if (option.hardenedValue != null) result[option.key] = option.hardenedValue
  }
  return result
}

/**
 * Returns the deprecated/broken algorithm names found in an algorithm list.
 *
 * Tokenises on commas and whitespace and matches each token against
 * `SSH_DEPRECATED_ALGORITHMS` case-insensitively. Leading `+`/`-`/`^` list
 * modifiers are stripped first. Empty when the list is clean.
 */
export function sshDeprecatedAlgorithmsIn(value: string): string[] {
  const found: string[] = []
  for (const rawToken of value.split(/[,\s]+/)) {
    const token = rawToken.replace(/^[+\-^]/, '').trim().toLowerCase()
    if (token.length === 0) continue
    for (const bad of SSH_DEPRECATED_ALGORITHMS) {
      if (token.includes(bad) && !found.includes(rawToken)) {
        found.push(rawToken)
        break
      }
    }
  }
  return found
}

/** One `Host` block in a client config. */
export interface SshHostBlock {
  /**
   * The `Host` pattern list, e.g. `prod-web-1` or `web-* db-*`. Multiple
   * space-separated patterns are legal; the value must be non-empty and
   * single-line.
   */
  pattern: string
  /** Selected directives for this block, keyed by exact directive name. */
  values?: Record<string, string>
  /** Optional comment rendered above the `Host` line. */
  comment?: string
}

export interface SshConfigBuilderInput {
  mode?: SshConfigMode
  /** Client mode: per-host blocks, emitted in list order. */
  hostBlocks?: SshHostBlock[]
  /**
   * Client mode: the `Host *` defaults block.
   *
   * Emitted LAST. `ssh_config(5)` is first-match-wins per parameter, so a
   * `Host *` block placed at the top would shadow every specific block below
   * it — a very common way to write a config that silently does the wrong
   * thing.
   */
  globalDefaults?: Record<string, string>
  /** Server mode: the flat directive set. */
  serverValues?: Record<string, string>
  /** Whether to emit the explanatory/permissions header comment. */
  includeHeader?: boolean
}

export interface SshConfigBuilderResult {
  /** The rendered config file text. */
  configText: string
  /** `config` or `sshd_config`, for the save dialog. */
  suggestedFileName: string
  /**
   * Non-fatal advisories, e.g. a deprecated algorithm in a crypto list.
   * Never blocks generation — legacy interop is sometimes genuinely needed.
   */
  warnings: string[]
}

const INDENT = '    '

/**
 * Renders a client `~/.ssh/config` or server `sshd_config` from selected
 * catalog directives.
 *
 * Pure text generation, no filesystem access: writing the result is the
 * adapter layer's job.
 *
 * Every value is validated against its `SshOption` descriptor before it is
 * emitted, so a `choice` directive can never reach the output with a value
 * outside `allowedValues`, and a `boolean` directive can only ever emit
 * `yes` or `no`. Violations throw an `Error`.
 */
export class SshConfigBuilder implements IToolUseCase<SshConfigBuilderInput, SshConfigBuilderResult> {
  execute(input: SshConfigBuilderInput): SshConfigBuilderResult {
    const mode = input.mode ?? 'client'
    const warnings: string[] = []
    const text = mode === 'client' ? this.renderClient(input, warnings) : this.renderServer(input, warnings)

    return {
      configText: text,
      suggestedFileName: SSH_CONFIG_MODE_FILE_NAMES[mode],
      warnings,
    }
  }

  // ------------------------------------------------------------------
  // Client
  // ------------------------------------------------------------------

  private renderClient(input: SshConfigBuilderInput, warnings: string[]): string {
    const hostBlocks = input.hostBlocks ?? []
    const globalDefaults = input.globalDefaults ?? {}
    const includeHeader = input.includeHeader ?? true

    if (hostBlocks.length === 0 && Object.keys(globalDefaults).length === 0) {
      throw new Error('Add at least one Host block, or some Host * defaults, to generate a client config.')
    }

    const sections: string[] = []

    for (const block of hostBlocks) {
      const pattern = block.pattern.trim()
      if (pattern.length === 0) {
        throw new Error('Every Host block needs a pattern (for example "web-01" or "web-*").')
      }
      if (pattern.includes('\n')) {
        throw new Error(`A Host pattern must be a single line (got "${pattern}").`)
      }
      if (pattern === '*') {
        throw new Error('Use the "Global defaults (Host *)" section for the Host * block, not a named host.')
      }

      const lines = this.renderDirectives('client', block.values ?? {}, warnings, INDENT, `Host ${pattern}`)

      const buffer: string[] = []
      if (block.comment != null && block.comment.trim().length > 0) {
        for (const line of block.comment.trim().split('\n')) {
          buffer.push(`# ${line.trim()}`)
        }
      }
      let section = `Host ${pattern}`
      if (lines.length === 0) {
        warnings.push(`Host block "${pattern}" has no options selected, so it does nothing.`)
      } else {
        section += `\n${lines.join('\n')}`
      }
      sections.push([...buffer, section].join('\n'))
    }

    if (Object.keys(globalDefaults).length > 0) {
      const lines = this.renderDirectives('client', globalDefaults, warnings, INDENT, 'Host *')
      if (lines.length > 0) {
        sections.push(
          '# Defaults for every host. ssh_config is first-match-wins, so this\n' +
            '# block MUST stay at the bottom or it will shadow the blocks above.\n' +
            `Host *\n${lines.join('\n')}`,
        )
      }
    }

    const buffer: string[] = []
    if (includeHeader) {
      buffer.push(
        '# ~/.ssh/config — generated by InfraKit Studio',
        '#',
        '# Install:',
        '#   mkdir -p ~/.ssh && chmod 700 ~/.ssh',
        '#   install -m 600 config ~/.ssh/config      # must be 600; ssh refuses a world/group-writable config',
        '#',
        '# Check what ssh actually resolves for a host:  ssh -G <host>',
        '# Verify every directive against your build:    ssh -V ; ssh -Q kex ; ssh -Q cipher ; ssh -Q mac',
        '#',
        '',
      )
    }
    return buffer.join('\n') + sections.join('\n\n') + '\n'
  }

  // ------------------------------------------------------------------
  // Server
  // ------------------------------------------------------------------

  private renderServer(input: SshConfigBuilderInput, warnings: string[]): string {
    const serverValues = input.serverValues ?? {}
    const includeHeader = input.includeHeader ?? true

    if (Object.keys(serverValues).length === 0) {
      throw new Error('Select at least one sshd_config directive to generate a server config.')
    }

    const lines = this.renderDirectives('server', serverValues, warnings, '', 'sshd_config')

    if (
      'PasswordAuthentication' in serverValues &&
      serverValues.PasswordAuthentication.trim().toLowerCase() === 'no' &&
      !('KbdInteractiveAuthentication' in serverValues)
    ) {
      warnings.push(
        'PasswordAuthentication no without KbdInteractiveAuthentication no: on PAM systems ' +
          'password login can still succeed through keyboard-interactive. Set both.',
      )
    }
    if (serverValues.PermitRootLogin?.trim().toLowerCase() === 'yes') {
      warnings.push('PermitRootLogin yes allows direct root login — prefer "no" or "prohibit-password".')
    }

    const buffer: string[] = []
    if (includeHeader) {
      buffer.push(
        '# sshd_config — generated by InfraKit Studio',
        '#',
        '# Install:',
        '#   install -o root -g root -m 600 sshd_config /etc/ssh/sshd_config',
        '#   sshd -t                 # validate BEFORE restarting — a typo here locks you out',
        '#   systemctl reload ssh    # or: systemctl reload sshd',
        '#',
        '# Keep your current SSH session open and confirm a NEW session works',
        '# before closing it. Check the effective config with:  sshd -T',
        '#',
        '# Many distributions end sshd_config with an Include of /etc/ssh/sshd_config.d/*.conf,',
        '# and the FIRST value obtained wins — a drop-in can silently override the lines below.',
        '#',
        '',
      )
    }
    return buffer.join('\n') + lines.join('\n') + '\n'
  }

  // ------------------------------------------------------------------
  // Shared directive rendering + validation
  // ------------------------------------------------------------------

  private renderDirectives(
    mode: SshConfigMode,
    values: Record<string, string>,
    warnings: string[],
    indent: string,
    context: string,
  ): string[] {
    const ordered = sshOptionsForMode(mode)
    const known = new Set(ordered.map((o) => o.key))

    for (const key of Object.keys(values)) {
      if (!known.has(key)) {
        throw new Error(
          `"${key}" is not a known ${mode === 'client' ? 'ssh_config' : 'sshd_config'} directive in this catalog (${context}).`,
        )
      }
    }

    const lines: string[] = []
    for (const option of ordered) {
      const raw = values[option.key]
      if (raw == null) continue // Not selected -> never emitted.

      const value = this.validate(option, raw, context)

      if (this.isAlgorithmList(option)) {
        const bad = sshDeprecatedAlgorithmsIn(value)
        if (bad.length > 0) {
          warnings.push(`${context}: ${option.key} contains deprecated or broken algorithms: ${bad.join(', ')}.`)
        }
      }

      if (option.outputComment != null) {
        lines.push(`${indent}# ${option.outputComment}`)
      }
      lines.push(`${indent}${option.key} ${value}`)
    }
    return lines
  }

  private isAlgorithmList(option: SshOption): boolean {
    return option.group === 'Cryptography' && option.kind === 'freeText'
  }

  /**
   * Canonicalises and range/enum-checks one value. Throws an `Error` on
   * anything the directive cannot legally take.
   */
  private validate(option: SshOption, raw: string, context: string): string {
    const value = raw.trim()
    if (value.length === 0) {
      throw new Error(`${context}: ${option.key} needs a value.`)
    }
    if (value.includes('\n')) {
      throw new Error(`${context}: ${option.key} must be a single line.`)
    }

    switch (option.kind) {
      case 'boolean': {
        const lower = value.toLowerCase()
        if (lower !== 'yes' && lower !== 'no') {
          throw new Error(`${context}: ${option.key} must be "yes" or "no" (got "${value}").`)
        }
        return lower
      }

      case 'choice': {
        for (const allowed of option.allowedValues ?? []) {
          if (allowed.toLowerCase() === value.toLowerCase()) return allowed
        }
        throw new Error(
          `${context}: ${option.key} must be one of ${(option.allowedValues ?? []).join(', ')} (got "${value}").`,
        )
      }

      case 'integer': {
        if (!/^-?\d+$/.test(value)) {
          throw new Error(`${context}: ${option.key} must be a whole number (got "${value}").`)
        }
        const parsed = Number.parseInt(value, 10)
        const min = option.minValue
        const max = option.maxValue
        if (min != null && parsed < min) {
          throw new Error(`${context}: ${option.key} must be at least ${min} (got ${parsed}).`)
        }
        if (max != null && parsed > max) {
          throw new Error(`${context}: ${option.key} must be at most ${max} (got ${parsed}).`)
        }
        return `${parsed}`
      }

      case 'freeText': {
        if (value.startsWith('#')) {
          throw new Error(`${context}: ${option.key} value must not start with "#".`)
        }
        return value
      }
    }
  }
}
