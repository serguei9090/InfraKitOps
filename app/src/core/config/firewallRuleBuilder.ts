/**
 * Firewall rule builder — pure TypeScript, no I/O, no React.
 *
 * Takes a structured, validated set of `FirewallRule`s plus a default policy
 * and renders them into a runnable script in one of two dialects: a `ufw`
 * command script or an `nft` ruleset file. Same rule model, two back ends —
 * so a rule set can be reviewed in whichever syntax the target host speaks.
 *
 * ## Why the lockout warning exists
 *
 * A firewall script is the one generator in this app that can permanently
 * separate a user from their own server. `ufw default deny incoming` followed
 * by `ufw enable`, with no rule permitting TCP 22, drops the very SSH session
 * that ran it and every session after it — recovery needs out-of-band console
 * access. So the builder actively checks for that combination
 * (`firewallRuleSetPermitsSsh`) and returns a `critical` warning, and every
 * generated script carries the "keep a session open, test from a second
 * terminal" caution in its header.
 *
 * ## Dialect notes baked into the renderers
 *
 * * `ufw enable` prompts interactively ("may disrupt existing ssh
 *   connections"), so the script emits `ufw --force enable`.
 * * `ufw limit` only understands TCP; a rate-limit rule on UDP is flagged.
 * * `ufw` comments are emitted single-quoted and cannot themselves contain
 *   quotes, so comment text is sanitised rather than escaped.
 * * nftables chain policies only accept `accept` or `drop` — there is no
 *   `reject` policy. A "reject by default" choice becomes `policy drop` with
 *   an explicit note.
 * * The nft ruleset opens with `flush ruleset`, which wipes tables owned by
 *   Docker, libvirt and firewalld too. That is called out as a warning.
 * * Interfaces are matched with `iifname`/`oifname` (string matching) rather
 *   than `iif`/`oif` (index matching) so the ruleset still loads when the
 *   interface does not exist yet.
 */

import type { IToolUseCase } from '../ports/IToolUseCase'

/** Which syntax the rule set is rendered into. */
export type FirewallDialect = 'ufw' | 'nftables'

interface FirewallDialectMeta {
  label: string
  description: string
  suggestedFileName: string
  fileExtension: string
}

const firewallDialectMeta: Record<FirewallDialect, FirewallDialectMeta> = {
  ufw: { label: 'UFW', description: 'ufw command script (Debian/Ubuntu)', suggestedFileName: 'apply-firewall.sh', fileExtension: 'sh' },
  nftables: { label: 'nftables', description: 'nft ruleset file (modern Linux)', suggestedFileName: 'nftables.conf', fileExtension: 'conf' },
}

export function firewallDialectSuggestedFileName(dialect: FirewallDialect): string {
  return firewallDialectMeta[dialect].suggestedFileName
}

/** What a rule (or a default policy) does with matching traffic. */
export type FirewallAction = 'allow' | 'deny' | 'reject' | 'limit'

interface FirewallActionMeta {
  ufwKeyword: string
  nftVerdict: string
  label: string
  description: string
}

const firewallActionMeta: Record<FirewallAction, FirewallActionMeta> = {
  allow: { ufwKeyword: 'allow', nftVerdict: 'accept', label: 'Allow', description: 'Permit matching traffic.' },
  deny: { ufwKeyword: 'deny', nftVerdict: 'drop', label: 'Deny (drop)', description: 'Silently drop matching traffic. Scanners see a timeout.' },
  reject: {
    ufwKeyword: 'reject',
    nftVerdict: 'reject',
    label: 'Reject',
    description: 'Refuse with an ICMP/TCP-RST error. Faster failures, but confirms the host is alive.',
  },
  limit: {
    ufwKeyword: 'limit',
    nftVerdict: 'accept',
    label: 'Rate-limit',
    description: 'Allow, but throttle repeated new connections from one source. TCP only.',
  },
}

/** Whether this action lets traffic through (used by the SSH reachability check). */
export function firewallActionPermitsTraffic(action: FirewallAction): boolean {
  return action === 'allow' || action === 'limit'
}

/** Chain policies have no rate-limiting concept. */
export function firewallActionValidAsPolicy(action: FirewallAction): boolean {
  return action !== 'limit'
}

/** Which direction the rule applies to. */
export type FirewallDirection = 'inbound' | 'outbound'

interface FirewallDirectionMeta {
  ufwKeyword: string
  nftChain: string
  label: string
  description: string
}

const firewallDirectionMeta: Record<FirewallDirection, FirewallDirectionMeta> = {
  inbound: { ufwKeyword: 'in', nftChain: 'input', label: 'Inbound', description: 'Traffic arriving at this host.' },
  outbound: { ufwKeyword: 'out', nftChain: 'output', label: 'Outbound', description: 'Traffic this host originates.' },
}

