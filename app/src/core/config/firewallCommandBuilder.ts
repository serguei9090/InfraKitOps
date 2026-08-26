/**
 * Firewall command builder — pure TypeScript, no I/O, no React.
 *
 * Unlike `FirewallRuleBuilder` (a whole-policy `ufw`/`nftables` script), this
 * builder is per-rule: pick a target (`FirewallCmdProvider`) and get back a
 * single apply command and its exact undo command, so a rule can be tried,
 * copy-pasted and reversed one at a time across Linux, Windows and the big
 * three clouds.
 *
 * ## AWS Security Groups are allow-only
 *
 * Unlike every other target here, an AWS security group has no "deny" rule
 * concept — it is an allow-list with an implicit deny for everything else.
 * Denying traffic on AWS means a Network ACL, a different resource this
 * builder does not generate. So a `deny` action against
 * `awsSecurityGroup` does not emit a (wrong) command — it emits an
 * explanatory comment plus a caution warning, the same warning-list
 * convention `FirewallRuleBuilder` uses for its own advisories.
 */

import type { PortRange, FirewallDirection, FirewallProtocol, FirewallWarning } from './firewallRuleBuilder'

/** Which target syntax a rule is rendered into. */
export type FirewallCmdProvider =
  | 'iptables'
  | 'firewalld'
  | 'ufw'
  | 'windowsPowerShell'
  | 'windowsNetsh'
  | 'awsSecurityGroup'
  | 'gcpFirewall'
  | 'azureNsg'

interface FirewallCmdProviderMeta {
  label: string
  /** UI grouping: "Linux", "Windows" or "Cloud". */
  group: 'Linux' | 'Windows' | 'Cloud'
  description: string
}

const firewallCmdProviderMeta: Record<FirewallCmdProvider, FirewallCmdProviderMeta> = {
  iptables: { label: 'iptables', group: 'Linux', description: 'Raw netfilter rules via the iptables CLI.' },
  firewalld: { label: 'firewalld', group: 'Linux', description: 'Rich rules via firewall-cmd (RHEL/CentOS/Fedora default).' },
  ufw: { label: 'ufw', group: 'Linux', description: 'Uncomplicated Firewall one-liners (Debian/Ubuntu default).' },
  windowsPowerShell: {
    label: 'Windows PowerShell',
    group: 'Windows',
    description: 'New-NetFirewallRule / Remove-NetFirewallRule cmdlets.',
  },
  windowsNetsh: { label: 'Windows netsh', group: 'Windows', description: 'Legacy netsh advfirewall firewall commands.' },
  awsSecurityGroup: {
    label: 'AWS Security Group',
    group: 'Cloud',
    description: 'aws ec2 authorize/revoke-security-group-* (allow-only).',
  },
  gcpFirewall: { label: 'GCP Firewall Rule', group: 'Cloud', description: 'gcloud compute firewall-rules create/delete.' },
  azureNsg: { label: 'Azure NSG Rule', group: 'Cloud', description: 'az network nsg rule create/delete.' },
}

export function firewallCmdProviderLabel(provider: FirewallCmdProvider): string {
  return firewallCmdProviderMeta[provider].label
}
export function firewallCmdProviderGroup(provider: FirewallCmdProvider): 'Linux' | 'Windows' | 'Cloud' {
  return firewallCmdProviderMeta[provider].group
}
export function firewallCmdProviderDescription(provider: FirewallCmdProvider): string {
  return firewallCmdProviderMeta[provider].description
}

/** AWS security groups cannot express "deny" — see the module doc comment. */
export function firewallCmdProviderSupportsDeny(provider: FirewallCmdProvider): boolean {
  return provider !== 'awsSecurityGroup'
}

/** Whether this target identifies a rule by a name rather than by its match criteria. */
export function firewallCmdProviderNeedsRuleName(provider: FirewallCmdProvider): boolean {
  return provider === 'windowsPowerShell' || provider === 'windowsNetsh' || provider === 'gcpFirewall' || provider === 'azureNsg'
}

/** Azure NSG rules are evaluated in priority order and require one. */
export function firewallCmdProviderNeedsPriority(provider: FirewallCmdProvider): boolean {
  return provider === 'azureNsg'
}

/** Cloud targets need account/resource context beyond the rule itself. */
export function firewallCmdProviderNeedsGroupContext(provider: FirewallCmdProvider): boolean {
  return provider === 'awsSecurityGroup' || provider === 'gcpFirewall' || provider === 'azureNsg'
}

