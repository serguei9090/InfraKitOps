import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Fail2ban `jail.local` builder — pure TypeScript, no I/O, no React.
 *
 * Renders a `[DEFAULT]` section plus one section per enabled jail, matching
 * the shape documented in fail2ban's own `jail.conf`
 * (github.com/fail2ban/fail2ban/blob/master/config/jail.conf). Per-jail
 * blocks are deliberately minimal — `enabled = true` plus only the fields
 * the caller explicitly overrode — because fail2ban's shipped `jail.conf`
 * already defines each preset's filter/logpath/port internally; a
 * `jail.local` is meant to *override* that file, not restate it. Writing
 * `jail.local` (rather than editing `jail.conf` directly) is fail2ban's own
 * documented convention: `jail.conf` is replaced wholesale on package
 * upgrade, `jail.local` is not.
 */

// ===========================================================================
// DEFAULT section
// ===========================================================================

/** The pre-defined `action_*` shortcuts from jail.conf, in increasing notification detail. */
export type Fail2banActionPreset = 'banOnly' | 'banWithEmail' | 'banWithEmailAndWhois'

const actionPresetMeta: Record<Fail2banActionPreset, { directive: string; label: string; description: string }> = {
  banOnly: {
    directive: '%(action_)s',
    label: 'Ban only',
    description: 'Just ban the offending IP via the configured banaction (e.g. iptables/nftables/firewalld). No notification.',
  },
  banWithEmail: {
    directive: '%(action_mw)s',
    label: 'Ban + email with whois',
    description: 'Ban, then email destemail a report including a whois lookup of the banned IP.',
  },
  banWithEmailAndWhois: {
    directive: '%(action_mwl)s',
    label: 'Ban + email with whois and matched log lines',
    description: 'Ban, then email destemail a report including the whois lookup and the log lines that triggered the ban.',
  },
}

export function fail2banActionPresetLabel(preset: Fail2banActionPreset): string {
  return actionPresetMeta[preset].label
}
export function fail2banActionPresetDescription(preset: Fail2banActionPreset): string {
  return actionPresetMeta[preset].description
}

export const kFail2banActionPresets: Fail2banActionPreset[] = ['banOnly', 'banWithEmail', 'banWithEmailAndWhois']

/** `[DEFAULT]` section fields the builder accepts. Every field has a fail2ban-documented fallback if left blank. */
export interface Fail2banDefaults {
  /** How long a ban lasts. A bare integer is seconds; `10m`/`1h`/`1d`/`1w` suffixes are accepted; `-1` bans permanently. */
  bantime?: string
  /** Window over which `maxretry` failures must occur to trigger a ban. Same duration syntax as `bantime`. */
  findtime?: string
  /** Failures within `findtime` before a ban is issued. */
  maxretry?: string
  /** Space-separated IPs/CIDRs never banned, e.g. "127.0.0.1/8 ::1 10.0.0.0/8". */
  ignoreIp?: string
  /** Recipient for ban notification email. Only emitted (and only matters) when the action preset includes email. */
  destEmail?: string
  /** From-address for notification email. */
  sender?: string
  /** Mail transfer agent fail2ban shells out to for notifications. */
  mta?: string
  /** How fail2ban watches log files. `auto` picks pyinotify/gamin/polling by availability. */
  backend?: string
  actionPreset?: Fail2banActionPreset
}

const kDefaultBantime = '10m'
const kDefaultFindtime = '10m'
const kDefaultMaxretry = '5'
const kDefaultBackend = 'auto'
const kDefaultActionPreset: Fail2banActionPreset = 'banOnly'

/** A duration in fail2ban's own syntax: a bare non-negative integer (seconds), `-1` (permanent), or an integer with a s/m/h/d/w suffix. */
const kDurationPattern = /^-1$|^\d+[smhdw]?$/i

function validateDuration(field: string, raw: string): string {
  const value = raw.trim()
  if (!kDurationPattern.test(value)) {
    throw new Error(`${field} must be a duration like "10m", "1h", "1d", a plain second count, or "-1" for permanent (got "${raw}").`)
  }
  return value
}

function validatePositiveInteger(field: string, raw: string): string {
  const value = raw.trim()
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new Error(`${field} must be a positive whole number (got "${raw}").`)
  }
  return value
}

/** One token of `ignoreIp` is a bare IPv4/IPv6 address or a CIDR block. Deliberately permissive (no reachability/format-perfect check) — fail2ban itself just string-matches this list. */
const kIgnoreIpTokenPattern = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/

