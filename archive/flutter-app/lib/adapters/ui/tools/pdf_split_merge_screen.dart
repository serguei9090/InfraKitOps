import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';

import '../../../core/office_media/pdf_inspector.dart';
import '../../../core/office_media/pdf_split_merge.dart';
import '../shell/file_drop_field.dart';

/// "PDF Split & Merge" tool screen (spec section 3.1).
///
/// ## Why a plain [Scaffold], not [ToolDetailScaffold]
/// The shared `ToolDetailScaffold` (see `lib/adapters/ui/shell/
/// tool_detail_scaffold.dart`) is built around "paste/configure on the
/// left, see live rendered text on the right" — a shape that fits a
/// calculator or a text formatter well. This tool doesn't produce any text
/// to preview: its output is a binary PDF the user saves to disk. Forcing
/// it into a text-preview right pane would mean either showing nothing
/// useful there or faking a "preview" that isn't one, so this screen uses a
/// plain `Scaffold` with its own `AppBar` instead, while still pulling
/// every color/spacing choice from [Theme.of(context)] (see
/// `lib/adapters/ui/shell/app_theme.dart`) so it stays visually consistent
/// with the tools that do use the shared scaffold.
///
/// ## File input/output
/// Sources come in through [FileDropField] (drag-and-drop or the native
/// file browser) — merge mode accepts several PDFs and keeps them in the
/// user's chosen order, split/extract mode takes one. The produced PDF is
/// written through [saveBytesWithDialog], so nothing here needs a
/// filesystem path and the screen works the same on desktop and web.
class PdfSplitMergeScreen extends StatefulWidget {
  const PdfSplitMergeScreen({super.key});

  @override
  State<PdfSplitMergeScreen> createState() => _PdfSplitMergeScreenState();
}

enum _PdfSplitMergeMode { merge, split }

const _pdfTypeGroup = XTypeGroup(label: 'PDF', extensions: ['pdf'], mimeTypes: ['application/pdf']);

class _PdfSplitMergeScreenState extends State<PdfSplitMergeScreen> {
  static const _merger = PdfMerger();
  static const _extractor = PdfPageExtractor();
  static const _inspector = PdfInspector();
  static const _rangeParser = PdfPageRangeParser();

  _PdfSplitMergeMode _mode = _PdfSplitMergeMode.merge;

  // Merge state: the dropped/picked sources, in merge order.
  final List<PickedFileData> _mergeSources = [];

  // Split state.
  PickedFileData? _splitSource;
  final _splitRangeController = TextEditingController();

  bool _isBusy = false;
  String? _errorText;
  String? _successText;

  @override
  void dispose() {
    _splitRangeController.dispose();
    super.dispose();
  }

  void _addMergeSources(List<PickedFileData> files) {
    setState(() {
      _mergeSources.addAll(files);
      _errorText = null;
      _successText = null;
    });
  }

  void _removeMergeSource(int index) {
    setState(() => _mergeSources.removeAt(index));
  }

  void _moveMergeSource(int index, int delta) {
    final target = index + delta;
    if (target < 0 || target >= _mergeSources.length) return;
    setState(() {
      final item = _mergeSources.removeAt(index);
      _mergeSources.insert(target, item);
    });
  }

  String _messageOf(Object e) {
    if (e is FormatException) return e.message;
    if (e is ArgumentError) return e.message?.toString() ?? e.toString();
    if (e is RangeError) return e.message?.toString() ?? e.toString();
    return e.toString();
  }

