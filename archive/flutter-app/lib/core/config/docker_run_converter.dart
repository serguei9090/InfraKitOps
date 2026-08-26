import '../ports/i_tool_use_case.dart';

/// Input for [DockerRunConverter]: a raw `docker run ...` command line,
/// exactly as a user would paste it from a README or shell history
/// (multi-line with trailing backslashes is fine).
class DockerRunInput {
  const DockerRunInput({required this.command});

  final String command;
}

/// Result of a `docker run` -> Compose conversion.
///
/// [warnings] lists flags that were recognised as valid `docker run` flags
/// but deliberately **not** translated. Silently dropping a flag would
/// produce a compose file that quietly does the wrong thing, so every
/// unmapped flag is surfaced here as `ignored: --foo`.
///
/// [notes] lists flags that *were* handled but whose Compose semantics
/// differ from `docker run` (for example `--rm`, which has no service-level
/// equivalent at all).
class DockerRunResult {
  const DockerRunResult({
    required this.isValid,
    this.yaml,
    this.warnings = const <String>[],
    this.notes = const <String>[],
    this.errorMessage,
  });

  /// False when the command could not be parsed at all (bad quoting, no
  /// image, not a `docker run` command). [yaml] is then null and
  /// [errorMessage] explains why.
  final bool isValid;

  /// The generated `docker-compose.yml` document.
  final String? yaml;

  /// Recognised-but-untranslated flags, formatted `ignored: --foo`.
  final List<String> warnings;

  /// Handled flags whose Compose behaviour differs from `docker run`.
  final List<String> notes;

  final String? errorMessage;
}

/// Splits a shell-style command line into argv tokens.
///
/// A naive `split(' ')` mangles `-e "FOO=bar baz"` into three tokens, so
/// this walks the string one character at a time and honours:
///
/// * single quotes — everything up to the closing quote is literal;
/// * double quotes — literal except `\"`, `\\`, `\$` and ``\` ``;
/// * backslash escapes outside quotes;
/// * backslash-newline line continuations (how multi-line `docker run`
///   snippets are almost always written).
///
/// Deliberate deviation from POSIX `sh`: outside quotes, a backslash only
/// escapes a shell-special character (whitespace, quotes, `$`, backtick,
/// backslash, newline). Anything else keeps its backslash, so a pasted
/// Windows path such as `-v C:\data:/data` survives instead of being
/// silently rewritten to `C:data:/data`. Strict `sh` would eat the
/// backslash; here that behaviour loses user data for no benefit.
///
/// Throws [FormatException] on an unterminated quote.
List<String> tokenizeDockerCommand(String input) {
  final tokens = <String>[];
  final current = StringBuffer();
  var hasToken = false;
  var i = 0;

  const shellSpecial = {' ', '\t', '\n', '\r', '"', "'", r'$', '`', '\\'};

  while (i < input.length) {
    final ch = input[i];

    if (ch == '\\') {
      if (i + 1 >= input.length) {
        i++;
        continue;
      }
      final next = input[i + 1];
      if (next == '\n') {
        i += 2;
        continue;
      }
      if (next == '\r') {
        i += 2;
        if (i < input.length && input[i] == '\n') i++;
        continue;
      }
      if (shellSpecial.contains(next)) {
        current.write(next);
      } else {
        current.write('\\');
        current.write(next);
      }
      hasToken = true;
      i += 2;
      continue;
    }

    if (ch == "'") {
      hasToken = true;
      i++;
      while (i < input.length && input[i] != "'") {
        current.write(input[i]);
        i++;
      }
      if (i >= input.length) {
        throw const FormatException("Unterminated single quote (')");
      }
      i++;
      continue;
    }

    if (ch == '"') {
      hasToken = true;
      i++;
      while (i < input.length && input[i] != '"') {
        if (input[i] == '\\' && i + 1 < input.length) {
          final next = input[i + 1];
          if (next == '"' || next == '\\' || next == r'$' || next == '`') {
            current.write(next);
            i += 2;
            continue;
          }
          if (next == '\n') {
            i += 2;
            continue;
          }
        }
        current.write(input[i]);
        i++;
      }
      if (i >= input.length) {
        throw const FormatException('Unterminated double quote (")');
      }
      i++;
      continue;
    }

    if (ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r') {
      if (hasToken) {
        tokens.add(current.toString());
        current.clear();
        hasToken = false;
      }
      i++;
      continue;
    }

    current.write(ch);
    hasToken = true;
    i++;
  }

  if (hasToken) tokens.add(current.toString());
  return tokens;
}

