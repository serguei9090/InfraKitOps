/// Firewall rule builder — pure Dart, no I/O, no Flutter.
///
/// Takes a structured, validated set of [FirewallRule]s plus a default policy
/// and renders them into a runnable script in one of two dialects: a `ufw`
/// command script or an `nft` ruleset file. Same rule model, two back ends —
/// so a rule set can be reviewed in whichever syntax the target host speaks.
///
/// The shape follows `lib/core/utility/ssh_config_builder.dart`: a catalog of
/// typed descriptors ([kFirewallServicePresets], and the enums below carrying
/// their own labels/descriptions/dialect spellings), a generic UI driven off
/// that catalog, and output that contains only what the user actually asked
/// for. Advisories come back as a returned [FirewallWarning] list rather than
/// being buried in a comment.
///
/// ## Why the lockout warning exists
///
/// A firewall script is the one generator in this app that can permanently
/// separate a user from their own server. `ufw default deny incoming` followed
/// by `ufw enable`, with no rule permitting TCP 22, drops the very SSH session
/// that ran it and every session after it — recovery needs out-of-band console
/// access. So the builder actively checks for that combination
/// ([firewallRuleSetPermitsSsh]) and returns a
/// [FirewallWarningSeverity.critical] warning, and every generated script
/// carries the "keep a session open, test from a second terminal" caution in
/// its header.
///
/// ## Dialect notes baked into the renderers
///
/// * `ufw enable` prompts interactively ("may disrupt existing ssh
///   connections"), so the script emits `ufw --force enable`.
/// * `ufw limit` only understands TCP; a rate-limit rule on UDP is flagged.
/// * `ufw` comments are emitted single-quoted and cannot themselves contain
///   quotes, so comment text is sanitised rather than escaped.
/// * nftables chain policies only accept `accept` or `drop` — there is no
///   `reject` policy. A "reject by default" choice becomes `policy drop` with
///   an explicit note.
/// * The nft ruleset opens with `flush ruleset`, which wipes tables owned by
///   Docker, libvirt and firewalld too. That is called out as a warning.
/// * Interfaces are matched with `iifname`/`oifname` (string matching) rather
///   than `iif`/`oif` (index matching) so the ruleset still loads when the
///   interface does not exist yet.
library;

import '../ports/i_tool_use_case.dart';

/// Which syntax the rule set is rendered into.
enum FirewallDialect {
  /// Uncomplicated Firewall: a shell script of `ufw` commands.
  ufw('UFW', 'ufw command script (Debian/Ubuntu)', 'apply-firewall.sh', 'sh'),

  /// nftables: a single `nft -f` ruleset file.
  nftables('nftables', 'nft ruleset file (modern Linux)', 'nftables.conf', 'conf');

  const FirewallDialect(this.label, this.description, this.suggestedFileName, this.fileExtension);

  final String label;
  final String description;

  /// Filename to suggest in a native "save as" dialog.
  final String suggestedFileName;

  final String fileExtension;
}

/// What a rule (or a default policy) does with matching traffic.
enum FirewallAction {
  allow('allow', 'accept', 'Allow', 'Permit matching traffic.'),
  deny('deny', 'drop', 'Deny (drop)', 'Silently drop matching traffic. Scanners see a timeout.'),
  reject('reject', 'reject', 'Reject', 'Refuse with an ICMP/TCP-RST error. Faster failures, but confirms the host is alive.'),
  limit('limit', 'accept', 'Rate-limit', 'Allow, but throttle repeated new connections from one source. TCP only.');

  const FirewallAction(this.ufwKeyword, this.nftVerdict, this.label, this.description);

  /// The `ufw` sub-command word.
  final String ufwKeyword;

  /// The nftables verdict statement. [limit] reaches `accept` through a
  /// preceding `limit rate` statement — see [FirewallRuleBuilder].
  final String nftVerdict;

  final String label;
  final String description;

  /// Whether this action lets traffic through (used by the SSH reachability
  /// check).
  bool get permitsTraffic => this == FirewallAction.allow || this == FirewallAction.limit;

  /// Chain policies have no rate-limiting concept.
  bool get validAsPolicy => this != FirewallAction.limit;
}

/// Which direction the rule applies to.
enum FirewallDirection {
  inbound('in', 'input', 'Inbound', 'Traffic arriving at this host.'),
  outbound('out', 'output', 'Outbound', 'Traffic this host originates.');

  const FirewallDirection(this.ufwKeyword, this.nftChain, this.label, this.description);

  final String ufwKeyword;

  /// Which nftables base chain the rule lands in.
  final String nftChain;

  final String label;
  final String description;
}

/// Layer-4 protocol selector.
enum FirewallProtocol {
  tcp('tcp', 'TCP'),
  udp('udp', 'UDP'),
  any('any', 'TCP + UDP');