  Future<void> _runMerge() async {
    setState(() {
      _isBusy = true;
      _errorText = null;
      _successText = null;
    });

    try {
      if (_mergeSources.isEmpty) {
        throw const FormatException('Add at least one source PDF');
      }

      final merged = await _merger.execute([for (final f in _mergeSources) f.bytes]);
      final savedTo = await saveBytesWithDialog(
        bytes: merged,
        suggestedName: 'merged.pdf',
        mimeType: 'application/pdf',
        acceptedTypes: const [_pdfTypeGroup],
      );

      if (!mounted) return;
      setState(() {
        _successText = savedTo == null
            ? 'Save cancelled — the merged PDF (${formatFileSize(merged.length)}) was not written.'
            : 'Merged ${_mergeSources.length} file(s) into "$savedTo" (${formatFileSize(merged.length)}).';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _errorText = _messageOf(e));
    } finally {
      if (mounted) setState(() => _isBusy = false);
    }
  }

  Future<void> _runSplit() async {
    setState(() {
      _isBusy = true;
      _errorText = null;
      _successText = null;
    });

    try {
      final source = _splitSource;
      if (source == null) {
        throw const FormatException('Drop or choose a source PDF first');
      }

      final sourceBytes = source.bytes;

      // Page count is needed to validate the range before extracting —
      // PdfInspector gives us that without this screen needing to import
      // syncfusion_flutter_pdf types directly.
      final inspection = _inspector.execute(PdfInspectInput(bytes: sourceBytes));
      if (!inspection.isReadable) {
        throw FormatException(
          inspection.isEncrypted
              ? 'This PDF is password-protected and could not be read'
              : 'This file could not be read as a PDF',
        );
      }

      final pageNumbers = _rangeParser.parse(_splitRangeController.text, pageCount: inspection.pageCount);
      final extracted = await _extractor.execute(PdfExtractInput(bytes: sourceBytes, pageNumbers: pageNumbers));
      final savedTo = await saveBytesWithDialog(
        bytes: extracted,
        suggestedName: _suggestedExtractName(source.name),
        mimeType: 'application/pdf',
        acceptedTypes: const [_pdfTypeGroup],
      );

      if (!mounted) return;
      setState(() {
        _successText = savedTo == null
            ? 'Save cancelled — the extracted PDF (${formatFileSize(extracted.length)}) was not written.'
            : 'Extracted ${pageNumbers.length} page(s) into "$savedTo" (${formatFileSize(extracted.length)}).';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _errorText = _messageOf(e));
    } finally {
      if (mounted) setState(() => _isBusy = false);
    }
  }

  static String _suggestedExtractName(String sourceName) {
    final dot = sourceName.lastIndexOf('.');
    final stem = dot > 0 ? sourceName.substring(0, dot) : sourceName;
    return '$stem-extracted.pdf';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('PDF Split & Merge')),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final maxWidth = constraints.maxWidth < 720 ? constraints.maxWidth : 720.0;
          return Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: maxWidth),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SegmentedButton<_PdfSplitMergeMode>(
                      segments: const [
                        ButtonSegment(
                          value: _PdfSplitMergeMode.merge,
                          label: Text('Merge'),
                          icon: Icon(Icons.merge_type),
                        ),
                        ButtonSegment(
                          value: _PdfSplitMergeMode.split,
                          label: Text('Split / Extract'),
                          icon: Icon(Icons.content_cut),
                        ),
                      ],
                      selected: {_mode},
                      onSelectionChanged: (selection) {
                        setState(() {
                          _mode = selection.first;
                          _errorText = null;
                          _successText = null;
                        });
                      },
                    ),
                    const SizedBox(height: 20),
                    if (_mode == _PdfSplitMergeMode.merge) _buildMergePanel(context) else _buildSplitPanel(context),
                    const SizedBox(height: 20),
                    if (_errorText != null) _statusCard(context, _errorText!, isError: true),
                    if (_successText != null) _statusCard(context, _successText!, isError: false),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildMergePanel(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Source PDFs, in merge order', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              'Drop several PDFs at once, or browse for them. Reorder with the '
              'arrows — pages are merged top-to-bottom.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            FileDropField(
              onFilesPicked: _addMergeSources,
              acceptedTypes: const [_pdfTypeGroup],
              allowMultiple: true,
              hint: 'PDF files — dropping more adds them to the end of the list',
              loadedSummary: _mergeSources.isEmpty
                  ? null
                  : '${_mergeSources.length} PDF(s) queued · '
                      '${formatFileSize(_mergeSources.fold(0, (sum, f) => sum + f.byteSize))} total',
            ),
            if (_mergeSources.isNotEmpty) ...[
              const SizedBox(height: 12),
              for (var i = 0; i < _mergeSources.length; i++) _mergeSourceRow(context, i),
            ],
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: _isBusy || _mergeSources.isEmpty ? null : _runMerge,
              icon: _isBusy
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.merge_type),
              label: Text(_isBusy ? 'Merging…' : 'Merge and save…'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _mergeSourceRow(BuildContext context, int index) {
    final file = _mergeSources[index];
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          SizedBox(
            width: 28,
            child: Text('${index + 1}.', style: textTheme.bodySmall),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(file.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: textTheme.bodyMedium),
                Text(
                  formatFileSize(file.byteSize),
                  style: textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Move up',
            icon: const Icon(Icons.arrow_upward, size: 18),
            onPressed: index == 0 ? null : () => _moveMergeSource(index, -1),
          ),
          IconButton(
            tooltip: 'Move down',
            icon: const Icon(Icons.arrow_downward, size: 18),
            onPressed: index == _mergeSources.length - 1 ? null : () => _moveMergeSource(index, 1),
          ),
          IconButton(
            tooltip: 'Remove',
            icon: const Icon(Icons.close, size: 18),
            onPressed: () => _removeMergeSource(index),
          ),
        ],
      ),
    );
  }

  Widget _buildSplitPanel(BuildContext context) {
    final source = _splitSource;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Source PDF', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            FileDropField(
              onFilesPicked: (files) => setState(() {
                _splitSource = files.first;
                _errorText = null;
                _successText = null;
              }),
              acceptedTypes: const [_pdfTypeGroup],
              hint: 'A single PDF file',
              loadedSummary: source == null ? null : '${source.name} · ${formatFileSize(source.byteSize)}',
            ),
            const SizedBox(height: 20),
            Text('Page range', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              'Comma-separated page numbers and/or ranges, e.g. "1-3,5".',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _splitRangeController,
              decoration: const InputDecoration(border: OutlineInputBorder(), hintText: '1-3,5'),
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: _isBusy || source == null ? null : _runSplit,
              icon: _isBusy
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.content_cut),
              label: Text(_isBusy ? 'Extracting…' : 'Extract and save…'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _statusCard(BuildContext context, String message, {required bool isError}) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: isError ? scheme.errorContainer : scheme.secondaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              isError ? Icons.error_outline : Icons.check_circle_outline,
              color: isError ? scheme.onErrorContainer : scheme.onSecondaryContainer,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                message,
                style: TextStyle(color: isError ? scheme.onErrorContainer : scheme.onSecondaryContainer),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