/// Converts a `docker run` command line into an equivalent
/// `docker-compose.yml` service definition.
///
/// The `yaml` package vendored in this repo is parse-only (it ships no
/// emitter), so the YAML here is hand-serialised, following the same
/// scalar-quoting rules as `lib/core/utility/yaml_formatter.dart` — see
/// [_scalar] / [_needsQuoting].
///
/// One quoting rule is stricter than the formatter's: published ports are
/// **always** quoted. `53:53` is a base-60 integer under YAML 1.1 (which
/// several Compose implementations still resolve with), so an unquoted
/// `- 53:53` can silently become the number 3183. Compose's own docs
/// recommend quoting port mappings for exactly this reason.
class DockerRunConverter implements IToolUseCase<DockerRunInput, DockerRunResult> {
  const DockerRunConverter();

  @override
  DockerRunResult execute(DockerRunInput input) {
    final raw = input.command.trim();
    if (raw.isEmpty) {
      return const DockerRunResult(
        isValid: false,
        errorMessage: 'Paste a `docker run ...` command to convert.',
      );
    }

    List<String> tokens;
    try {
      tokens = tokenizeDockerCommand(raw);
    } on FormatException catch (e) {
      return DockerRunResult(isValid: false, errorMessage: e.message);
    }

    tokens = _stripCommandPrefix(tokens);
    if (tokens.isEmpty) {
      return const DockerRunResult(
        isValid: false,
        errorMessage: 'No `docker run` invocation found in the input.',
      );
    }

    final parsed = _Parsed();
    final index = _parseFlags(tokens, parsed);

    if (index >= tokens.length) {
      return DockerRunResult(
        isValid: false,
        warnings: parsed.warnings,
        notes: parsed.notes,
        errorMessage: 'No IMAGE found — a `docker run` command must name an image '
            'after its flags.',
      );
    }

    parsed.image = tokens[index];
    parsed.command = tokens.sublist(index + 1);

    final yaml = _emitYaml(parsed);
    return DockerRunResult(
      isValid: true,
      yaml: yaml,
      warnings: List.unmodifiable(parsed.warnings),
      notes: List.unmodifiable(parsed.notes),
    );
  }

  // ---------------------------------------------------------------- parsing

  /// Drops any `sudo` / `docker` / `podman` / `container` / `run` prefix so
  /// the parser starts at the first flag. Also tolerates a bare flag list
  /// with no `docker run` at all.
  List<String> _stripCommandPrefix(List<String> tokens) {
    var i = 0;
    const prefixes = {'sudo', 'docker', 'podman', 'container', 'run', 'create'};
    while (i < tokens.length && prefixes.contains(tokens[i])) {
      i++;
    }
    return tokens.sublist(i);
  }

  /// Consumes flags from [tokens], filling [p]. Returns the index of the
  /// first non-flag token (the IMAGE).
  int _parseFlags(List<String> tokens, _Parsed p) {
    var i = 0;
    while (i < tokens.length) {
      final token = tokens[i];

      if (token == '--') {
        i++;
        break;
      }
      if (!token.startsWith('-') || token == '-') break;

      if (token.startsWith('--')) {
        final body = token.substring(2);
        final eq = body.indexOf('=');
        if (eq >= 0) {
          _apply(body.substring(0, eq), body.substring(eq + 1), p, hadValue: true);
          i++;
          continue;
        }
        final name = body;
        if (_valueFlags.contains(name)) {
          if (i + 1 >= tokens.length) {
            p.warnings.add('ignored: --$name (missing value)');
            i++;
            continue;
          }
          _apply(name, tokens[i + 1], p, hadValue: true);
          i += 2;
          continue;
        }
        if (!_booleanFlags.contains(name)) {
          p.warnings.add('ignored: --$name (unrecognised flag, assumed to take no value)');
          i++;
          continue;
        }
        _apply(name, null, p, hadValue: false);
        i++;
        continue;
      }

      // Short form: possibly clustered (-it) and possibly with an attached
      // value (-p8080:80).
      final cluster = token.substring(1);
      var consumedNext = false;
      for (var c = 0; c < cluster.length; c++) {
        final letter = cluster[c];
        final long = _shortAliases[letter];
        if (long == null) {
          p.warnings.add('ignored: -$letter (unrecognised short flag)');
          continue;
        }
        if (_valueFlags.contains(long)) {
          // A value-taking short flag swallows the rest of the cluster as
          // its value (`-p8080:80`), or the next token when nothing is
          // attached (`-p 8080:80`).
          final attached = cluster.substring(c + 1);
          if (attached.isNotEmpty) {
            _apply(long, attached, p, hadValue: true);
          } else if (i + 1 < tokens.length) {
            _apply(long, tokens[i + 1], p, hadValue: true);
            consumedNext = true;
          } else {
            p.warnings.add('ignored: -$letter (missing value)');
          }
          break;
        }
        _apply(long, null, p, hadValue: false);
      }
      i += consumedNext ? 2 : 1;
    }
    return i;
  }