/** Layer-4 protocol selector. */
export type FirewallProtocol = 'tcp' | 'udp' | 'any'

interface FirewallProtocolMeta {
  keyword: string
  label: string
}

const firewallProtocolMeta: Record<FirewallProtocol, FirewallProtocolMeta> = {
  tcp: { keyword: 'tcp', label: 'TCP' },
  udp: { keyword: 'udp', label: 'UDP' },
  any: { keyword: 'any', label: 'TCP + UDP' },
}

/** The literal spelling in both dialects (`any` is never emitted). */
export function firewallProtocolIsSpecific(protocol: FirewallProtocol): boolean {
  return protocol !== 'any'
}

/**
 * How serious an advisory is. `critical` means "this script can lock you out
 * of the machine"; the UI is expected to render it as an error banner rather
 * than a note.
 */
export type FirewallWarningSeverity = 'critical' | 'caution'

/** A non-fatal advisory returned alongside the generated script. */
export interface FirewallWarning {
  severity: FirewallWarningSeverity
  /** Human-readable text, safe to show verbatim. */
  message: string
  /** Stable machine-readable identifier, so tests and the UI can assert on a specific advisory without string matching. */
  code: string
}

/** Emitted when the default incoming policy blocks traffic and no rule permits inbound SSH. The lockout case. */
export const sshLockoutCode = 'ssh-lockout'
/** Emitted when the default incoming policy is `allow`. */
export const openByDefaultCode = 'open-by-default'
/** Emitted for the nftables `flush ruleset` line. */
export const flushRulesetCode = 'flush-ruleset'
/** Emitted when a rate-limit rule is not TCP. */
export const limitNotTcpCode = 'limit-not-tcp'
/** Emitted when a rule mixes an IPv4 and an IPv6 address. */
export const addressFamilyMismatchCode = 'address-family-mismatch'
/** Emitted when the rule list is empty. */
export const noRulesCode = 'no-rules'
/** Emitted when nftables silently downgrades a `reject` policy to `drop`. */
export const rejectPolicyCode = 'reject-policy-downgraded'

/**
 * A single port, or an inclusive port range.
 *
 * Validated on construction, so an out-of-range or inverted range can never
 * reach a renderer. The two dialects spell ranges differently — `22:25` for
 * ufw (iptables heritage) and `22-25` for nft — which is exactly the kind of
 * difference this type exists to hide.
 */
export class PortRange {
  readonly start: number
  readonly end: number

  constructor(start: number, end: number) {
    checkPort(start, 'start')
    checkPort(end, 'end')
    if (start > end) {
      throw new Error(`Port range start (${start}) must not be greater than its end (${end}).`)
    }
    this.start = start
    this.end = end
  }

  static single(port: number): PortRange {
    return new PortRange(port, port)
  }

  /** Parses `"22"`, `"8000:8010"` or `"8000-8010"`. Throws on anything else. */
  static parse(raw: string): PortRange {
    const text = raw.trim()
    if (text.length === 0) {
      throw new Error('Port must not be empty. Use a port such as 22, or a range such as 8000-8010.')
    }
    const parts = text.split(/[:-]/)
    if (parts.length === 1) {
      return PortRange.single(parsePort(parts[0], text))
    }
    if (parts.length === 2) {
      return new PortRange(parsePort(parts[0], text), parsePort(parts[1], text))
    }
    throw new Error(`"${raw}" is not a port or a port range (expected 22, 8000:8010 or 8000-8010).`)
  }

  get isSingle(): boolean {
    return this.start === this.end
  }

  contains(port: number): boolean {
    return port >= this.start && port <= this.end
  }

  /** ufw/iptables spelling: `8000:8010`. */
  get ufwText(): string {
    return this.isSingle ? `${this.start}` : `${this.start}:${this.end}`
  }

  /** nftables spelling: `8000-8010`. */
  get nftText(): string {
    return this.isSingle ? `${this.start}` : `${this.start}-${this.end}`
  }

  toString(): string {
    return this.nftText
  }

  equals(other: PortRange): boolean {
    return other.start === this.start && other.end === this.end
  }
}

function parsePort(raw: string, context: string): number {
  const trimmed = raw.trim()
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`"${context}" is not a valid port (expected a whole number between 1 and 65535).`)
  }
  const parsed = Number.parseInt(trimmed, 10)
  checkPort(parsed, 'port')
  return parsed
}

function checkPort(port: number, name: string): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`"${name}" (${port}): Ports must be between 1 and 65535`)
  }
}

/**
 * One firewall rule, dialect-independent.
 *
 * `undefined` for `ports`, `source`, `destination` and `interfaceName` means
 * "any" — the renderers omit the corresponding match entirely rather than
 * emitting a restated default.
 */
