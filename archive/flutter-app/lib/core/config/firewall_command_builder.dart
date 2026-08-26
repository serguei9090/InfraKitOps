/// Firewall command builder — pure Dart, no I/O, no Flutter.
///
/// Unlike [FirewallRuleBuilder] (a whole-policy `ufw`/`nftables` script), this
/// builder is per-rule: pick a target ([FirewallCmdProvider]) and get back a
/// single apply command and its exact undo command, so a rule can be tried,
/// copy-pasted and reversed one at a time across Linux, Windows and the big
/// three clouds.
///
/// ## AWS Security Groups are allow-only
///
/// Unlike every other target here, an AWS security group has no "deny" rule
/// concept — it is an allow-list with an implicit deny for everything else.
/// Denying traffic on AWS means a Network ACL, a different resource this
/// builder does not generate. So a `deny` action against
/// [FirewallCmdProvider.awsSecurityGroup] does not emit a (wrong) command —
/// it emits an explanatory comment plus a [FirewallWarningSeverity.caution]
/// warning, the same warning-list convention [FirewallRuleBuilder] uses for
/// its own advisories.
library;

import 'firewall_rule_builder.dart' show PortRange, FirewallDirection, FirewallProtocol, FirewallWarning, FirewallWarningSeverity;

/// Which target syntax a rule is rendered into.
enum FirewallCmdProvider {
  iptables('iptables', 'Linux', 'Raw netfilter rules via the iptables CLI.'),
  firewalld('firewalld', 'Linux', 'Rich rules via firewall-cmd (RHEL/CentOS/Fedora default).'),
  ufw('ufw', 'Linux', 'Uncomplicated Firewall one-liners (Debian/Ubuntu default).'),
  windowsPowerShell('Windows PowerShell', 'Windows', 'New-NetFirewallRule / Remove-NetFirewallRule cmdlets.'),
  windowsNetsh('Windows netsh', 'Windows', 'Legacy netsh advfirewall firewall commands.'),
  awsSecurityGroup('AWS Security Group', 'Cloud', 'aws ec2 authorize/revoke-security-group-* (allow-only).'),
  gcpFirewall('GCP Firewall Rule', 'Cloud', 'gcloud compute firewall-rules create/delete.'),
  azureNsg('Azure NSG Rule', 'Cloud', 'az network nsg rule create/delete.');

  const FirewallCmdProvider(this.label, this.group, this.description);

  final String label;

  /// UI grouping: "Linux", "Windows" or "Cloud".
  final String group;
  final String description;

  /// AWS security groups cannot express "deny" — see the library doc comment.
  bool get supportsDeny => this != FirewallCmdProvider.awsSecurityGroup;

  /// Whether this target identifies a rule by a name rather than by its
  /// match criteria (so the UI should offer a name field).
  bool get needsRuleName =>
      this == FirewallCmdProvider.windowsPowerShell ||
      this == FirewallCmdProvider.windowsNetsh ||
      this == FirewallCmdProvider.gcpFirewall ||
      this == FirewallCmdProvider.azureNsg;

  /// Azure NSG rules are evaluated in priority order and require one.
  bool get needsPriority => this == FirewallCmdProvider.azureNsg;

  /// Cloud targets need account/resource context beyond the rule itself.
  bool get needsGroupContext =>
      this == FirewallCmdProvider.awsSecurityGroup ||
      this == FirewallCmdProvider.gcpFirewall ||
      this == FirewallCmdProvider.azureNsg;

  bool get isCloud => group == 'Cloud';
}

/// What the rule does with matching traffic. Deliberately narrower than
/// [FirewallRuleBuilder]'s `FirewallAction` — `reject`/`limit` do not have a
/// clean one-liner across all 8 targets here.
enum FirewallCmdAction {
  allow('Allow', 'Permit matching traffic.'),
  deny('Deny', 'Block matching traffic.');

  const FirewallCmdAction(this.label, this.description);

  final String label;
  final String description;
}

/// Account/subscription-level context shared by every rule rendered for a
/// cloud [FirewallCmdProvider]. Ignored by Linux/Windows providers.
class FirewallCmdContext {
  const FirewallCmdContext({
    required this.provider,
    this.groupId,
    this.resourceGroup,
    this.nsgName,
    this.network,
  });