  void _apply(String flag, String? value, _Parsed p, {required bool hadValue}) {
    String v() => value ?? '';
    bool boolValue() => value == null || value.toLowerCase() != 'false';

    switch (flag) {
      // ---- identity / process ----
      case 'name':
        p.containerName = v();
      case 'hostname':
        p.fields['hostname'] = v();
      case 'domainname':
        p.fields['domainname'] = v();
      case 'user':
        p.fields['user'] = v();
      case 'workdir':
        p.fields['working_dir'] = v();
      case 'entrypoint':
        p.entrypoint = v();
      case 'interactive':
        p.stdinOpen = boolValue();
      case 'tty':
        p.tty = boolValue();
      case 'init':
        p.fields['init'] = boolValue() ? 'true' : 'false';
      case 'read-only':
        p.fields['read_only'] = boolValue() ? 'true' : 'false';
      case 'privileged':
        p.fields['privileged'] = boolValue() ? 'true' : 'false';

      case 'detach':
        p.notes.add(
          '-d/--detach has no service-level equivalent; run `docker compose up -d` instead.',
        );
      case 'rm':
        p.notes.add(
          '--rm has no Compose equivalent; use `docker compose run --rm <service>` '
          'or remove containers with `docker compose down`.',
        );

      // ---- ports ----
      case 'publish':
        p.ports.add(_normalisePort(v(), p));
      case 'expose':
        p.expose.add(v());
      case 'publish-all':
        p.warnings.add('ignored: -P/--publish-all (Compose has no publish-all; '
            'list the ports explicitly)');

      // ---- storage ----
      case 'volume':
        _applyVolume(v(), p);
      case 'tmpfs':
        p.tmpfs.add(v());
      case 'volumes-from':
        p.volumesFrom.add(v());
      case 'device':
        p.devices.add(v());
      case 'mount':
        p.warnings.add('ignored: --mount $value (use -v/--volume, or hand-write '
            'the Compose long volume syntax)');

      // ---- environment ----
      case 'env':
        p.environment.add(v());
      case 'env-file':
        p.envFiles.add(v());
      case 'label':
        p.labels.add(v());
      case 'label-file':
        p.warnings.add('ignored: --label-file (Compose has no label-file; inline '
            'the labels)');

      // ---- networking ----
      case 'network':
      case 'net':
        _applyNetwork(v(), p);
      case 'network-alias':
        p.warnings.add('ignored: --network-alias $value (needs the Compose long '
            'network syntax with `aliases:`)');
      case 'add-host':
        p.extraHosts.add(v());
      case 'dns':
        p.dns.add(v());
      case 'dns-search':
        p.dnsSearch.add(v());
      case 'dns-option':
      case 'dns-opt':
        p.dnsOpt.add(v());
      case 'mac-address':
        p.fields['mac_address'] = v();
      case 'ip':
      case 'ip6':
      case 'link-local-ip':
        p.warnings.add('ignored: --$flag $value (needs the Compose long network '
            'syntax with `ipv4_address`/`ipv6_address`)');
      case 'link':
        p.links.add(v());

      // ---- lifecycle ----
      case 'restart':
        p.fields['restart'] = v();
      case 'stop-signal':
        p.fields['stop_signal'] = v();
      case 'stop-timeout':
        p.fields['stop_grace_period'] = '${v()}s';

      // ---- security / kernel ----
      case 'cap-add':
        p.capAdd.add(v());
      case 'cap-drop':
        p.capDrop.add(v());
      case 'security-opt':
        p.securityOpt.add(v());
      case 'sysctl':
        p.sysctls.add(v());
      case 'group-add':
        p.groupAdd.add(v());
      case 'userns':
        p.fields['userns_mode'] = v();
      case 'pid':
        p.fields['pid'] = v();
      case 'ipc':
        p.fields['ipc'] = v();
      case 'uts':
        p.fields['uts'] = v();
      case 'cgroup-parent':
        p.fields['cgroup_parent'] = v();
      case 'cgroupns':
        p.fields['cgroup'] = v();

      // ---- resources ----
      case 'memory':
        p.fields['mem_limit'] = v();
      case 'memory-reservation':
        p.fields['mem_reservation'] = v();
      case 'memory-swap':
        p.fields['memswap_limit'] = v();
      case 'memory-swappiness':
        p.fields['mem_swappiness'] = v();
      case 'cpus':
        p.cpus = v();
      case 'cpu-shares':
        p.cpuShares = v();
      case 'cpuset-cpus':
        p.fields['cpuset'] = v();
      case 'pids-limit':
        p.pidsLimit = v();
      case 'oom-kill-disable':
        p.fields['oom_kill_disable'] = boolValue() ? 'true' : 'false';
      case 'oom-score-adj':
        p.oomScoreAdj = v();
      case 'shm-size':
        p.fields['shm_size'] = v();
      case 'gpus':
        p.warnings.add('ignored: --gpus $value (needs '
            '`deploy.resources.reservations.devices` in Compose)');

      // ---- healthcheck ----
      case 'health-cmd':
        p.healthCmd = v();
      case 'health-interval':
        p.healthInterval = v();
      case 'health-timeout':
        p.healthTimeout = v();
      case 'health-retries':
        p.healthRetries = v();
      case 'health-start-period':
        p.healthStartPeriod = v();
      case 'health-start-interval':
        p.healthStartInterval = v();
      case 'no-healthcheck':
        p.noHealthcheck = true;

      // ---- logging ----
      case 'log-driver':
        p.logDriver = v();
      case 'log-opt':
        p.logOpts.add(v());

      // ---- misc pass-through ----
      case 'platform':
        p.fields['platform'] = v();
      case 'runtime':
        p.fields['runtime'] = v();
      case 'isolation':
        p.fields['isolation'] = v();
      case 'storage-opt':
        p.storageOpt.add(v());
      case 'pull':
        p.fields['pull_policy'] = v();

      default:
        p.warnings.add(hadValue ? 'ignored: --$flag $value' : 'ignored: --$flag');
    }
  }