function validateIgnoreIp(raw: string): string {
  const value = raw.trim()
  if (value.length === 0) return value
  const tokens = value.split(/\s+/)
  for (const token of tokens) {
    if (!kIgnoreIpTokenPattern.test(token)) {
      throw new Error(`"${token}" in ignoreip is not a plausible IP address or CIDR block.`)
    }
  }
  return tokens.join(' ')
}

// ===========================================================================
// Jail catalog
// ===========================================================================

export type Fail2banJailCategory = 'ssh' | 'web' | 'mail' | 'ftp' | 'database'

export const fail2banJailCategoryValues: Fail2banJailCategory[] = ['ssh', 'web', 'mail', 'ftp', 'database']

export function fail2banJailCategoryLabel(category: Fail2banJailCategory): string {
  switch (category) {
    case 'ssh':
      return 'SSH'
    case 'web':
      return 'Web Servers'
    case 'mail':
      return 'Mail Servers'
    case 'ftp':
      return 'FTP'
    case 'database':
      return 'Databases'
  }
}

/**
 * One entry in the jail catalog. `id` is the literal `jail.conf` section
 * name — fail2ban's shipped config already defines that section's
 * filter/logpath/port, so a `jail.local` block only needs `enabled = true`
 * plus whatever the caller chose to override.
 */
export interface Fail2banJailPreset {
  id: string
  label: string
  description: string
  category: Fail2banJailCategory
  /** Suggested `port` value shown as a placeholder — the jail's own default from jail.conf, not written unless the caller overrides it. */
  defaultPort?: string
}

export const kFail2banJailCatalog: Fail2banJailPreset[] = [
  { id: 'sshd', label: 'sshd', description: 'Repeated failed SSH logins.', category: 'ssh', defaultPort: 'ssh' },
  {
    id: 'apache-auth',
    label: 'apache-auth',
    description: 'Failed HTTP basic-auth attempts against an Apache-protected path.',
    category: 'web',
    defaultPort: 'http,https',
  },
  {
    id: 'apache-badbots',
    label: 'apache-badbots',
    description: 'Known malicious/scraper user-agents hitting Apache.',
    category: 'web',
    defaultPort: 'http,https',
  },
  {
    id: 'apache-noscript',
    label: 'apache-noscript',
    description: 'Requests for script files the vhost does not actually serve — a common vulnerability-scanner signature.',
    category: 'web',
    defaultPort: 'http,https',
  },
  {
    id: 'nginx-http-auth',
    label: 'nginx-http-auth',
    description: 'Failed HTTP basic-auth attempts against an nginx-protected path.',
    category: 'web',
    defaultPort: 'http,https',
  },
  {
    id: 'nginx-limit-req',
    label: 'nginx-limit-req',
    description: 'Clients repeatedly hitting an nginx limit_req rate limit.',
    category: 'web',
    defaultPort: 'http,https',
  },
  {
    id: 'nginx-botsearch',
    label: 'nginx-botsearch',
    description: 'Requests probing for common exploit/admin paths (wp-login, phpmyadmin, …) against nginx.',
    category: 'web',
    defaultPort: 'http,https',
  },
  { id: 'postfix', label: 'postfix', description: 'Rejected/failed SMTP connections and relay attempts against Postfix.', category: 'mail', defaultPort: 'smtp,465,submission' },
  {
    id: 'postfix-sasl',
    label: 'postfix-sasl',
    description: 'Failed SASL authentication attempts against Postfix.',
    category: 'mail',
    defaultPort: 'smtp,465,submission,imap,imaps,pop3,pop3s',
  },
  { id: 'dovecot', label: 'dovecot', description: 'Failed IMAP/POP3 logins against Dovecot.', category: 'mail', defaultPort: 'pop3,pop3s,imap,imaps,submission,465,sieve' },
  { id: 'proftpd', label: 'proftpd', description: 'Failed FTP logins against ProFTPD.', category: 'ftp', defaultPort: 'ftp,ftp-data,ftps,ftps-data' },
  { id: 'pure-ftpd', label: 'pure-ftpd', description: 'Failed FTP logins against Pure-FTPd.', category: 'ftp', defaultPort: 'ftp,ftp-data,ftps,ftps-data' },
  { id: 'vsftpd', label: 'vsftpd', description: 'Failed FTP logins against vsftpd.', category: 'ftp', defaultPort: 'ftp,ftp-data,ftps,ftps-data' },
  { id: 'mysqld-auth', label: 'mysqld-auth', description: 'Failed authentication attempts against a network-reachable MySQL/MariaDB.', category: 'database', defaultPort: '3306' },
  { id: 'mongodb-auth', label: 'mongodb-auth', description: 'Failed authentication attempts against a network-reachable MongoDB.', category: 'database', defaultPort: '27017' },
]