  const FirewallProtocol(this.keyword, this.label);

  /// The literal spelling in both dialects (`any` is never emitted).
  final String keyword;

  final String label;

  bool get isSpecific => this != FirewallProtocol.any;
}

/// How serious an advisory is. [critical] means "this script can lock you out
/// of the machine"; the UI is expected to render it as an error banner rather
/// than a note.
enum FirewallWarningSeverity { critical, caution }

/// A non-fatal advisory returned alongside the generated script.
///
/// Generation is never blocked by a warning — an air-gapped box with console
/// access legitimately has no SSH rule — but the UI must surface these.
class FirewallWarning {
  const FirewallWarning({required this.severity, required this.message, required this.code});

  final FirewallWarningSeverity severity;

  /// Human-readable text, safe to show verbatim.
  final String message;

  /// Stable machine-readable identifier, so tests and the UI can assert on a
  /// specific advisory without string matching.
  final String code;

  /// Emitted when the default incoming policy blocks traffic and no rule
  /// permits inbound SSH. The lockout case.
  static const String sshLockoutCode = 'ssh-lockout';

  /// Emitted when the default incoming policy is `allow`.
  static const String openByDefaultCode = 'open-by-default';

  /// Emitted for the nftables `flush ruleset` line.
  static const String flushRulesetCode = 'flush-ruleset';

  /// Emitted when a rate-limit rule is not TCP.
  static const String limitNotTcpCode = 'limit-not-tcp';

  /// Emitted when a rule mixes an IPv4 and an IPv6 address.
  static const String addressFamilyMismatchCode = 'address-family-mismatch';

  /// Emitted when the rule list is empty.
  static const String noRulesCode = 'no-rules';

  /// Emitted when nftables silently downgrades a `reject` policy to `drop`.
  static const String rejectPolicyCode = 'reject-policy-downgraded';

  @override
  String toString() => '[${severity.name}] $message';
}

/// A single port, or an inclusive port range.
///
/// Validated on construction, so an out-of-range or inverted range can never
/// reach a renderer. The two dialects spell ranges differently — `22:25` for
/// ufw (iptables heritage) and `22-25` for nft — which is exactly the kind of
/// difference this type exists to hide.
class PortRange {
  PortRange(this.start, this.end) {
    _checkPort(start, 'start');
    _checkPort(end, 'end');
    if (start > end) {
      throw ArgumentError('Port range start ($start) must not be greater than its end ($end).');
    }
  }

  PortRange.single(int port) : this(port, port);

  /// Parses `"22"`, `"8000:8010"` or `"8000-8010"`. Throws [ArgumentError] on
  /// anything else.
  factory PortRange.parse(String raw) {
    final text = raw.trim();
    if (text.isEmpty) {
      throw ArgumentError('Port must not be empty. Use a port such as 22, or a range such as 8000-8010.');
    }
    final parts = text.split(RegExp('[:-]'));
    if (parts.length == 1) {
      return PortRange.single(_parsePort(parts[0], text));
    }
    if (parts.length == 2) {
      return PortRange(_parsePort(parts[0], text), _parsePort(parts[1], text));
    }
    throw ArgumentError('"$raw" is not a port or a port range (expected 22, 8000:8010 or 8000-8010).');
  }

  final int start;
  final int end;

  bool get isSingle => start == end;

  bool contains(int port) => port >= start && port <= end;

  /// ufw/iptables spelling: `8000:8010`.
  String get ufwText => isSingle ? '$start' : '$start:$end';

  /// nftables spelling: `8000-8010`.
  String get nftText => isSingle ? '$start' : '$start-$end';

  static int _parsePort(String raw, String context) {
    final parsed = int.tryParse(raw.trim());
    if (parsed == null) {
      throw ArgumentError('"$context" is not a valid port (expected a whole number between 1 and 65535).');
    }
    _checkPort(parsed, 'port');
    return parsed;
  }

  static void _checkPort(int port, String name) {
    if (port < 1 || port > 65535) {
      throw ArgumentError.value(port, name, 'Ports must be between 1 and 65535');
    }
  }

  @override
  String toString() => nftText;

  @override
  bool operator ==(Object other) => other is PortRange && other.start == start && other.end == end;

  @override
  int get hashCode => Object.hash(start, end);
}

/// One firewall rule, dialect-independent.
///
/// `null` for [ports], [source], [destination] and [interfaceName] means "any"
/// — the renderers omit the corresponding match entirely rather than emitting
/// a restated default.
class FirewallRule {
  const FirewallRule({
    required this.action,
    this.direction = FirewallDirection.inbound,
    this.protocol = FirewallProtocol.tcp,
    this.ports,
    this.source,
    this.destination,
    this.interfaceName,
    this.comment,
    this.logged = false,
  });

  final FirewallAction action;
  final FirewallDirection direction;
  final FirewallProtocol protocol;

