import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Shared "Tool Detail Split Panel" layout from the spec's Wireframe 2:
/// inputs on the left, live generated output on the right, with a
/// copy-to-clipboard action. Every Phase 1+ tool screen should build on this
/// instead of hand-rolling its own split layout, so the app stays visually
/// consistent as more tools are added independently.
class ToolDetailScaffold extends StatelessWidget {
  const ToolDetailScaffold({
    super.key,
    required this.title,
    required this.inputPanel,
    required this.outputPanel,
    this.copyText,
  });

  final String title;
  final Widget inputPanel;
  final Widget outputPanel;

  /// Text to copy when the toolbar's copy button is pressed. Null hides it.
  final String? copyText;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: [
          if (copyText != null)
            IconButton(
              tooltip: 'Copy to clipboard',
              icon: const Icon(Icons.copy),
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: copyText!));
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Copied to clipboard'), duration: Duration(seconds: 1)),
                  );
                }
              },
            ),
          const SizedBox(width: 8),
        ],
      ),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final scheme = Theme.of(context).colorScheme;
          final isCompact = constraints.maxWidth < 720;

          final input = _panel(context, label: 'INPUT PARAMETERS & CONTROLS', color: scheme.surface, child: inputPanel);
          final output = _panel(
            context,
            label: 'GENERATED OUTPUT & LIVE PREVIEW',
            color: scheme.surfaceContainerLow,
            child: outputPanel,
          );

          if (isCompact) {
            return SingleChildScrollView(
              child: Column(children: [input, Divider(height: 1, color: scheme.outlineVariant), output]),
            );
          }

          return Row(
            children: [
              Expanded(child: SingleChildScrollView(child: input)),
              VerticalDivider(width: 1, color: scheme.outlineVariant),
              Expanded(child: SingleChildScrollView(child: output)),
            ],
          );
        },
      ),
    );
  }

  Widget _panel(BuildContext context, {required String label, required Color color, required Widget child}) {
    return Container(
      color: color,
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
              letterSpacing: 0.6,
            ),
          ),
          const SizedBox(height: 14),
          child,
        ],
      ),
    );
  }
}
