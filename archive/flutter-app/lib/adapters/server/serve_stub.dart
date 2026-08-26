/// Web-safe stub for the headless serve entrypoint. `dart:io` (and thus the
/// real shelf server) isn't available when this app compiles to web — the
/// conditional import in main.dart swaps this out for
/// `serve_entrypoint.dart` on any platform with `dart:io`. `--serve` is only
/// ever passed by the native desktop runners, so this is never actually
/// called from a web build.
Future<void> runServeModeFromArgs(List<String> args) async {
  throw UnsupportedError('Serve mode is not supported on this platform.');
}