  /// Destination port or port range. Null means every port.
  final PortRange? ports;

  /// Source address or CIDR, e.g. `10.0.0.0/8` or `2001:db8::/32`. Null (or
  /// `any`) means every source.
  final String? source;

  /// Destination address or CIDR. Null means every destination.
  final String? destination;

  /// Interface name, e.g. `eth0`. Null means every interface.
  final String? interfaceName;

  /// Free-text comment. Quotes and newlines are stripped before emission —
  /// neither dialect can escape a quote inside its own comment syntax.
  final String? comment;

  /// Log packets matching this rule.
  final bool logged;

  /// Whether this rule permits inbound traffic to [port] over TCP — the test
  /// used by the SSH lockout check.
  bool permitsInboundTcpPort(int port) =>
      direction == FirewallDirection.inbound &&
      action.permitsTraffic &&
      (protocol == FirewallProtocol.tcp || protocol == FirewallProtocol.any) &&
      (ports == null || ports!.contains(port));
}

/// Default policy for each chain/direction. `null`-free by design: a firewall
/// always has a default, and pretending otherwise is how people end up with an
/// accidentally open box.
class FirewallPolicy {
  const FirewallPolicy({
    this.incoming = FirewallAction.deny,
    this.outgoing = FirewallAction.allow,
    this.forward = FirewallAction.deny,
  });

  final FirewallAction incoming;
  final FirewallAction outgoing;

  /// Routed traffic. Only rendered in the nftables dialect (ufw's `default`
  /// command manages it separately and most single hosts never route).
  final FirewallAction forward;

  /// True when inbound traffic is blocked unless a rule permits it.
  bool get blocksIncomingByDefault => !incoming.permitsTraffic;
}

/// A one-click "open this well-known service" entry for the UI.
class FirewallServicePreset {
  const FirewallServicePreset({
    required this.label,
    required this.port,
    required this.protocol,
    required this.description,
    this.exposureNote,
  });

  final String label;
  final int port;
  final FirewallProtocol protocol;
  final String description;

  /// Extra caution shown when this service is usually *not* meant to face the
  /// internet.
  final String? exposureNote;

  /// Builds the rule this preset stands for.
  FirewallRule toRule({
    FirewallAction action = FirewallAction.allow,
    FirewallDirection direction = FirewallDirection.inbound,
    String? source,
  }) {
    return FirewallRule(
      action: action,
      direction: direction,
      protocol: protocol,
      ports: PortRange.single(port),
      source: source,
      comment: label,
    );
  }
}

/// Common services offered as one-click rule additions.
const List<FirewallServicePreset> kFirewallServicePresets = [
  FirewallServicePreset(
    label: 'SSH',
    port: 22,
    protocol: FirewallProtocol.tcp,
    description: 'Remote shell. Add this before enabling a deny-by-default firewall.',
  ),
  FirewallServicePreset(
    label: 'HTTP',
    port: 80,
    protocol: FirewallProtocol.tcp,
    description: 'Plain web traffic. Usually kept open only to redirect to HTTPS or to answer ACME challenges.',
  ),
  FirewallServicePreset(
    label: 'HTTPS',
    port: 443,
    protocol: FirewallProtocol.tcp,
    description: 'TLS web traffic. Also QUIC/HTTP-3 if you additionally open UDP 443.',
  ),
  FirewallServicePreset(
    label: 'DNS',
    port: 53,
    protocol: FirewallProtocol.any,
    description: 'DNS uses UDP 53 with a TCP 53 fallback for large answers and zone transfers.',
    exposureNote: 'An internet-facing open resolver will be abused for amplification attacks. Restrict the source.',
  ),
  FirewallServicePreset(
    label: 'NTP',
    port: 123,
    protocol: FirewallProtocol.udp,
    description: 'Network time. Clients need this outbound; only a time *server* needs it inbound.',
  ),
  FirewallServicePreset(
    label: 'PostgreSQL',
    port: 5432,
    protocol: FirewallProtocol.tcp,
    description: 'PostgreSQL wire protocol.',
    exposureNote: 'Databases should not be internet-reachable. Restrict the source to your app subnet.',
  ),
  FirewallServicePreset(
    label: 'MySQL',
    port: 3306,
    protocol: FirewallProtocol.tcp,
    description: 'MySQL / MariaDB wire protocol.',
    exposureNote: 'Databases should not be internet-reachable. Restrict the source to your app subnet.',
  ),
  FirewallServicePreset(
    label: 'Redis',
    port: 6379,
    protocol: FirewallProtocol.tcp,
    description: 'Redis. Unauthenticated by default in many builds.',
    exposureNote: 'An exposed Redis is a well-known remote-code-execution path. Bind to localhost if you can.',
  ),
];