export function firewallCmdProviderIsCloud(provider: FirewallCmdProvider): boolean {
  return firewallCmdProviderMeta[provider].group === 'Cloud'
}

/**
 * What the rule does with matching traffic. Deliberately narrower than
 * `FirewallRuleBuilder`'s `FirewallAction` — `reject`/`limit` do not have a
 * clean one-liner across all 8 targets here.
 */
export type FirewallCmdAction = 'allow' | 'deny'

/**
 * Account/subscription-level context shared by every rule rendered for a
 * cloud `FirewallCmdProvider`. Ignored by Linux/Windows providers.
 */
export interface FirewallCmdContext {
  provider: FirewallCmdProvider
  /** AWS security group id, e.g. `sg-0123456789abcdef0`. */
  groupId?: string
  /** Azure resource group name. */
  resourceGroup?: string
  /** Azure NSG name. */
  nsgName?: string
  /** GCP VPC network name. Defaults to `default` when blank. */
  network?: string
}

/** One firewall rule, provider-independent. */
export interface FirewallCmdRule {
  action: FirewallCmdAction
  direction?: FirewallDirection
  protocol?: FirewallProtocol
  /** Destination port or port range. Undefined means every port. */
  ports?: PortRange
  /** Source address or CIDR, e.g. `10.0.0.0/8`. Undefined (or `any`) means every source. */
  source?: string
  /** Rule/display name — required spelling for Windows/GCP/Azure. When blank, a name is generated from the rule's shape. */
  ruleName?: string
  /** Azure NSG rule priority (100-4096, lower evaluates first). */
  priority?: number
  comment?: string
}

function ruleDirection(rule: FirewallCmdRule): FirewallDirection {
  return rule.direction ?? 'inbound'
}
function ruleProtocol(rule: FirewallCmdRule): FirewallProtocol {
  return rule.protocol ?? 'tcp'
}
function protocolIsSpecific(protocol: FirewallProtocol): boolean {
  return protocol !== 'any'
}
function protocolKeyword(protocol: FirewallProtocol): string {
  return protocol
}

/**
 * The rendered result for one rule against one `FirewallCmdContext`: the
 * command that applies it, the command that undoes it, and any advisories.
 */
export interface FirewallCommand {
  addCommand: string
  deleteCommand: string
  warnings: FirewallWarning[]
}

/** AWS Security Groups cannot express "deny" — see the module doc comment. */
export const awsDenyUnsupportedCode = 'aws-deny-unsupported'

export class FirewallCommandBuilder {
  build(rule: FirewallCmdRule, context: FirewallCmdContext): FirewallCommand {
    switch (context.provider) {
      case 'iptables':
        return this.iptables(rule)
      case 'firewalld':
        return this.firewalld(rule)
      case 'ufw':
        return this.ufw(rule)
      case 'windowsPowerShell':
        return this.windowsPowerShell(rule)
      case 'windowsNetsh':
        return this.windowsNetsh(rule)
      case 'awsSecurityGroup':
        return this.aws(rule, context)
      case 'gcpFirewall':
        return this.gcp(rule, context)
      case 'azureNsg':
        return this.azure(rule, context)
    }
  }

  // ---- Linux --------------------------------------------------------

  private iptables(rule: FirewallCmdRule): FirewallCommand {
    const chain = ruleDirection(rule) === 'inbound' ? 'INPUT' : 'OUTPUT'
    const verdict = rule.action === 'allow' ? 'ACCEPT' : 'DROP'
    const parts: string[] = [`-p ${iptablesProto(ruleProtocol(rule))}`]
    if (rule.ports != null) parts.push(`--dport ${rule.ports.ufwText}`)
    if (hasSource(rule.source)) parts.push(`-s ${rule.source}`)
    parts.push(`-j ${verdict}`)
    const comment = sanitize(rule.comment)
    if (comment != null) parts.push(`-m comment --comment "${comment}"`)

    const match = parts.join(' ')
    return { addCommand: `iptables -A ${chain} ${match}`, deleteCommand: `iptables -D ${chain} ${match}`, warnings: [] }
  }

  private firewalld(rule: FirewallCmdRule): FirewallCommand {
    const verdict = rule.action === 'allow' ? 'accept' : 'drop'
    const segments: string[] = ['rule family="ipv4"']
    if (hasSource(rule.source)) segments.push(`source address="${rule.source}"`)
    if (rule.ports != null) {
      segments.push(`port port="${rule.ports.nftText}" protocol="${iptablesProto(ruleProtocol(rule))}"`)
    }
    segments.push(verdict)
    const richRule = segments.join(' ')

    return {
      addCommand: `firewall-cmd --permanent --add-rich-rule='${richRule}' && firewall-cmd --reload`,
      deleteCommand: `firewall-cmd --permanent --remove-rich-rule='${richRule}' && firewall-cmd --reload`,
      warnings: [],
    }
  }