  final FirewallCmdProvider provider;

  /// AWS security group id, e.g. `sg-0123456789abcdef0`.
  final String? groupId;

  /// Azure resource group name.
  final String? resourceGroup;

  /// Azure NSG name.
  final String? nsgName;

  /// GCP VPC network name. Defaults to `default` when blank.
  final String? network;
}

/// One firewall rule, provider-independent.
class FirewallCmdRule {
  const FirewallCmdRule({
    required this.action,
    this.direction = FirewallDirection.inbound,
    this.protocol = FirewallProtocol.tcp,
    this.ports,
    this.source,
    this.ruleName,
    this.priority,
    this.comment,
  });

  final FirewallCmdAction action;
  final FirewallDirection direction;
  final FirewallProtocol protocol;

  /// Destination port or port range. Null means every port.
  final PortRange? ports;

  /// Source address or CIDR, e.g. `10.0.0.0/8`. Null (or `any`) means every
  /// source.
  final String? source;

  /// Rule/display name — required spelling for Windows/GCP/Azure. When
  /// blank, a name is generated from the rule's shape.
  final String? ruleName;

  /// Azure NSG rule priority (100-4096, lower evaluates first).
  final int? priority;

  final String? comment;
}

/// The rendered result for one rule against one [FirewallCmdContext]: the
/// command that applies it, the command that undoes it, and any advisories.
class FirewallCommand {
  const FirewallCommand({required this.addCommand, required this.deleteCommand, this.warnings = const []});

  final String addCommand;
  final String deleteCommand;
  final List<FirewallWarning> warnings;
}

/// AWS Security Groups cannot express "deny" — see the library doc comment.
const String _awsDenyUnsupportedCode = 'aws-deny-unsupported';

class FirewallCommandBuilder {
  const FirewallCommandBuilder();

  FirewallCommand build(FirewallCmdRule rule, FirewallCmdContext context) {
    switch (context.provider) {
      case FirewallCmdProvider.iptables:
        return _iptables(rule);
      case FirewallCmdProvider.firewalld:
        return _firewalld(rule);
      case FirewallCmdProvider.ufw:
        return _ufw(rule);
      case FirewallCmdProvider.windowsPowerShell:
        return _windowsPowerShell(rule);
      case FirewallCmdProvider.windowsNetsh:
        return _windowsNetsh(rule);
      case FirewallCmdProvider.awsSecurityGroup:
        return _aws(rule, context);
      case FirewallCmdProvider.gcpFirewall:
        return _gcp(rule, context);
      case FirewallCmdProvider.azureNsg:
        return _azure(rule, context);
    }
  }

  // ---- Linux --------------------------------------------------------

  FirewallCommand _iptables(FirewallCmdRule rule) {
    final chain = rule.direction == FirewallDirection.inbound ? 'INPUT' : 'OUTPUT';
    final verdict = rule.action == FirewallCmdAction.allow ? 'ACCEPT' : 'DROP';
    final parts = <String>['-p ${_iptablesProto(rule.protocol)}'];
    if (rule.ports != null) parts.add('--dport ${rule.ports!.ufwText}');
    if (_hasSource(rule.source)) parts.add('-s ${rule.source}');
    parts.add('-j $verdict');
    final comment = _sanitize(rule.comment);
    if (comment != null) parts.add('-m comment --comment "$comment"');

    final match = parts.join(' ');
    return FirewallCommand(addCommand: 'iptables -A $chain $match', deleteCommand: 'iptables -D $chain $match');
  }

  FirewallCommand _firewalld(FirewallCmdRule rule) {
    final verdict = rule.action == FirewallCmdAction.allow ? 'accept' : 'drop';
    final segments = <String>['rule family="ipv4"'];
    if (_hasSource(rule.source)) segments.add('source address="${rule.source}"');
    if (rule.ports != null) {
      segments.add('port port="${rule.ports!.nftText}" protocol="${_iptablesProto(rule.protocol)}"');
    }
    segments.add(verdict);
    final richRule = segments.join(' ');

    return FirewallCommand(
      addCommand: "firewall-cmd --permanent --add-rich-rule='$richRule' && firewall-cmd --reload",
      deleteCommand: "firewall-cmd --permanent --remove-rich-rule='$richRule' && firewall-cmd --reload",
    );
  }