/// The [FirewallServicePreset] whose [FirewallServicePreset.label] is [label],
/// or null.
FirewallServicePreset? firewallPresetFor(String label) {
  for (final preset in kFirewallServicePresets) {
    if (preset.label.toLowerCase() == label.toLowerCase()) return preset;
  }
  return null;
}

/// Everything the builder needs to render a script.
class FirewallRuleSetInput {
  const FirewallRuleSetInput({
    this.dialect = FirewallDialect.ufw,
    this.rules = const [],
    this.policy = const FirewallPolicy(),
    this.sshPort = 22,
    this.includeHeader = true,
    this.allowLoopback = true,
    this.allowEstablished = true,
    this.allowIcmp = true,
  });

  final FirewallDialect dialect;

  /// Rules in the order they should be evaluated.
  final List<FirewallRule> rules;

  final FirewallPolicy policy;

  /// The port SSH actually listens on, for the lockout check. Change this if
  /// sshd was moved off 22.
  final int sshPort;

  /// Emit the explanatory/caution header comment.
  final bool includeHeader;

  /// nftables only: emit `iif "lo" accept`. ufw permits loopback itself.
  final bool allowLoopback;

  /// nftables only: emit the conntrack established/related accept. Without it
  /// a `policy drop` input chain also drops the replies to the host's own
  /// outbound connections, which breaks DNS, apt, everything.
  final bool allowEstablished;

  /// nftables only: accept ICMP and ICMPv6. Dropping ICMPv6 neighbour
  /// discovery breaks IPv6 outright; dropping ICMP breaks path MTU discovery.
  final bool allowIcmp;
}

/// The rendered script plus its advisories.
class FirewallScriptResult {
  const FirewallScriptResult({
    required this.script,
    required this.suggestedFileName,
    required this.ruleCount,
    this.warnings = const [],
  });

  /// The full script text, ready to save and run.
  final String script;

  /// `apply-firewall.sh` or `nftables.conf`, for the save dialog.
  final String suggestedFileName;

  /// How many user rules were rendered (excludes scaffolding lines).
  final int ruleCount;

  /// Non-fatal advisories, most severe first.
  final List<FirewallWarning> warnings;

  /// True when at least one advisory can lock the user out.
  bool get hasCriticalWarning => warnings.any((w) => w.severity == FirewallWarningSeverity.critical);
}

/// Whether [rules] contain anything that would let an inbound SSH connection
/// to [sshPort] through.
///
/// Deliberately optimistic about the source address: a rule restricted to
/// `10.0.0.0/8` still counts, because the builder cannot know where the user
/// is connecting from. It is pessimistic about everything it *can* check —
/// direction, action, protocol and port.
bool firewallRuleSetPermitsSsh(List<FirewallRule> rules, {int sshPort = 22}) =>
    rules.any((rule) => rule.permitsInboundTcpPort(sshPort));

/// The standard "do not lock yourself out" caution, emitted into every script
/// header and reusable by the UI.
const String kFirewallTestingCaution =
    'Keep your existing SSH session open and test the new rules from a SECOND '
    'terminal before you trust them. If this ruleset is wrong, the only way '
    'back in is out-of-band console/KVM access.';

/// Renders a validated [FirewallRuleSetInput] into a `ufw` script or an `nft`
/// ruleset.
///
/// Pure text generation, no filesystem and no privileged calls: running the
/// result is the operator's job, deliberately.
///
/// Every address, port, interface and policy is validated before emission, so
/// a malformed CIDR or an out-of-range port can never reach the output. Those
/// throw [ArgumentError]. Things that are *legal but dangerous* — no SSH rule
/// under a deny-by-default policy, an allow-by-default policy, `flush ruleset`
/// — come back as [FirewallScriptResult.warnings] instead.
class FirewallRuleBuilder implements IToolUseCase<FirewallRuleSetInput, FirewallScriptResult> {
  const FirewallRuleBuilder();

  static const String _tab = '\t';

  @override
  FirewallScriptResult execute(FirewallRuleSetInput input) {
    _validatePolicy(input.policy);
    if (input.sshPort < 1 || input.sshPort > 65535) {
      throw ArgumentError.value(input.sshPort, 'sshPort', 'Must be between 1 and 65535');
    }
    for (final rule in input.rules) {
      _validateRule(rule);
    }

    final warnings = _collectWarnings(input);

    final script = switch (input.dialect) {
      FirewallDialect.ufw => _renderUfw(input),
      FirewallDialect.nftables => _renderNft(input),
    };

    return FirewallScriptResult(
      script: script,
      suggestedFileName: input.dialect.suggestedFileName,
      ruleCount: input.rules.length,
      warnings: List.unmodifiable(warnings),
    );
  }

  // ------------------------------------------------------------------
  // Validation
  // ------------------------------------------------------------------