  /// `-p` accepts `containerPort`, `host:container`, `ip:host:container`, and
  /// any of those with a `/udp` (or `/tcp`, `/sctp`) suffix, plus port
  /// ranges. All of those are already valid Compose *short syntax*, so this
  /// is a validating pass-through rather than a rewrite.
  String _normalisePort(String spec, _Parsed p) {
    final trimmed = spec.trim();
    if (trimmed.isEmpty) {
      p.warnings.add('ignored: -p (empty port specification)');
      return trimmed;
    }
    // Split off the optional /proto suffix, then count the colon-separated
    // fields. IPv6 host IPs are bracketed (`[::1]:8080:80`) so a plain colon
    // count is only safe after the bracketed part is set aside.
    final slash = trimmed.lastIndexOf('/');
    final body = slash > 0 ? trimmed.substring(0, slash) : trimmed;
    var fieldSource = body;
    if (body.startsWith('[')) {
      final close = body.indexOf(']');
      if (close > 0) fieldSource = body.substring(close + 1);
    }
    final fields = fieldSource.split(':').where((f) => f.isNotEmpty).length;
    if (fields > 3) {
      p.warnings.add('ignored: -p $spec (unrecognised port specification)');
    }
    return trimmed;
  }

  /// `-v` is either `container_path` (anonymous volume), `src:dst`, or
  /// `src:dst:opts`. A `src` that is not a filesystem path is a *named*
  /// volume, which Compose additionally requires to be declared in the
  /// top-level `volumes:` block.
  void _applyVolume(String spec, _Parsed p) {
    if (spec.isEmpty) {
      p.warnings.add('ignored: -v (empty volume specification)');
      return;
    }

    // Keep `C:\data` together instead of splitting it at the drive colon.
    var head = '';
    var rest = spec;
    if (RegExp(r'^[A-Za-z]:[\\/]').hasMatch(spec)) {
      head = spec.substring(0, 2);
      rest = spec.substring(2);
    }
    final parts = rest.split(':');
    if (head.isNotEmpty) parts[0] = head + parts[0];

    p.volumes.add(spec);

    if (parts.length < 2) return; // anonymous volume, nothing to declare
    final source = parts[0];
    if (_isNamedVolume(source)) p.namedVolumes.add(source);
  }

