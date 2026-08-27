import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Zabbix config builder — pure TypeScript, no I/O, no React.
 *
 * Covers both `zabbix_server.conf` and `zabbix_agentd.conf` from two
 * independent catalogs, switched by `ZabbixMode` — the directive sets barely
 * overlap (a database connection makes no sense on an agent; buffering and
 * active-check refresh make no sense on a server), so treating them as one
 * shared catalog with mode-gated entries would make every row's relevance
 * conditional on a toggle. Two catalogs keep each one a flat, honest list of
 * what actually applies.
 *
 * References:
 *  - github.com/zabbix/zabbix/blob/master/conf/zabbix_server.conf
 *  - zabbix.com/documentation/current/en/manual/appendix/config/zabbix_server
 *  - zabbix.com/documentation/current/en/manual/appendix/config/zabbix_agentd
 *
 * Both catalogs are curated subsets of their respective ~100/~50-directive
 * full references — the ones operators actually tune day to day — following
 * the same "minimal reviewable diff" philosophy as `sysctlConfigBuilder`: a
 * directive only appears in the output if the caller selected it.
 *
 * Deliberately out of scope for both: TLS/PSK peer-encryption directives,
 * HA clustering, Vault integration, VMware polling, UserParameter/Alias
 * scripting, and load-module directives. Legitimate directives, just not
 * ones a curated "pick your defaults" builder should front-load.
 */

export type ZabbixMode = 'server' | 'agent'

export type ZabbixParameterCategory =
  | 'database'
  | 'network'
  | 'workers'
  | 'cache'
  | 'housekeeping'
  | 'timeouts'
  | 'logging'
  | 'misc'
  | 'hostIdentification'
  | 'activeChecks'
  | 'buffering'
  | 'security'

export function zabbixParameterCategoryLabel(category: ZabbixParameterCategory): string {
  switch (category) {
    case 'database':
      return 'Database Connection'
    case 'network':
      return 'Network'
    case 'workers':
      return 'Worker Processes'
    case 'cache':
      return 'Cache Sizing'
    case 'housekeeping':
      return 'Housekeeping'
    case 'timeouts':
      return 'Timeouts'
    case 'logging':
      return 'Logging'
    case 'misc':
      return 'Miscellaneous'
    case 'hostIdentification':
      return 'Host Identification'
    case 'activeChecks':
      return 'Active Checks'
    case 'buffering':
      return 'Data Buffering'
    case 'security':
      return 'Security & Access Control'
  }
}

/** Category display order for each mode. Categories absent from a mode's catalog are simply never rendered. */
export const kZabbixServerCategoryOrder: ZabbixParameterCategory[] = [
  'database',
  'network',
  'workers',
  'cache',
  'housekeeping',
  'timeouts',
  'logging',
  'misc',
]

export const kZabbixAgentCategoryOrder: ZabbixParameterCategory[] = [
  'network',
  'hostIdentification',
  'workers',
  'activeChecks',
  'buffering',
  'timeouts',
  'logging',
  'security',
  'misc',
]

export function zabbixCategoryOrderFor(mode: ZabbixMode): ZabbixParameterCategory[] {
  return mode === 'server' ? kZabbixServerCategoryOrder : kZabbixAgentCategoryOrder
}

export type ZabbixValueKind = 'integer' | 'text' | 'boolean' | 'enumerated'

export interface ZabbixValueOption {
  value: string
  label: string
}

export const kZabbixBooleanOptions: ZabbixValueOption[] = [
  { value: '0', label: 'Disabled (0)' },
  { value: '1', label: 'Enabled (1)' },
]

export interface ZabbixParameter {
  /** The literal directive name, e.g. `CacheSize`. */
  key: string
  label: string
  description: string
  category: ZabbixParameterCategory
  /** Value pre-filled in the UI before the user changes anything. */
  defaultValue: string
  kind: ZabbixValueKind
  /** Legal values for `enumerated`. Empty otherwise. */
  options: ZabbixValueOption[]
  /** Brief caution surfaced in the UI where getting this wrong has a real operational cost. */
  riskNote?: string
}

