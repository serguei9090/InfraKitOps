import 'dart:io';

import 'package:shelf/shelf_io.dart' as shelf_io;
import 'package:shelf_static/shelf_static.dart';

/// Headless "serve" mode: hosts the pre-built `flutter build web` output
/// (shipped as a `web/` folder adjacent to the compiled desktop exe) over
/// plain HTTP, so InfraKit Studio can be reached from a browser without
/// opening the native GUI window. Triggered by `--serve [--port N]`; the
/// native runners (windows/runner/main.cpp, linux/runner/my_application.cc)
/// detect this flag and keep the window hidden while Dart runs this instead
/// of `runApp()`.
Future<void> runServeModeFromArgs(List<String> args) async {
  var port = 8080;
  final portIndex = args.indexOf('--port');
  if (portIndex != -1 && portIndex + 1 < args.length) {
    port = int.tryParse(args[portIndex + 1]) ?? port;
  }

  final exeDir = File(Platform.resolvedExecutable).parent.path;
  final webRoot = '$exeDir${Platform.pathSeparator}web';

  if (!Directory(webRoot).existsSync()) {
    stderr.writeln('Web assets folder not found: $webRoot');
    exit(1);
  }

  final handler = createStaticHandler(webRoot, defaultDocument: 'index.html');
  final server = await shelf_io.serve(handler, InternetAddress.anyIPv4, port);
  stdout.writeln(
    'InfraKit Studio serving $webRoot on http://${server.address.host}:${server.port}',
  );
}
