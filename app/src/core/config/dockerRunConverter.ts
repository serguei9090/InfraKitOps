import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Input for `DockerRunConverter`: a raw `docker run ...` command line,
 * exactly as a user would paste it from a README or shell history
 * (multi-line with trailing backslashes is fine).
 */
export interface DockerRunInput {
  command: string
}

/**
 * Result of a `docker run` -> Compose conversion.
 *
 * `warnings` lists flags that were recognised as valid `docker run` flags
 * but deliberately **not** translated. Silently dropping a flag would
 * produce a compose file that quietly does the wrong thing, so every
 * unmapped flag is surfaced here as `ignored: --foo`.
 *
 * `notes` lists flags that *were* handled but whose Compose semantics
 * differ from `docker run` (for example `--rm`, which has no service-level
 * equivalent at all).
 */
export interface DockerRunResult {
  /**
   * False when the command could not be parsed at all (bad quoting, no
   * image, not a `docker run` command). `yaml` is then undefined and
   * `errorMessage` explains why.
   */
  isValid: boolean
  /** The generated `docker-compose.yml` document. */
  yaml?: string
  /** Recognised-but-untranslated flags, formatted `ignored: --foo`. */
  warnings: string[]
  /** Handled flags whose Compose behaviour differs from `docker run`. */
  notes: string[]
  errorMessage?: string
}

/**
 * Splits a shell-style command line into argv tokens.
 *
 * A naive `split(' ')` mangles `-e "FOO=bar baz"` into three tokens, so
 * this walks the string one character at a time and honours:
 *
 * * single quotes — everything up to the closing quote is literal;
 * * double quotes — literal except `\"`, `\\`, `\$` and `` \` ``;
 * * backslash escapes outside quotes;
 * * backslash-newline line continuations (how multi-line `docker run`
 *   snippets are almost always written).
 *
 * Deliberate deviation from POSIX `sh`: outside quotes, a backslash only
 * escapes a shell-special character (whitespace, quotes, `$`, backtick,
 * backslash, newline). Anything else keeps its backslash, so a pasted
 * Windows path such as `-v C:\data:/data` survives instead of being
 * silently rewritten to `C:data:/data`. Strict `sh` would eat the
 * backslash; here that behaviour loses user data for no benefit.
 *
 * Throws on an unterminated quote.
 */
export function tokenizeDockerCommand(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let hasToken = false
  let i = 0

  const shellSpecial = new Set([' ', '\t', '\n', '\r', '"', "'", '$', '`', '\\'])

  while (i < input.length) {
    const ch = input[i]

    if (ch === '\\') {
      if (i + 1 >= input.length) {
        i++
        continue
      }
      const next = input[i + 1]
      if (next === '\n') {
        i += 2
        continue
      }
      if (next === '\r') {
        i += 2
        if (i < input.length && input[i] === '\n') i++
        continue
      }
      if (shellSpecial.has(next)) {
        current += next
      } else {
        current += '\\' + next
      }
      hasToken = true
      i += 2
      continue
    }

    if (ch === "'") {
      hasToken = true
      i++
      while (i < input.length && input[i] !== "'") {
        current += input[i]
        i++
      }
      if (i >= input.length) {
        throw new Error("Unterminated single quote (')")
      }
      i++
      continue
    }

    if (ch === '"') {
      hasToken = true
      i++
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          const next = input[i + 1]
          if (next === '"' || next === '\\' || next === '$' || next === '`') {
            current += next
            i += 2
            continue
          }
          if (next === '\n') {
            i += 2
            continue
          }
        }
        current += input[i]
        i++
      }
      if (i >= input.length) {
        throw new Error('Unterminated double quote (")')
      }
      i++
      continue
    }

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (hasToken) {
        tokens.push(current)
        current = ''
        hasToken = false
      }
      i++
      continue
    }

    current += ch
    hasToken = true
    i++
  }

  if (hasToken) tokens.push(current)
  return tokens
}