export interface FirewallRule {
  action: FirewallAction
  direction?: FirewallDirection
  protocol?: FirewallProtocol
  /** Destination port or port range. Undefined means every port. */
  ports?: PortRange
  /** Source address or CIDR, e.g. `10.0.0.0/8` or `2001:db8::/32`. Undefined (or `any`) means every source. */
  source?: string
  /** Destination address or CIDR. Undefined means every destination. */
  destination?: string
  /** Interface name, e.g. `eth0`. Undefined means every interface. */
  interfaceName?: string
  /** Free-text comment. Quotes and newlines are stripped before emission. */
  comment?: string
  /** Log packets matching this rule. */
  logged?: boolean
}

function ruleDirection(rule: FirewallRule): FirewallDirection {
  return rule.direction ?? 'inbound'
}
function ruleProtocol(rule: FirewallRule): FirewallProtocol {
  return rule.protocol ?? 'tcp'
}
function ruleLogged(rule: FirewallRule): boolean {
  return rule.logged ?? false
}

/**
 * Whether this rule permits inbound traffic to `port` over TCP — the test
 * used by the SSH lockout check.
 */
export function firewallRulePermitsInboundTcpPort(rule: FirewallRule, port: number): boolean {
  return (
    ruleDirection(rule) === 'inbound' &&
    firewallActionPermitsTraffic(rule.action) &&
    (ruleProtocol(rule) === 'tcp' || ruleProtocol(rule) === 'any') &&
    (rule.ports == null || rule.ports.contains(port))
  )
}

/**
 * Default policy for each chain/direction. Always-present by design: a
 * firewall always has a default, and pretending otherwise is how people end
 * up with an accidentally open box.
 */
export interface FirewallPolicy {
  incoming?: FirewallAction
  outgoing?: FirewallAction
  /**
   * Routed traffic. Only rendered in the nftables dialect (ufw's `default`
   * command manages it separately and most single hosts never route).
   */
  forward?: FirewallAction
}

function policyIncoming(policy: FirewallPolicy): FirewallAction {
  return policy.incoming ?? 'deny'
}
function policyOutgoing(policy: FirewallPolicy): FirewallAction {
  return policy.outgoing ?? 'allow'
}
function policyForward(policy: FirewallPolicy): FirewallAction {
  return policy.forward ?? 'deny'
}

/** True when inbound traffic is blocked unless a rule permits it. */
function policyBlocksIncomingByDefault(policy: FirewallPolicy): boolean {
  return !firewallActionPermitsTraffic(policyIncoming(policy))
}

/** A one-click "open this well-known service" entry for the UI. */
export interface FirewallServicePreset {
  label: string
  port: number
  protocol: FirewallProtocol
  description: string
  /** Extra caution shown when this service is usually *not* meant to face the internet. */
  exposureNote?: string
}

/** Builds the rule this preset stands for. */
export function firewallPresetToRule(
  preset: FirewallServicePreset,
  opts: { action?: FirewallAction; direction?: FirewallDirection; source?: string } = {},
): FirewallRule {
  return {
    action: opts.action ?? 'allow',
    direction: opts.direction ?? 'inbound',
    protocol: preset.protocol,
    ports: PortRange.single(preset.port),
    source: opts.source,
    comment: preset.label,
  }
}

/** Common services offered as one-click rule additions. */
export const kFirewallServicePresets: FirewallServicePreset[] = [
  { label: 'SSH', port: 22, protocol: 'tcp', description: 'Remote shell. Add this before enabling a deny-by-default firewall.' },
  {
    label: 'HTTP',
    port: 80,
    protocol: 'tcp',
    description: 'Plain web traffic. Usually kept open only to redirect to HTTPS or to answer ACME challenges.',
  },
  { label: 'HTTPS', port: 443, protocol: 'tcp', description: 'TLS web traffic. Also QUIC/HTTP-3 if you additionally open UDP 443.' },
  {
    label: 'DNS',
    port: 53,
    protocol: 'any',
    description: 'DNS uses UDP 53 with a TCP 53 fallback for large answers and zone transfers.',
    exposureNote: 'An internet-facing open resolver will be abused for amplification attacks. Restrict the source.',
  },
  { label: 'NTP', port: 123, protocol: 'udp', description: 'Network time. Clients need this outbound; only a time *server* needs it inbound.' },
  {
    label: 'PostgreSQL',
    port: 5432,
    protocol: 'tcp',
    description: 'PostgreSQL wire protocol.',
    exposureNote: 'Databases should not be internet-reachable. Restrict the source to your app subnet.',
  },
  {
    label: 'MySQL',
    port: 3306,
    protocol: 'tcp',
    description: 'MySQL / MariaDB wire protocol.',
    exposureNote: 'Databases should not be internet-reachable. Restrict the source to your app subnet.',
  },
  {
    label: 'Redis',
    port: 6379,
    protocol: 'tcp',
    description: 'Redis. Unauthenticated by default in many builds.',
    exposureNote: 'An exposed Redis is a well-known remote-code-execution path. Bind to localhost if you can.',
  },
]

