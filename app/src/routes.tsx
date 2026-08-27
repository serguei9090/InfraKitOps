import { createBrowserRouter } from 'react-router-dom'
import { AppShellScaffold } from './adapters/ui/shell/AppShellScaffold'
import { HomeDashboardScreen } from './adapters/ui/shell/HomeDashboardScreen'
import { ModuleToolsScreen } from './adapters/ui/shell/ModuleToolsScreen'

// Wave 1 — Tuning + Config
import { CephPgScreen } from './adapters/ui/tools/CephPgScreen'
import { LinuxSysctlScreen } from './adapters/ui/tools/LinuxSysctlScreen'
import { DbMemorySizerScreen } from './adapters/ui/tools/DbMemorySizerScreen'
import { ZabbixSizerScreen } from './adapters/ui/tools/ZabbixSizerScreen'
import { FirewallCommandBuilderScreen } from './adapters/ui/tools/FirewallCommandBuilderScreen'
import { SshConfigBuilderScreen } from './adapters/ui/tools/SshConfigBuilderScreen'
import { SysctlConfigBuilderScreen } from './adapters/ui/tools/SysctlConfigBuilderScreen'
import { FirewallRuleBuilderScreen } from './adapters/ui/tools/FirewallRuleBuilderScreen'
import { DockerRunConverterScreen } from './adapters/ui/tools/DockerRunConverterScreen'
import { CrontabBuilderScreen } from './adapters/ui/tools/CrontabBuilderScreen'
import { ChmodCalculatorScreen } from './adapters/ui/tools/ChmodCalculatorScreen'
import { DatabaseConfigBuilderScreen } from './adapters/ui/tools/DatabaseConfigBuilderScreen'

// Wave 2 — Utilities + Knowledge Hub
import { SshKeygenScreen } from './adapters/ui/tools/SshKeygenScreen'
import { HashCalculatorScreen } from './adapters/ui/tools/HashCalculatorScreen'
import { BcryptScreen } from './adapters/ui/tools/BcryptScreen'
import { X509InspectorScreen } from './adapters/ui/tools/X509InspectorScreen'
import { JwtParserScreen } from './adapters/ui/tools/JwtParserScreen'
import { HtpasswdGeneratorScreen } from './adapters/ui/tools/HtpasswdGeneratorScreen'
import { SubnetCalculatorScreen } from './adapters/ui/tools/SubnetCalculatorScreen'
import { MacAddressScreen } from './adapters/ui/tools/MacAddressScreen'
import { IpRangeScreen } from './adapters/ui/tools/IpRangeScreen'
import { RegexTesterScreen } from './adapters/ui/tools/RegexTesterScreen'
import { IdGeneratorScreen } from './adapters/ui/tools/IdGeneratorScreen'
import { PasswordGeneratorScreen } from './adapters/ui/tools/PasswordGeneratorScreen'
import { ConvertersScreen } from './adapters/ui/tools/ConvertersScreen'
import { FormattersScreen } from './adapters/ui/tools/FormattersScreen'
import { TextDiffScreen } from './adapters/ui/tools/TextDiffScreen'
import { JsonpathEvaluatorScreen } from './adapters/ui/tools/JsonpathEvaluatorScreen'
import { StructuredTreeViewerScreen } from './adapters/ui/tools/StructuredTreeViewerScreen'
import { JsonToCsvScreen } from './adapters/ui/tools/JsonToCsvScreen'
import { GzipConverterScreen } from './adapters/ui/tools/GzipConverterScreen'
import { Base64FileScreen } from './adapters/ui/tools/Base64FileScreen'
import { TextTransformerScreen } from './adapters/ui/tools/TextTransformerScreen'
import { CheatsheetsScreen } from './adapters/ui/tools/CheatsheetsScreen'
import { DocumentationScreen } from './adapters/ui/tools/DocumentationScreen'
import { ReferenceListsScreen } from './adapters/ui/tools/ReferenceListsScreen'
import { StudyPracticeScreen } from './adapters/ui/tools/StudyPracticeScreen'