/** Mutable accumulator used while walking the argv list. */
interface Parsed {
  image: string
  containerName: string | null
  entrypoint: string | null
  command: string[]

  fields: Map<string, string>

  ports: string[]
  expose: string[]
  volumes: string[]
  namedVolumes: string[]
  tmpfs: string[]
  volumesFrom: string[]
  devices: string[]
  environment: string[]
  envFiles: string[]
  labels: string[]
  networks: string[]
  links: string[]
  dns: string[]
  dnsSearch: string[]
  dnsOpt: string[]
  extraHosts: string[]
  capAdd: string[]
  capDrop: string[]
  securityOpt: string[]
  sysctls: string[]
  groupAdd: string[]
  storageOpt: string[]
  logOpts: string[]

  networkMode: string | null
  cpus: string | null
  cpuShares: string | null
  pidsLimit: string | null
  oomScoreAdj: string | null
  logDriver: string | null

  stdinOpen: boolean
  tty: boolean

  healthCmd: string | null
  healthInterval: string | null
  healthTimeout: string | null
  healthRetries: string | null
  healthStartPeriod: string | null
  healthStartInterval: string | null
  noHealthcheck: boolean

  warnings: string[]
  notes: string[]
}

function newParsed(): Parsed {
  return {
    image: '',
    containerName: null,
    entrypoint: null,
    command: [],
    fields: new Map(),
    ports: [],
    expose: [],
    volumes: [],
    namedVolumes: [],
    tmpfs: [],
    volumesFrom: [],
    devices: [],
    environment: [],
    envFiles: [],
    labels: [],
    networks: [],
    links: [],
    dns: [],
    dnsSearch: [],
    dnsOpt: [],
    extraHosts: [],
    capAdd: [],
    capDrop: [],
    securityOpt: [],
    sysctls: [],
    groupAdd: [],
    storageOpt: [],
    logOpts: [],
    networkMode: null,
    cpus: null,
    cpuShares: null,
    pidsLimit: null,
    oomScoreAdj: null,
    logDriver: null,
    stdinOpen: false,
    tty: false,
    healthCmd: null,
    healthInterval: null,
    healthTimeout: null,
    healthRetries: null,
    healthStartPeriod: null,
    healthStartInterval: null,
    noHealthcheck: false,
    warnings: [],
    notes: [],
  }
}

/**
 * Short flag letter -> long flag name. Needed both to expand clusters like
 * `-it` and to know whether a short flag consumes the next token.
 */
const shortAliases: Record<string, string> = {
  d: 'detach',
  i: 'interactive',
  t: 'tty',
  p: 'publish',
  P: 'publish-all',
  v: 'volume',
  e: 'env',
  w: 'workdir',
  u: 'user',
  h: 'hostname',
  l: 'label',
  m: 'memory',
  c: 'cpu-shares',
  a: 'attach',
}

/**
 * Flags that consume the following token as their value. Getting this list
 * right is what stops the parser from mistaking a flag's value for the
 * IMAGE argument.
 */
const valueFlags = new Set([
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
])

/** Flags that take no value (a `--flag=false` form is still handled). */
const booleanFlags = new Set([
  'detach', 'disable-content-trust', 'help', 'init', 'interactive',
  'no-healthcheck', 'oom-kill-disable', 'privileged', 'publish-all', 'quiet',
  'read-only', 'rm', 'sig-proxy', 'tty', 'use-api-socket',
])

/**
 * Converts a `docker run` command line into an equivalent
 * `docker-compose.yml` service definition.
 *
 * The YAML here is hand-serialised (no external YAML library, per the
 * browser-safe / zero-new-dependency constraint), following the same
 * scalar-quoting rules as the Dart reference's `yaml_formatter.dart`.
 *
 * One quoting rule is stricter than a generic formatter's: published ports
 * are **always** quoted. `53:53` is a base-60 integer under YAML 1.1 (which
 * several Compose implementations still resolve with), so an unquoted
 * `- 53:53` can silently become the number 3183. Compose's own docs
 * recommend quoting port mappings for exactly this reason.
 */