  void _validatePolicy(FirewallPolicy policy) {
    for (final entry in {
      'incoming': policy.incoming,
      'outgoing': policy.outgoing,
      'forward': policy.forward,
    }.entries) {
      if (!entry.value.validAsPolicy) {
        throw ArgumentError('Default ${entry.key} policy cannot be "${entry.value.ufwKeyword}" — a policy has no rate limit.');
      }
    }
  }

  void _validateRule(FirewallRule rule) {
    if (rule.source != null) _requireCidr(rule.source!, 'source');
    if (rule.destination != null) _requireCidr(rule.destination!, 'destination');
    if (rule.interfaceName != null) {
      final name = rule.interfaceName!.trim();
      if (name.isEmpty) {
        throw ArgumentError('Interface name must not be blank — leave it unset for "any interface".');
      }
      if (!RegExp(r'^[A-Za-z0-9_.:@+-]{1,32}$').hasMatch(name)) {
        throw ArgumentError('"$name" is not a valid interface name (letters, digits and . _ - : @ + only, max 32 characters).');
      }
    }
  }

  void _requireCidr(String raw, String field) {
    if (!isAnyAddress(raw) && !isValidCidr(raw)) {
      throw ArgumentError('"$raw" is not a valid $field address or CIDR block (expected e.g. 10.0.0.0/8, 192.168.1.5 or 2001:db8::/32).');
    }
  }

  // ------------------------------------------------------------------
  // Warnings
  // ------------------------------------------------------------------

  List<FirewallWarning> _collectWarnings(FirewallRuleSetInput input) {
    final warnings = <FirewallWarning>[];

    // The one that matters: deny-by-default with no way back in.
    if (input.policy.blocksIncomingByDefault && !firewallRuleSetPermitsSsh(input.rules, sshPort: input.sshPort)) {
      warnings.add(
        FirewallWarning(
          severity: FirewallWarningSeverity.critical,
          code: FirewallWarning.sshLockoutCode,
          message:
              'LOCKOUT RISK: the default incoming policy is "${input.policy.incoming.ufwKeyword}" and no rule permits '
              'inbound TCP ${input.sshPort} (SSH). Applying this over an SSH session will drop that session and every '
              'session after it. Add an allow rule for TCP ${input.sshPort} — or be certain you have console/KVM access.',
        ),
      );
    }

    if (!input.policy.blocksIncomingByDefault) {
      warnings.add(
        const FirewallWarning(
          severity: FirewallWarningSeverity.caution,
          code: FirewallWarning.openByDefaultCode,
          message:
              'The default incoming policy is "allow": every port stays reachable unless a rule explicitly blocks it. '
              'Deny-by-default is the safer posture for anything internet-facing.',
        ),
      );
    }

    if (input.rules.isEmpty) {
      warnings.add(
        const FirewallWarning(
          severity: FirewallWarningSeverity.caution,
          code: FirewallWarning.noRulesCode,
          message: 'No rules defined — the generated script only sets default policies.',
        ),
      );
    }

    for (var i = 0; i < input.rules.length; i++) {
      final rule = input.rules[i];
      final label = 'Rule ${i + 1}${rule.comment != null && rule.comment!.trim().isNotEmpty ? ' (${_sanitizeComment(rule.comment!)})' : ''}';

      if (rule.action == FirewallAction.limit && rule.protocol != FirewallProtocol.tcp) {
        warnings.add(
          FirewallWarning(
            severity: FirewallWarningSeverity.caution,
            code: FirewallWarning.limitNotTcpCode,
            message: '$label: rate-limiting only applies to TCP. `ufw limit` rejects a non-TCP rule outright.',
          ),
        );
      }

      final srcV6 = rule.source != null && !isAnyAddress(rule.source!) && isIpv6Cidr(rule.source!);
      final dstV6 = rule.destination != null && !isAnyAddress(rule.destination!) && isIpv6Cidr(rule.destination!);
      final srcSet = rule.source != null && !isAnyAddress(rule.source!);
      final dstSet = rule.destination != null && !isAnyAddress(rule.destination!);
      if (srcSet && dstSet && srcV6 != dstV6) {
        warnings.add(
          FirewallWarning(
            severity: FirewallWarningSeverity.caution,
            code: FirewallWarning.addressFamilyMismatchCode,
            message: '$label: mixes an IPv4 and an IPv6 address. Such a rule can never match — split it into two rules.',
          ),
        );
      }
    }

    if (input.dialect == FirewallDialect.nftables) {
      warnings.add(
        const FirewallWarning(
          severity: FirewallWarningSeverity.caution,
          code: FirewallWarning.flushRulesetCode,
          message:
              'The ruleset starts with `flush ruleset`, which removes EVERY existing nftables table — including the '
              'ones Docker, libvirt, Kubernetes and firewalld manage for themselves.',
        ),
      );
      if (input.policy.incoming == FirewallAction.reject || input.policy.forward == FirewallAction.reject) {
        warnings.add(
          const FirewallWarning(
            severity: FirewallWarningSeverity.caution,
            code: FirewallWarning.rejectPolicyCode,
            message:
                'nftables chain policies accept only `accept` or `drop`, so a "reject" default is rendered as '
                '`policy drop`. Add an explicit trailing `reject` rule if you need the ICMP error.',
          ),
        );
      }
    }

    warnings.sort((a, b) => a.severity.index.compareTo(b.severity.index));
    return warnings;
  }