/** The `FirewallServicePreset` whose label is `label`, or null. */
export function firewallPresetFor(label: string): FirewallServicePreset | null {
  for (const preset of kFirewallServicePresets) {
    if (preset.label.toLowerCase() === label.toLowerCase()) return preset
  }
  return null
}

/** Everything the builder needs to render a script. */
export interface FirewallRuleSetInput {
  dialect?: FirewallDialect
  /** Rules in the order they should be evaluated. */
  rules?: FirewallRule[]
  policy?: FirewallPolicy
  /** The port SSH actually listens on, for the lockout check. */
  sshPort?: number
  /** Emit the explanatory/caution header comment. */
  includeHeader?: boolean
  /** nftables only: emit `iif "lo" accept`. ufw permits loopback itself. */
  allowLoopback?: boolean
  /** nftables only: emit the conntrack established/related accept. */
  allowEstablished?: boolean
  /** nftables only: accept ICMP and ICMPv6. */
  allowIcmp?: boolean
}

/** The rendered script plus its advisories. */
export interface FirewallScriptResult {
  /** The full script text, ready to save and run. */
  script: string
  /** `apply-firewall.sh` or `nftables.conf`, for the save dialog. */
  suggestedFileName: string
  /** How many user rules were rendered (excludes scaffolding lines). */
  ruleCount: number
  /** Non-fatal advisories, most severe first. */
  warnings: FirewallWarning[]
  /** True when at least one advisory can lock the user out. */
  hasCriticalWarning: boolean
}

/**
 * Whether `rules` contain anything that would let an inbound SSH connection
 * to `sshPort` through.
 *
 * Deliberately optimistic about the source address: a rule restricted to
 * `10.0.0.0/8` still counts, because the builder cannot know where the user
 * is connecting from. It is pessimistic about everything it *can* check —
 * direction, action, protocol and port.
 */
export function firewallRuleSetPermitsSsh(rules: FirewallRule[], sshPort: number = 22): boolean {
  return rules.some((rule) => firewallRulePermitsInboundTcpPort(rule, sshPort))
}

/** The standard "do not lock yourself out" caution, emitted into every script header and reusable by the UI. */
export const kFirewallTestingCaution =
  'Keep your existing SSH session open and test the new rules from a SECOND ' +
  'terminal before you trust them. If this ruleset is wrong, the only way ' +
  'back in is out-of-band console/KVM access.'

const TAB = '\t'

/**
 * Renders a validated `FirewallRuleSetInput` into a `ufw` script or an `nft`
 * ruleset.
 *
 * Pure text generation, no filesystem and no privileged calls: running the
 * result is the operator's job, deliberately.
 *
 * Every address, port, interface and policy is validated before emission, so
 * a malformed CIDR or an out-of-range port can never reach the output. Those
 * throw. Things that are *legal but dangerous* — no SSH rule under a
 * deny-by-default policy, an allow-by-default policy, `flush ruleset` — come
 * back as `FirewallScriptResult.warnings` instead.
 */
export class FirewallRuleBuilder implements IToolUseCase<FirewallRuleSetInput, FirewallScriptResult> {
  execute(input: FirewallRuleSetInput): FirewallScriptResult {
    const dialect = input.dialect ?? 'ufw'
    const rules = input.rules ?? []
    const policy = input.policy ?? {}
    const sshPort = input.sshPort ?? 22
    const includeHeader = input.includeHeader ?? true
    const allowLoopback = input.allowLoopback ?? true
    const allowEstablished = input.allowEstablished ?? true
    const allowIcmp = input.allowIcmp ?? true

    this.validatePolicy(policy)
    if (sshPort < 1 || sshPort > 65535) {
      throw new Error('sshPort: Must be between 1 and 65535')
    }
    for (const rule of rules) {
      this.validateRule(rule)
    }

    const resolvedInput: Required<FirewallRuleSetInput> = {
      dialect,
      rules,
      policy,
      sshPort,
      includeHeader,
      allowLoopback,
      allowEstablished,
      allowIcmp,
    }

    const warnings = this.collectWarnings(resolvedInput)

    const script = dialect === 'ufw' ? this.renderUfw(resolvedInput) : this.renderNft(resolvedInput)

    return {
      script,
      suggestedFileName: firewallDialectSuggestedFileName(dialect),
      ruleCount: rules.length,
      warnings,
      hasCriticalWarning: warnings.some((w) => w.severity === 'critical'),
    }
  }