export function fail2banJailPresetFor(id: string): Fail2banJailPreset | null {
  for (const preset of kFail2banJailCatalog) {
    if (preset.id === id) return preset
  }
  return null
}

/** Per-jail overrides. Every field left `undefined` inherits `[DEFAULT]` or the jail's own built-in filter/logpath/port. */
export interface Fail2banJailSelection {
  id: string
  enabled: boolean
  maxretry?: string
  bantime?: string
  port?: string
  logPath?: string
}

// ===========================================================================
// Builder
// ===========================================================================

export interface Fail2banJailConfigBuilderInput {
  defaults?: Fail2banDefaults
  jails?: Fail2banJailSelection[]
}

export const kFail2banJailConfigFileName = 'jail.local'

/**
 * Renders a `jail.local` from a `[DEFAULT]` policy plus a set of enabled
 * jails with optional per-jail overrides.
 */
export class Fail2banJailConfigBuilder implements IToolUseCase<Fail2banJailConfigBuilderInput, string> {
  execute(input: Fail2banJailConfigBuilderInput): string {
    const defaults = input.defaults ?? {}
    const jails = (input.jails ?? [])
      .filter((j) => j.enabled)
      .map((j) => ({ selection: j, preset: fail2banJailPresetFor(j.id) }))
      .filter((j): j is { selection: Fail2banJailSelection; preset: Fail2banJailPreset } => j.preset != null)

    const bantime = validateDuration('bantime', defaults.bantime?.trim() || kDefaultBantime)
    const findtime = validateDuration('findtime', defaults.findtime?.trim() || kDefaultFindtime)
    const maxretry = validatePositiveInteger('maxretry', defaults.maxretry?.trim() || kDefaultMaxretry)
    const ignoreIp = validateIgnoreIp(defaults.ignoreIp ?? '')
    const backend = (defaults.backend?.trim() || kDefaultBackend).trim()
    const actionPreset = defaults.actionPreset ?? kDefaultActionPreset

    const lines: string[] = []
    lines.push('# jail.local — generated by InfraKit Studio')
    lines.push('# Reference: https://github.com/fail2ban/fail2ban/blob/master/config/jail.conf')
    lines.push('# This overrides jail.conf, which package upgrades replace wholesale — do not edit jail.conf directly.')
    lines.push('')
    lines.push('[DEFAULT]')
    lines.push(`bantime = ${bantime}`)
    lines.push(`findtime = ${findtime}`)
    lines.push(`maxretry = ${maxretry}`)
    lines.push(`backend = ${backend}`)
    if (ignoreIp.length > 0) lines.push(`ignoreip = ${ignoreIp}`)
    lines.push(`action = ${actionPresetMeta[actionPreset].directive}`)
    if (actionPreset !== 'banOnly') {
      if (defaults.destEmail?.trim()) lines.push(`destemail = ${defaults.destEmail.trim()}`)
      if (defaults.sender?.trim()) lines.push(`sender = ${defaults.sender.trim()}`)
      if (defaults.mta?.trim()) lines.push(`mta = ${defaults.mta.trim()}`)
    }

    if (jails.length === 0) {
      lines.push('')
      lines.push('# No jails enabled — check one or more services on the left to add [section] blocks below.')
      return lines.join('\n').replace(/\s+$/, '') + '\n'
    }

    for (const { selection, preset } of jails) {
      lines.push('')
      lines.push(`[${preset.id}]`)
      lines.push('enabled = true')
      if (selection.maxretry?.trim()) lines.push(`maxretry = ${validatePositiveInteger(`${preset.id}.maxretry`, selection.maxretry)}`)
      if (selection.bantime?.trim()) lines.push(`bantime = ${validateDuration(`${preset.id}.bantime`, selection.bantime)}`)
      if (selection.port?.trim()) lines.push(`port = ${selection.port.trim()}`)
      if (selection.logPath?.trim()) lines.push(`logpath = ${selection.logPath.trim()}`)
    }

    return lines.join('\n').replace(/\s+$/, '') + '\n'
  }
}