  // ------------------------------------------------------------------
  // UFW
  // ------------------------------------------------------------------

  String _renderUfw(FirewallRuleSetInput input) {
    final buffer = StringBuffer();

    if (input.includeHeader) {
      buffer.writeln('#!/usr/bin/env bash');
      buffer.writeln('#');
      buffer.writeln('# UFW firewall script — generated by InfraKit Studio');
      buffer.writeln('#');
      for (final line in _wrapComment(kFirewallTestingCaution)) {
        buffer.writeln('# $line');
      }
      buffer.writeln('#');
      buffer.writeln('# Review before enabling:  ufw status numbered');
      buffer.writeln('# Undo everything:         ufw --force reset');
      buffer.writeln('#');
      buffer.writeln('# Run as root. Rules are appended in the order below and ufw evaluates');
      buffer.writeln('# them first-match-wins, so put the specific ones first.');
      buffer.writeln('#');
      buffer.writeln('set -euo pipefail');
      buffer.writeln();
    }

    buffer.writeln('# Default policies');
    buffer.writeln('ufw default ${input.policy.incoming.ufwKeyword} incoming');
    buffer.writeln('ufw default ${input.policy.outgoing.ufwKeyword} outgoing');

    if (input.rules.isNotEmpty) {
      buffer.writeln();
      buffer.writeln('# Rules');
      for (final rule in input.rules) {
        buffer.writeln(ufwRuleCommand(rule));
      }
    }

    buffer.writeln();
    buffer.writeln('# `ufw enable` asks for confirmation because it can disrupt live SSH');
    buffer.writeln('# sessions; --force answers yes non-interactively.');
    buffer.writeln('ufw --force enable');
    buffer.writeln('ufw status verbose');
    return buffer.toString();
  }

  /// The single `ufw` command line for [rule]. Public so the UI can preview a
  /// row without rendering the whole script.
  static String ufwRuleCommand(FirewallRule rule) {
    final tokens = <String>['ufw', rule.action.ufwKeyword, rule.direction.ufwKeyword];

    if (rule.interfaceName != null) {
      tokens.addAll(['on', rule.interfaceName!.trim()]);
    }
    if (rule.logged) {
      tokens.add('log');
    }
    if (rule.protocol.isSpecific) {
      tokens.addAll(['proto', rule.protocol.keyword]);
    }

    final source = _normalizeAddress(rule.source) ?? 'any';
    final destination = _normalizeAddress(rule.destination) ?? 'any';
    tokens.addAll(['from', source, 'to', destination]);

    if (rule.ports != null) {
      tokens.addAll(['port', rule.ports!.ufwText]);
    }

    final comment = _sanitizeComment(rule.comment);
    if (comment != null) {
      tokens.addAll(['comment', "'$comment'"]);
    }

    return tokens.join(' ');
  }

  // ------------------------------------------------------------------
  // nftables
  // ------------------------------------------------------------------

  String _renderNft(FirewallRuleSetInput input) {
    final buffer = StringBuffer();

    if (input.includeHeader) {
      buffer.writeln('#!/usr/sbin/nft -f');
      buffer.writeln('#');
      buffer.writeln('# nftables ruleset — generated by InfraKit Studio');
      buffer.writeln('#');
      for (final line in _wrapComment(kFirewallTestingCaution)) {
        buffer.writeln('# $line');
      }
      buffer.writeln('#');
      buffer.writeln('# Syntax-check first:  nft -c -f nftables.conf');
      buffer.writeln('# Load:                nft -f nftables.conf');
      buffer.writeln('# Inspect:             nft list ruleset');
      buffer.writeln('#');
      buffer.writeln('# `flush ruleset` below removes EVERY existing table, including those');
      buffer.writeln('# managed by Docker, libvirt, Kubernetes or firewalld.');
      buffer.writeln('#');
    }

    buffer.writeln('flush ruleset');
    buffer.writeln();
    buffer.writeln('table inet filter {');

    // input
    buffer.writeln('${_tab}chain input {');
    buffer.writeln('$_tab$_tab' 'type filter hook input priority 0; policy ${_nftPolicy(input.policy.incoming)};');
    final preamble = _nftInputPreamble(input);
    if (preamble.isNotEmpty) {
      buffer.writeln();
      for (final line in preamble) {
        buffer.writeln('$_tab$_tab$line');
      }
    }
    final inbound = input.rules.where((r) => r.direction == FirewallDirection.inbound).toList();
    if (inbound.isNotEmpty) {
      buffer.writeln();
      for (final line in _nftRuleBlock(inbound)) {
        buffer.writeln('$_tab$_tab$line');
      }
    }
    buffer.writeln('$_tab}');
    buffer.writeln();

    // forward
    buffer.writeln('${_tab}chain forward {');
    buffer.writeln('$_tab$_tab' 'type filter hook forward priority 0; policy ${_nftPolicy(input.policy.forward)};');
    buffer.writeln('$_tab}');
    buffer.writeln();

    // output
    buffer.writeln('${_tab}chain output {');
    buffer.writeln('$_tab$_tab' 'type filter hook output priority 0; policy ${_nftPolicy(input.policy.outgoing)};');
    final outbound = input.rules.where((r) => r.direction == FirewallDirection.outbound).toList();
    if (outbound.isNotEmpty) {
      buffer.writeln();
      for (final line in _nftRuleBlock(outbound)) {
        buffer.writeln('$_tab$_tab$line');
      }
    }
    buffer.writeln('$_tab}');
    buffer.writeln('}');
    return buffer.toString();
  }