export class DockerRunConverter implements IToolUseCase<DockerRunInput, DockerRunResult> {
  execute(input: DockerRunInput): DockerRunResult {
    const raw = input.command.trim()
    if (raw.length === 0) {
      return { isValid: false, warnings: [], notes: [], errorMessage: 'Paste a `docker run ...` command to convert.' }
    }

    let tokens: string[]
    try {
      tokens = tokenizeDockerCommand(raw)
    } catch (e) {
      return { isValid: false, warnings: [], notes: [], errorMessage: e instanceof Error ? e.message : String(e) }
    }

    tokens = this.stripCommandPrefix(tokens)
    if (tokens.length === 0) {
      return { isValid: false, warnings: [], notes: [], errorMessage: 'No `docker run` invocation found in the input.' }
    }

    const parsed = newParsed()
    const index = this.parseFlags(tokens, parsed)

    if (index >= tokens.length) {
      return {
        isValid: false,
        warnings: parsed.warnings,
        notes: parsed.notes,
        errorMessage: 'No IMAGE found — a `docker run` command must name an image after its flags.',
      }
    }

    parsed.image = tokens[index]
    parsed.command = tokens.slice(index + 1)

    const yaml = this.emitYaml(parsed)
    return { isValid: true, yaml, warnings: [...parsed.warnings], notes: [...parsed.notes] }
  }

  // ---------------------------------------------------------------- parsing

  /**
   * Drops any `sudo` / `docker` / `podman` / `container` / `run` prefix so
   * the parser starts at the first flag. Also tolerates a bare flag list
   * with no `docker run` at all.
   */
  private stripCommandPrefix(tokens: string[]): string[] {
    let i = 0
    const prefixes = new Set(['sudo', 'docker', 'podman', 'container', 'run', 'create'])
    while (i < tokens.length && prefixes.has(tokens[i])) {
      i++
    }
    return tokens.slice(i)
  }

  /** Consumes flags from `tokens`, filling `p`. Returns the index of the first non-flag token (the IMAGE). */
  private parseFlags(tokens: string[], p: Parsed): number {
    let i = 0
    while (i < tokens.length) {
      const token = tokens[i]

      if (token === '--') {
        i++
        break
      }
      if (!token.startsWith('-') || token === '-') break

      if (token.startsWith('--')) {
        const body = token.substring(2)
        const eq = body.indexOf('=')
        if (eq >= 0) {
          this.apply(body.substring(0, eq), body.substring(eq + 1), p, true)
          i++
          continue
        }
        const name = body
        if (valueFlags.has(name)) {
          if (i + 1 >= tokens.length) {
            p.warnings.push(`ignored: --${name} (missing value)`)
            i++
            continue
          }
          this.apply(name, tokens[i + 1], p, true)
          i += 2
          continue
        }
        if (!booleanFlags.has(name)) {
          p.warnings.push(`ignored: --${name} (unrecognised flag, assumed to take no value)`)
          i++
          continue
        }
        this.apply(name, null, p, false)
        i++
        continue
      }

      // Short form: possibly clustered (-it) and possibly with an attached value (-p8080:80).
      const cluster = token.substring(1)
      let consumedNext = false
      for (let c = 0; c < cluster.length; c++) {
        const letter = cluster[c]
        const long = shortAliases[letter]
        if (long == null) {
          p.warnings.push(`ignored: -${letter} (unrecognised short flag)`)
          continue
        }
        if (valueFlags.has(long)) {
          // A value-taking short flag swallows the rest of the cluster as
          // its value (`-p8080:80`), or the next token when nothing is
          // attached (`-p 8080:80`).
          const attached = cluster.substring(c + 1)
          if (attached.length > 0) {
            this.apply(long, attached, p, true)
          } else if (i + 1 < tokens.length) {
            this.apply(long, tokens[i + 1], p, true)
            consumedNext = true
          } else {
            p.warnings.push(`ignored: -${letter} (missing value)`)
          }
          break
        }
        this.apply(long, null, p, false)
      }
      i += consumedNext ? 2 : 1
    }
    return i
  }