  static final _namedVolumePattern = RegExp(r'^[a-zA-Z0-9][a-zA-Z0-9_.-]*$');

  bool _isNamedVolume(String source) {
    if (source.startsWith('/') ||
        source.startsWith('./') ||
        source.startsWith('../') ||
        source.startsWith('~') ||
        source.startsWith(r'$') ||
        source.contains('\\')) {
      return false;
    }
    if (RegExp(r'^[A-Za-z]:').hasMatch(source)) return false;
    return _namedVolumePattern.hasMatch(source);
  }

  /// The four built-in network modes map to `network_mode:`; anything else
  /// is a user-defined network, which becomes a `networks:` membership plus
  /// a top-level declaration.
  void _applyNetwork(String spec, _Parsed p) {
    if (spec.isEmpty) return;
    if (spec == 'host' || spec == 'none' || spec == 'bridge' || spec == 'default') {
      p.networkMode = spec;
      return;
    }
    if (spec.startsWith('container:')) {
      p.networkMode = spec;
      return;
    }
    p.networks.add(spec);
  }

  // --------------------------------------------------------------- emitting

  String _emitYaml(_Parsed p) {
    final service = <String, Object?>{};

    service['image'] = _scalar(p.image);
    if (p.containerName != null) service['container_name'] = _scalar(p.containerName!);

    for (final key in const ['hostname', 'domainname', 'user', 'working_dir']) {
      final value = p.fields[key];
      if (value != null) service[key] = _scalar(value);
    }

    if (p.entrypoint != null) service['entrypoint'] = _scalar(p.entrypoint!);
    if (p.command.isNotEmpty) service['command'] = _flowList(p.command);

    if (p.environment.isNotEmpty) {
      service['environment'] = p.environment.map(_scalar).toList();
    }
    if (p.envFiles.isNotEmpty) service['env_file'] = p.envFiles.map(_scalar).toList();

    if (p.ports.isNotEmpty) service['ports'] = p.ports.map(_quote).toList();
    if (p.expose.isNotEmpty) service['expose'] = p.expose.map(_quote).toList();

    if (p.volumes.isNotEmpty) service['volumes'] = p.volumes.map(_scalar).toList();
    if (p.tmpfs.isNotEmpty) service['tmpfs'] = p.tmpfs.map(_scalar).toList();
    if (p.volumesFrom.isNotEmpty) {
      service['volumes_from'] = p.volumesFrom.map(_scalar).toList();
    }
    if (p.devices.isNotEmpty) service['devices'] = p.devices.map(_scalar).toList();

    if (p.networkMode != null) service['network_mode'] = _scalar(p.networkMode!);
    if (p.networks.isNotEmpty) service['networks'] = p.networks.map(_scalar).toList();
    if (p.links.isNotEmpty) service['links'] = p.links.map(_scalar).toList();
    if (p.dns.isNotEmpty) service['dns'] = p.dns.map(_scalar).toList();
    if (p.dnsSearch.isNotEmpty) service['dns_search'] = p.dnsSearch.map(_scalar).toList();
    if (p.dnsOpt.isNotEmpty) service['dns_opt'] = p.dnsOpt.map(_scalar).toList();
    if (p.extraHosts.isNotEmpty) {
      service['extra_hosts'] = p.extraHosts.map(_scalar).toList();
    }

    final restart = p.fields['restart'];
    if (restart != null) service['restart'] = _scalar(restart);
    if (p.labels.isNotEmpty) service['labels'] = p.labels.map(_scalar).toList();

    if (p.capAdd.isNotEmpty) service['cap_add'] = p.capAdd.map(_scalar).toList();
    if (p.capDrop.isNotEmpty) service['cap_drop'] = p.capDrop.map(_scalar).toList();
    if (p.securityOpt.isNotEmpty) {
      service['security_opt'] = p.securityOpt.map(_scalar).toList();
    }
    if (p.sysctls.isNotEmpty) service['sysctls'] = p.sysctls.map(_scalar).toList();
    if (p.groupAdd.isNotEmpty) service['group_add'] = p.groupAdd.map(_scalar).toList();
    if (p.storageOpt.isNotEmpty) {
      service['storage_opt'] = {
        for (final entry in p.storageOpt) ..._splitKeyValue(entry),
      };
    }

    for (final key in const [
      'privileged',
      'read_only',
      'init',
      'oom_kill_disable',
      'shm_size',
      'pid',
      'ipc',
      'uts',
      'userns_mode',
      'cgroup',
      'cgroup_parent',
      'stop_signal',
      'stop_grace_period',
      'mac_address',
      'platform',
      'runtime',
      'isolation',
      'pull_policy',
      'mem_limit',
      'mem_reservation',
      'memswap_limit',
      'mem_swappiness',
      'cpuset',
    ]) {
      final value = p.fields[key];
      if (value != null) {
        service[key] = key == 'privileged' ||
                key == 'read_only' ||
                key == 'init' ||
                key == 'oom_kill_disable'
            ? value
            : _scalar(value);
      }
    }

    if (p.cpus != null) service['cpus'] = _numericOrScalar(p.cpus!);
    if (p.cpuShares != null) service['cpu_shares'] = _numericOrScalar(p.cpuShares!);
    if (p.pidsLimit != null) service['pids_limit'] = _numericOrScalar(p.pidsLimit!);
    if (p.oomScoreAdj != null) service['oom_score_adj'] = _numericOrScalar(p.oomScoreAdj!);

    if (p.logDriver != null || p.logOpts.isNotEmpty) {
      final logging = <String, Object?>{};
      if (p.logDriver != null) logging['driver'] = _scalar(p.logDriver!);
      if (p.logOpts.isNotEmpty) {
        logging['options'] = {for (final o in p.logOpts) ..._splitKeyValue(o)};
      }
      service['logging'] = logging;
    }

    if (p.stdinOpen) service['stdin_open'] = 'true';
    if (p.tty) service['tty'] = 'true';

    final healthcheck = _buildHealthcheck(p);
    if (healthcheck != null) service['healthcheck'] = healthcheck;

    final buffer = StringBuffer();
    buffer.writeln('services:');
    buffer.writeln('  ${_serviceName(p)}:');
    _writeMap(buffer, service, 4);

    if (p.namedVolumes.isNotEmpty) {
      buffer.writeln();
      buffer.writeln('volumes:');
      for (final name in p.namedVolumes) {
        buffer.writeln('  ${_scalar(name)}:');
      }
    }

    if (p.networks.isNotEmpty) {
      buffer.writeln();
      buffer.writeln('networks:');
      for (final name in p.networks) {
        buffer.writeln('  ${_scalar(name)}:');
        // `docker run --network foo` requires `foo` to already exist, so
        // `external: true` is the faithful translation. Drop it to let
        // Compose create the network itself.
        buffer.writeln('    external: true');
      }
    }

    return buffer.toString().trimRight();
  }