  List<String> _nftInputPreamble(FirewallRuleSetInput input) {
    final lines = <String>[];
    if (input.allowEstablished) {
      lines.add('# Replies to connections this host started. Without this, a policy-drop');
      lines.add('# input chain also breaks DNS, package updates and outbound HTTPS.');
      lines.add('ct state established,related accept');
      lines.add('ct state invalid drop');
    }
    if (input.allowLoopback) {
      if (lines.isNotEmpty) lines.add('');
      lines.add('# Local services talk to each other over loopback.');
      lines.add('iif "lo" accept');
    }
    if (input.allowIcmp) {
      if (lines.isNotEmpty) lines.add('');
      lines.add('# ICMP: dropping ICMPv6 neighbour discovery breaks IPv6 entirely,');
      lines.add('# dropping ICMP breaks path MTU discovery.');
      lines.add('ip protocol icmp accept');
      lines.add('ip6 nexthdr ipv6-icmp accept');
    }
    return lines;
  }

  List<String> _nftRuleBlock(List<FirewallRule> rules) {
    final lines = <String>[];
    for (final rule in rules) {
      if (rule.action == FirewallAction.limit) {
        lines.add('# Rate limit approximates `ufw limit` (6 new connections / 30s per source).');
      }
      lines.add(nftRuleStatement(rule));
    }
    return lines;
  }

  /// The single nft rule statement for [rule], without indentation. Public so
  /// the UI can preview a row.
  static String nftRuleStatement(FirewallRule rule) {
    final tokens = <String>[];

    if (rule.interfaceName != null) {
      final key = rule.direction == FirewallDirection.inbound ? 'iifname' : 'oifname';
      tokens.add('$key "${rule.interfaceName!.trim()}"');
    }

    final source = _normalizeAddress(rule.source);
    if (source != null) {
      tokens.add('${isIpv6Cidr(source) ? 'ip6' : 'ip'} saddr $source');
    }
    final destination = _normalizeAddress(rule.destination);
    if (destination != null) {
      tokens.add('${isIpv6Cidr(destination) ? 'ip6' : 'ip'} daddr $destination');
    }

    final ports = rule.ports;
    if (ports != null) {
      switch (rule.protocol) {
        case FirewallProtocol.tcp:
        case FirewallProtocol.udp:
          tokens.add('${rule.protocol.keyword} dport ${ports.nftText}');
        case FirewallProtocol.any:
          // `th dport` matches the transport header of whichever of the two
          // protocols l4proto selected.
          tokens.add('meta l4proto { tcp, udp } th dport ${ports.nftText}');
      }
    } else if (rule.protocol.isSpecific) {
      tokens.add('meta l4proto ${rule.protocol.keyword}');
    }

    if (rule.action == FirewallAction.limit) {
      tokens.add('ct state new limit rate 6/minute burst 6 packets');
    }

    if (rule.logged) {
      tokens.add('log prefix "${_nftLogPrefix(rule)}" level info');
    }

    tokens.add(rule.action.nftVerdict);

    final comment = _sanitizeComment(rule.comment);
    if (comment != null) {
      tokens.add('comment "$comment"');
    }

    return tokens.join(' ');
  }

  static String _nftPolicy(FirewallAction action) => action.permitsTraffic ? 'accept' : 'drop';

  static String _nftLogPrefix(FirewallRule rule) {
    final comment = _sanitizeComment(rule.comment);
    final base = comment ?? '${rule.direction.ufwKeyword}-${rule.action.ufwKeyword}';
    // nft caps log prefixes at 127 characters; keep well under it.
    final trimmed = base.length > 48 ? base.substring(0, 48) : base;
    return '${trimmed.replaceAll(RegExp(r'\s+'), '-')} ';
  }

