import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'module_taxonomy.dart';

/// One module's header + tool-card grid. Shared by HomeDashboardScreen (all
/// modules stacked, page 1) and ModuleToolsScreen (a single module, page 2)
/// so the two pages never duplicate this layout.
class ModuleSectionView extends StatelessWidget {
  const ModuleSectionView({super.key, required this.module, this.linkHeaderToModulePage = true});

  final ModuleSection module;

  /// When true, tapping the section header navigates to '/modules/:id'.
  /// Pass false when already on that module's own page.
  final bool linkHeaderToModulePage;

  @override
  Widget build(BuildContext context) {
    final implemented = module.tools.where((t) => t.route != null).length;

    final header = Row(
      children: [
        Icon(module.icon, size: 20),
        const SizedBox(width: 8),
        Flexible(
          child: Text(
            module.title,
            style: Theme.of(context).textTheme.headlineSmall,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );

    return Padding(
      padding: const EdgeInsets.only(bottom: 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (linkHeaderToModulePage)
            InkWell(
              borderRadius: BorderRadius.circular(8),
              onTap: () => context.go('/modules/${module.id}'),
              child: Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: header),
            )
          else
            header,
          const SizedBox(height: 4),
          Text(
            '$implemented of ${module.tools.length} tools live',
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 16),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
              maxCrossAxisExtent: 320,
              mainAxisExtent: 196 * MediaQuery.textScalerOf(context).scale(1.0).clamp(1.0, 2.0),
              crossAxisSpacing: 16,
              mainAxisSpacing: 16,
            ),
            itemCount: module.tools.length,
            itemBuilder: (context, index) => ToolCard(tool: module.tools[index]),
          ),
        ],
      ),
    );
  }
}

class ToolCard extends StatefulWidget {
  const ToolCard({super.key, required this.tool});

  final ToolEntry tool;

  @override
  State<ToolCard> createState() => _ToolCardState();
}

class _ToolCardState extends State<ToolCard> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final tool = widget.tool;
    final enabled = tool.route != null;

    return MouseRegion(
      cursor: enabled ? SystemMouseCursors.click : SystemMouseCursors.basic,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeOut,
        transform: Matrix4.translationValues(0, enabled && _hovered ? -2 : 0, 0),
        child: Card(
          color: enabled && _hovered ? scheme.surfaceContainer : scheme.surfaceContainerLow,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: BorderSide(
              color: enabled && _hovered
                  ? scheme.primary.withValues(alpha: 0.5)
                  : scheme.outlineVariant.withValues(alpha: 0.6),
            ),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: enabled ? () => context.go(tool.route!) : null,
            child: Opacity(
              opacity: enabled ? 1 : 0.55,
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 36,
                          height: 36,
                          decoration: BoxDecoration(
                            color: scheme.primaryContainer,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Icon(tool.icon, size: 19, color: scheme.onPrimaryContainer),
                        ),
                        const Spacer(),
                        if (!enabled)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: scheme.surfaceContainerHighest,
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Text(
                              'Coming soon',
                              style: Theme.of(context).textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant),
                            ),
                          )
                        else
                          AnimatedOpacity(
                            opacity: _hovered ? 1 : 0,
                            duration: const Duration(milliseconds: 150),
                            child: Icon(Icons.arrow_outward, size: 18, color: scheme.primary),
                          ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      tool.name,
                      style: Theme.of(context).textTheme.titleMedium,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      tool.description,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
