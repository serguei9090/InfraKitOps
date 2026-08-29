/**
 * Sidebar/overview source of truth. Mirrors `module_taxonomy.dart` in the
 * Flutter reference app: the icon rail, the "All Tools" overview, and search
 * all derive from this list — nothing else needs editing to add a tool
 * besides one entry here and one route in `routes.tsx`.
 *
 * `route` is left `undefined` until the tool's screen is actually ported
 * (Phase 3+) — `ToolCard` renders a "Coming soon" badge and disables the
 * card for any entry without one, same mechanic as the Flutter version's
 * nullable `route` field.
 */
import {
  Activity,
  Archive,
  ArrowLeftRight,
  Bot,
  Box,
  Boxes,
  BookOpen,
  BrainCircuit,
  Braces,
  Cable,
  Calculator,
  Camera,
  Clock,
  Cloud,
  Code,
  Coins,
  Database,
  FileCog,
  FileKey,
  Files,
  FileSearch,
  FileText,
  Fingerprint,
  FolderOpen,
  Gauge,
  GitCompare,
  Globe,
  GraduationCap,
  Hash,
  HardDrive,
  Image,
  KeyRound,
  KeySquare,
  LibraryBig,
  List,
  ListTree,
  Lock,
  LockKeyhole,
  MapPin,
  MonitorCog,
  Network,
  Palette,
  Paperclip,
  Plug,
  Power,
  QrCode,
  RadioTower,
  Route,
  Router,
  Scale,
  ScanLine,
  ScanSearch,
  SearchCode,
  Server,
  ServerCog,
  Shield,
  ShieldAlert,
  ShieldBan,
  ShieldCheck,
  Shuffle,
  SlidersHorizontal,
  Table,
  Table2,
  Target,
  Terminal,
  TrendingUp,
  Type,
  Wand2,
  Waypoints,
  Workflow,
  type LucideIcon,
} from 'lucide-react'

export interface ToolEntry {
  /** Stable slug, independent of route wiring — also the intended route's final segment. */
  id: string
  name: string
  description: string
  icon: LucideIcon
  /** Set once the tool's screen is ported (Phase 3+). Undefined = "Coming soon". */
  route?: string
  /**
   * Optional short label for the visual cluster this tool belongs to. Tools
   * are laid out in taxonomy order and the sidebar draws a divider + this
   * label whenever it changes, so tools sharing a `group` MUST be contiguous
   * in the module's `tools` array. Modules with no groups render a flat list.
   */
  group?: string
}

/** Ordered, de-duplicated list of the group labels used in a module. */
export function toolGroups(module: ModuleDef): string[] {
  const seen: string[] = []
  for (const t of module.tools) {
    if (t.group && !seen.includes(t.group)) seen.push(t.group)
  }
  return seen
}

export interface ModuleDef {
  /** Stable slug used for the '/modules/:id' route. */
  id: string
  title: string
  icon: LucideIcon
  tools: ToolEntry[]
}

/** Finds the module that owns the tool at `route`, or null if none does. */
export function moduleContainingRoute(route: string): ModuleDef | null {
  for (const module of kModuleTaxonomy) {
    for (const tool of module.tools) {
      if (tool.route === route) return module
    }
  }
  return null
}

