import 'package:flutter/material.dart';

/// Shared Material 3 theme: flat hairline-bordered surfaces, a single
/// indigo brand seed, and a slightly tightened type scale — the "premium
/// dev tool" look (Linear/Vercel-style), not stock Material defaults.
class AppTheme {
  AppTheme._();

  static const _seed = Color(0xFF4F46E5);

  static ThemeData light() => _base(Brightness.light);
  static ThemeData dark() => _base(Brightness.dark);

  static ThemeData _base(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(seedColor: _seed, brightness: brightness);

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      visualDensity: VisualDensity.standard,
      textTheme: _textTheme(ThemeData(brightness: brightness).textTheme),
      appBarTheme: AppBarTheme(
        elevation: 0,
        scrolledUnderElevation: 1,
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.2,
          color: scheme.onSurface,
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: scheme.surfaceContainerLow,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.6)),
        ),
        margin: EdgeInsets.zero,
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: scheme.surface,
        indicatorColor: scheme.primaryContainer,
        indicatorShape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        selectedIconTheme: IconThemeData(color: scheme.onPrimaryContainer),
        selectedLabelTextStyle: TextStyle(color: scheme.onSurface, fontWeight: FontWeight.w600),
        unselectedLabelTextStyle: TextStyle(color: scheme.onSurfaceVariant),
      ),
      // The one "this item is currently active" look, used everywhere a list
      // shows a selected row (sidebar tool lists, in-screen page switchers
      // like CheatsheetsScreen's). Set once here instead of per-screen so
      // new lists match by default — see design.md's "Selected state
      // convention" for why this exists.
      listTileTheme: ListTileThemeData(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.selectedIndicatorRadius)),
        selectedTileColor: AppTheme.selectedIndicatorColor(scheme),
        selectedColor: scheme.onPrimaryContainer,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: scheme.primary, width: 1.5),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
        ),
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: SegmentedButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
      ),
      dividerTheme: DividerThemeData(color: scheme.outlineVariant.withValues(alpha: 0.6), space: 1),
      splashFactory: InkSparkle.splashFactory,
    );
  }

  static TextTheme _textTheme(TextTheme base) {
    return base.copyWith(
      headlineSmall: base.headlineSmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: -0.4),
      titleLarge: base.titleLarge?.copyWith(fontWeight: FontWeight.w700, letterSpacing: -0.3),
      titleMedium: base.titleMedium?.copyWith(fontWeight: FontWeight.w600, letterSpacing: -0.1),
      bodyMedium: base.bodyMedium?.copyWith(letterSpacing: -0.05),
    );
  }

  /// Monospace stack for generated code/config output panels.
  static const monospace = TextStyle(
    fontFamily: 'monospace',
    fontFamilyFallback: ['Cascadia Code', 'Consolas', 'Roboto Mono'],
    fontSize: 13,
    height: 1.5,
  );

  /// The shared "selected/active" indicator radius and color — the sidebar
  /// rail's selected-icon box uses these same two values directly (it's a
  /// custom Container, not a ListTile, so it can't inherit listTileTheme),
  /// so every "you are here" indicator in the app reads as one visual
  /// language instead of each screen inventing its own. See design.md.
  static const double selectedIndicatorRadius = 10;

  static Color selectedIndicatorColor(ColorScheme scheme) => scheme.primaryContainer.withValues(alpha: 0.4);
}