  Map<String, Object?>? _buildHealthcheck(_Parsed p) {
    if (p.noHealthcheck) return {'disable': 'true'};
    if (p.healthCmd == null &&
        p.healthInterval == null &&
        p.healthTimeout == null &&
        p.healthRetries == null &&
        p.healthStartPeriod == null &&
        p.healthStartInterval == null) {
      return null;
    }
    final health = <String, Object?>{};
    if (p.healthCmd != null) {
      // `--health-cmd` is a shell string, which is exactly CMD-SHELL.
      health['test'] = '["CMD-SHELL", ${_jsonQuote(p.healthCmd!)}]';
    }
    if (p.healthInterval != null) health['interval'] = _scalar(p.healthInterval!);
    if (p.healthTimeout != null) health['timeout'] = _scalar(p.healthTimeout!);
    if (p.healthRetries != null) health['retries'] = _numericOrScalar(p.healthRetries!);
    if (p.healthStartPeriod != null) {
      health['start_period'] = _scalar(p.healthStartPeriod!);
    }
    if (p.healthStartInterval != null) {
      health['start_interval'] = _scalar(p.healthStartInterval!);
    }
    return health;
  }

  /// Service key: `--name` when given, else the image's repository basename
  /// with the tag/digest stripped, else `app`.
  String _serviceName(_Parsed p) {
    final explicit = p.containerName;
    if (explicit != null && explicit.isNotEmpty) return _sanitiseName(explicit);

    var image = p.image;
    final at = image.indexOf('@');
    if (at > 0) image = image.substring(0, at);
    final lastSlash = image.lastIndexOf('/');
    var base = lastSlash >= 0 ? image.substring(lastSlash + 1) : image;
    final colon = base.indexOf(':');
    if (colon > 0) base = base.substring(0, colon);
    final name = _sanitiseName(base);
    return name.isEmpty ? 'app' : name;
  }