export const kModuleTaxonomy: ModuleDef[] = [
  {
    id: 'tuning',
    title: 'Tuning & Performance',
    icon: Gauge,
    tools: [
      { id: 'db-memory-sizer', name: 'Database RAM Sizer', description: 'PostgreSQL / MariaDB buffer sizing', icon: Server, route: '/tools/db-memory-sizer', group: 'Sizing' },
      { id: 'zabbix-sizer', name: 'Monitoring Sizing', description: 'Zabbix NVPS & poller allocation', icon: Activity, route: '/tools/zabbix-sizer', group: 'Sizing' },
      { id: 'ceph-pg', name: 'Ceph PG Calculator', description: 'Power-of-2 PG rounding math', icon: HardDrive, route: '/tools/ceph-pg', group: 'Sizing' },
      {
        id: 'load-balancer-sizer',
        name: 'Load Balancer & App Tier Sizer',
        description: 'RPS + latency → instances, workers, nginx/HAProxy tuning (Little’s Law, M/M/c)',
        icon: Scale,
        route: '/tools/load-balancer-sizer',
        group: 'Sizing',
      },
      {
        id: 'connection-pool-sizer',
        name: 'Connection Pool Sizer',
        description: 'Does the app tier fit inside max_connections? Pool size + PgBouncer config',
        icon: Cable,
        route: '/tools/connection-pool-sizer',
        group: 'Sizing',
      },
      {
        id: 'k8s-capacity-sizer',
        name: 'Kubernetes Node & Pod Capacity',
        description: 'Pods + node type → node count, pods/node, "survives 1 AZ?", ResourceQuota',
        icon: Boxes,
        route: '/tools/k8s-capacity-sizer',
        group: 'Sizing',
      },
      {
        id: 'storage-iops-sizer',
        name: 'Storage IOPS & Capacity',
        description: 'IOPS + RAID write penalty + growth → disks needed, usable IOPS/capacity, runway',
        icon: HardDrive,
        route: '/tools/storage-iops-sizer',
        group: 'Sizing',
      },
      {
        id: 'capacity-runway',
        name: 'Capacity Runway',
        description: 'Usage + growth vs a ceiling → months to full, "order by" date, projection',
        icon: TrendingUp,
        route: '/tools/capacity-runway',
        group: 'Sizing',
      },

      {
        id: 'slo-error-budget',
        name: 'SLO & Error Budget',
        description: 'SLO → allowed downtime, budget spent, multi-window burn-rate Prometheus alerts',
        icon: Target,
        route: '/tools/slo-error-budget',
        group: 'Reliability',
      },
      {
        id: 'availability-calculator',
        name: 'Availability & Redundancy',
        description: 'Compose component availabilities (series/parallel, k-of-n) → system nines & downtime',
        icon: ShieldCheck,
        route: '/tools/availability-calculator',
        group: 'Reliability',
      },

      {
        id: 'cloud-right-size',
        name: 'Cloud Right-Size & Commitment',
        description: 'p95 util → recommended size; on-demand vs reserved vs spot mix, break-even',
        icon: Coins,
        route: '/tools/cloud-right-size',
        group: 'Cost',
      },

      { id: 'linux-sysctl', name: 'Linux Kernel Sysctl', description: 'Network buffers, BBR, somaxconn', icon: Terminal, route: '/tools/linux-sysctl', group: 'Kernel & firewall' },
      {
        id: 'firewall-command-builder',
        name: 'Firewall Command Builder',
        description: 'iptables, Windows Firewall & cloud (AWS/GCP/Azure) one-liners',
        icon: Shield,
        route: '/tools/firewall-command-builder',
        group: 'Kernel & firewall',
      },
    ],
  },
  {
    id: 'utilities',
    title: 'Daily Developer & Utilities',
    icon: Code,
    // Grouped: Encode & format → Text → Structured data → Hashing & secrets →
    // Keys & certs → Net addressing.
    tools: [
      {
        id: 'converters',
        name: 'Data Converter',
        description: 'YAML ⟷ JSON ⟷ TOML ⟷ XML, Base64, URL/HTML, radix, timestamps',
        icon: Shuffle,
        route: '/tools/converters',
        group: 'Encode & format',
      },
      { id: 'formatters', name: 'Formatters', description: 'Pretty-print, minify & validate JSON/XML/YAML/SQL', icon: Code, route: '/tools/formatters', group: 'Encode & format' },
      {
        id: 'base64-file',
        name: 'Base64 File Converter',
        description: 'Binary file ⟷ base64, data-URI & k8s Secret formats',
        icon: Paperclip,
        route: '/tools/base64-file',
        group: 'Encode & format',
      },
      { id: 'gzip-converter', name: 'GZip Compress / Decompress', description: 'Text or file, with base64 transport', icon: Archive, route: '/tools/gzip-converter', group: 'Encode & format' },
      {
        id: 'json-to-csv',
        name: 'JSON → CSV',
        description: 'Flatten nested JSON arrays into CSV, RFC 4180 quoting',
        icon: Table,
        route: '/tools/json-to-csv',
        group: 'Encode & format',
      },

      { id: 'text-transformer', name: 'Text Transformer', description: 'Case conversion, slugify, sort/dedupe/trim lines', icon: Type, route: '/tools/text-transformer', group: 'Text' },
      {
        id: 'text-diff',
        name: 'Text & JSON Diff',
        description: 'LCS-based line diff, JSON-aware key-order-insensitive mode',
        icon: GitCompare,
        route: '/tools/text-diff',
        group: 'Text',
      },
      {
        id: 'regex-tester',
        name: 'Regex Tester & Explainer',
        description: 'Live matches, capture groups & pattern breakdown',
        icon: SearchCode,
        route: '/tools/regex-tester',
        group: 'Text',
      },

      {
        id: 'jsonpath-evaluator',
        name: 'JSONPath Evaluator',
        description: 'Query JSON with $.a.b[*], slices, filters & recursive descent',
        icon: Braces,
        route: '/tools/jsonpath-evaluator',
        group: 'Structured data',
      },
      {
        id: 'structured-tree-viewer',
        name: 'JSON/YAML Tree Viewer',
        description: 'Collapsible tree browser for large config files',
        icon: ListTree,
        route: '/tools/structured-tree-viewer',
        group: 'Structured data',
      },
      {
        id: 'jwt-parser',
        name: 'JWT Parser',
        description: 'Decode header/payload, expiry check (does not verify signature)',
        icon: FileKey,
        route: '/tools/jwt-parser',
        group: 'Structured data',
      },

      { id: 'hash', name: 'Hash & Checksum', description: 'MD5, SHA-1/256/512, Blake2b, HMAC', icon: Hash, route: '/tools/hash', group: 'Hashing & secrets' },
      { id: 'bcrypt', name: 'bcrypt Hash & Verify', description: 'One-way password hashing & verification', icon: Lock, route: '/tools/bcrypt', group: 'Hashing & secrets' },
      {
        id: 'password-generator',
        name: 'Password & Secret Generator',
        description: 'Configurable passwords, passphrases & strength rating',
        icon: KeySquare,
        route: '/tools/password-generator',
        group: 'Hashing & secrets',
      },
      { id: 'id-generator', name: 'UUID / ULID Generator', description: 'UUID v1/v3/v4/v5 and ULID identifiers', icon: Fingerprint, route: '/tools/id-generator', group: 'Hashing & secrets' },
      {
        id: 'htpasswd-generator',
        name: 'htpasswd / Basic Auth Generator',
        description: 'bcrypt/APR1/SHA htpasswd lines & Basic auth header',
        icon: LockKeyhole,
        route: '/tools/htpasswd-generator',
        group: 'Hashing & secrets',
      },

      {
        id: 'ssh-keygen',
        name: 'SSH Key Pair Generator',
        description: 'Ed25519 keygen, OpenSSH format (RSA-4096 unsupported)',
        icon: KeyRound,
        route: '/tools/ssh-keygen',
        group: 'Keys & certificates',
      },
      {
        id: 'x509-inspector',
        name: 'X.509 Certificate Inspector',
        description: 'Subject, validity, fingerprints & SANs from PEM/DER',
        icon: ShieldCheck,
        route: '/tools/x509-inspector',
        group: 'Keys & certificates',
      },

      {
        id: 'mac-address',
        name: 'MAC Address Tool',
        description: 'Normalize, analyze U/L·I/G bits, vendor lookup & generate',
        icon: Cable,
        route: '/tools/mac-address',
        group: 'Network addressing',
      },
      {
        id: 'ip-range',
        name: 'IPv4 Range & IPv6 ULA',
        description: 'Range → minimal CIDR set, RFC 4193 ULA generator',
        icon: Waypoints,
        route: '/tools/ip-range',
        group: 'Network addressing',
      },
    ],
  },
  {
    id: 'network',
    title: 'Network Toolkit',
    icon: Network,
    // Grouped (see ToolEntry.group): Lookups → Reachability → Discovery →
    // Local host → System → Devices & throughput. Tools in a group stay
    // contiguous.
    tools: [
      {
        id: 'subnet-calculator',
        name: 'IPv4/IPv6 Subnet Calculator',
        description: 'CIDR mask math — the one Network tool that needs no backend',
        icon: Calculator,
        route: '/tools/subnet-calculator',
        group: 'Lookups',
      },
      { id: 'dns-lookup', name: 'DNS Lookup', description: 'Any record type against public presets or a custom resolver', icon: Globe, route: '/tools/dns-lookup', group: 'Lookups' },
      { id: 'whois', name: 'Whois', description: 'Registrar, dates & nameservers for a domain or IP', icon: FileSearch, route: '/tools/whois', group: 'Lookups' },
      { id: 'ip-geolocation', name: 'IP Geolocation', description: 'Country, ISP & coordinates for a public IP', icon: MapPin, route: '/tools/ip-geolocation', group: 'Lookups' },
      { id: 'sntp', name: 'SNTP Lookup', description: 'Clock offset & round-trip delay from NTP servers', icon: Clock, route: '/tools/sntp', group: 'Lookups' },

      { id: 'ping-monitor', name: 'Ping Monitor', description: 'Continuous multi-host latency, loss % & live chart', icon: Activity, route: '/tools/ping-monitor', group: 'Reachability' },
      { id: 'traceroute', name: 'Traceroute', description: 'Per-hop RTT with geolocation and a route map', icon: Route, route: '/tools/traceroute', group: 'Reachability' },

      { id: 'port-scanner', name: 'Port Scanner', description: 'Concurrent TCP port sweep with service names', icon: ScanSearch, route: '/tools/port-scanner', group: 'Discovery' },
      { id: 'network-scanner', name: 'IP / Network Scanner', description: 'Discover hosts by ICMP, ARP, reverse DNS & port probe', icon: ScanLine, route: '/tools/network-scanner', group: 'Discovery' },

      { id: 'connections', name: 'Connections & Listeners', description: 'netstat-style active TCP/UDP sockets with owning process', icon: ArrowLeftRight, route: '/tools/connections', group: 'Local host' },
      { id: 'neighbor-table', name: 'Neighbor Table', description: 'ARP / NDP cache: IP ⟷ MAC ⟷ interface & state', icon: Table2, route: '/tools/neighbor-table', group: 'Local host' },
      { id: 'wake-on-lan', name: 'Wake on LAN', description: 'Send a magic packet to power on a host by MAC', icon: Power, route: '/tools/wake-on-lan', group: 'Local host' },

      { id: 'hosts-editor', name: 'Hosts File Editor', description: 'Edit /etc/hosts with enable/disable, backup & restore', icon: FileText, route: '/tools/hosts-editor', group: 'System' },
      { id: 'firewall-viewer', name: 'Firewall Viewer', description: 'Read-only view of OS firewall rules (Windows / firewalld)', icon: ShieldCheck, route: '/tools/firewall-viewer', group: 'System' },

      { id: 'iperf3', name: 'iperf3 Throughput', description: 'Bandwidth test with optional MTU / MSS override', icon: Gauge, route: '/tools/iperf3', group: 'Devices & throughput' },
      { id: 'snmp', name: 'SNMP', description: 'v1 / v2c / v3 Walk, Get & Set against an OID', icon: ServerCog, route: '/tools/snmp', group: 'Devices & throughput' },
      { id: 'discovery-protocol', name: 'Discovery Protocol', description: 'Capture LLDP / CDP neighbor advertisements', icon: RadioTower, group: 'Devices & throughput' },
    ],
  },
  {
    id: 'office',
    title: 'Office & Media',
    icon: FolderOpen,
    tools: [
      { id: 'pdf-split-merge', name: 'PDF Split & Merge', description: 'Combine or extract page ranges', icon: Files, route: '/tools/pdf-split-merge', group: 'Documents' },
      { id: 'pdf-inspector', name: 'PDF Inspector', description: 'Page count, metadata & encryption status', icon: FileSearch, route: '/tools/pdf-inspector', group: 'Documents' },

      { id: 'image-converter', name: 'Image Converter', description: 'JPEG / PNG / WebP compression', icon: Image, route: '/tools/image-converter', group: 'Images' },
      { id: 'exif-viewer', name: 'EXIF Metadata Viewer', description: 'Camera, GPS & technical EXIF tags', icon: Camera, route: '/tools/exif-viewer', group: 'Images' },

      { id: 'qr-code', name: 'QR Code Suite', description: 'Custom QR & WiFi access codes', icon: QrCode, route: '/tools/qr-code', group: 'Codes' },
      {
        id: 'qr-reader',
        name: 'QR Code Reader',
        description: 'Decode a QR image, structured breakdown for known formats',
        icon: ScanLine,
        route: '/tools/qr-reader',
        group: 'Codes',
      },

      { id: 'color-tools', name: 'Color Tools', description: 'Hex/RGB/HSL converter & color blindness simulator', icon: Palette, route: '/tools/color-tools', group: 'Color' },
    ],
  },
  {
    id: 'formflow',
    title: 'FormFlow Dynamic Builder',
    icon: Workflow,
    tools: [
      { id: 'formflow-builder', name: 'XML/YAML Form Designer', description: 'Auto-detect schema & loops', icon: Workflow, route: '/tools/formflow-builder' },
    ],
  },
  {
    id: 'config',
    title: 'Configuration Builders',
    icon: FileCog,
    // Grouped: Services → System → Containers.
    tools: [
      {
        id: 'web-server-config-builder',
        name: 'Web Server Config Builder',
        description: 'nginx server block or Apache VirtualHost — SSL, reverse proxy, security headers',
        icon: Server,
        route: '/tools/web-server-config-builder',
        group: 'Services',
      },
      {
        id: 'database-config-builder',
        name: 'Database Config Builder',
        description: 'postgresql.conf / my.cnf from RAM, workload & storage type',
        icon: Database,
        route: '/tools/database-config-builder',
        group: 'Services',
      },
      {
        id: 'zabbix-config-builder',
        name: 'Zabbix Config Builder',
        description: 'zabbix_server.conf or zabbix_agentd.conf from a curated directive catalog',
        icon: Activity,
        route: '/tools/zabbix-config-builder',
        group: 'Services',
      },
      {
        id: 'fail2ban-config-builder',
        name: 'Fail2ban Jail Config Builder',
        description: 'jail.local: DEFAULT policy plus a pick-your-services jail list',
        icon: ShieldBan,
        route: '/tools/fail2ban-config-builder',
        group: 'Services',
      },

      {
        id: 'ssh-config-builder',
        name: 'SSH Config Builder',
        description: 'Build ~/.ssh/config and sshd_config with hardened defaults',
        icon: Router,
        route: '/tools/ssh-config-builder',
        group: 'System',
      },
      {
        id: 'firewall-rule-builder',
        name: 'Firewall Rule Builder',
        description: 'UFW / nftables rules, with SSH-lockout safety warnings',
        icon: ShieldAlert,
        route: '/tools/firewall-rule-builder',
        group: 'System',
      },
      {
        id: 'sysctl-config-builder',
        name: 'Kernel Parameter Config Builder',
        description: 'Pick individual sysctl params, temp or permanent output',
        icon: SlidersHorizontal,
        route: '/tools/sysctl-config-builder',
        group: 'System',
      },
      { id: 'crontab-builder', name: 'Crontab Builder', description: 'Build or explain a cron expression, next run times', icon: Clock, route: '/tools/crontab-builder', group: 'System' },
      {
        id: 'chmod-calculator',
        name: 'Chmod Calculator',
        description: 'Octal ⟷ symbolic ⟷ checkbox grid, with special bits',
        icon: Lock,
        route: '/tools/chmod-calculator',
        group: 'System',
      },
      {
        id: 'rdp-file-builder',
        name: 'Windows RDP File Builder',
        description: 'Build an .rdp connection file from a catalog of mstsc properties, with a hardened preset',
        icon: MonitorCog,
        route: '/tools/rdp-file-builder',
        group: 'System',
      },

      {
        id: 'docker-run-converter',
        name: 'Docker Run → Compose',
        description: 'Convert a docker run command to docker-compose.yml',
        icon: Box,
        route: '/tools/docker-run-converter',
        group: 'Containers',
      },
    ],
  },
  {
    id: 'knowledge',
    title: 'Knowledge Hub',
    icon: GraduationCap,
    // Grouped: Reference (browse/look-up material) → AI & Automation (the
    // AI/agent/MCP/automation tooling landscape). See
    // KNOWLEDGE_HUB_AI_EXPANSION_PLAN.md.
    tools: [
      { id: 'cheatsheets', name: 'Cheatsheets', description: 'Git, Regex, Sysctl, Crontab & Chmod quick reference', icon: BookOpen, route: '/tools/cheatsheets', group: 'Reference' },
      {
        id: 'documentation',
        name: 'Documentation',
        description: 'Official docs: Zabbix, Ceph, PostgreSQL, K8s, Linux Kernel',
        icon: FileText,
        route: '/tools/documentation',
        group: 'Reference',
      },
      {
        id: 'reference-lists',
        name: 'Reference Lists',
        description: 'Curated "awesome-X" resource lists, searchable by tag',
        icon: List,
        route: '/tools/reference-lists',
        group: 'Reference',
      },
      { id: 'study-practice', name: 'Study & Practice', description: 'Roadmaps and hands-on exercise repos', icon: GraduationCap, route: '/tools/study-practice', group: 'Reference' },

      {
        id: 'ai-catalogs',
        name: 'AI Catalogs & Directories',
        description: 'Tool indexes, MCP registries, model leaderboards, awesome-lists',
        icon: LibraryBig,
        route: '/tools/ai-catalogs',
        group: 'AI & Automation',
      },
      { id: 'mcp-servers', name: 'MCP Servers', description: 'Model Context Protocol servers, gateways & registries', icon: Plug, route: '/tools/mcp-servers', group: 'AI & Automation' },
      {
        id: 'ai-frameworks',
        name: 'AI Frameworks & SDKs',
        description: 'Agent & LLM-app frameworks: LangChain, ADK, Pydantic AI, vLLM',
        icon: Boxes,
        route: '/tools/ai-frameworks',
        group: 'AI & Automation',
      },
      { id: 'ai-software', name: 'AI Software', description: 'End-user AI apps & agents — chat clients, desktop agents, coding tools', icon: Bot, route: '/tools/ai-software', group: 'AI & Automation' },
      { id: 'ai-skills', name: 'AI Skills', description: 'Packaged agent skills (SKILL.md) & skill marketplaces', icon: Wand2, route: '/tools/ai-skills', group: 'AI & Automation' },
      { id: 'automation', name: 'Automation', description: 'Workflow automation platforms: n8n, Activepieces, Windmill, Kestra', icon: Workflow, route: '/tools/automation', group: 'AI & Automation' },
      {
        id: 'ai-models',
        name: 'AI Models & Harnesses',
        description: 'Top foundation model families + serving stacks (Ollama, vLLM, llama.cpp)',
        icon: BrainCircuit,
        route: '/tools/ai-models',
        group: 'AI & Automation',
      },
      { id: 'dev-services', name: 'Dev Services & Hosting', description: 'Tunnels, static hosts, PaaS & deploy platforms', icon: Cloud, route: '/tools/dev-services', group: 'AI & Automation' },
    ],
  },
]
