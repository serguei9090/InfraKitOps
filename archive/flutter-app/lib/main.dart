import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'adapters/server/serve_stub.dart'
    if (dart.library.io) 'adapters/server/serve_entrypoint.dart' as server;
import 'adapters/ui/shell/app_shell.dart';

Future<void> main(List<String> args) async {
  if (args.contains('--serve')) {
    await server.runServeModeFromArgs(args);
    return;
  }

  runApp(const ProviderScope(child: InfraKitApp()));
}