  private apply(flag: string, value: string | null, p: Parsed, hadValue: boolean): void {
    const v = () => value ?? ''
    const boolValue = () => value == null || value.toLowerCase() !== 'false'

    switch (flag) {
      // ---- identity / process ----
      case 'name':
        p.containerName = v()
        break
      case 'hostname':
        p.fields.set('hostname', v())
        break
      case 'domainname':
        p.fields.set('domainname', v())
        break
      case 'user':
        p.fields.set('user', v())
        break
      case 'workdir':
        p.fields.set('working_dir', v())
        break
      case 'entrypoint':
        p.entrypoint = v()
        break
      case 'interactive':
        p.stdinOpen = boolValue()
        break
      case 'tty':
        p.tty = boolValue()
        break
      case 'init':
        p.fields.set('init', boolValue() ? 'true' : 'false')
        break
      case 'read-only':
        p.fields.set('read_only', boolValue() ? 'true' : 'false')
        break
      case 'privileged':
        p.fields.set('privileged', boolValue() ? 'true' : 'false')
        break

      case 'detach':
        p.notes.push('-d/--detach has no service-level equivalent; run `docker compose up -d` instead.')
        break
      case 'rm':
        p.notes.push(
          '--rm has no Compose equivalent; use `docker compose run --rm <service>` ' +
            'or remove containers with `docker compose down`.',
        )
        break

      // ---- ports ----
      case 'publish':
        p.ports.push(this.normalisePort(v(), p))
        break
      case 'expose':
        p.expose.push(v())
        break
      case 'publish-all':
        p.warnings.push('ignored: -P/--publish-all (Compose has no publish-all; list the ports explicitly)')
        break

      // ---- storage ----
      case 'volume':
        this.applyVolume(v(), p)
        break
      case 'tmpfs':
        p.tmpfs.push(v())
        break
      case 'volumes-from':
        p.volumesFrom.push(v())
        break
      case 'device':
        p.devices.push(v())
        break
      case 'mount':
        p.warnings.push(`ignored: --mount ${value} (use -v/--volume, or hand-write the Compose long volume syntax)`)
        break

      // ---- environment ----
      case 'env':
        p.environment.push(v())
        break
      case 'env-file':
        p.envFiles.push(v())
        break
      case 'label':
        p.labels.push(v())
        break
      case 'label-file':
        p.warnings.push('ignored: --label-file (Compose has no label-file; inline the labels)')
        break

      // ---- networking ----
      case 'network':
      case 'net':
        this.applyNetwork(v(), p)
        break
      case 'network-alias':
        p.warnings.push(`ignored: --network-alias ${value} (needs the Compose long network syntax with \`aliases:\`)`)
        break
      case 'add-host':
        p.extraHosts.push(v())
        break
      case 'dns':
        p.dns.push(v())
        break
      case 'dns-search':
        p.dnsSearch.push(v())
        break
      case 'dns-option':
      case 'dns-opt':
        p.dnsOpt.push(v())
        break
      case 'mac-address':
        p.fields.set('mac_address', v())
        break
      case 'ip':
      case 'ip6':
      case 'link-local-ip':
        p.warnings.push(`ignored: --${flag} ${value} (needs the Compose long network syntax with \`ipv4_address\`/\`ipv6_address\`)`)
        break
      case 'link':
        p.links.push(v())
        break

      // ---- lifecycle ----
      case 'restart':
        p.fields.set('restart', v())
        break
      case 'stop-signal':
        p.fields.set('stop_signal', v())
        break
      case 'stop-timeout':
        p.fields.set('stop_grace_period', `${v()}s`)
        break

      // ---- security / kernel ----
      case 'cap-add':
        p.capAdd.push(v())
        break
      case 'cap-drop':
        p.capDrop.push(v())
        break
      case 'security-opt':
        p.securityOpt.push(v())
        break
      case 'sysctl':
        p.sysctls.push(v())
        break
      case 'group-add':
        p.groupAdd.push(v())
        break
      case 'userns':
        p.fields.set('userns_mode', v())
        break
      case 'pid':
        p.fields.set('pid', v())
        break
      case 'ipc':
        p.fields.set('ipc', v())
        break
      case 'uts':
        p.fields.set('uts', v())
        break
      case 'cgroup-parent':
        p.fields.set('cgroup_parent', v())
        break
      case 'cgroupns':
        p.fields.set('cgroup', v())
        break

      // ---- resources ----
      case 'memory':
        p.fields.set('mem_limit', v())
        break
      case 'memory-reservation':
        p.fields.set('mem_reservation', v())
        break
      case 'memory-swap':
        p.fields.set('memswap_limit', v())
        break
      case 'memory-swappiness':
        p.fields.set('mem_swappiness', v())
        break
      case 'cpus':
        p.cpus = v()
        break
      case 'cpu-shares':
        p.cpuShares = v()
        break
      case 'cpuset-cpus':
        p.fields.set('cpuset', v())
        break
      case 'pids-limit':
        p.pidsLimit = v()
        break
      case 'oom-kill-disable':
        p.fields.set('oom_kill_disable', boolValue() ? 'true' : 'false')
        break
      case 'oom-score-adj':
        p.oomScoreAdj = v()
        break
      case 'shm-size':
        p.fields.set('shm_size', v())
        break
      case 'gpus':
        p.warnings.push(`ignored: --gpus ${value} (needs \`deploy.resources.reservations.devices\` in Compose)`)
        break

      // ---- healthcheck ----
      case 'health-cmd':
        p.healthCmd = v()
        break
      case 'health-interval':
        p.healthInterval = v()
        break
      case 'health-timeout':
        p.healthTimeout = v()
        break
      case 'health-retries':
        p.healthRetries = v()
        break
      case 'health-start-period':
        p.healthStartPeriod = v()
        break
      case 'health-start-interval':
        p.healthStartInterval = v()
        break
      case 'no-healthcheck':
        p.noHealthcheck = true
        break

      // ---- logging ----
      case 'log-driver':
        p.logDriver = v()
        break
      case 'log-opt':
        p.logOpts.push(v())
        break

      // ---- misc pass-through ----
      case 'platform':
        p.fields.set('platform', v())
        break
      case 'runtime':
        p.fields.set('runtime', v())
        break
      case 'isolation':
        p.fields.set('isolation', v())
        break
      case 'storage-opt':
        p.storageOpt.push(v())
        break
      case 'pull':
        p.fields.set('pull_policy', v())
        break

      default:
        p.warnings.push(hadValue ? `ignored: --${flag} ${value}` : `ignored: --${flag}`)
    }
  }