  // ------------------------------------------------------------------
  // Validation
  // ------------------------------------------------------------------

  private validatePolicy(policy: FirewallPolicy): void {
    const entries: Array<[string, FirewallAction]> = [
      ['incoming', policyIncoming(policy)],
      ['outgoing', policyOutgoing(policy)],
      ['forward', policyForward(policy)],
    ]
    for (const [key, action] of entries) {
      if (!firewallActionValidAsPolicy(action)) {
        throw new Error(`Default ${key} policy cannot be "${firewallActionMeta[action].ufwKeyword}" — a policy has no rate limit.`)
      }
    }
  }

  private validateRule(rule: FirewallRule): void {
    if (rule.source != null) this.requireCidr(rule.source, 'source')
    if (rule.destination != null) this.requireCidr(rule.destination, 'destination')
    if (rule.interfaceName != null) {
      const name = rule.interfaceName.trim()
      if (name.length === 0) {
        throw new Error('Interface name must not be blank — leave it unset for "any interface".')
      }
      if (!/^[A-Za-z0-9_.:@+-]{1,32}$/.test(name)) {
        throw new Error(`"${name}" is not a valid interface name (letters, digits and . _ - : @ + only, max 32 characters).`)
      }
    }
  }

  private requireCidr(raw: string, field: string): void {
    if (!isAnyAddress(raw) && !isValidCidr(raw)) {
      throw new Error(`"${raw}" is not a valid ${field} address or CIDR block (expected e.g. 10.0.0.0/8, 192.168.1.5 or 2001:db8::/32).`)
    }
  }

  // ------------------------------------------------------------------
  // Warnings
  // ------------------------------------------------------------------

  private collectWarnings(input: Required<FirewallRuleSetInput>): FirewallWarning[] {
    const warnings: FirewallWarning[] = []

    // The one that matters: deny-by-default with no way back in.
    if (policyBlocksIncomingByDefault(input.policy) && !firewallRuleSetPermitsSsh(input.rules, input.sshPort)) {
      warnings.push({
        severity: 'critical',
        code: sshLockoutCode,
        message:
          `LOCKOUT RISK: the default incoming policy is "${firewallActionMeta[policyIncoming(input.policy)].ufwKeyword}" and no rule permits ` +
          `inbound TCP ${input.sshPort} (SSH). Applying this over an SSH session will drop that session and every ` +
          `session after it. Add an allow rule for TCP ${input.sshPort} — or be certain you have console/KVM access.`,
      })
    }

    if (!policyBlocksIncomingByDefault(input.policy)) {
      warnings.push({
        severity: 'caution',
        code: openByDefaultCode,
        message:
          'The default incoming policy is "allow": every port stays reachable unless a rule explicitly blocks it. ' +
          'Deny-by-default is the safer posture for anything internet-facing.',
      })
    }

    if (input.rules.length === 0) {
      warnings.push({
        severity: 'caution',
        code: noRulesCode,
        message: 'No rules defined — the generated script only sets default policies.',
      })
    }

    for (let i = 0; i < input.rules.length; i++) {
      const rule = input.rules[i]
      const commentSuffix = rule.comment != null && rule.comment.trim().length > 0 ? ` (${sanitizeComment(rule.comment)})` : ''
      const label = `Rule ${i + 1}${commentSuffix}`

      if (rule.action === 'limit' && ruleProtocol(rule) !== 'tcp') {
        warnings.push({
          severity: 'caution',
          code: limitNotTcpCode,
          message: `${label}: rate-limiting only applies to TCP. \`ufw limit\` rejects a non-TCP rule outright.`,
        })
      }

      const srcV6 = rule.source != null && !isAnyAddress(rule.source) && isIpv6Cidr(rule.source)
      const dstV6 = rule.destination != null && !isAnyAddress(rule.destination) && isIpv6Cidr(rule.destination)
      const srcSet = rule.source != null && !isAnyAddress(rule.source)
      const dstSet = rule.destination != null && !isAnyAddress(rule.destination)
      if (srcSet && dstSet && srcV6 !== dstV6) {
        warnings.push({
          severity: 'caution',
          code: addressFamilyMismatchCode,
          message: `${label}: mixes an IPv4 and an IPv6 address. Such a rule can never match — split it into two rules.`,
        })
      }
    }

    if (input.dialect === 'nftables') {
      warnings.push({
        severity: 'caution',
        code: flushRulesetCode,
        message:
          'The ruleset starts with `flush ruleset`, which removes EVERY existing nftables table — including the ' +
          'ones Docker, libvirt, Kubernetes and firewalld manage for themselves.',
      })
      if (policyIncoming(input.policy) === 'reject' || policyForward(input.policy) === 'reject') {
        warnings.push({
          severity: 'caution',
          code: rejectPolicyCode,
          message:
            'nftables chain policies accept only `accept` or `drop`, so a "reject" default is rendered as ' +
            '`policy drop`. Add an explicit trailing `reject` rule if you need the ICMP error.',
        })
      }
    }

    warnings.sort((a, b) => severityIndex(a.severity) - severityIndex(b.severity))
    return warnings
  }

