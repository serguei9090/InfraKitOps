import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/form_flow/schema_model.dart';
import '../tools/base64_file_screen.dart';
import '../tools/bcrypt_screen.dart';
import '../tools/ceph_pg_screen.dart';
import '../tools/cheatsheets_screen.dart';
import '../tools/chmod_calculator_screen.dart';
import '../tools/color_tools_screen.dart';
import '../tools/converters_screen.dart';
import '../tools/crontab_builder_screen.dart';
import '../tools/database_config_builder_screen.dart';
import '../tools/db_memory_sizer_screen.dart';
import '../tools/docker_run_converter_screen.dart';
import '../tools/documentation_screen.dart';
import '../tools/exif_viewer_screen.dart';
import '../tools/firewall_command_builder_screen.dart';
import '../tools/firewall_rule_builder_screen.dart';
import '../tools/form_flow_builder_screen.dart';
import '../tools/formatters_screen.dart';
import '../tools/gzip_converter_screen.dart';
import '../tools/hash_calculator_screen.dart';
import '../tools/htpasswd_generator_screen.dart';
import '../tools/id_generator_screen.dart';
import '../tools/image_converter_screen.dart';
import '../tools/ip_range_screen.dart';
import '../tools/json_to_csv_screen.dart';
import '../tools/jsonpath_evaluator_screen.dart';
import '../tools/jwt_parser_screen.dart';
import '../tools/linux_sysctl_screen.dart';
import '../tools/mac_address_screen.dart';
import '../tools/password_generator_screen.dart';
import '../tools/pdf_inspector_screen.dart';
import '../tools/pdf_split_merge_screen.dart';
import '../tools/qr_code_screen.dart';
import '../tools/qr_reader_screen.dart';
import '../tools/reference_lists_screen.dart';
import '../tools/regex_tester_screen.dart';
import '../tools/saved_templates_screen.dart';
import '../tools/ssh_config_builder_screen.dart';
import '../tools/ssh_keygen_screen.dart';
import '../tools/structured_tree_viewer_screen.dart';
import '../tools/study_practice_screen.dart';
import '../tools/subnet_calculator_screen.dart';
import '../tools/sysctl_config_builder_screen.dart';
import '../tools/text_diff_screen.dart';
import '../tools/text_transformer_screen.dart';
import '../tools/x509_inspector_screen.dart';
import '../tools/zabbix_sizer_screen.dart';
import 'app_shell_scaffold.dart';
import 'app_theme.dart';
import 'home_dashboard_screen.dart';
import 'module_tools_screen.dart';
import 'theme_provider.dart';