  /**
   * `-p` accepts `containerPort`, `host:container`, `ip:host:container`, and
   * any of those with a `/udp` (or `/tcp`, `/sctp`) suffix, plus port
   * ranges. All of those are already valid Compose *short syntax*, so this
   * is a validating pass-through rather than a rewrite.
   */
  private normalisePort(spec: string, p: Parsed): string {
    const trimmed = spec.trim()
    if (trimmed.length === 0) {
      p.warnings.push('ignored: -p (empty port specification)')
      return trimmed
    }
    // Split off the optional /proto suffix, then count the colon-separated
    // fields. IPv6 host IPs are bracketed (`[::1]:8080:80`) so a plain colon
    // count is only safe after the bracketed part is set aside.
    const slash = trimmed.lastIndexOf('/')
    const body = slash > 0 ? trimmed.substring(0, slash) : trimmed
    let fieldSource = body
    if (body.startsWith('[')) {
      const close = body.indexOf(']')
      if (close > 0) fieldSource = body.substring(close + 1)
    }
    const fields = fieldSource.split(':').filter((f) => f.length > 0).length
    if (fields > 3) {
      p.warnings.push(`ignored: -p ${spec} (unrecognised port specification)`)
    }
    return trimmed
  }

  /**
   * `-v` is either `container_path` (anonymous volume), `src:dst`, or
   * `src:dst:opts`. A `src` that is not a filesystem path is a *named*
   * volume, which Compose additionally requires to be declared in the
   * top-level `volumes:` block.
   */
  private applyVolume(spec: string, p: Parsed): void {
    if (spec.length === 0) {
      p.warnings.push('ignored: -v (empty volume specification)')
      return
    }

    // Keep `C:\data` together instead of splitting it at the drive colon.
    let head = ''
    let rest = spec
    if (/^[A-Za-z]:[\\/]/.test(spec)) {
      head = spec.substring(0, 2)
      rest = spec.substring(2)
    }
    const parts = rest.split(':')
    if (head.length > 0) parts[0] = head + parts[0]

    p.volumes.push(spec)

    if (parts.length < 2) return // anonymous volume, nothing to declare
    const source = parts[0]
    if (this.isNamedVolume(source)) p.namedVolumes.push(source)
  }