  private ufw(rule: FirewallCmdRule): FirewallCommand {
    const verb = rule.action === 'allow' ? 'allow' : 'deny'
    const dir = ruleDirection(rule) === 'inbound' ? 'in' : 'out'
    const parts: string[] = [verb, dir]
    if (hasSource(rule.source)) {
      parts.push(`from ${rule.source}`)
    } else {
      parts.push('from any')
    }
    if (rule.ports != null) {
      parts.push(`to any port ${rule.ports.ufwText}`)
    } else {
      parts.push('to any')
    }
    if (protocolIsSpecific(ruleProtocol(rule))) parts.push(`proto ${protocolKeyword(ruleProtocol(rule))}`)
    const comment = sanitize(rule.comment)
    const spec = parts.join(' ')
    const withComment = comment == null ? spec : `${spec} comment '${comment}'`

    return { addCommand: `ufw ${withComment}`, deleteCommand: `ufw delete ${spec}`, warnings: [] }
  }

  // ---- Windows --------------------------------------------------------

  private windowsPowerShell(rule: FirewallCmdRule): FirewallCommand {
    const name = this.ruleName(rule)
    const direction = ruleDirection(rule) === 'inbound' ? 'Inbound' : 'Outbound'
    const action = rule.action === 'allow' ? 'Allow' : 'Block'
    const parts: string[] = [
      'New-NetFirewallRule',
      `-DisplayName "${name}"`,
      `-Direction ${direction}`,
      ...(protocolIsSpecific(ruleProtocol(rule)) ? [`-Protocol ${protocolKeyword(ruleProtocol(rule)).toUpperCase()}`] : []),
      ...(rule.ports != null ? [`-LocalPort ${rule.ports.nftText}`] : []),
      ...(hasSource(rule.source) ? [`-RemoteAddress ${rule.source}`] : []),
      `-Action ${action}`,
    ]

    return {
      addCommand: parts.join(' '),
      deleteCommand: `Remove-NetFirewallRule -DisplayName "${name}"`,
      warnings: [],
    }
  }

  private windowsNetsh(rule: FirewallCmdRule): FirewallCommand {
    const name = this.ruleName(rule)
    const dir = ruleDirection(rule) === 'inbound' ? 'in' : 'out'
    const action = rule.action === 'allow' ? 'allow' : 'block'
    const parts: string[] = [
      'netsh advfirewall firewall add rule',
      `name="${name}"`,
      `dir=${dir}`,
      `action=${action}`,
      ...(protocolIsSpecific(ruleProtocol(rule)) ? [`protocol=${protocolKeyword(ruleProtocol(rule)).toUpperCase()}`] : []),
      ...(rule.ports != null ? [`localport=${rule.ports.nftText}`] : []),
      ...(hasSource(rule.source) ? [`remoteip=${rule.source}`] : []),
    ]

    return {
      addCommand: parts.join(' '),
      deleteCommand: `netsh advfirewall firewall delete rule name="${name}"`,
      warnings: [],
    }
  }

  // ---- Cloud --------------------------------------------------------

  private aws(rule: FirewallCmdRule, context: FirewallCmdContext): FirewallCommand {
    const groupId = context.groupId == null || context.groupId.trim().length === 0 ? 'sg-xxxxxxxxxxxxxxxxx' : context.groupId.trim()

    if (rule.action === 'deny') {
      const note = '# AWS Security Groups are allow-only — deny traffic with a Network ACL instead.'
      return {
        addCommand: note,
        deleteCommand: note,
        warnings: [
          {
            severity: 'caution',
            message: 'AWS Security Groups cannot deny traffic (allow-list only, implicit deny). Use a Network ACL for that.',
            code: awsDenyUnsupportedCode,
          },
        ],
      }
    }

    const verb = ruleDirection(rule) === 'inbound' ? 'ingress' : 'egress'
    const parts: string[] = [
      `aws ec2 authorize-security-group-${verb}`,
      `--group-id ${groupId}`,
      `--protocol ${protocolIsSpecific(ruleProtocol(rule)) ? protocolKeyword(ruleProtocol(rule)) : '-1'}`,
      ...(rule.ports != null ? [`--port ${rule.ports.nftText}`] : []),
      `--cidr ${hasSource(rule.source) ? rule.source : '0.0.0.0/0'}`,
    ]

    return {
      addCommand: parts.join(' '),
      deleteCommand: parts.join(' ').replace('authorize-security-group', 'revoke-security-group'),
      warnings: [],
    }
  }