export function zabbixEffectiveOptions(parameter: ZabbixParameter): ZabbixValueOption[] {
  switch (parameter.kind) {
    case 'enumerated':
      return parameter.options
    case 'boolean':
      return kZabbixBooleanOptions
    case 'integer':
    case 'text':
      return []
  }
}

export function zabbixIsLegalValue(parameter: ZabbixParameter, value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  const legal = zabbixEffectiveOptions(parameter)
  if (legal.length === 0) return true
  return legal.some((option) => option.value === trimmed)
}

export function zabbixSanitize(parameter: ZabbixParameter, rawValue: string | null | undefined): string {
  if (rawValue == null) return parameter.defaultValue
  const trimmed = rawValue.trim()
  if (trimmed.length === 0) return parameter.defaultValue
  return zabbixIsLegalValue(parameter, trimmed) ? trimmed : parameter.defaultValue
}

function param(p: Omit<ZabbixParameter, 'options'> & { options?: ZabbixValueOption[] }): ZabbixParameter {
  return { options: [], ...p }
}

// ===========================================================================
// Server catalog (zabbix_server.conf)
// ===========================================================================

export const kZabbixServerParameterCatalog: ZabbixParameter[] = [
  // ---------------------------------------------------------------------
  // Database Connection
  // ---------------------------------------------------------------------
  param({
    key: 'DBHost',
    label: 'Database Host',
    description: 'Host (or, on Unix, the socket directory) of the database server. Empty/localhost uses a local Unix socket.',
    category: 'database',
    defaultValue: 'localhost',
    kind: 'text',
  }),
  param({
    key: 'DBName',
    label: 'Database Name',
    description: 'Database name. Mandatory in every real deployment; there is no working default.',
    category: 'database',
    defaultValue: 'zabbix',
    kind: 'text',
  }),
  param({
    key: 'DBUser',
    label: 'Database User',
    description: 'Database user Zabbix server connects as.',
    category: 'database',
    defaultValue: 'zabbix',
    kind: 'text',
  }),
  param({
    key: 'DBPassword',
    label: 'Database Password',
    description: 'Password for DBUser. Left blank, Zabbix connects with no password — fine for a local trust-auth socket, unsafe over the network.',
    category: 'database',
    defaultValue: '',
    kind: 'text',
    riskNote: 'Shipping this file with a real password in it is a plaintext secret at rest — prefer a root-owned, 600-permission file or Include a separate credentials file.',
  }),
  param({
    key: 'DBPort',
    label: 'Database Port',
    description: 'TCP port of the database server. 0 uses the database\'s own default port (5432 PostgreSQL / 3306 MySQL) — only meaningful once DBHost is set to something other than "localhost".',
    category: 'database',
    defaultValue: '0',
    kind: 'integer',
  }),

  // ---------------------------------------------------------------------
  // Network
  // ---------------------------------------------------------------------
  param({
    key: 'ListenPort',
    label: 'Listen Port',
    description: 'TCP port the trapper listens on for incoming agent/sender data.',
    category: 'network',
    defaultValue: '10051',
    kind: 'integer',
  }),
  param({
    key: 'ListenIP',
    label: 'Listen IP',
    description: 'Comma-separated list of IP addresses the trapper listens on. Empty listens on all network interfaces.',
    category: 'network',
    defaultValue: '',
    kind: 'text',
  }),
  param({
    key: 'SourceIP',
    label: 'Source IP',
    description: 'Source IP address used for outgoing connections to agents, proxies and the Java gateway. Empty lets the OS pick.',
    category: 'network',
    defaultValue: '',
    kind: 'text',
  }),

  // ---------------------------------------------------------------------
  // Worker Processes
  // ---------------------------------------------------------------------
  param({
    key: 'StartPollers',
    label: 'Pollers',
    description: 'Pre-forked instances polling agents/SNMP/simple checks. Raise this if pollers are consistently busy (check the internal item zabbix[process,poller,avg,busy]).',
    category: 'workers',
    defaultValue: '5',
    kind: 'integer',
  }),
  param({
    key: 'StartTrappers',
    label: 'Trappers',
    description: 'Pre-forked instances accepting incoming trapper/sender/active-agent data on ListenPort.',
    category: 'workers',
    defaultValue: '5',
    kind: 'integer',
  }),
  param({
    key: 'StartPingers',
    label: 'Pingers',
    description: 'Pre-forked instances running ICMP ping checks (fping).',
    category: 'workers',
    defaultValue: '1',
    kind: 'integer',
  }),
  param({
    key: 'StartDBSyncers',
    label: 'History Syncers (DB Syncers)',
    description: 'Pre-forked instances flushing the in-memory history cache to the database. The classic bottleneck on a busy server — raise this before raising HistoryCacheSize.',
    category: 'workers',
    defaultValue: '4',
    kind: 'integer',
  }),
  param({
    key: 'StartDiscoverers',
    label: 'Discoverers',
    description: 'Pre-forked instances running network discovery rules.',
    category: 'workers',
    defaultValue: '1',
    kind: 'integer',
  }),
  param({
    key: 'StartHTTPPollers',
    label: 'HTTP Pollers',
    description: 'Pre-forked instances running web monitoring (web scenario) checks.',
    category: 'workers',
    defaultValue: '1',
    kind: 'integer',
  }),

  // ---------------------------------------------------------------------
  // Cache Sizing
  // ---------------------------------------------------------------------
  param({
    key: 'CacheSize',
    label: 'Configuration Cache Size',
    description: 'Shared memory for the configuration cache (hosts, items, triggers). Undersizing this is the most common cause of "cache is more than X% full" warnings.',
    category: 'cache',
    defaultValue: '8M',
    kind: 'text',
  }),
  param({
    key: 'HistoryCacheSize',
    label: 'History Cache Size',
    description: 'Shared memory buffering collected values before they are synced to the database by the DB syncers.',
    category: 'cache',
    defaultValue: '16M',
    kind: 'text',
  }),
  param({
    key: 'HistoryIndexCacheSize',
    label: 'History Index Cache Size',
    description: 'Shared memory indexing the history cache. Zabbix logs a warning if this is undersized relative to HistoryCacheSize.',
    category: 'cache',
    defaultValue: '4M',
    kind: 'text',
  }),
  param({
    key: 'TrendCacheSize',
    label: 'Trend Cache Size',
    description: 'Shared memory caching trend (hourly aggregate) data.',
    category: 'cache',
    defaultValue: '4M',
    kind: 'text',
  }),
  param({
    key: 'ValueCacheSize',
    label: 'History Value Cache Size',
    description: 'Shared memory caching historical values for trigger expressions, calculated items and the frontend. 0 disables it, which is a real functional regression, not just a performance one.',
    category: 'cache',
    defaultValue: '8M',
    kind: 'text',
  }),

  // ---------------------------------------------------------------------
  // Housekeeping
  // ---------------------------------------------------------------------
  param({
    key: 'HousekeepingFrequency',
    label: 'Housekeeping Frequency (hours)',
    description: 'How often the housekeeper runs, deleting data past its configured retention. 0 disables housekeeping entirely.',
    category: 'housekeeping',
    defaultValue: '1',
    kind: 'integer',
    riskNote: 'Disabling housekeeping (0) grows the history/trends tables without bound.',
  }),
  param({
    key: 'MaxHousekeeperDelete',
    label: 'Max Rows Per Housekeeping Batch',
    description: 'Upper bound on rows deleted from one table in a single housekeeping cycle. Protects against one huge DELETE locking the database; 0 removes the limit.',
    category: 'housekeeping',
    defaultValue: '5000',
    kind: 'integer',
  }),

  // ---------------------------------------------------------------------
  // Timeouts
  // ---------------------------------------------------------------------
  param({
    key: 'Timeout',
    label: 'Item Processing Timeout (seconds)',
    description: 'Seconds Zabbix server waits for one item check (agent/SNMP/external script) before giving up. Valid range is 1-30.',
    category: 'timeouts',
    defaultValue: '4',
    kind: 'integer',
    riskNote: 'Too low a value marks slow-but-healthy checks (a loaded SNMP device, a slow external script) as "not supported".',
  }),
  param({
    key: 'TrapperTimeout',
    label: 'Trapper Timeout (seconds)',
    description: 'Seconds a trapper connection is allowed to send historical data, request configuration, or run a script before the server drops it.',
    category: 'timeouts',
    defaultValue: '300',
    kind: 'integer',
  }),

  // ---------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------
  param({
    key: 'LogType',
    label: 'Log Destination',
    description: 'Where log messages go: a file (LogFile), the system log, or the console (foreground/debug runs only).',
    category: 'logging',
    defaultValue: 'file',
    kind: 'enumerated',
    options: [
      { value: 'file', label: 'file — write to LogFile' },
      { value: 'system', label: 'system — syslog' },
      { value: 'console', label: 'console — stdout, foreground only' },
    ],
  }),
  param({
    key: 'LogFile',
    label: 'Log File Path',
    description: 'Path to the log file. Only meaningful when LogType is "file".',
    category: 'logging',
    defaultValue: '/var/log/zabbix/zabbix_server.log',
    kind: 'text',
  }),
  param({
    key: 'LogFileSize',
    label: 'Log File Size (MB)',
    description: 'Log file rotates once it reaches this size, in MB. 0 disables rotation entirely (unbounded growth) — only meaningful when LogType is "file".',
    category: 'logging',
    defaultValue: '1',
    kind: 'integer',
  }),
  param({
    key: 'DebugLevel',
    label: 'Debug Level',
    description: 'How verbose logging is, from 0 (nothing) to 5 (extended per-connection trace). Level 4-5 in production quickly fills the log and adds measurable overhead.',
    category: 'logging',
    defaultValue: '3',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Basic information about starting and stopping only' },
      { value: '1', label: '1 — Critical information' },
      { value: '2', label: '2 — Error information' },
      { value: '3', label: '3 — Warnings (default)' },
      { value: '4', label: '4 — For debugging (produces a lot of information)' },
      { value: '5', label: '5 — Extended debugging (produces even more information)' },
    ],
    riskNote: 'Levels 4-5 are meant for temporary troubleshooting, not standing production configuration.',
  }),

  // ---------------------------------------------------------------------
  // Miscellaneous
  // ---------------------------------------------------------------------
  param({
    key: 'PidFile',
    label: 'PID File Path',
    description: 'Path to the file the running server writes its PID to.',
    category: 'misc',
    defaultValue: '/tmp/zabbix_server.pid',
    kind: 'text',
  }),
  param({
    key: 'SocketDir',
    label: 'IPC Socket Directory',
    description: 'Directory Zabbix server places its internal IPC sockets in.',
    category: 'misc',
    defaultValue: '/tmp',
    kind: 'text',
  }),
  param({
    key: 'AllowRoot',
    label: 'Allow Running as Root',
    description: 'Whether the server is allowed to run as the root user. Disabled, it switches to the User directive\'s account instead.',
    category: 'misc',
    defaultValue: '0',
    kind: 'boolean',
    riskNote: 'Running a network-facing daemon as root is a much larger blast radius for any future vulnerability — leave this disabled and let it drop privileges.',
  }),
]