  // ------------------------------------------------------------------
  // UFW
  // ------------------------------------------------------------------

  private renderUfw(input: Required<FirewallRuleSetInput>): string {
    const lines: string[] = []

    if (input.includeHeader) {
      lines.push('#!/usr/bin/env bash')
      lines.push('#')
      lines.push('# UFW firewall script — generated by InfraKit Studio')
      lines.push('#')
      for (const line of wrapComment(kFirewallTestingCaution)) {
        lines.push(`# ${line}`)
      }
      lines.push('#')
      lines.push('# Review before enabling:  ufw status numbered')
      lines.push('# Undo everything:         ufw --force reset')
      lines.push('#')
      lines.push('# Run as root. Rules are appended in the order below and ufw evaluates')
      lines.push('# them first-match-wins, so put the specific ones first.')
      lines.push('#')
      lines.push('set -euo pipefail')
      lines.push('')
    }

    lines.push('# Default policies')
    lines.push(`ufw default ${firewallActionMeta[policyIncoming(input.policy)].ufwKeyword} incoming`)
    lines.push(`ufw default ${firewallActionMeta[policyOutgoing(input.policy)].ufwKeyword} outgoing`)

    if (input.rules.length > 0) {
      lines.push('')
      lines.push('# Rules')
      for (const rule of input.rules) {
        lines.push(FirewallRuleBuilder.ufwRuleCommand(rule))
      }
    }

    lines.push('')
    lines.push('# `ufw enable` asks for confirmation because it can disrupt live SSH')
    lines.push('# sessions; --force answers yes non-interactively.')
    lines.push('ufw --force enable')
    lines.push('ufw status verbose')
    return lines.join('\n') + '\n'
  }

  /** The single `ufw` command line for `rule`. Public so the UI can preview a row without rendering the whole script. */
  static ufwRuleCommand(rule: FirewallRule): string {
    const tokens: string[] = ['ufw', firewallActionMeta[rule.action].ufwKeyword, firewallDirectionMeta[ruleDirection(rule)].ufwKeyword]

    if (rule.interfaceName != null) {
      tokens.push('on', rule.interfaceName.trim())
    }
    if (ruleLogged(rule)) {
      tokens.push('log')
    }
    if (firewallProtocolIsSpecific(ruleProtocol(rule))) {
      tokens.push('proto', firewallProtocolMeta[ruleProtocol(rule)].keyword)
    }

    const source = normalizeAddress(rule.source) ?? 'any'
    const destination = normalizeAddress(rule.destination) ?? 'any'
    tokens.push('from', source, 'to', destination)

    if (rule.ports != null) {
      tokens.push('port', rule.ports.ufwText)
    }

    const comment = sanitizeComment(rule.comment)
    if (comment != null) {
      tokens.push('comment', `'${comment}'`)
    }

    return tokens.join(' ')
  }

  // ------------------------------------------------------------------
  // nftables
  // ------------------------------------------------------------------

  private renderNft(input: Required<FirewallRuleSetInput>): string {
    const lines: string[] = []

    if (input.includeHeader) {
      lines.push('#!/usr/sbin/nft -f')
      lines.push('#')
      lines.push('# nftables ruleset — generated by InfraKit Studio')
      lines.push('#')
      for (const line of wrapComment(kFirewallTestingCaution)) {
        lines.push(`# ${line}`)
      }
      lines.push('#')
      lines.push('# Syntax-check first:  nft -c -f nftables.conf')
      lines.push('# Load:                nft -f nftables.conf')
      lines.push('# Inspect:             nft list ruleset')
      lines.push('#')
      lines.push('# `flush ruleset` below removes EVERY existing table, including those')
      lines.push('# managed by Docker, libvirt, Kubernetes or firewalld.')
      lines.push('#')
    }

    lines.push('flush ruleset')
    lines.push('')
    lines.push('table inet filter {')

    // input
    lines.push(`${TAB}chain input {`)
    lines.push(`${TAB}${TAB}type filter hook input priority 0; policy ${nftPolicy(policyIncoming(input.policy))};`)
    const preamble = this.nftInputPreamble(input)
    if (preamble.length > 0) {
      lines.push('')
      for (const line of preamble) lines.push(`${TAB}${TAB}${line}`)
    }
    const inbound = input.rules.filter((r) => ruleDirection(r) === 'inbound')
    if (inbound.length > 0) {
      lines.push('')
      for (const line of this.nftRuleBlock(inbound)) lines.push(`${TAB}${TAB}${line}`)
    }
    lines.push(`${TAB}}`)
    lines.push('')

    // forward
    lines.push(`${TAB}chain forward {`)
    lines.push(`${TAB}${TAB}type filter hook forward priority 0; policy ${nftPolicy(policyForward(input.policy))};`)
    lines.push(`${TAB}}`)
    lines.push('')

    // output
    lines.push(`${TAB}chain output {`)
    lines.push(`${TAB}${TAB}type filter hook output priority 0; policy ${nftPolicy(policyOutgoing(input.policy))};`)
    const outbound = input.rules.filter((r) => ruleDirection(r) === 'outbound')
    if (outbound.length > 0) {
      lines.push('')
      for (const line of this.nftRuleBlock(outbound)) lines.push(`${TAB}${TAB}${line}`)
    }
    lines.push(`${TAB}}`)
    lines.push('}')
    return lines.join('\n') + '\n'
  }