final _router = GoRouter(
  routes: [
    ShellRoute(
      builder: (context, state, child) => AppShellScaffold(child: child),
      routes: [
        GoRoute(path: '/', builder: (context, state) => const HomeDashboardScreen()),
        GoRoute(
          path: '/modules/:id',
          builder: (context, state) => ModuleToolsScreen(moduleId: state.pathParameters['id']!),
        ),
        GoRoute(path: '/tools/hash', builder: (context, state) => const HashCalculatorScreen()),
        GoRoute(path: '/tools/bcrypt', builder: (context, state) => const BcryptScreen()),
        GoRoute(path: '/tools/converters', builder: (context, state) => const ConvertersScreen()),
        GoRoute(path: '/tools/formatters', builder: (context, state) => const FormattersScreen()),
        GoRoute(path: '/tools/id-generator', builder: (context, state) => const IdGeneratorScreen()),
        GoRoute(path: '/tools/password-generator', builder: (context, state) => const PasswordGeneratorScreen()),
        GoRoute(path: '/tools/ceph-pg', builder: (context, state) => const CephPgScreen()),
        GoRoute(path: '/tools/db-memory-sizer', builder: (context, state) => const DbMemorySizerScreen()),
        GoRoute(path: '/tools/linux-sysctl', builder: (context, state) => const LinuxSysctlScreen()),
        GoRoute(path: '/tools/sysctl-config-builder', builder: (context, state) => const SysctlConfigBuilderScreen()),
        GoRoute(path: '/tools/subnet-calculator', builder: (context, state) => const SubnetCalculatorScreen()),
        GoRoute(path: '/tools/ssh-keygen', builder: (context, state) => const SshKeygenScreen()),
        GoRoute(path: '/tools/ssh-config-builder', builder: (context, state) => const SshConfigBuilderScreen()),
        GoRoute(
          path: '/tools/formflow-builder',
          builder: (context, state) => FormFlowBuilderScreen(initialTemplate: state.extra as SavedFormFlowTemplate?),
        ),
        GoRoute(path: '/tools/saved-templates', builder: (context, state) => const SavedTemplatesScreen()),
        GoRoute(path: '/tools/pdf-split-merge', builder: (context, state) => const PdfSplitMergeScreen()),
        GoRoute(path: '/tools/pdf-inspector', builder: (context, state) => const PdfInspectorScreen()),
        GoRoute(path: '/tools/image-converter', builder: (context, state) => const ImageConverterScreen()),
        GoRoute(path: '/tools/exif-viewer', builder: (context, state) => const ExifViewerScreen()),
        GoRoute(path: '/tools/qr-code', builder: (context, state) => const QrCodeScreen()),
        GoRoute(path: '/tools/color-tools', builder: (context, state) => const ColorToolsScreen()),
        GoRoute(path: '/tools/cheatsheets', builder: (context, state) => const CheatsheetsScreen()),
        GoRoute(path: '/tools/documentation', builder: (context, state) => const DocumentationScreen()),
        GoRoute(path: '/tools/reference-lists', builder: (context, state) => const ReferenceListsScreen()),
        GoRoute(path: '/tools/study-practice', builder: (context, state) => const StudyPracticeScreen()),
        GoRoute(path: '/tools/zabbix-sizer', builder: (context, state) => const ZabbixSizerScreen()),
        GoRoute(path: '/tools/regex-tester', builder: (context, state) => const RegexTesterScreen()),
        GoRoute(path: '/tools/text-diff', builder: (context, state) => const TextDiffScreen()),
        GoRoute(path: '/tools/jsonpath-evaluator', builder: (context, state) => const JsonPathEvaluatorScreen()),
        GoRoute(path: '/tools/jwt-parser', builder: (context, state) => const JwtParserScreen()),
        GoRoute(path: '/tools/x509-inspector', builder: (context, state) => const X509InspectorScreen()),
        GoRoute(
          path: '/tools/structured-tree-viewer',
          builder: (context, state) => const StructuredTreeViewerScreen(),
        ),
        GoRoute(path: '/tools/gzip-converter', builder: (context, state) => const GzipConverterScreen()),
        GoRoute(path: '/tools/base64-file', builder: (context, state) => const Base64FileScreen()),
        GoRoute(path: '/tools/json-to-csv', builder: (context, state) => const JsonToCsvScreen()),
        GoRoute(path: '/tools/text-transformer', builder: (context, state) => const TextTransformerScreen()),
        GoRoute(path: '/tools/mac-address', builder: (context, state) => const MacAddressScreen()),
        GoRoute(path: '/tools/ip-range', builder: (context, state) => const IpRangeScreen()),
        GoRoute(path: '/tools/htpasswd-generator', builder: (context, state) => const HtpasswdGeneratorScreen()),
        GoRoute(path: '/tools/qr-reader', builder: (context, state) => const QrReaderScreen()),
        GoRoute(
          path: '/tools/firewall-rule-builder',
          builder: (context, state) => const FirewallRuleBuilderScreen(),
        ),
        GoRoute(
          path: '/tools/firewall-command-builder',
          builder: (context, state) => const FirewallCommandBuilderScreen(),
        ),
        GoRoute(
          path: '/tools/docker-run-converter',
          builder: (context, state) => const DockerRunConverterScreen(),
        ),
        GoRoute(path: '/tools/crontab-builder', builder: (context, state) => const CrontabBuilderScreen()),
        GoRoute(path: '/tools/chmod-calculator', builder: (context, state) => const ChmodCalculatorScreen()),
        GoRoute(
          path: '/tools/database-config-builder',
          builder: (context, state) => const DatabaseConfigBuilderScreen(),
        ),
      ],
    ),
  ],
);

class InfraKitApp extends ConsumerWidget {
  const InfraKitApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);

    return MaterialApp.router(
      title: 'InfraKit Studio',
      debugShowCheckedModeBanner: false,
      themeMode: themeMode,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      routerConfig: _router,
    );
  }
}
