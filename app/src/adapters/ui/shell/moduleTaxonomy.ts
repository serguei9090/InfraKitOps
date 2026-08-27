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
  Box,
  BookOpen,
  Braces,
  Cable,
  Calculator,
  Camera,
  Clock,
  Code,
  Database,
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
  List,
  ListTree,
  Lock,
  LockKeyhole,
  MapPin,
  Network,
  Palette,
  Paperclip,
  Power,
  QrCode,
  RadioTower,
  Route,
  Router,
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
  Terminal,
  Type,
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
    title: '1. Tuning & Performance',
    icon: Gauge,
    tools: [
      { id: 'linux-sysctl', name: 'Linux Kernel Sysctl', description: 'Network buffers, BBR, somaxconn', icon: Terminal, route: '/tools/linux-sysctl' },
      { id: 'ceph-pg', name: 'Ceph PG Calculator', description: 'Power-of-2 PG rounding math', icon: HardDrive, route: '/tools/ceph-pg' },
      { id: 'db-memory-sizer', name: 'Database RAM Sizer', description: 'PostgreSQL / MariaDB buffer sizing', icon: Server, route: '/tools/db-memory-sizer' },
      { id: 'zabbix-sizer', name: 'Monitoring Sizing', description: 'Zabbix NVPS & poller allocation', icon: Activity, route: '/tools/zabbix-sizer' },
      {
        id: 'firewall-command-builder',
        name: 'Firewall Command Builder',
        description: 'iptables, Windows Firewall & cloud (AWS/GCP/Azure) one-liners',
        icon: Shield,
        route: '/tools/firewall-command-builder',
      },
    ],
  },
  {
    id: 'utilities',
    title: '2. Daily Developer & Utilities',
    icon: Code,
    tools: [
      {
        id: 'ssh-keygen',
        name: 'SSH Key Pair Generator',
        description: 'Ed25519 keygen, OpenSSH format (RSA-4096 unsupported)',
        icon: KeyRound,
        route: '/tools/ssh-keygen',
      },
      { id: 'hash', name: 'Hash & Checksum', description: 'MD5, SHA-1/256/512, Blake2b, HMAC', icon: Hash, route: '/tools/hash' },
      { id: 'bcrypt', name: 'bcrypt Hash & Verify', description: 'One-way password hashing & verification', icon: Lock, route: '/tools/bcrypt' },
      {
        id: 'converters',
        name: 'Data Converter',
        description: 'YAML ⟷ JSON ⟷ TOML ⟷ XML, Base64, URL/HTML, radix, timestamps',
        icon: Shuffle,
        route: '/tools/converters',
      },
      { id: 'formatters', name: 'Formatters', description: 'Pretty-print, minify & validate JSON/XML/YAML/SQL', icon: Code, route: '/tools/formatters' },
      { id: 'id-generator', name: 'UUID / ULID Generator', description: 'UUID v1/v3/v4/v5 and ULID identifiers', icon: Fingerprint, route: '/tools/id-generator' },
      {
        id: 'password-generator',
        name: 'Password & Secret Generator',
        description: 'Configurable passwords, passphrases & strength rating',
        icon: KeySquare,
        route: '/tools/password-generator',
      },
      {
        id: 'regex-tester',
        name: 'Regex Tester & Explainer',
        description: 'Live matches, capture groups & pattern breakdown',
        icon: SearchCode,
        route: '/tools/regex-tester',
      },
      {
        id: 'text-diff',
        name: 'Text & JSON Diff',
        description: 'LCS-based line diff, JSON-aware key-order-insensitive mode',
        icon: GitCompare,
        route: '/tools/text-diff',
      },
      {
        id: 'jsonpath-evaluator',
        name: 'JSONPath Evaluator',
        description: 'Query JSON with $.a.b[*], slices, filters & recursive descent',
        icon: Braces,
        route: '/tools/jsonpath-evaluator',
      },
      {
        id: 'jwt-parser',
        name: 'JWT Parser',
        description: 'Decode header/payload, expiry check (does not verify signature)',
        icon: FileKey,
        route: '/tools/jwt-parser',
      },
      {
        id: 'x509-inspector',
        name: 'X.509 Certificate Inspector',
        description: 'Subject, validity, fingerprints & SANs from PEM/DER',
        icon: ShieldCheck,
        route: '/tools/x509-inspector',
      },
      {
        id: 'structured-tree-viewer',
        name: 'JSON/YAML Tree Viewer',
        description: 'Collapsible tree browser for large config files',
        icon: ListTree,
        route: '/tools/structured-tree-viewer',
      },
      { id: 'gzip-converter', name: 'GZip Compress / Decompress', description: 'Text or file, with base64 transport', icon: Archive, route: '/tools/gzip-converter' },
      {
        id: 'base64-file',
        name: 'Base64 File Converter',
        description: 'Binary file ⟷ base64, data-URI & k8s Secret formats',
        icon: Paperclip,
        route: '/tools/base64-file',
      },
      {
        id: 'json-to-csv',
        name: 'JSON → CSV',
        description: 'Flatten nested JSON arrays into CSV, RFC 4180 quoting',
        icon: Table,
        route: '/tools/json-to-csv',
      },
      { id: 'text-transformer', name: 'Text Transformer', description: 'Case conversion, slugify, sort/dedupe/trim lines', icon: Type, route: '/tools/text-transformer' },
      {
        id: 'mac-address',
        name: 'MAC Address Tool',
        description: 'Normalize, analyze U/L·I/G bits, vendor lookup & generate',
        icon: Cable,
        route: '/tools/mac-address',
      },
      {
        id: 'ip-range',
        name: 'IPv4 Range & IPv6 ULA',
        description: 'Range → minimal CIDR set, RFC 4193 ULA generator',
        icon: Waypoints,
        route: '/tools/ip-range',
      },
      {
        id: 'htpasswd-generator',
        name: 'htpasswd / Basic Auth Generator',
        description: 'bcrypt/APR1/SHA htpasswd lines & Basic auth header',
        icon: LockKeyhole,
        route: '/tools/htpasswd-generator',
      },
    ],
  },
  {
    id: 'network',
    title: '3. Network Toolkit',
    icon: Network,
    tools: [
      {
        id: 'subnet-calculator',
        name: 'IPv4/IPv6 Subnet Calculator',
        description: 'CIDR mask math — the one Network tool that needs no backend',
        icon: Calculator,
        route: '/tools/subnet-calculator',
      },
      { id: 'dns-lookup', name: 'DNS Lookup', description: 'Any record type against public presets or a custom resolver', icon: Globe },
      { id: 'sntp', name: 'SNTP Lookup', description: 'Clock offset & round-trip delay from NTP servers', icon: Clock },
      { id: 'whois', name: 'Whois', description: 'Registrar, dates & nameservers for a domain or IP', icon: FileSearch },
      { id: 'ip-geolocation', name: 'IP Geolocation', description: 'Country, ISP & coordinates for a public IP', icon: MapPin },
      { id: 'connections', name: 'Connections & Listeners', description: 'netstat-style active TCP/UDP sockets with owning process', icon: ArrowLeftRight },
      { id: 'wake-on-lan', name: 'Wake on LAN', description: 'Send a magic packet to power on a host by MAC', icon: Power },
      { id: 'ping-monitor', name: 'Ping Monitor', description: 'Continuous multi-host latency, loss % & live chart', icon: Activity },
      { id: 'traceroute', name: 'Traceroute', description: 'Per-hop RTT with geolocation and a route map', icon: Route },
      { id: 'port-scanner', name: 'Port Scanner', description: 'Concurrent TCP port sweep with service names', icon: ScanSearch },
      { id: 'network-scanner', name: 'IP / Network Scanner', description: 'Discover hosts by ICMP, ARP, reverse DNS & port probe', icon: ScanLine },
      { id: 'neighbor-table', name: 'Neighbor Table', description: 'ARP / NDP cache: IP ⟷ MAC ⟷ interface & state', icon: Table2 },
      { id: 'hosts-editor', name: 'Hosts File Editor', description: 'Edit /etc/hosts with enable/disable, backup & restore', icon: FileText },
      { id: 'firewall-viewer', name: 'Firewall Viewer', description: 'Read-only view of OS firewall rules (Windows / firewalld)', icon: ShieldCheck },
      { id: 'iperf3', name: 'iperf3 Throughput', description: 'Bandwidth test with optional MTU / MSS override', icon: Gauge },
      { id: 'snmp', name: 'SNMP', description: 'v1 / v2c / v3 Walk, Get & Set against an OID', icon: ServerCog },
      { id: 'discovery-protocol', name: 'Discovery Protocol', description: 'Capture LLDP / CDP neighbor advertisements', icon: RadioTower },
    ],
  },
  {
    id: 'office',
    title: '4. Office & Media',
    icon: FolderOpen,
    tools: [
      { id: 'pdf-split-merge', name: 'PDF Split & Merge', description: 'Combine or extract page ranges', icon: Files, route: '/tools/pdf-split-merge' },
      { id: 'pdf-inspector', name: 'PDF Inspector', description: 'Page count, metadata & encryption status', icon: FileSearch, route: '/tools/pdf-inspector' },
      { id: 'image-converter', name: 'Image Converter', description: 'JPEG / PNG / WebP compression', icon: Image, route: '/tools/image-converter' },
      { id: 'exif-viewer', name: 'EXIF Metadata Viewer', description: 'Camera, GPS & technical EXIF tags', icon: Camera, route: '/tools/exif-viewer' },
      { id: 'qr-code', name: 'QR Code Suite', description: 'Custom QR & WiFi access codes', icon: QrCode, route: '/tools/qr-code' },
      {
        id: 'qr-reader',
        name: 'QR Code Reader',
        description: 'Decode a QR image, structured breakdown for known formats',
        icon: ScanLine,
        route: '/tools/qr-reader',
      },
      { id: 'color-tools', name: 'Color Tools', description: 'Hex/RGB/HSL converter & color blindness simulator', icon: Palette, route: '/tools/color-tools' },
    ],
  },
  {
    id: 'formflow',
    title: '5. FormFlow Dynamic Builder',
    icon: Workflow,
    tools: [
      { id: 'formflow-builder', name: 'XML/YAML Form Designer', description: 'Auto-detect schema & loops', icon: Workflow, route: '/tools/formflow-builder' },
    ],
  },
  {
    id: 'config',
    title: '6. Configuration Builders',
    icon: Network,
    tools: [
      {
        id: 'ssh-config-builder',
        name: 'SSH Config Builder',
        description: 'Build ~/.ssh/config and sshd_config with hardened defaults',
        icon: Router,
        route: '/tools/ssh-config-builder',
      },
      {
        id: 'sysctl-config-builder',
        name: 'Kernel Parameter Config Builder',
        description: 'Pick individual sysctl params, temp or permanent output',
        icon: SlidersHorizontal,
        route: '/tools/sysctl-config-builder',
      },
      {
        id: 'firewall-rule-builder',
        name: 'Firewall Rule Builder',
        description: 'UFW / nftables rules, with SSH-lockout safety warnings',
        icon: ShieldAlert,
        route: '/tools/firewall-rule-builder',
      },
      {
        id: 'docker-run-converter',
        name: 'Docker Run → Compose',
        description: 'Convert a docker run command to docker-compose.yml',
        icon: Box,
        route: '/tools/docker-run-converter',
      },
      { id: 'crontab-builder', name: 'Crontab Builder', description: 'Build or explain a cron expression, next run times', icon: Clock, route: '/tools/crontab-builder' },
      {
        id: 'chmod-calculator',
        name: 'Chmod Calculator',
        description: 'Octal ⟷ symbolic ⟷ checkbox grid, with special bits',
        icon: Lock,
        route: '/tools/chmod-calculator',
      },
      {
        id: 'database-config-builder',
        name: 'Database Config Builder',
        description: 'postgresql.conf / my.cnf from RAM, workload & storage type',
        icon: Database,
        route: '/tools/database-config-builder',
      },
      {
        id: 'zabbix-config-builder',
        name: 'Zabbix Config Builder',
        description: 'zabbix_server.conf or zabbix_agentd.conf from a curated directive catalog',
        icon: Activity,
        route: '/tools/zabbix-config-builder',
      },
      {
        id: 'fail2ban-config-builder',
        name: 'Fail2ban Jail Config Builder',
        description: 'jail.local: DEFAULT policy plus a pick-your-services jail list',
        icon: ShieldBan,
        route: '/tools/fail2ban-config-builder',
      },
      {
        id: 'web-server-config-builder',
        name: 'Web Server Config Builder',
        description: 'nginx server block or Apache VirtualHost — SSL, reverse proxy, security headers',
        icon: Server,
        route: '/tools/web-server-config-builder',
      },
    ],
  },
  {
    id: 'knowledge',
    title: '7. Knowledge Hub',
    icon: GraduationCap,
    tools: [
      { id: 'cheatsheets', name: 'Cheatsheets', description: 'Git, Regex, Sysctl, Crontab & Chmod quick reference', icon: BookOpen, route: '/tools/cheatsheets' },
      {
        id: 'documentation',
        name: 'Documentation',
        description: 'Official docs: Zabbix, Ceph, PostgreSQL, K8s, Linux Kernel',
        icon: FileText,
        route: '/tools/documentation',
      },
      {
        id: 'reference-lists',
        name: 'Reference Lists',
        description: 'Curated "awesome-X" resource lists, searchable by tag',
        icon: List,
        route: '/tools/reference-lists',
      },
      { id: 'study-practice', name: 'Study & Practice', description: 'Roadmaps and hands-on exercise repos', icon: GraduationCap, route: '/tools/study-practice' },
    ],
  },
]