  // ------------------------------------------------------------------
  // Shared helpers
  // ------------------------------------------------------------------

  /// Trims an address, and maps the "no restriction" spellings to null so the
  /// renderers can omit the match entirely.
  static String? _normalizeAddress(String? raw) {
    if (raw == null) return null;
    final text = raw.trim();
    if (text.isEmpty || isAnyAddress(text)) return null;
    return text;
  }

  /// Strips the characters neither dialect can carry inside its own comment
  /// syntax. Returns null when nothing usable is left.
  static String? _sanitizeComment(String? raw) {
    if (raw == null) return null;
    final text = raw.replaceAll(RegExp(r'''['"\\\r\n]'''), ' ').replaceAll(RegExp(r'\s+'), ' ').trim();
    return text.isEmpty ? null : text;
  }

  static List<String> _wrapComment(String text, {int width = 72}) {
    final words = text.split(' ');
    final lines = <String>[];
    var current = StringBuffer();
    for (final word in words) {
      if (current.isEmpty) {
        current.write(word);
      } else if (current.length + 1 + word.length <= width) {
        current.write(' $word');
      } else {
        lines.add(current.toString());
        current = StringBuffer(word);
      }
    }
    if (current.isNotEmpty) lines.add(current.toString());
    return lines;
  }
}

// ----------------------------------------------------------------------
// Address validation (pure, reusable by the UI for inline field errors)
// ----------------------------------------------------------------------

/// The spellings that mean "no address restriction".
bool isAnyAddress(String raw) {
  final text = raw.trim().toLowerCase();
  return text.isEmpty || text == 'any' || text == '0.0.0.0/0' || text == '::/0';
}

/// True when [raw] is a valid IPv4 or IPv6 address, with an optional prefix
/// length.
bool isValidCidr(String raw) => _parseCidr(raw) != null;

/// True when [raw] is an IPv6 address/CIDR (as opposed to IPv4).
bool isIpv6Cidr(String raw) => _parseCidr(raw)?.isV6 ?? raw.contains(':');

({bool isV6, int prefix})? _parseCidr(String raw) {
  final text = raw.trim();
  if (text.isEmpty) return null;

  final slash = text.indexOf('/');
  final address = slash < 0 ? text : text.substring(0, slash);
  final prefixText = slash < 0 ? null : text.substring(slash + 1);

  final isV6 = address.contains(':');
  final maxPrefix = isV6 ? 128 : 32;

  var prefix = maxPrefix;
  if (prefixText != null) {
    if (prefixText.isEmpty || prefixText.length > 3) return null;
    final parsed = int.tryParse(prefixText);
    if (parsed == null || parsed < 0 || parsed > maxPrefix) return null;
    prefix = parsed;
  }

  final valid = isV6 ? _isValidIpv6(address) : _isValidIpv4(address);
  return valid ? (isV6: isV6, prefix: prefix) : null;
}

bool _isValidIpv4(String address) {
  final parts = address.split('.');
  if (parts.length != 4) return false;
  for (final part in parts) {
    if (part.isEmpty || part.length > 3) return false;
    if (!RegExp(r'^\d+$').hasMatch(part)) return false;
    // Reject "010" — a leading zero reads as octal to some parsers and as
    // decimal to others, which is exactly how firewall rules end up matching
    // an address nobody intended.
    if (part.length > 1 && part.startsWith('0')) return false;
    final value = int.parse(part);
    if (value > 255) return false;
  }
  return true;
}

bool _isValidIpv6(String address) {
  if (address.contains(':::')) return false;

  final doubleColon = address.indexOf('::');
  if (doubleColon != address.lastIndexOf('::')) return false;

  List<String> head;
  List<String> tail;
  if (doubleColon < 0) {
    head = address.split(':');
    tail = const [];
  } else {
    final headText = address.substring(0, doubleColon);
    final tailText = address.substring(doubleColon + 2);
    if (headText.endsWith(':') || tailText.startsWith(':')) return false;
    head = headText.isEmpty ? const [] : headText.split(':');
    tail = tailText.isEmpty ? const [] : tailText.split(':');
  }

  final groups = [...head, ...tail];
  if (groups.isEmpty) return doubleColon >= 0; // "::" itself.

  var count = groups.length;

  // A trailing dotted quad (IPv4-mapped form) occupies two 16-bit groups.
  final last = groups.last;
  if (last.contains('.')) {
    if (!_isValidIpv4(last)) return false;
    count += 1;
    groups.removeLast();
  }

  for (final group in groups) {
    if (group.isEmpty || group.length > 4) return false;
    if (!RegExp(r'^[0-9A-Fa-f]+$').hasMatch(group)) return false;
  }

  return doubleColon < 0 ? count == 8 : count < 8;
}
