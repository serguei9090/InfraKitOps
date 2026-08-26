import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Live text from the shell's global search field. lib/adapters/ui/shell/
/// app_sidebar.dart watches this to filter the module/tool tree in real time
/// — kept separate from theme_provider.dart since it's shell-chrome state,
/// not a user preference.
final searchQueryProvider = StateProvider<String>((ref) => '');