// ===========================================================================
// Agent catalog (zabbix_agentd.conf)
// ===========================================================================

export const kZabbixAgentParameterCatalog: ZabbixParameter[] = [
  // ---------------------------------------------------------------------
  // Network
  // ---------------------------------------------------------------------
  param({
    key: 'Server',
    label: 'Passive Check Servers',
    description: 'Comma-delimited IPs/DNS names of Zabbix servers/proxies allowed to query this agent for passive checks. Connections from anywhere else are refused.',
    category: 'network',
    defaultValue: '127.0.0.1',
    kind: 'text',
    riskNote: 'Leaving this at 127.0.0.1 on a real deployment means no real Zabbix server can passive-check this host at all.',
  }),
  param({
    key: 'ServerActive',
    label: 'Active Check Server',
    description: 'Server/proxy address this agent connects out to for active checks — the address the agent itself calls home to, independent of Server.',
    category: 'network',
    defaultValue: '',
    kind: 'text',
  }),
  param({
    key: 'ListenPort',
    label: 'Listen Port',
    description: 'TCP port the agent listens on for incoming passive-check connections from Server.',
    category: 'network',
    defaultValue: '10050',
    kind: 'integer',
  }),
  param({
    key: 'ListenIP',
    label: 'Listen IP',
    description: 'Comma-delimited IP addresses the agent listens on. Empty listens on all network interfaces.',
    category: 'network',
    defaultValue: '',
    kind: 'text',
  }),
  param({
    key: 'SourceIP',
    label: 'Source IP',
    description: 'Source IP address used for outgoing active-check connections to the server. Empty lets the OS pick.',
    category: 'network',
    defaultValue: '',
    kind: 'text',
  }),

  // ---------------------------------------------------------------------
  // Host Identification
  // ---------------------------------------------------------------------
  param({
    key: 'Hostname',
    label: 'Hostname',
    description: 'Name this agent identifies itself as — must exactly match a host configured in the Zabbix frontend for active checks to resolve. Defaults to the system hostname if unset.',
    category: 'hostIdentification',
    defaultValue: '',
    kind: 'text',
    riskNote: 'A mismatch with the frontend host name is the single most common reason active checks silently never run.',
  }),
  param({
    key: 'HostMetadata',
    label: 'Host Metadata',
    description: 'Free-text metadata sent during autoregistration, matched against autoregistration action rules to auto-assign templates/host groups. Only used when the host does not already exist.',
    category: 'hostIdentification',
    defaultValue: '',
    kind: 'text',
  }),

  // ---------------------------------------------------------------------
  // Worker Processes
  // ---------------------------------------------------------------------
  param({
    key: 'StartAgents',
    label: 'Passive Check Workers',
    description: 'Pre-forked instances handling incoming passive checks. 0 disables passive checks entirely — the agent then only performs active checks.',
    category: 'workers',
    defaultValue: '3',
    kind: 'integer',
  }),

  // ---------------------------------------------------------------------
  // Active Checks
  // ---------------------------------------------------------------------
  param({
    key: 'RefreshActiveChecks',
    label: 'Active Check Refresh Interval (seconds)',
    description: 'How often the agent asks ServerActive for its current list of active checks to run.',
    category: 'activeChecks',
    defaultValue: '120',
    kind: 'integer',
  }),
  param({
    key: 'HeartbeatFrequency',
    label: 'Heartbeat Frequency (seconds)',
    description: 'How often the agent sends a heartbeat message so the server can track active-agent availability. 0 disables heartbeat messages.',
    category: 'activeChecks',
    defaultValue: '60',
    kind: 'integer',
  }),

  // ---------------------------------------------------------------------
  // Data Buffering
  // ---------------------------------------------------------------------
  param({
    key: 'BufferSend',
    label: 'Max Buffer Retention (seconds)',
    description: 'Longest an active-check value sits in the local buffer before being flushed to the server, even if BufferSize has not been reached.',
    category: 'buffering',
    defaultValue: '5',
    kind: 'integer',
  }),
  param({
    key: 'BufferSize',
    label: 'Buffer Size (values)',
    description: 'Number of active-check values the agent buffers locally before forcing a send — also the amount of data at risk of loss if the agent is killed uncleanly.',
    category: 'buffering',
    defaultValue: '100',
    kind: 'integer',
  }),

  // ---------------------------------------------------------------------
  // Timeouts
  // ---------------------------------------------------------------------
  param({
    key: 'Timeout',
    label: 'Item Processing Timeout (seconds)',
    description: 'Seconds the agent waits for one check to complete before giving up. Valid range is 1-30.',
    category: 'timeouts',
    defaultValue: '3',
    kind: 'integer',
    riskNote: 'Too low a value marks slow-but-healthy checks (a slow UserParameter script) as "not supported".',
  }),

  // ---------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------
  param({
    key: 'LogType',
    label: 'Log Destination',
    description: 'Where log messages go: a file (LogFile), syslog, or the Windows event log.',
    category: 'logging',
    defaultValue: 'file',
    kind: 'enumerated',
    options: [
      { value: 'file', label: 'file — write to LogFile' },
      { value: 'syslog', label: 'syslog — system log' },
      { value: 'eventlog', label: 'eventlog — Windows event log (Windows agent only)' },
    ],
  }),
  param({
    key: 'LogFile',
    label: 'Log File Path',
    description: 'Path to the log file. Only meaningful when LogType is "file".',
    category: 'logging',
    defaultValue: '/var/log/zabbix/zabbix_agentd.log',
    kind: 'text',
  }),
  param({
    key: 'LogFileSize',
    label: 'Log File Size (MB)',
    description: 'Log file rotates once it reaches this size, in MB. 0 disables rotation entirely — only meaningful when LogType is "file".',
    category: 'logging',
    defaultValue: '1',
    kind: 'integer',
  }),
  param({
    key: 'DebugLevel',
    label: 'Debug Level',
    description: 'How verbose logging is, from 0 (nothing) to 5 (extended per-connection trace). Level 4-5 in production quickly fills the log and adds measurable overhead.',
    category: 'logging',
    defaultValue: '3',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Basic information about starting and stopping only' },
      { value: '1', label: '1 — Critical information' },
      { value: '2', label: '2 — Error information' },
      { value: '3', label: '3 — Warnings (default)' },
      { value: '4', label: '4 — For debugging (produces a lot of information)' },
      { value: '5', label: '5 — Extended debugging (produces even more information)' },
    ],
    riskNote: 'Levels 4-5 are meant for temporary troubleshooting, not standing production configuration.',
  }),

  // ---------------------------------------------------------------------
  // Security & Access Control
  // ---------------------------------------------------------------------
  param({
    key: 'AllowKey',
    label: 'Allow Key Pattern',
    description: 'Wildcard pattern of item keys the server is permitted to request from this agent (e.g. "system.run[ls *]"). Evaluated together with DenyKey in the order both appear in the file.',
    category: 'security',
    defaultValue: '',
    kind: 'text',
  }),
  param({
    key: 'DenyKey',
    label: 'Deny Key Pattern',
    description: 'Wildcard pattern of item keys refused outright, most commonly "system.run[*]" to disable remote command execution entirely.',
    category: 'security',
    defaultValue: 'system.run[*]',
    kind: 'text',
    riskNote: 'An agent that allows system.run is a remote-command-execution surface — deny it unless a specific, narrow AllowKey exception is deliberately configured.',
  }),
  param({
    key: 'UnsafeUserParameters',
    label: 'Unsafe UserParameters',
    description: 'Allows the shell metacharacters \\ " \' ` * ? [ ] { } ~ $ ! & ; ( ) < > | # @ \\n in UserParameter command-line arguments passed from the server.',
    category: 'security',
    defaultValue: '0',
    kind: 'boolean',
    riskNote: 'Enabling this on an agent that also accepts UserParameter arguments from the network is a significant injection surface — keep it off unless a specific UserParameter genuinely needs those characters.',
  }),

  // ---------------------------------------------------------------------
  // Miscellaneous
  // ---------------------------------------------------------------------
  param({
    key: 'PidFile',
    label: 'PID File Path',
    description: 'Path to the file the running agent writes its PID to.',
    category: 'misc',
    defaultValue: '/tmp/zabbix_agentd.pid',
    kind: 'text',
  }),
  param({
    key: 'User',
    label: 'Run As User',
    description: 'System user the agent switches to after start, when not run as root (or when AllowRoot is disabled).',
    category: 'misc',
    defaultValue: 'zabbix',
    kind: 'text',
  }),
  param({
    key: 'AllowRoot',
    label: 'Allow Running as Root',
    description: 'Whether the agent is allowed to run as the root user. Disabled, it switches to the User directive\'s account instead.',
    category: 'misc',
    defaultValue: '0',
    kind: 'boolean',
    riskNote: 'Running a network-facing daemon as root is a much larger blast radius for any future vulnerability — leave this disabled and let it drop privileges.',
  }),
]