  private static readonly namedVolumePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/

  private isNamedVolume(source: string): boolean {
    if (
      source.startsWith('/') ||
      source.startsWith('./') ||
      source.startsWith('../') ||
      source.startsWith('~') ||
      source.startsWith('$') ||
      source.includes('\\')
    ) {
      return false
    }
    if (/^[A-Za-z]:/.test(source)) return false
    return DockerRunConverter.namedVolumePattern.test(source)
  }

  /**
   * The four built-in network modes map to `network_mode:`; anything else
   * is a user-defined network, which becomes a `networks:` membership plus
   * a top-level declaration.
   */
  private applyNetwork(spec: string, p: Parsed): void {
    if (spec.length === 0) return
    if (spec === 'host' || spec === 'none' || spec === 'bridge' || spec === 'default') {
      p.networkMode = spec
      return
    }
    if (spec.startsWith('container:')) {
      p.networkMode = spec
      return
    }
    p.networks.push(spec)
  }

  // --------------------------------------------------------------- emitting

  private emitYaml(p: Parsed): string {
    const service = new Map<string, YamlValue>()

    service.set('image', scalar(p.image))
    if (p.containerName != null) service.set('container_name', scalar(p.containerName))

    for (const key of ['hostname', 'domainname', 'user', 'working_dir']) {
      const value = p.fields.get(key)
      if (value != null) service.set(key, scalar(value))
    }

    if (p.entrypoint != null) service.set('entrypoint', scalar(p.entrypoint))
    if (p.command.length > 0) service.set('command', { raw: flowList(p.command) })

    if (p.environment.length > 0) service.set('environment', p.environment.map(scalar))
    if (p.envFiles.length > 0) service.set('env_file', p.envFiles.map(scalar))

    if (p.ports.length > 0) service.set('ports', p.ports.map(quote))
    if (p.expose.length > 0) service.set('expose', p.expose.map(quote))

    if (p.volumes.length > 0) service.set('volumes', p.volumes.map(scalar))
    if (p.tmpfs.length > 0) service.set('tmpfs', p.tmpfs.map(scalar))
    if (p.volumesFrom.length > 0) service.set('volumes_from', p.volumesFrom.map(scalar))
    if (p.devices.length > 0) service.set('devices', p.devices.map(scalar))

    if (p.networkMode != null) service.set('network_mode', scalar(p.networkMode))
    if (p.networks.length > 0) service.set('networks', p.networks.map(scalar))
    if (p.links.length > 0) service.set('links', p.links.map(scalar))
    if (p.dns.length > 0) service.set('dns', p.dns.map(scalar))
    if (p.dnsSearch.length > 0) service.set('dns_search', p.dnsSearch.map(scalar))
    if (p.dnsOpt.length > 0) service.set('dns_opt', p.dnsOpt.map(scalar))
    if (p.extraHosts.length > 0) service.set('extra_hosts', p.extraHosts.map(scalar))

    const restart = p.fields.get('restart')
    if (restart != null) service.set('restart', scalar(restart))
    if (p.labels.length > 0) service.set('labels', p.labels.map(scalar))

    if (p.capAdd.length > 0) service.set('cap_add', p.capAdd.map(scalar))
    if (p.capDrop.length > 0) service.set('cap_drop', p.capDrop.map(scalar))
    if (p.securityOpt.length > 0) service.set('security_opt', p.securityOpt.map(scalar))
    if (p.sysctls.length > 0) service.set('sysctls', p.sysctls.map(scalar))
    if (p.groupAdd.length > 0) service.set('group_add', p.groupAdd.map(scalar))
    if (p.storageOpt.length > 0) {
      const m = new Map<string, YamlValue>()
      for (const entry of p.storageOpt) {
        const [k, v] = splitKeyValue(entry)
        m.set(k, v)
      }
      service.set('storage_opt', m)
    }

    for (const key of [
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
      const value = p.fields.get(key)
      if (value != null) {
        const isBooleanLike = key === 'privileged' || key === 'read_only' || key === 'init' || key === 'oom_kill_disable'
        service.set(key, { raw: isBooleanLike ? value : scalar(value) })
      }
    }

    if (p.cpus != null) service.set('cpus', { raw: numericOrScalar(p.cpus) })
    if (p.cpuShares != null) service.set('cpu_shares', { raw: numericOrScalar(p.cpuShares) })
    if (p.pidsLimit != null) service.set('pids_limit', { raw: numericOrScalar(p.pidsLimit) })
    if (p.oomScoreAdj != null) service.set('oom_score_adj', { raw: numericOrScalar(p.oomScoreAdj) })

    if (p.logDriver != null || p.logOpts.length > 0) {
      const logging = new Map<string, YamlValue>()
      if (p.logDriver != null) logging.set('driver', scalar(p.logDriver))
      if (p.logOpts.length > 0) {
        const opts = new Map<string, YamlValue>()
        for (const o of p.logOpts) {
          const [k, v] = splitKeyValue(o)
          opts.set(k, v)
        }
        logging.set('options', opts)
      }
      service.set('logging', logging)
    }

    if (p.stdinOpen) service.set('stdin_open', { raw: 'true' })
    if (p.tty) service.set('tty', { raw: 'true' })

    const healthcheck = this.buildHealthcheck(p)
    if (healthcheck != null) service.set('healthcheck', healthcheck)

    const lines: string[] = []
    lines.push('services:')
    lines.push(`  ${this.serviceName(p)}:`)
    writeMap(lines, service, 4)

    if (p.namedVolumes.length > 0) {
      lines.push('')
      lines.push('volumes:')
      for (const name of p.namedVolumes) {
        lines.push(`  ${scalar(name)}:`)
      }
    }

    if (p.networks.length > 0) {
      lines.push('')
      lines.push('networks:')
      for (const name of p.networks) {
        lines.push(`  ${scalar(name)}:`)
        // `docker run --network foo` requires `foo` to already exist, so
        // `external: true` is the faithful translation. Drop it to let
        // Compose create the network itself.
        lines.push('    external: true')
      }
    }

    return lines.join('\n').replace(/\s+$/, '')
  }

  private buildHealthcheck(p: Parsed): Map<string, YamlValue> | null {
    if (p.noHealthcheck) {
      const m = new Map<string, YamlValue>()
      m.set('disable', { raw: 'true' })
      return m
    }
    if (
      p.healthCmd == null &&
      p.healthInterval == null &&
      p.healthTimeout == null &&
      p.healthRetries == null &&
      p.healthStartPeriod == null &&
      p.healthStartInterval == null
    ) {
      return null
    }
    const health = new Map<string, YamlValue>()
    if (p.healthCmd != null) {
      // `--health-cmd` is a shell string, which is exactly CMD-SHELL.
      health.set('test', { raw: `["CMD-SHELL", ${jsonQuote(p.healthCmd)}]` })
    }
    if (p.healthInterval != null) health.set('interval', scalar(p.healthInterval))
    if (p.healthTimeout != null) health.set('timeout', scalar(p.healthTimeout))
    if (p.healthRetries != null) health.set('retries', { raw: numericOrScalar(p.healthRetries) })
    if (p.healthStartPeriod != null) health.set('start_period', scalar(p.healthStartPeriod))
    if (p.healthStartInterval != null) health.set('start_interval', scalar(p.healthStartInterval))
    return health
  }

  /**
   * Service key: `--name` when given, else the image's repository basename
   * with the tag/digest stripped, else `app`.
   */
  private serviceName(p: Parsed): string {
    const explicit = p.containerName
    if (explicit != null && explicit.length > 0) return this.sanitiseName(explicit)

    let image = p.image
    const at = image.indexOf('@')
    if (at > 0) image = image.substring(0, at)
    const lastSlash = image.lastIndexOf('/')
    let base = lastSlash >= 0 ? image.substring(lastSlash + 1) : image
    const colon = base.indexOf(':')
    if (colon > 0) base = base.substring(0, colon)
    const name = this.sanitiseName(base)
    return name.length === 0 ? 'app' : name
  }

  private sanitiseName(value: string): string {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9_.-]/g, '-')
    return cleaned.replace(/^-+|-+$/g, '')
  }
}

