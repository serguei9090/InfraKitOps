import { createBrowserRouter } from 'react-router-dom'
import { AppShellScaffold } from './adapters/ui/shell/AppShellScaffold'
import { HomeDashboardScreen } from './adapters/ui/shell/HomeDashboardScreen'
import { ModuleToolsScreen } from './adapters/ui/shell/ModuleToolsScreen'
import { RouteFallback } from './adapters/ui/shell/RouteFallback'

// Every `/tools/*` and `/settings*` screen is code-split via `lazy:` — see
// CODE_SPLITTING_PLAN.md. Only the shell + first-paint routes are eager.
// React Router holds the previous screen mounted until the chunk resolves, so
// client navigations don't flash; `RouteFallback` covers a cold deep-link.

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShellScaffold />,
    HydrateFallback: RouteFallback,
    children: [
      { index: true, element: <HomeDashboardScreen /> },
      { path: 'modules/:moduleId', element: <ModuleToolsScreen /> },
      // '/tools/*' routes are added one at a time as each tool screen is
      // ported (Phase 3+) — see CLAUDE.md's "Adding a new tool" section.

      // Wave 1 — Tuning + Config
      { path: 'tools/ceph-pg', lazy: () => import('./adapters/ui/tools/CephPgScreen').then((m) => ({ Component: m.CephPgScreen })) },
      { path: 'tools/linux-sysctl', lazy: () => import('./adapters/ui/tools/LinuxSysctlScreen').then((m) => ({ Component: m.LinuxSysctlScreen })) },
      { path: 'tools/db-memory-sizer', lazy: () => import('./adapters/ui/tools/DbMemorySizerScreen').then((m) => ({ Component: m.DbMemorySizerScreen })) },
      { path: 'tools/load-balancer-sizer', lazy: () => import('./adapters/ui/tools/LoadBalancerSizerScreen').then((m) => ({ Component: m.LoadBalancerSizerScreen })) },
      { path: 'tools/connection-pool-sizer', lazy: () => import('./adapters/ui/tools/ConnectionPoolSizerScreen').then((m) => ({ Component: m.ConnectionPoolSizerScreen })) },
      { path: 'tools/k8s-capacity-sizer', lazy: () => import('./adapters/ui/tools/K8sCapacitySizerScreen').then((m) => ({ Component: m.K8sCapacitySizerScreen })) },
      { path: 'tools/slo-error-budget', lazy: () => import('./adapters/ui/tools/SloErrorBudgetScreen').then((m) => ({ Component: m.SloErrorBudgetScreen })) },
      { path: 'tools/availability-calculator', lazy: () => import('./adapters/ui/tools/AvailabilityCalculatorScreen').then((m) => ({ Component: m.AvailabilityCalculatorScreen })) },
      { path: 'tools/storage-iops-sizer', lazy: () => import('./adapters/ui/tools/StorageIopsSizerScreen').then((m) => ({ Component: m.StorageIopsSizerScreen })) },
      { path: 'tools/capacity-runway', lazy: () => import('./adapters/ui/tools/CapacityRunwayScreen').then((m) => ({ Component: m.CapacityRunwayScreen })) },
      { path: 'tools/cloud-right-size', lazy: () => import('./adapters/ui/tools/CloudRightSizeScreen').then((m) => ({ Component: m.CloudRightSizeScreen })) },
      { path: 'tools/cache-sizer', lazy: () => import('./adapters/ui/tools/CacheSizerScreen').then((m) => ({ Component: m.CacheSizerScreen })) },
      { path: 'tools/kafka-sizer', lazy: () => import('./adapters/ui/tools/KafkaSizerScreen').then((m) => ({ Component: m.KafkaSizerScreen })) },
      { path: 'tools/retry-budget', lazy: () => import('./adapters/ui/tools/RetryBudgetScreen').then((m) => ({ Component: m.RetryBudgetScreen })) },
      { path: 'tools/etcd-sizer', lazy: () => import('./adapters/ui/tools/EtcdSizerScreen').then((m) => ({ Component: m.EtcdSizerScreen })) },
      { path: 'tools/zabbix-sizer', lazy: () => import('./adapters/ui/tools/ZabbixSizerScreen').then((m) => ({ Component: m.ZabbixSizerScreen })) },
      { path: 'tools/firewall-command-builder', lazy: () => import('./adapters/ui/tools/FirewallCommandBuilderScreen').then((m) => ({ Component: m.FirewallCommandBuilderScreen })) },
      { path: 'tools/ssh-config-builder', lazy: () => import('./adapters/ui/tools/SshConfigBuilderScreen').then((m) => ({ Component: m.SshConfigBuilderScreen })) },
      { path: 'tools/sysctl-config-builder', lazy: () => import('./adapters/ui/tools/SysctlConfigBuilderScreen').then((m) => ({ Component: m.SysctlConfigBuilderScreen })) },
      { path: 'tools/firewall-rule-builder', lazy: () => import('./adapters/ui/tools/FirewallRuleBuilderScreen').then((m) => ({ Component: m.FirewallRuleBuilderScreen })) },
      { path: 'tools/docker-run-converter', lazy: () => import('./adapters/ui/tools/DockerRunConverterScreen').then((m) => ({ Component: m.DockerRunConverterScreen })) },
      { path: 'tools/crontab-builder', lazy: () => import('./adapters/ui/tools/CrontabBuilderScreen').then((m) => ({ Component: m.CrontabBuilderScreen })) },
      { path: 'tools/chmod-calculator', lazy: () => import('./adapters/ui/tools/ChmodCalculatorScreen').then((m) => ({ Component: m.ChmodCalculatorScreen })) },
      { path: 'tools/rdp-file-builder', lazy: () => import('./adapters/ui/tools/RdpFileBuilderScreen').then((m) => ({ Component: m.RdpFileBuilderScreen })) },
      { path: 'tools/database-config-builder', lazy: () => import('./adapters/ui/tools/DatabaseConfigBuilderScreen').then((m) => ({ Component: m.DatabaseConfigBuilderScreen })) },

      // Wave 2 — Utilities + Knowledge Hub
      { path: 'tools/ssh-keygen', lazy: () => import('./adapters/ui/tools/SshKeygenScreen').then((m) => ({ Component: m.SshKeygenScreen })) },
      { path: 'tools/hash', lazy: () => import('./adapters/ui/tools/HashCalculatorScreen').then((m) => ({ Component: m.HashCalculatorScreen })) },
      { path: 'tools/bcrypt', lazy: () => import('./adapters/ui/tools/BcryptScreen').then((m) => ({ Component: m.BcryptScreen })) },
      { path: 'tools/x509-inspector', lazy: () => import('./adapters/ui/tools/X509InspectorScreen').then((m) => ({ Component: m.X509InspectorScreen })) },
      { path: 'tools/jwt-parser', lazy: () => import('./adapters/ui/tools/JwtParserScreen').then((m) => ({ Component: m.JwtParserScreen })) },
      { path: 'tools/htpasswd-generator', lazy: () => import('./adapters/ui/tools/HtpasswdGeneratorScreen').then((m) => ({ Component: m.HtpasswdGeneratorScreen })) },
      { path: 'tools/subnet-calculator', lazy: () => import('./adapters/ui/tools/SubnetCalculatorScreen').then((m) => ({ Component: m.SubnetCalculatorScreen })) },
      { path: 'tools/mac-address', lazy: () => import('./adapters/ui/tools/MacAddressScreen').then((m) => ({ Component: m.MacAddressScreen })) },
      { path: 'tools/ip-range', lazy: () => import('./adapters/ui/tools/IpRangeScreen').then((m) => ({ Component: m.IpRangeScreen })) },
      { path: 'tools/regex-tester', lazy: () => import('./adapters/ui/tools/RegexTesterScreen').then((m) => ({ Component: m.RegexTesterScreen })) },
      { path: 'tools/id-generator', lazy: () => import('./adapters/ui/tools/IdGeneratorScreen').then((m) => ({ Component: m.IdGeneratorScreen })) },
      { path: 'tools/password-generator', lazy: () => import('./adapters/ui/tools/PasswordGeneratorScreen').then((m) => ({ Component: m.PasswordGeneratorScreen })) },
      { path: 'tools/converters', lazy: () => import('./adapters/ui/tools/ConvertersScreen').then((m) => ({ Component: m.ConvertersScreen })) },
      { path: 'tools/formatters', lazy: () => import('./adapters/ui/tools/FormattersScreen').then((m) => ({ Component: m.FormattersScreen })) },
      { path: 'tools/text-diff', lazy: () => import('./adapters/ui/tools/TextDiffScreen').then((m) => ({ Component: m.TextDiffScreen })) },
      { path: 'tools/jsonpath-evaluator', lazy: () => import('./adapters/ui/tools/JsonpathEvaluatorScreen').then((m) => ({ Component: m.JsonpathEvaluatorScreen })) },
      { path: 'tools/structured-tree-viewer', lazy: () => import('./adapters/ui/tools/StructuredTreeViewerScreen').then((m) => ({ Component: m.StructuredTreeViewerScreen })) },
      { path: 'tools/json-to-csv', lazy: () => import('./adapters/ui/tools/JsonToCsvScreen').then((m) => ({ Component: m.JsonToCsvScreen })) },
      { path: 'tools/gzip-converter', lazy: () => import('./adapters/ui/tools/GzipConverterScreen').then((m) => ({ Component: m.GzipConverterScreen })) },
      { path: 'tools/base64-file', lazy: () => import('./adapters/ui/tools/Base64FileScreen').then((m) => ({ Component: m.Base64FileScreen })) },
      { path: 'tools/text-transformer', lazy: () => import('./adapters/ui/tools/TextTransformerScreen').then((m) => ({ Component: m.TextTransformerScreen })) },
      { path: 'tools/cheatsheets', lazy: () => import('./adapters/ui/tools/CheatsheetsScreen').then((m) => ({ Component: m.CheatsheetsScreen })) },
      { path: 'tools/documentation', lazy: () => import('./adapters/ui/tools/DocumentationScreen').then((m) => ({ Component: m.DocumentationScreen })) },
      { path: 'tools/reference-lists', lazy: () => import('./adapters/ui/tools/ReferenceListsScreen').then((m) => ({ Component: m.ReferenceListsScreen })) },
      { path: 'tools/study-practice', lazy: () => import('./adapters/ui/tools/StudyPracticeScreen').then((m) => ({ Component: m.StudyPracticeScreen })) },
      { path: 'tools/ai-catalogs', lazy: () => import('./adapters/ui/tools/AiCatalogsScreen').then((m) => ({ Component: m.AiCatalogsScreen })) },
      { path: 'tools/mcp-servers', lazy: () => import('./adapters/ui/tools/McpServersScreen').then((m) => ({ Component: m.McpServersScreen })) },
      { path: 'tools/ai-frameworks', lazy: () => import('./adapters/ui/tools/AiFrameworksScreen').then((m) => ({ Component: m.AiFrameworksScreen })) },
      { path: 'tools/ai-software', lazy: () => import('./adapters/ui/tools/AiSoftwareScreen').then((m) => ({ Component: m.AiSoftwareScreen })) },
      { path: 'tools/ai-skills', lazy: () => import('./adapters/ui/tools/AiSkillsScreen').then((m) => ({ Component: m.AiSkillsScreen })) },
      { path: 'tools/automation', lazy: () => import('./adapters/ui/tools/AutomationScreen').then((m) => ({ Component: m.AutomationScreen })) },
      { path: 'tools/ai-models', lazy: () => import('./adapters/ui/tools/AiModelsScreen').then((m) => ({ Component: m.AiModelsScreen })) },
      { path: 'tools/dev-services', lazy: () => import('./adapters/ui/tools/DevServicesScreen').then((m) => ({ Component: m.DevServicesScreen })) },

      // Phase 4 — Office & Media
      { path: 'tools/color-tools', lazy: () => import('./adapters/ui/tools/ColorToolsScreen').then((m) => ({ Component: m.ColorToolsScreen })) },
      { path: 'tools/pdf-split-merge', lazy: () => import('./adapters/ui/tools/PdfSplitMergeScreen').then((m) => ({ Component: m.PdfSplitMergeScreen })) },
      { path: 'tools/pdf-inspector', lazy: () => import('./adapters/ui/tools/PdfInspectorScreen').then((m) => ({ Component: m.PdfInspectorScreen })) },
      { path: 'tools/image-converter', lazy: () => import('./adapters/ui/tools/ImageConverterScreen').then((m) => ({ Component: m.ImageConverterScreen })) },
      { path: 'tools/exif-viewer', lazy: () => import('./adapters/ui/tools/ExifViewerScreen').then((m) => ({ Component: m.ExifViewerScreen })) },
      { path: 'tools/qr-code', lazy: () => import('./adapters/ui/tools/QrCodeScreen').then((m) => ({ Component: m.QrCodeScreen })) },
      { path: 'tools/qr-reader', lazy: () => import('./adapters/ui/tools/QrReaderScreen').then((m) => ({ Component: m.QrReaderScreen })) },

      // Phase 5 — FormFlow Dynamic Builder
      { path: 'tools/formflow-builder', lazy: () => import('./adapters/ui/tools/FormFlowBuilderScreen').then((m) => ({ Component: m.FormFlowBuilderScreen })) },

      // Prompt Library
      { path: 'tools/prompt-library', lazy: () => import('./adapters/ui/tools/PromptLibraryScreen').then((m) => ({ Component: m.PromptLibraryScreen })) },

      // Runbooks
      { path: 'tools/runbook', lazy: () => import('./adapters/ui/tools/RunbookScreen').then((m) => ({ Component: m.RunbookScreen })) },
      { path: 'tools/runbook/edit/:id', lazy: () => import('./adapters/ui/tools/RunbookEditorScreen').then((m) => ({ Component: m.RunbookEditorScreen })) },
      { path: 'tools/ai', lazy: () => import('./adapters/ui/tools/AiScreen').then((m) => ({ Component: m.AiScreen })) },

      // Ansible Manager
      { path: 'tools/ansible', lazy: () => import('./adapters/ui/tools/AnsibleScreen').then((m) => ({ Component: m.AnsibleScreen })) },
      { path: 'settings', lazy: () => import('./adapters/ui/settings/SettingsScreen').then((m) => ({ Component: m.SettingsScreen })) },
      { path: 'settings/:section', lazy: () => import('./adapters/ui/settings/SettingsScreen').then((m) => ({ Component: m.SettingsScreen })) },

      // Configuration Builders — Zabbix / Fail2ban
      { path: 'tools/zabbix-config-builder', lazy: () => import('./adapters/ui/tools/ZabbixConfigBuilderScreen').then((m) => ({ Component: m.ZabbixConfigBuilderScreen })) },
      { path: 'tools/fail2ban-config-builder', lazy: () => import('./adapters/ui/tools/Fail2banConfigBuilderScreen').then((m) => ({ Component: m.Fail2banConfigBuilderScreen })) },
      { path: 'tools/web-server-config-builder', lazy: () => import('./adapters/ui/tools/WebServerConfigBuilderScreen').then((m) => ({ Component: m.WebServerConfigBuilderScreen })) },

      // Network Toolkit
      { path: 'tools/sntp', lazy: () => import('./adapters/ui/tools/SntpLookupScreen').then((m) => ({ Component: m.SntpLookupScreen })) },
      { path: 'tools/whois', lazy: () => import('./adapters/ui/tools/WhoisScreen').then((m) => ({ Component: m.WhoisScreen })) },
      { path: 'tools/dns-lookup', lazy: () => import('./adapters/ui/tools/DnsLookupScreen').then((m) => ({ Component: m.DnsLookupScreen })) },
      { path: 'tools/ip-geolocation', lazy: () => import('./adapters/ui/tools/IpGeolocationScreen').then((m) => ({ Component: m.IpGeolocationScreen })) },
      { path: 'tools/connections', lazy: () => import('./adapters/ui/tools/ConnectionsScreen').then((m) => ({ Component: m.ConnectionsScreen })) },
      { path: 'tools/wake-on-lan', lazy: () => import('./adapters/ui/tools/WakeOnLanScreen').then((m) => ({ Component: m.WakeOnLanScreen })) },
      { path: 'tools/port-scanner', lazy: () => import('./adapters/ui/tools/PortScannerScreen').then((m) => ({ Component: m.PortScannerScreen })) },
      { path: 'tools/ping-monitor', lazy: () => import('./adapters/ui/tools/PingMonitorScreen').then((m) => ({ Component: m.PingMonitorScreen })) },
      { path: 'tools/traceroute', lazy: () => import('./adapters/ui/tools/TracerouteScreen').then((m) => ({ Component: m.TracerouteScreen })) },
      { path: 'tools/network-scanner', lazy: () => import('./adapters/ui/tools/NetworkScannerScreen').then((m) => ({ Component: m.NetworkScannerScreen })) },
      { path: 'tools/snmp', lazy: () => import('./adapters/ui/tools/SnmpScreen').then((m) => ({ Component: m.SnmpScreen })) },
      { path: 'tools/discovery-protocol', lazy: () => import('./adapters/ui/tools/DiscoveryProtocolScreen').then((m) => ({ Component: m.DiscoveryProtocolScreen })) },
      { path: 'tools/neighbor-table', lazy: () => import('./adapters/ui/tools/NeighborTableScreen').then((m) => ({ Component: m.NeighborTableScreen })) },
      { path: 'tools/hosts-editor', lazy: () => import('./adapters/ui/tools/HostsFileEditorScreen').then((m) => ({ Component: m.HostsFileEditorScreen })) },
      { path: 'tools/firewall-viewer', lazy: () => import('./adapters/ui/tools/FirewallViewerScreen').then((m) => ({ Component: m.FirewallViewerScreen })) },
      { path: 'tools/iperf3', lazy: () => import('./adapters/ui/tools/Iperf3Screen').then((m) => ({ Component: m.Iperf3Screen })) },
    ],
  },
])