  String _sanitiseName(String value) {
    final cleaned = value.toLowerCase().replaceAll(RegExp(r'[^a-z0-9_.-]'), '-');
    return cleaned.replaceAll(RegExp(r'^-+|-+$'), '');
  }

  Map<String, Object?> _splitKeyValue(String entry) {
    final eq = entry.indexOf('=');
    if (eq < 0) return {_scalar(entry): _scalar('')};
    return {entry.substring(0, eq): _scalar(entry.substring(eq + 1))};
  }

  void _writeMap(StringBuffer buffer, Map<String, Object?> map, int indent) {
    final pad = ' ' * indent;
    for (final entry in map.entries) {
      final value = entry.value;
      if (value is String) {
        buffer.writeln('$pad${entry.key}: $value');
      } else if (value is List<String>) {
        if (value.isEmpty) continue;
        buffer.writeln('$pad${entry.key}:');
        for (final item in value) {
          buffer.writeln('$pad  - $item');
        }
      } else if (value is Map<String, Object?>) {
        if (value.isEmpty) {
          buffer.writeln('$pad${entry.key}: {}');
          continue;
        }
        buffer.writeln('$pad${entry.key}:');
        _writeMap(buffer, value, indent + 2);
      } else {
        buffer.writeln('$pad${entry.key}:');
      }
    }
  }

  /// Renders a `["a", "b"]` flow sequence. Used for `command:` so the exact
  /// argv split from the source command line survives verbatim rather than
  /// being re-tokenised by the shell inside the container.
  String _flowList(List<String> items) =>
      '[${items.map(_jsonQuote).join(', ')}]';

  String _jsonQuote(String text) {
    final escaped = text
        .replaceAll('\\', r'\\')
        .replaceAll('"', r'\"')
        .replaceAll('\n', r'\n')
        .replaceAll('\t', r'\t');
    return '"$escaped"';
  }

  /// Emits an unquoted number when the text really is one, so `cpus: 1.5`
  /// and `retries: 3` come out as YAML numbers rather than strings.
  String _numericOrScalar(String text) {
    return num.tryParse(text) != null ? text : _scalar(text);
  }

  // Scalar quoting rules mirror lib/core/utility/yaml_formatter.dart so the
  // two hand-rolled emitters in this codebase stay consistent.
  String _scalar(String text) => _needsQuoting(text) ? _quote(text) : text;

  String _quote(String text) {
    final escaped =
        text.replaceAll('\\', r'\\').replaceAll('"', r'\"').replaceAll('\n', r'\n');
    return '"$escaped"';
  }

  bool _needsQuoting(String text) {
    if (text.isEmpty) return true;
    if (text.trim() != text) return true;
    if (text.contains('\n')) return true;
    if (_reservedWords.hasMatch(text)) return true;
    if (_numericLike.hasMatch(text)) return true;
    if (text.contains(': ') || text.endsWith(':')) return true;
    if (text.contains('#')) return true;
    if (_leadingSpecialChar.hasMatch(text)) return true;
    return false;
  }

  static final _reservedWords =
      RegExp(r'^(true|false|null|~|yes|no|on|off)$', caseSensitive: false);
  static final _numericLike = RegExp(r'^-?\d+(\.\d+)?([eE][+-]?\d+)?$');
  static final _leadingSpecialChar = RegExp(r'''^[\[\]{}&*!|>%@`"'#,-]''');
}

