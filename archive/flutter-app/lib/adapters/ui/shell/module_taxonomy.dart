import 'package:flutter/material.dart';

/// Static description of the five root modules from the spec's Master
/// Taxonomy. Tool entries are placeholders until each phase implements the
/// real use-case wired to lib/core/**.
class ToolEntry {
  const ToolEntry({required this.name, required this.description, required this.icon, this.route});

  final String name;
  final String description;
  final IconData icon;

  /// go_router path. Null means the tool isn't implemented yet — its
  /// "Launch Tool" button stays disabled.
  final String? route;
}

class ModuleSection {
  const ModuleSection({required this.id, required this.title, required this.icon, required this.tools});

  /// Stable slug used for the '/modules/:id' route — independent of the
  /// display title so renaming a module never breaks bookmarks/links.
  final String id;
  final String title;
  final IconData icon;
  final List<ToolEntry> tools;
}

/// Finds the module that owns the tool at [route], or null if [route]
/// isn't any tool's route (e.g. it's '/' or '/modules/:id' itself).
ModuleSection? moduleContainingRoute(String route) {
  for (final module in kModuleTaxonomy) {
    for (final tool in module.tools) {
      if (tool.route == route) return module;
    }
  }
  return null;
}

const List<ModuleSection> kModuleTaxonomy = [
  ModuleSection(
    id: 'tuning',
    title: '1. Tuning & Performance',
    icon: Icons.speed,
    tools: [
      ToolEntry(
        name: 'Linux Kernel Sysctl',
        description: 'Network buffers, BBR, somaxconn',
        icon: Icons.terminal,
        route: '/tools/linux-sysctl',
      ),
      ToolEntry(
        name: 'Ceph PG Calculator',
        description: 'Power-of-2 PG rounding math',
        icon: Icons.storage,
        route: '/tools/ceph-pg',
      ),
      ToolEntry(
        name: 'Database RAM Sizer',
        description: 'PostgreSQL / MariaDB buffer sizing',
        icon: Icons.dns,
        route: '/tools/db-memory-sizer',
      ),
      ToolEntry(
        name: 'Monitoring Sizing',
        description: 'Zabbix NVPS & poller allocation',
        icon: Icons.monitor_heart,
        route: '/tools/zabbix-sizer',
      ),
      ToolEntry(
        name: 'Firewall Command Builder',
        description: 'iptables, Windows Firewall & cloud (AWS/GCP/Azure) one-liners',
        icon: Icons.shield_outlined,
        route: '/tools/firewall-command-builder',
      ),
    ],
  ),
  ModuleSection(
    id: 'utilities',
    title: '2. Daily Developer & Utilities',
    icon: Icons.build,
    tools: [
      ToolEntry(
        name: 'SSH Key Pair Generator',
        description: 'Ed25519 keygen, OpenSSH format (RSA-4096 unsupported)',
        icon: Icons.key,
        route: '/tools/ssh-keygen',
      ),
      ToolEntry(
        name: 'IPv4/IPv6 Subnet Calculator',
        description: 'CIDR mask math',
        icon: Icons.lan,
        route: '/tools/subnet-calculator',
      ),
      ToolEntry(
        name: 'Hash & Checksum',
        description: 'MD5, SHA-1/256/512, Blake2b, HMAC',
        icon: Icons.tag,
        route: '/tools/hash',
      ),
      ToolEntry(
        name: 'bcrypt Hash & Verify',
        description: 'One-way password hashing & verification',
        icon: Icons.enhanced_encryption,
        route: '/tools/bcrypt',
      ),
      ToolEntry(
        name: 'Data Converter',
        description: 'YAML ⟷ JSON ⟷ TOML ⟷ XML, Base64, URL/HTML, radix, timestamps',
        icon: Icons.transform,
        route: '/tools/converters',
      ),
      ToolEntry(
        name: 'Formatters',
        description: 'Pretty-print, minify & validate JSON/XML/YAML/SQL',
        icon: Icons.code,
        route: '/tools/formatters',
      ),
      ToolEntry(
        name: 'UUID / ULID Generator',
        description: 'UUID v1/v3/v4/v5 and ULID identifiers',
        icon: Icons.fingerprint,
        route: '/tools/id-generator',
      ),
      ToolEntry(
        name: 'Password & Secret Generator',
        description: 'Configurable passwords, passphrases & strength rating',
        icon: Icons.password,
        route: '/tools/password-generator',
      ),
      ToolEntry(
        name: 'Regex Tester & Explainer',
        description: 'Live matches, capture groups & pattern breakdown',
        icon: Icons.manage_search,
        route: '/tools/regex-tester',
      ),
      ToolEntry(
        name: 'Text & JSON Diff',
        description: 'LCS-based line diff, JSON-aware key-order-insensitive mode',
        icon: Icons.difference_outlined,
        route: '/tools/text-diff',
      ),
      ToolEntry(
        name: 'JSONPath Evaluator',
        description: r'Query JSON with $.a.b[*], slices, filters & recursive descent',
        icon: Icons.data_object,
        route: '/tools/jsonpath-evaluator',
      ),
      ToolEntry(
        name: 'JWT Parser',
        description: 'Decode header/payload, expiry check (does not verify signature)',
        icon: Icons.key_outlined,
        route: '/tools/jwt-parser',
      ),
      ToolEntry(
        name: 'X.509 Certificate Inspector',
        description: 'Subject, validity, fingerprints & SANs from PEM/DER',
        icon: Icons.verified_user_outlined,
        route: '/tools/x509-inspector',
      ),
      ToolEntry(
        name: 'JSON/YAML Tree Viewer',
        description: 'Collapsible tree browser for large config files',
        icon: Icons.account_tree_outlined,
        route: '/tools/structured-tree-viewer',
      ),
      ToolEntry(
        name: 'GZip Compress / Decompress',
        description: 'Text or file, with base64 transport',
        icon: Icons.compress,
        route: '/tools/gzip-converter',
      ),
      ToolEntry(
        name: 'Base64 File Converter',
        description: 'Binary file ⟷ base64, data-URI & k8s Secret formats',
        icon: Icons.attach_file,
        route: '/tools/base64-file',
      ),
      ToolEntry(
        name: 'JSON → CSV',
        description: 'Flatten nested JSON arrays into CSV, RFC 4180 quoting',
        icon: Icons.table_chart_outlined,
        route: '/tools/json-to-csv',
      ),
      ToolEntry(
        name: 'Text Transformer',
        description: 'Case conversion, slugify, sort/dedupe/trim lines',
        icon: Icons.text_fields,
        route: '/tools/text-transformer',
      ),
      ToolEntry(
        name: 'MAC Address Tool',
        description: 'Normalize, analyze U/L·I/G bits, vendor lookup & generate',
        icon: Icons.settings_ethernet,
        route: '/tools/mac-address',
      ),
      ToolEntry(
        name: 'IPv4 Range & IPv6 ULA',
        description: 'Range → minimal CIDR set, RFC 4193 ULA generator',
        icon: Icons.hub_outlined,
        route: '/tools/ip-range',
      ),
      ToolEntry(
        name: 'htpasswd / Basic Auth Generator',
        description: 'bcrypt/APR1/SHA htpasswd lines & Basic auth header',
        icon: Icons.password_outlined,
        route: '/tools/htpasswd-generator',
      ),
    ],
  ),
  ModuleSection(
    id: 'office',
    title: '3. Office & Media',
    icon: Icons.folder_copy,
    tools: [
      ToolEntry(
        name: 'PDF Split & Merge',
        description: 'Combine or extract page ranges',
        icon: Icons.picture_as_pdf,
        route: '/tools/pdf-split-merge',
      ),
      ToolEntry(
        name: 'PDF Inspector',
        description: 'Page count, metadata & encryption status',
        icon: Icons.find_in_page,
        route: '/tools/pdf-inspector',
      ),
      ToolEntry(
        name: 'Image Converter',
        description: 'JPEG / PNG / WebP compression',
        icon: Icons.image,
        route: '/tools/image-converter',
      ),
      ToolEntry(
        name: 'EXIF Metadata Viewer',
        description: 'Camera, GPS & technical EXIF tags',
        icon: Icons.camera_alt_outlined,
        route: '/tools/exif-viewer',
      ),
      ToolEntry(
        name: 'QR Code Suite',
        description: 'Custom QR & WiFi access codes',
        icon: Icons.qr_code,
        route: '/tools/qr-code',
      ),
      ToolEntry(
        name: 'QR Code Reader',
        description: 'Decode a QR image, structured breakdown for known formats',
        icon: Icons.qr_code_scanner,
        route: '/tools/qr-reader',
      ),
      ToolEntry(
        name: 'Color Tools',
        description: 'Hex/RGB/HSL converter & color blindness simulator',
        icon: Icons.palette_outlined,
        route: '/tools/color-tools',
      ),
    ],
  ),
  ModuleSection(
    id: 'formflow',
    title: '4. FormFlow Dynamic Builder',
    icon: Icons.dynamic_form,
    tools: [
      ToolEntry(
        name: 'XML/YAML Form Designer',
        description: 'Auto-detect schema & loops',
        icon: Icons.schema,
        route: '/tools/formflow-builder',
      ),
      ToolEntry(
        name: 'Custom Saved Templates',
        description: 'Your saved form library',
        icon: Icons.folder_special,
        route: '/tools/saved-templates',
      ),
    ],
  ),
  ModuleSection(
    id: 'config',
    title: '5. Configuration Builders',
    icon: Icons.settings_ethernet,
    tools: [
      ToolEntry(
        name: 'SSH Config Builder',
        description: 'Build ~/.ssh/config and sshd_config with hardened defaults',
        icon: Icons.router,
        route: '/tools/ssh-config-builder',
      ),
      ToolEntry(
        name: 'Kernel Parameter Config Builder',
        description: 'Pick individual sysctl params, temp or permanent output',
        icon: Icons.tune,
        route: '/tools/sysctl-config-builder',
      ),
      ToolEntry(
        name: 'Firewall Rule Builder',
        description: 'UFW / nftables rules, with SSH-lockout safety warnings',
        icon: Icons.security,
        route: '/tools/firewall-rule-builder',
      ),
      ToolEntry(
        name: 'Docker Run → Compose',
        description: 'Convert a docker run command to docker-compose.yml',
        icon: Icons.view_in_ar_outlined,
        route: '/tools/docker-run-converter',
      ),
      ToolEntry(
        name: 'Crontab Builder',
        description: 'Build or explain a cron expression, next run times',
        icon: Icons.schedule,
        route: '/tools/crontab-builder',
      ),
      ToolEntry(
        name: 'Chmod Calculator',
        description: 'Octal ⟷ symbolic ⟷ checkbox grid, with special bits',
        icon: Icons.lock_outline,
        route: '/tools/chmod-calculator',
      ),
      ToolEntry(
        name: 'Database Config Builder',
        description: 'postgresql.conf / my.cnf from RAM, workload & storage type',
        icon: Icons.storage_outlined,
        route: '/tools/database-config-builder',
      ),
    ],
  ),
  ModuleSection(
    id: 'knowledge',
    title: '6. Knowledge Hub',
    icon: Icons.school_outlined,
    tools: [
      ToolEntry(
        name: 'Cheatsheets',
        description: 'Git, Regex, Sysctl, Crontab & Chmod quick reference',
        icon: Icons.menu_book,
        route: '/tools/cheatsheets',
      ),
      ToolEntry(
        name: 'Documentation',
        description: 'Official docs: Zabbix, Ceph, PostgreSQL, K8s, Linux Kernel',
        icon: Icons.description_outlined,
        route: '/tools/documentation',
      ),
      ToolEntry(
        name: 'Reference Lists',
        description: 'Curated "awesome-X" resource lists, searchable by tag',
        icon: Icons.list_alt,
        route: '/tools/reference-lists',
      ),
      ToolEntry(
        name: 'Study & Practice',
        description: 'Roadmaps and hands-on exercise repos',
        icon: Icons.school,
        route: '/tools/study-practice',
      ),
    ],
  ),
];