  private nftInputPreamble(input: Required<FirewallRuleSetInput>): string[] {
    const lines: string[] = []
    if (input.allowEstablished) {
      lines.push('# Replies to connections this host started. Without this, a policy-drop')
      lines.push('# input chain also breaks DNS, package updates and outbound HTTPS.')
      lines.push('ct state established,related accept')
      lines.push('ct state invalid drop')
    }
    if (input.allowLoopback) {
      if (lines.length > 0) lines.push('')
      lines.push('# Local services talk to each other over loopback.')
      lines.push('iif "lo" accept')
    }
    if (input.allowIcmp) {
      if (lines.length > 0) lines.push('')
      lines.push('# ICMP: dropping ICMPv6 neighbour discovery breaks IPv6 entirely,')
      lines.push('# dropping ICMP breaks path MTU discovery.')
      lines.push('ip protocol icmp accept')
      lines.push('ip6 nexthdr ipv6-icmp accept')
    }
    return lines
  }

  private nftRuleBlock(rules: FirewallRule[]): string[] {
    const lines: string[] = []
    for (const rule of rules) {
      if (rule.action === 'limit') {
        lines.push('# Rate limit approximates `ufw limit` (6 new connections / 30s per source).')
      }
      lines.push(FirewallRuleBuilder.nftRuleStatement(rule))
    }
    return lines
  }

  /** The single nft rule statement for `rule`, without indentation. Public so the UI can preview a row. */
  static nftRuleStatement(rule: FirewallRule): string {
    const tokens: string[] = []

    if (rule.interfaceName != null) {
      const key = ruleDirection(rule) === 'inbound' ? 'iifname' : 'oifname'
      tokens.push(`${key} "${rule.interfaceName.trim()}"`)
    }

    const source = normalizeAddress(rule.source)
    if (source != null) {
      tokens.push(`${isIpv6Cidr(source) ? 'ip6' : 'ip'} saddr ${source}`)
    }
    const destination = normalizeAddress(rule.destination)
    if (destination != null) {
      tokens.push(`${isIpv6Cidr(destination) ? 'ip6' : 'ip'} daddr ${destination}`)
    }

    const ports = rule.ports
    const protocol = ruleProtocol(rule)
    if (ports != null) {
      if (protocol === 'tcp' || protocol === 'udp') {
        tokens.push(`${firewallProtocolMeta[protocol].keyword} dport ${ports.nftText}`)
      } else {
        // `th dport` matches the transport header of whichever of the two
        // protocols l4proto selected.
        tokens.push(`meta l4proto { tcp, udp } th dport ${ports.nftText}`)
      }
    } else if (firewallProtocolIsSpecific(protocol)) {
      tokens.push(`meta l4proto ${firewallProtocolMeta[protocol].keyword}`)
    }

    if (rule.action === 'limit') {
      tokens.push('ct state new limit rate 6/minute burst 6 packets')
    }

    if (ruleLogged(rule)) {
      tokens.push(`log prefix "${nftLogPrefix(rule)}" level info`)
    }

    tokens.push(firewallActionMeta[rule.action].nftVerdict)

    const comment = sanitizeComment(rule.comment)
    if (comment != null) {
      tokens.push(`comment "${comment}"`)
    }

    return tokens.join(' ')
  }
}

function nftPolicy(action: FirewallAction): string {
  return firewallActionPermitsTraffic(action) ? 'accept' : 'drop'
}