  private gcp(rule: FirewallCmdRule, context: FirewallCmdContext): FirewallCommand {
    const name = this.ruleName(rule)
    const network = context.network == null || context.network.trim().length === 0 ? 'default' : context.network.trim()
    const direction = ruleDirection(rule) === 'inbound' ? 'INGRESS' : 'EGRESS'
    const action = rule.action === 'allow' ? 'ALLOW' : 'DENY'
    const rangeFlag = ruleDirection(rule) === 'inbound' ? '--source-ranges' : '--destination-ranges'
    const parts: string[] = [
      `gcloud compute firewall-rules create ${name}`,
      `--network=${network}`,
      `--direction=${direction}`,
      `--action=${action}`,
      ...(protocolIsSpecific(ruleProtocol(rule)) || rule.ports != null ? [`--rules=${this.gcpRules(rule)}`] : []),
      `${rangeFlag}=${hasSource(rule.source) ? rule.source : '0.0.0.0/0'}`,
    ]

    return {
      addCommand: parts.join(' '),
      deleteCommand: `gcloud compute firewall-rules delete ${name} --quiet`,
      warnings: [],
    }
  }

  private azure(rule: FirewallCmdRule, context: FirewallCmdContext): FirewallCommand {
    const name = this.ruleName(rule)
    const resourceGroup =
      context.resourceGroup == null || context.resourceGroup.trim().length === 0 ? 'my-resource-group' : context.resourceGroup.trim()
    const nsgName = context.nsgName == null || context.nsgName.trim().length === 0 ? 'my-nsg' : context.nsgName.trim()
    const priority = rule.priority ?? 100
    const direction = ruleDirection(rule) === 'inbound' ? 'Inbound' : 'Outbound'
    const access = rule.action === 'allow' ? 'Allow' : 'Deny'
    const protocol = protocolIsSpecific(ruleProtocol(rule)) ? (ruleProtocol(rule) === 'tcp' ? 'Tcp' : 'Udp') : '*'
    const portRangeFlag = ruleDirection(rule) === 'inbound' ? '--destination-port-ranges' : '--source-port-ranges'
    const addressFlag = ruleDirection(rule) === 'inbound' ? '--source-address-prefixes' : '--destination-address-prefixes'

    const parts: string[] = [
      'az network nsg rule create',
      `--resource-group ${resourceGroup}`,
      `--nsg-name ${nsgName}`,
      `--name ${name}`,
      `--priority ${priority}`,
      `--direction ${direction}`,
      `--access ${access}`,
      `--protocol ${protocol}`,
      `${portRangeFlag} ${rule.ports?.nftText ?? '*'}`,
      `${addressFlag} ${hasSource(rule.source) ? rule.source : '*'}`,
    ]

    return {
      addCommand: parts.join(' '),
      deleteCommand: `az network nsg rule delete --resource-group ${resourceGroup} --nsg-name ${nsgName} --name ${name}`,
      warnings: [],
    }
  }

  // ---- shared helpers --------------------------------------------------------

  private gcpRules(rule: FirewallCmdRule): string {
    const proto = protocolIsSpecific(ruleProtocol(rule)) ? protocolKeyword(ruleProtocol(rule)) : 'all'
    return rule.ports == null ? proto : `${proto}:${rule.ports.nftText}`
  }

  private ruleName(rule: FirewallCmdRule): string {
    const raw = rule.ruleName?.trim()
    if (raw != null && raw.length > 0) return sanitize(raw) ?? raw
    const action = rule.action
    const port = rule.ports?.nftText ?? 'any-port'
    return `infrakit-${action}-${port}`
  }
}

function iptablesProto(protocol: FirewallProtocol): string {
  return protocolIsSpecific(protocol) ? protocolKeyword(protocol) : 'tcp'
}

function hasSource(source: string | undefined): boolean {
  return source != null && source.trim().length > 0 && source.trim().toLowerCase() !== 'any'
}

/** Strips quotes and newlines — none of the 8 target syntaxes can escape a quote inside their own string literal. */
function sanitize(text: string | undefined): string | null {
  if (text == null) return null
  const cleaned = text.replace(/['"\r\n]/g, '').trim()
  return cleaned.length === 0 ? null : cleaned
}