// ------------------------------------------------------------- YAML helpers

type YamlValue = string | string[] | Map<string, YamlValue> | { raw: string }

function writeMap(lines: string[], map: Map<string, YamlValue>, indent: number): void {
  const pad = ' '.repeat(indent)
  for (const [key, value] of map.entries()) {
    if (typeof value === 'string') {
      lines.push(`${pad}${key}: ${value}`)
    } else if (Array.isArray(value)) {
      if (value.length === 0) continue
      lines.push(`${pad}${key}:`)
      for (const item of value) {
        lines.push(`${pad}  - ${item}`)
      }
    } else if (value instanceof Map) {
      if (value.size === 0) {
        lines.push(`${pad}${key}: {}`)
        continue
      }
      lines.push(`${pad}${key}:`)
      writeMap(lines, value, indent + 2)
    } else {
      // { raw: string } — already-formatted scalar (booleans, numbers, flow lists)
      lines.push(`${pad}${key}: ${value.raw}`)
    }
  }
}

function splitKeyValue(entry: string): [string, string] {
  const eq = entry.indexOf('=')
  if (eq < 0) return [scalar(entry), scalar('')]
  return [entry.substring(0, eq), scalar(entry.substring(eq + 1))]
}

/**
 * Renders a `["a", "b"]` flow sequence. Used for `command:` so the exact
 * argv split from the source command line survives verbatim rather than
 * being re-tokenised by the shell inside the container.
 */