function nftLogPrefix(rule: FirewallRule): string {
  const comment = sanitizeComment(rule.comment)
  const base = comment ?? `${firewallDirectionMeta[ruleDirection(rule)].ufwKeyword}-${firewallActionMeta[rule.action].ufwKeyword}`
  // nft caps log prefixes at 127 characters; keep well under it.
  const trimmed = base.length > 48 ? base.substring(0, 48) : base
  return `${trimmed.replace(/\s+/g, '-')} `
}

function severityIndex(severity: FirewallWarningSeverity): number {
  return severity === 'critical' ? 0 : 1
}

/** Trims an address, and maps the "no restriction" spellings to null so the renderers can omit the match entirely. */
function normalizeAddress(raw: string | undefined): string | null {
  if (raw == null) return null
  const text = raw.trim()
  if (text.length === 0 || isAnyAddress(text)) return null
  return text
}

/** Strips the characters neither dialect can carry inside its own comment syntax. Returns null when nothing usable is left. */
function sanitizeComment(raw: string | undefined): string | null {
  if (raw == null) return null
  const text = raw
    .replace(/['"\\\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length === 0 ? null : text
}

function wrapComment(text: string, width: number = 72): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (current.length === 0) {
      current = word
    } else if (current.length + 1 + word.length <= width) {
      current += ` ${word}`
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current.length > 0) lines.push(current)
  return lines
}

// ----------------------------------------------------------------------
// Address validation (pure, reusable by the UI for inline field errors)
// ----------------------------------------------------------------------

/** The spellings that mean "no address restriction". */
export function isAnyAddress(raw: string): boolean {
  const text = raw.trim().toLowerCase()
  return text.length === 0 || text === 'any' || text === '0.0.0.0/0' || text === '::/0'
}

/** True when `raw` is a valid IPv4 or IPv6 address, with an optional prefix length. */
export function isValidCidr(raw: string): boolean {
  return parseCidr(raw) != null
}

/** True when `raw` is an IPv6 address/CIDR (as opposed to IPv4). */
export function isIpv6Cidr(raw: string): boolean {
  return parseCidr(raw)?.isV6 ?? raw.includes(':')
}

interface ParsedCidr {
  isV6: boolean
  prefix: number
}

function parseCidr(raw: string): ParsedCidr | null {
  const text = raw.trim()
  if (text.length === 0) return null

  const slash = text.indexOf('/')
  const address = slash < 0 ? text : text.substring(0, slash)
  const prefixText = slash < 0 ? null : text.substring(slash + 1)

  const isV6 = address.includes(':')
  const maxPrefix = isV6 ? 128 : 32

  let prefix = maxPrefix
  if (prefixText != null) {
    if (prefixText.length === 0 || prefixText.length > 3) return null
    if (!/^\d+$/.test(prefixText)) return null
    const parsed = Number.parseInt(prefixText, 10)
    if (Number.isNaN(parsed) || parsed < 0 || parsed > maxPrefix) return null
    prefix = parsed
  }

  const valid = isV6 ? isValidIpv6(address) : isValidIpv4(address)
  return valid ? { isV6, prefix } : null
}

function isValidIpv4(address: string): boolean {
  const parts = address.split('.')
  if (parts.length !== 4) return false
  for (const part of parts) {
    if (part.length === 0 || part.length > 3) return false
    if (!/^\d+$/.test(part)) return false
    // Reject "010" — a leading zero reads as octal to some parsers and as
    // decimal to others, which is exactly how firewall rules end up matching
    // an address nobody intended.
    if (part.length > 1 && part.startsWith('0')) return false
    const value = Number.parseInt(part, 10)
    if (value > 255) return false
  }
  return true
}

function isValidIpv6(address: string): boolean {
  if (address.includes(':::')) return false

  const doubleColon = address.indexOf('::')
  if (doubleColon !== address.lastIndexOf('::')) return false

  let head: string[]
  let tail: string[]
  if (doubleColon < 0) {
    head = address.split(':')
    tail = []
  } else {
    const headText = address.substring(0, doubleColon)
    const tailText = address.substring(doubleColon + 2)
    if (headText.endsWith(':') || tailText.startsWith(':')) return false
    head = headText.length === 0 ? [] : headText.split(':')
    tail = tailText.length === 0 ? [] : tailText.split(':')
  }

  const groups = [...head, ...tail]
  if (groups.length === 0) return doubleColon >= 0 // "::" itself.

  let count = groups.length

  // A trailing dotted quad (IPv4-mapped form) occupies two 16-bit groups.
  const last = groups[groups.length - 1]
  if (last.includes('.')) {
    if (!isValidIpv4(last)) return false
    count += 1
    groups.pop()
  }

  for (const group of groups) {
    if (group.length === 0 || group.length > 4) return false
    if (!/^[0-9A-Fa-f]+$/.test(group)) return false
  }

  return doubleColon < 0 ? count === 8 : count < 8
}