export function zabbixCatalogFor(mode: ZabbixMode): ZabbixParameter[] {
  return mode === 'server' ? kZabbixServerParameterCatalog : kZabbixAgentParameterCatalog
}

/** Catalog lookup by key within `mode`'s catalog. Returns null for keys not in it. */
export function zabbixParameterFor(mode: ZabbixMode, key: string): ZabbixParameter | null {
  for (const parameter of zabbixCatalogFor(mode)) {
    if (parameter.key === key) return parameter
  }
  return null
}

const kZabbixFileNames: Record<ZabbixMode, string> = {
  server: 'zabbix_server.conf',
  agent: 'zabbix_agentd.conf',
}

/** Suggested filename for the generated file's save dialog. */
export function zabbixConfigFileName(mode: ZabbixMode): string {
  return kZabbixFileNames[mode]
}

const kZabbixReferenceUrls: Record<ZabbixMode, string> = {
  server: 'https://www.zabbix.com/documentation/current/en/manual/appendix/config/zabbix_server',
  agent: 'https://www.zabbix.com/documentation/current/en/manual/appendix/config/zabbix_agentd',
}

/**
 * Input for `ZabbixConfigBuilder`: which mode (server/agent — each with its
 * own catalog, category set and output filename) and which directives the
 * user actually selected, with a value for each. Only keys present in
 * `selectedValues` that also exist in `mode`'s catalog are emitted — the
 * same "minimal reviewable diff" contract `sysctlConfigBuilder` uses.
 */