function flowList(items: string[]): string {
  return `[${items.map(jsonQuote).join(', ')}]`
}

function jsonQuote(text: string): string {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
  return `"${escaped}"`
}

/** Emits an unquoted number when the text really is one, so `cpus: 1.5` and `retries: 3` come out as YAML numbers rather than strings. */
function numericOrScalar(text: string): string {
  return isNumericLiteral(text) ? text : scalar(text)
}

function isNumericLiteral(text: string): boolean {
  return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text.trim()) && text.trim().length > 0
}

// Scalar quoting rules mirror the Dart reference's yaml_formatter.dart so
// the hand-rolled emitter stays consistent with the rest of the app.
function scalar(text: string): string {
  return needsQuoting(text) ? quote(text) : text
}

function quote(text: string): string {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
  return `"${escaped}"`
}

const reservedWords = /^(true|false|null|~|yes|no|on|off)$/i
const numericLike = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/
const leadingSpecialChar = /^[[\]{}&*!|>%@`"'#,-]/

function needsQuoting(text: string): boolean {
  if (text.length === 0) return true
  if (text.trim() !== text) return true
  if (text.includes('\n')) return true
  if (reservedWords.test(text)) return true
  if (numericLike.test(text)) return true
  if (text.includes(': ') || text.endsWith(':')) return true
  if (text.includes('#')) return true
  if (leadingSpecialChar.test(text)) return true
  return false
}