  FirewallCommand _ufw(FirewallCmdRule rule) {
    final verb = rule.action == FirewallCmdAction.allow ? 'allow' : 'deny';
    final dir = rule.direction == FirewallDirection.inbound ? 'in' : 'out';
    final parts = <String>[verb, dir];
    if (_hasSource(rule.source)) {
      parts.add('from ${rule.source}');
    } else {
      parts.add('from any');
    }
    if (rule.ports != null) {
      parts.add('to any port ${rule.ports!.ufwText}');
    } else {
      parts.add('to any');
    }
    if (rule.protocol.isSpecific) parts.add('proto ${rule.protocol.keyword}');
    final comment = _sanitize(rule.comment);
    final spec = parts.join(' ');
    final withComment = comment == null ? spec : "$spec comment '$comment'";

    return FirewallCommand(addCommand: 'ufw $withComment', deleteCommand: 'ufw delete $spec');
  }

  // ---- Windows --------------------------------------------------------

  FirewallCommand _windowsPowerShell(FirewallCmdRule rule) {
    final name = _ruleName(rule);
    final direction = rule.direction == FirewallDirection.inbound ? 'Inbound' : 'Outbound';
    final action = rule.action == FirewallCmdAction.allow ? 'Allow' : 'Block';
    final parts = <String>[
      'New-NetFirewallRule',
      '-DisplayName "$name"',
      '-Direction $direction',
      if (rule.protocol.isSpecific) '-Protocol ${rule.protocol.keyword.toUpperCase()}',
      if (rule.ports != null) '-LocalPort ${rule.ports!.nftText}',
      if (_hasSource(rule.source)) '-RemoteAddress ${rule.source}',
      '-Action $action',
    ];

    return FirewallCommand(
      addCommand: parts.join(' '),
      deleteCommand: 'Remove-NetFirewallRule -DisplayName "$name"',
    );
  }

  FirewallCommand _windowsNetsh(FirewallCmdRule rule) {
    final name = _ruleName(rule);
    final dir = rule.direction == FirewallDirection.inbound ? 'in' : 'out';
    final action = rule.action == FirewallCmdAction.allow ? 'allow' : 'block';
    final parts = <String>[
      'netsh advfirewall firewall add rule',
      'name="$name"',
      'dir=$dir',
      'action=$action',
      if (rule.protocol.isSpecific) 'protocol=${rule.protocol.keyword.toUpperCase()}',
      if (rule.ports != null) 'localport=${rule.ports!.nftText}',
      if (_hasSource(rule.source)) 'remoteip=${rule.source}',
    ];

    return FirewallCommand(
      addCommand: parts.join(' '),
      deleteCommand: 'netsh advfirewall firewall delete rule name="$name"',
    );
  }

  // ---- Cloud --------------------------------------------------------

  FirewallCommand _aws(FirewallCmdRule rule, FirewallCmdContext context) {
    final groupId = (context.groupId == null || context.groupId!.trim().isEmpty) ? 'sg-xxxxxxxxxxxxxxxxx' : context.groupId!.trim();

    if (rule.action == FirewallCmdAction.deny) {
      const note = '# AWS Security Groups are allow-only — deny traffic with a Network ACL instead.';
      return FirewallCommand(
        addCommand: note,
        deleteCommand: note,
        warnings: const [
          FirewallWarning(
            severity: FirewallWarningSeverity.caution,
            message: 'AWS Security Groups cannot deny traffic (allow-list only, implicit deny). Use a Network ACL for that.',
            code: _awsDenyUnsupportedCode,
          ),
        ],
      );
    }

    final verb = rule.direction == FirewallDirection.inbound ? 'ingress' : 'egress';
    final parts = <String>[
      'aws ec2 authorize-security-group-$verb',
      '--group-id $groupId',
      '--protocol ${rule.protocol.isSpecific ? rule.protocol.keyword : '-1'}',
      if (rule.ports != null) '--port ${rule.ports!.nftText}',
      '--cidr ${_hasSource(rule.source) ? rule.source : '0.0.0.0/0'}',
    ];

    return FirewallCommand(
      addCommand: parts.join(' '),
      deleteCommand: parts.join(' ').replaceFirst('authorize-security-group', 'revoke-security-group'),
    );
  }