export interface ZabbixConfigBuilderInput {
  mode: ZabbixMode
  /** Parameter key -> user-edited value. Keys not found in `mode`'s catalog are ignored. */
  selectedValues: Record<string, string>
}

/**
 * Renders a `zabbix_server.conf` or `zabbix_agentd.conf` from whichever
 * directives the user selected — anywhere from one to the whole catalog for
 * that mode.
 */
export class ZabbixConfigBuilder implements IToolUseCase<ZabbixConfigBuilderInput, string> {
  execute(input: ZabbixConfigBuilderInput): string {
    const catalog = zabbixCatalogFor(input.mode)
    const categoryOrder = zabbixCategoryOrderFor(input.mode)
    const fileName = zabbixConfigFileName(input.mode)

    const selected: Array<[ZabbixParameter, string]> = []
    for (const parameter of catalog) {
      const rawValue = input.selectedValues[parameter.key]
      if (rawValue == null) continue
      selected.push([parameter, zabbixSanitize(parameter, rawValue)])
    }

    if (selected.length === 0) {
      return `# No directives selected.\n# Check one or more parameters on the left to generate a ${fileName}.`
    }

    const lines: string[] = []
    lines.push(`# ${fileName} — generated by InfraKit Studio`)
    lines.push(`# Reference: ${kZabbixReferenceUrls[input.mode]}`)
    lines.push('')

    let firstCategory = true
    for (const category of categoryOrder) {
      const entriesInCategory = selected.filter(([parameter]) => parameter.category === category)
      if (entriesInCategory.length === 0) continue

      if (!firstCategory) lines.push('')
      firstCategory = false

      lines.push(`### ${zabbixParameterCategoryLabel(category)}`)
      for (const [parameter, value] of entriesInCategory) {
        lines.push(`${parameter.key}=${value}`)
      }
    }

    return lines.join('\n').replace(/\s+$/, '') + '\n'
  }
}