/// Mutable accumulator used while walking the argv list.
class _Parsed {
  String image = '';
  String? containerName;
  String? entrypoint;
  List<String> command = const [];

  final Map<String, String> fields = {};

  final List<String> ports = [];
  final List<String> expose = [];
  final List<String> volumes = [];
  final List<String> namedVolumes = [];
  final List<String> tmpfs = [];
  final List<String> volumesFrom = [];
  final List<String> devices = [];
  final List<String> environment = [];
  final List<String> envFiles = [];
  final List<String> labels = [];
  final List<String> networks = [];
  final List<String> links = [];
  final List<String> dns = [];
  final List<String> dnsSearch = [];
  final List<String> dnsOpt = [];
  final List<String> extraHosts = [];
  final List<String> capAdd = [];
  final List<String> capDrop = [];
  final List<String> securityOpt = [];
  final List<String> sysctls = [];
  final List<String> groupAdd = [];
  final List<String> storageOpt = [];
  final List<String> logOpts = [];

  String? networkMode;
  String? cpus;
  String? cpuShares;
  String? pidsLimit;
  String? oomScoreAdj;
  String? logDriver;

  bool stdinOpen = false;
  bool tty = false;

  String? healthCmd;
  String? healthInterval;
  String? healthTimeout;
  String? healthRetries;
  String? healthStartPeriod;
  String? healthStartInterval;
  bool noHealthcheck = false;

  final List<String> warnings = [];
  final List<String> notes = [];
}

/// Short flag letter -> long flag name. Needed both to expand clusters like
/// `-it` and to know whether a short flag consumes the next token.
const Map<String, String> _shortAliases = {
  'd': 'detach',
  'i': 'interactive',
  't': 'tty',
  'p': 'publish',
  'P': 'publish-all',
  'v': 'volume',
  'e': 'env',
  'w': 'workdir',
  'u': 'user',
  'h': 'hostname',
  'l': 'label',
  'm': 'memory',
  'c': 'cpu-shares',
  'a': 'attach',
};

/// Flags that consume the following token as their value. Getting this list
/// right is what stops the parser from mistaking a flag's value for the
/// IMAGE argument.
const Set<String> _valueFlags = {
  'add-host', 'annotation', 'attach', 'blkio-weight', 'blkio-weight-device',
  'cap-add', 'cap-drop', 'cgroup-parent', 'cgroupns', 'cidfile', 'cpu-period',
  'cpu-quota', 'cpu-rt-period', 'cpu-rt-runtime', 'cpu-shares', 'cpus',
  'cpuset-cpus', 'cpuset-mems', 'detach-keys', 'device', 'device-cgroup-rule',
  'device-read-bps', 'device-read-iops', 'device-write-bps',
  'device-write-iops', 'dns', 'dns-opt', 'dns-option', 'dns-search',
  'domainname', 'entrypoint', 'env', 'env-file', 'expose', 'gpus', 'group-add',
  'health-cmd', 'health-interval', 'health-retries', 'health-start-interval',
  'health-start-period', 'health-timeout', 'hostname', 'ip', 'ip6', 'ipc',
  'isolation', 'kernel-memory', 'label', 'label-file', 'link', 'link-local-ip',
  'log-driver', 'log-opt', 'mac-address', 'memory', 'memory-reservation',
  'memory-swap', 'memory-swappiness', 'mount', 'name', 'net', 'network',
  'network-alias', 'oom-score-adj', 'pid', 'pids-limit', 'platform', 'publish',
  'pull', 'restart', 'runtime', 'security-opt', 'shm-size', 'stop-signal',
  'stop-timeout', 'storage-opt', 'sysctl', 'tmpfs', 'ulimit', 'user', 'userns',
  'uts', 'volume', 'volume-driver', 'volumes-from', 'workdir',
};

/// Flags that take no value (a `--flag=false` form is still handled).
const Set<String> _booleanFlags = {
  'detach', 'disable-content-trust', 'help', 'init', 'interactive',
  'no-healthcheck', 'oom-kill-disable', 'privileged', 'publish-all', 'quiet',
  'read-only', 'rm', 'sig-proxy', 'tty', 'use-api-socket',
};
