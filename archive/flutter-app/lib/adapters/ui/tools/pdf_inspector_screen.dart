import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';

import '../../../core/office_media/pdf_inspector.dart';
import '../shell/file_drop_field.dart';

/// "PDF Inspector & Metadata Extractor" tool screen (spec section 3.1).
///
/// See the doc comment on `PdfSplitMergeScreen` in
/// `pdf_split_merge_screen.dart` for why this screen also uses a plain
/// [Scaffold] instead of the shared `ToolDetailScaffold` — that reason
/// applies identically here. The PDF comes in through [FileDropField]
/// (drag-and-drop or the native file browser); inspection is read-only, so
/// there is no save step.
///
/// This screen is kept separate from `PdfSplitMergeScreen` rather than
/// folded in as a third mode, since inspection is read-only (no output
/// file, no destructive action) and showing it alongside two
/// file-producing modes would blur that distinction.
class PdfInspectorScreen extends StatefulWidget {
  const PdfInspectorScreen({super.key});

  @override
  State<PdfInspectorScreen> createState() => _PdfInspectorScreenState();
}

class _PdfInspectorScreenState extends State<PdfInspectorScreen> {
  static const _inspector = PdfInspector();

  final _passwordController = TextEditingController();

  PickedFileData? _source;
  bool _isBusy = false;
  String? _errorText;
  PdfInspectionResult? _result;

  @override
  void dispose() {
    _passwordController.dispose();
    super.dispose();
  }

  void _onFilePicked(List<PickedFileData> files) {
    setState(() {
      _source = files.first;
      _errorText = null;
      _result = null;
    });
    _inspect();
  }

  String _messageOf(Object e) {
    if (e is FormatException) return e.message;
    if (e is ArgumentError) return e.message?.toString() ?? e.toString();
    return e.toString();
  }

  Future<void> _inspect() async {
    setState(() {
      _isBusy = true;
      _errorText = null;
      _result = null;
    });

    try {
      final source = _source;
      if (source == null) {
        throw const FormatException('Drop or choose a PDF file first');
      }

      final password = _passwordController.text;
      final result = _inspector.execute(
        PdfInspectInput(bytes: source.bytes, password: password.isEmpty ? null : password),
      );

      if (!mounted) return;
      setState(() => _result = result);
    } catch (e) {
      if (!mounted) return;
      setState(() => _errorText = _messageOf(e));
    } finally {
      if (mounted) setState(() => _isBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('PDF Inspector')),
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
                    _buildInputCard(context),
                    const SizedBox(height: 20),
                    if (_errorText != null) _errorCard(context, _errorText!),
                    if (_result != null) _buildResultCard(context, _result!),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildInputCard(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('PDF file', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            FileDropField(
              onFilesPicked: _onFilePicked,
              acceptedTypes: const [
                XTypeGroup(label: 'PDF', extensions: ['pdf'], mimeTypes: ['application/pdf']),
              ],
              hint: 'A single PDF file',
              loadedSummary: _source == null ? null : '${_source!.name} · ${formatFileSize(_source!.byteSize)}',
            ),
            const SizedBox(height: 16),
            Text('Password (optional)', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              'Only needed if the file turns out to be password-protected.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _passwordController,
              obscureText: true,
              decoration: const InputDecoration(border: OutlineInputBorder()),
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: _isBusy || _source == null ? null : _inspect,
              icon: _isBusy
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.search),
              label: Text(_isBusy ? 'Inspecting…' : 'Inspect'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _errorCard(BuildContext context, String message) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.error_outline, color: scheme.onErrorContainer),
            const SizedBox(width: 8),
            Expanded(child: Text(message, style: TextStyle(color: scheme.onErrorContainer))),
          ],
        ),
      ),
    );
  }

  Widget _buildResultCard(BuildContext context, PdfInspectionResult result) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    if (!result.isReadable) {
      return Card(
        color: scheme.tertiaryContainer,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.lock_outline, color: scheme.onTertiaryContainer),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'This PDF is password-protected and could not be opened'
                  '${_passwordController.text.isEmpty ? ' — enter the password above and inspect again' : ' with the given password'}.'
                  ' File size: ${formatFileSize(result.fileSizeBytes)}.',
                  style: TextStyle(color: scheme.onTertiaryContainer),
                ),
              ),
            ],
          ),
        ),
      );
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Document', style: textTheme.titleMedium),
            const SizedBox(height: 8),
            _factRow(context, 'Page count', '${result.pageCount}'),
            _factRow(context, 'File size', formatFileSize(result.fileSizeBytes)),
            _factRow(
              context,
              'Encrypted',
              result.isEncrypted ? 'Yes (opened with the supplied password)' : 'No',
            ),
            const SizedBox(height: 20),
            Text('Metadata', style: textTheme.titleMedium),
            const SizedBox(height: 4),
            if (result.info.isEmpty)
              Text('No document-info metadata is set on this file.', style: textTheme.bodySmall)
            else ...[
              _factRow(context, 'Title', result.info.title),
              _factRow(context, 'Author', result.info.author),
              _factRow(context, 'Subject', result.info.subject),
              _factRow(context, 'Keywords', result.info.keywords),
              _factRow(context, 'Creator', result.info.creator),
              _factRow(context, 'Producer', result.info.producer),
            ],
          ],
        ),
      ),
    );
  }

  Widget _factRow(BuildContext context, String label, String? value) {
    if (value == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(label, style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
          ),
          Expanded(child: SelectableText(value)),
        ],
      ),
    );
  }
}