  FirewallCommand _gcp(FirewallCmdRule rule, FirewallCmdContext context) {
    final name = _ruleName(rule);
    final network = (context.network == null || context.network!.trim().isEmpty) ? 'default' : context.network!.trim();
    final direction = rule.direction == FirewallDirection.inbound ? 'INGRESS' : 'EGRESS';
    final action = rule.action == FirewallCmdAction.allow ? 'ALLOW' : 'DENY';
    final rangeFlag = rule.direction == FirewallDirection.inbound ? '--source-ranges' : '--destination-ranges';
    final parts = <String>[
      'gcloud compute firewall-rules create $name',
      '--network=$network',
      '--direction=$direction',
      '--action=$action',
      if (rule.protocol.isSpecific || rule.ports != null) '--rules=${_gcpRules(rule)}',
      '$rangeFlag=${_hasSource(rule.source) ? rule.source : '0.0.0.0/0'}',
    ];

    return FirewallCommand(
      addCommand: parts.join(' '),
      deleteCommand: 'gcloud compute firewall-rules delete $name --quiet',
    );
  }

  FirewallCommand _azure(FirewallCmdRule rule, FirewallCmdContext context) {
    final name = _ruleName(rule);
    final resourceGroup = (context.resourceGroup == null || context.resourceGroup!.trim().isEmpty) ? 'my-resource-group' : context.resourceGroup!.trim();
    final nsgName = (context.nsgName == null || context.nsgName!.trim().isEmpty) ? 'my-nsg' : context.nsgName!.trim();
    final priority = rule.priority ?? 100;
    final direction = rule.direction == FirewallDirection.inbound ? 'Inbound' : 'Outbound';
    final access = rule.action == FirewallCmdAction.allow ? 'Allow' : 'Deny';
    final protocol = rule.protocol.isSpecific ? (rule.protocol == FirewallProtocol.tcp ? 'Tcp' : 'Udp') : '*';
    final portRangeFlag = rule.direction == FirewallDirection.inbound ? '--destination-port-ranges' : '--source-port-ranges';
    final addressFlag = rule.direction == FirewallDirection.inbound ? '--source-address-prefixes' : '--destination-address-prefixes';

    final parts = <String>[
      'az network nsg rule create',
      '--resource-group $resourceGroup',
      '--nsg-name $nsgName',
      '--name $name',
      '--priority $priority',
      '--direction $direction',
      '--access $access',
      '--protocol $protocol',
      '$portRangeFlag ${rule.ports?.nftText ?? '*'}',
      '$addressFlag ${_hasSource(rule.source) ? rule.source : '*'}',
    ];

    return FirewallCommand(
      addCommand: parts.join(' '),
      deleteCommand: 'az network nsg rule delete --resource-group $resourceGroup --nsg-name $nsgName --name $name',
    );
  }

  // ---- shared helpers --------------------------------------------------------

  String _gcpRules(FirewallCmdRule rule) {
    final proto = rule.protocol.isSpecific ? rule.protocol.keyword : 'all';
    return rule.ports == null ? proto : '$proto:${rule.ports!.nftText}';
  }

  String _iptablesProto(FirewallProtocol protocol) => protocol.isSpecific ? protocol.keyword : 'tcp';

  bool _hasSource(String? source) => source != null && source.trim().isNotEmpty && source.trim().toLowerCase() != 'any';

  String _ruleName(FirewallCmdRule rule) {
    final raw = rule.ruleName?.trim();
    if (raw != null && raw.isNotEmpty) return _sanitize(raw) ?? raw;
    final action = rule.action.name;
    final port = rule.ports?.nftText ?? 'any-port';
    return 'infrakit-$action-$port';
  }

  /// Strips quotes and newlines — none of the 8 target syntaxes can escape a
  /// quote inside their own string literal.
  String? _sanitize(String? text) {
    if (text == null) return null;
    final cleaned = text.replaceAll(RegExp(r'''['"\r\n]'''), '').trim();
    return cleaned.isEmpty ? null : cleaned;
  }
}