// Phase 4 — Office & Media
import { ColorToolsScreen } from './adapters/ui/tools/ColorToolsScreen'
import { PdfSplitMergeScreen } from './adapters/ui/tools/PdfSplitMergeScreen'
import { PdfInspectorScreen } from './adapters/ui/tools/PdfInspectorScreen'
import { ImageConverterScreen } from './adapters/ui/tools/ImageConverterScreen'
import { ExifViewerScreen } from './adapters/ui/tools/ExifViewerScreen'
import { QrCodeScreen } from './adapters/ui/tools/QrCodeScreen'
import { QrReaderScreen } from './adapters/ui/tools/QrReaderScreen'

// Phase 5 — FormFlow Dynamic Builder
import { FormFlowBuilderScreen } from './adapters/ui/tools/FormFlowBuilderScreen'

// Configuration Builders — Zabbix / Fail2ban
import { ZabbixConfigBuilderScreen } from './adapters/ui/tools/ZabbixConfigBuilderScreen'
import { Fail2banConfigBuilderScreen } from './adapters/ui/tools/Fail2banConfigBuilderScreen'
import { WebServerConfigBuilderScreen } from './adapters/ui/tools/WebServerConfigBuilderScreen'

// Network Toolkit (N1+)
import { SntpLookupScreen } from './adapters/ui/tools/SntpLookupScreen'
import { PortScannerScreen } from './adapters/ui/tools/PortScannerScreen'
import { PingMonitorScreen } from './adapters/ui/tools/PingMonitorScreen'
import { TracerouteScreen } from './adapters/ui/tools/TracerouteScreen'
import { NetworkScannerScreen } from './adapters/ui/tools/NetworkScannerScreen'
import { SnmpScreen } from './adapters/ui/tools/SnmpScreen'
import { NeighborTableScreen } from './adapters/ui/tools/NeighborTableScreen'
import { WhoisScreen } from './adapters/ui/tools/WhoisScreen'
import { DnsLookupScreen } from './adapters/ui/tools/DnsLookupScreen'
import { IpGeolocationScreen } from './adapters/ui/tools/IpGeolocationScreen'
import { ConnectionsScreen } from './adapters/ui/tools/ConnectionsScreen'
import { WakeOnLanScreen } from './adapters/ui/tools/WakeOnLanScreen'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShellScaffold />,
    children: [
      { index: true, element: <HomeDashboardScreen /> },
      { path: 'modules/:moduleId', element: <ModuleToolsScreen /> },
      // '/tools/*' routes are added one at a time as each tool screen is
      // ported (Phase 3+) — see CLAUDE.md's "Adding a new tool" section.

      // Wave 1 — Tuning + Config
      { path: 'tools/ceph-pg', element: <CephPgScreen /> },
      { path: 'tools/linux-sysctl', element: <LinuxSysctlScreen /> },
      { path: 'tools/db-memory-sizer', element: <DbMemorySizerScreen /> },
      { path: 'tools/zabbix-sizer', element: <ZabbixSizerScreen /> },
      { path: 'tools/firewall-command-builder', element: <FirewallCommandBuilderScreen /> },
      { path: 'tools/ssh-config-builder', element: <SshConfigBuilderScreen /> },
      { path: 'tools/sysctl-config-builder', element: <SysctlConfigBuilderScreen /> },
      { path: 'tools/firewall-rule-builder', element: <FirewallRuleBuilderScreen /> },
      { path: 'tools/docker-run-converter', element: <DockerRunConverterScreen /> },
      { path: 'tools/crontab-builder', element: <CrontabBuilderScreen /> },
      { path: 'tools/chmod-calculator', element: <ChmodCalculatorScreen /> },
      { path: 'tools/database-config-builder', element: <DatabaseConfigBuilderScreen /> },

      // Wave 2 — Utilities + Knowledge Hub
      { path: 'tools/ssh-keygen', element: <SshKeygenScreen /> },
      { path: 'tools/hash', element: <HashCalculatorScreen /> },
      { path: 'tools/bcrypt', element: <BcryptScreen /> },
      { path: 'tools/x509-inspector', element: <X509InspectorScreen /> },
      { path: 'tools/jwt-parser', element: <JwtParserScreen /> },
      { path: 'tools/htpasswd-generator', element: <HtpasswdGeneratorScreen /> },
      { path: 'tools/subnet-calculator', element: <SubnetCalculatorScreen /> },
      { path: 'tools/mac-address', element: <MacAddressScreen /> },
      { path: 'tools/ip-range', element: <IpRangeScreen /> },
      { path: 'tools/regex-tester', element: <RegexTesterScreen /> },
      { path: 'tools/id-generator', element: <IdGeneratorScreen /> },
      { path: 'tools/password-generator', element: <PasswordGeneratorScreen /> },
      { path: 'tools/converters', element: <ConvertersScreen /> },
      { path: 'tools/formatters', element: <FormattersScreen /> },
      { path: 'tools/text-diff', element: <TextDiffScreen /> },
      { path: 'tools/jsonpath-evaluator', element: <JsonpathEvaluatorScreen /> },
      { path: 'tools/structured-tree-viewer', element: <StructuredTreeViewerScreen /> },
      { path: 'tools/json-to-csv', element: <JsonToCsvScreen /> },
      { path: 'tools/gzip-converter', element: <GzipConverterScreen /> },
      { path: 'tools/base64-file', element: <Base64FileScreen /> },
      { path: 'tools/text-transformer', element: <TextTransformerScreen /> },
      { path: 'tools/cheatsheets', element: <CheatsheetsScreen /> },
      { path: 'tools/documentation', element: <DocumentationScreen /> },
      { path: 'tools/reference-lists', element: <ReferenceListsScreen /> },
      { path: 'tools/study-practice', element: <StudyPracticeScreen /> },

      // Phase 4 — Office & Media
      { path: 'tools/color-tools', element: <ColorToolsScreen /> },
      { path: 'tools/pdf-split-merge', element: <PdfSplitMergeScreen /> },
      { path: 'tools/pdf-inspector', element: <PdfInspectorScreen /> },
      { path: 'tools/image-converter', element: <ImageConverterScreen /> },
      { path: 'tools/exif-viewer', element: <ExifViewerScreen /> },
      { path: 'tools/qr-code', element: <QrCodeScreen /> },
      { path: 'tools/qr-reader', element: <QrReaderScreen /> },

      // Phase 5 — FormFlow Dynamic Builder
      { path: 'tools/formflow-builder', element: <FormFlowBuilderScreen /> },

      // Configuration Builders — Zabbix / Fail2ban
      { path: 'tools/zabbix-config-builder', element: <ZabbixConfigBuilderScreen /> },
      { path: 'tools/fail2ban-config-builder', element: <Fail2banConfigBuilderScreen /> },
      { path: 'tools/web-server-config-builder', element: <WebServerConfigBuilderScreen /> },

      // Network Toolkit
      { path: 'tools/sntp', element: <SntpLookupScreen /> },
      { path: 'tools/whois', element: <WhoisScreen /> },
      { path: 'tools/dns-lookup', element: <DnsLookupScreen /> },
      { path: 'tools/ip-geolocation', element: <IpGeolocationScreen /> },
      { path: 'tools/connections', element: <ConnectionsScreen /> },
      { path: 'tools/wake-on-lan', element: <WakeOnLanScreen /> },
      { path: 'tools/port-scanner', element: <PortScannerScreen /> },
      { path: 'tools/ping-monitor', element: <PingMonitorScreen /> },
      { path: 'tools/traceroute', element: <TracerouteScreen /> },
      { path: 'tools/network-scanner', element: <NetworkScannerScreen /> },
      { path: 'tools/snmp', element: <SnmpScreen /> },
      { path: 'tools/neighbor-table', element: <NeighborTableScreen /> },
    ],
  },
])
