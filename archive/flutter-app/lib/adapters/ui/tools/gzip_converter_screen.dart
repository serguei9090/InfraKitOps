import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';

import '../../../core/utility/gzip_converter.dart';
import '../shell/app_theme.dart';
import '../shell/file_drop_field.dart';
import '../shell/tool_detail_scaffold.dart';

/// "GZip Compressor / Decompressor" tool screen.
///
/// Two independent switches drive the whole screen: which [GzipOperation]
/// to run, and whether the payload comes from typed/pasted text or a
/// dropped file. Everything recomputes live (gzip on a few hundred KB is
/// effectively instant), so there is no explicit "Run" button — only a
/// Save action for the resulting bytes, via [saveBytesWithDialog].
enum _InputMode { text, file }

const _gzipTypeGroup = XTypeGroup(label: 'GZip', extensions: ['gz', 'gzip'], mimeTypes: ['application/gzip']);

class GzipConverterScreen extends StatefulWidget {
  const GzipConverterScreen({super.key});

  @override
  State<GzipConverterScreen> createState() => _GzipConverterScreenState();
}

class _GzipConverterScreenState extends State<GzipConverterScreen> {
  static const _converter = GzipConverter();

  final _textController = TextEditingController();

  GzipOperation _operation = GzipOperation.compress;
  _InputMode _inputMode = _InputMode.text;
  PickedFileData? _file;

  GzipConversionResult? _result;
  String? _error;

  String? _saveStatus;
  bool _saveWasError = false;

  @override
  void initState() {
    super.initState();
    _textController.addListener(_recompute);
  }

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  void _onFilePicked(List<PickedFileData> files) {
    setState(() {
      _file = files.first;
      _saveStatus = null;
    });
    _recompute();
  }

  void _setOperation(GzipOperation op) {
    setState(() {
      _operation = op;
      _saveStatus = null;
    });
    _recompute();
  }

  void _setInputMode(_InputMode mode) {
    setState(() {
      _inputMode = mode;
      _saveStatus = null;
    });
    _recompute();
  }

  void _recompute() {
    try {
      final result = switch ((_operation, _inputMode)) {
        (GzipOperation.compress, _InputMode.text) => _compressText(),
        (GzipOperation.compress, _InputMode.file) => _compressFile(),
        (GzipOperation.decompress, _InputMode.text) => _decompressText(),
        (GzipOperation.decompress, _InputMode.file) => _decompressFile(),
      };
      setState(() {
        _result = result;
        _error = null;
      });
    } catch (e) {
      setState(() {
        _result = null;
        _error = _describeError(e);
      });
    }
  }

  GzipConversionResult? _compressText() {
    final text = _textController.text;
    if (text.isEmpty) return null;
    return _converter.compressText(text);
  }

  GzipConversionResult? _compressFile() {
    final bytes = _file?.bytes;
    if (bytes == null || bytes.isEmpty) return null;
    return _converter.compressBytes(bytes);
  }

  GzipConversionResult? _decompressText() {
    final text = _textController.text.trim();
    if (text.isEmpty) return null;
    return _converter.decompressBase64(text);
  }

  GzipConversionResult? _decompressFile() {
    final bytes = _file?.bytes;
    if (bytes == null || bytes.isEmpty) return null;
    return _converter.decompressBytes(bytes);
  }

  Future<void> _save() async {
    final result = _result;
    if (result == null) {
      setState(() {
        _saveWasError = true;
        _saveStatus = 'Nothing to save yet.';
      });
      return;
    }

    final suggestedName = _operation == GzipOperation.compress
        ? '${_baseName(_file?.name) ?? 'output'}.gz'
        : _stripGzExtension(_file?.name) ?? 'decompressed.bin';

    try {
      final savedTo = await saveBytesWithDialog(
        bytes: result.data,
        suggestedName: suggestedName,
        acceptedTypes: _operation == GzipOperation.compress ? const [_gzipTypeGroup] : const [],
      );
      if (!mounted) return;
      setState(() {
        _saveWasError = false;
        _saveStatus = savedTo == null
            ? 'Save cancelled — nothing was written.'
            : 'Saved ${formatFileSize(result.outputSize)} to $savedTo';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saveWasError = true;
        _saveStatus = 'Could not save file: $e';
      });
    }
  }

  String? _baseName(String? fileName) {
    if (fileName == null) return null;
    final dot = fileName.lastIndexOf('.');
    return dot > 0 ? fileName.substring(0, dot) : fileName;
  }

  String? _stripGzExtension(String? fileName) {
    if (fileName == null) return null;
    if (fileName.toLowerCase().endsWith('.gz')) return fileName.substring(0, fileName.length - 3);
    if (fileName.toLowerCase().endsWith('.gzip')) return fileName.substring(0, fileName.length - 5);
    return fileName;
  }

  String _describeError(Object e) {
    if (e is FormatException) return e.message;
    if (e is ArgumentError) return e.message?.toString() ?? e.toString();
    return e.toString();
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    final copyText = result != null && _operation == GzipOperation.compress ? result.base64 : null;
    return ToolDetailScaffold(
      title: 'GZip Compressor / Decompressor',
      copyText: copyText,
      inputPanel: _buildInputPanel(context),
      outputPanel: _buildOutputPanel(context),
    );
  }

  Widget _buildInputPanel(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Operation', style: textTheme.titleMedium),
        const SizedBox(height: 8),
        SegmentedButton<GzipOperation>(
          segments: const [
            ButtonSegment(value: GzipOperation.compress, label: Text('Compress')),
            ButtonSegment(value: GzipOperation.decompress, label: Text('Decompress')),
          ],
          selected: {_operation},
          onSelectionChanged: (selection) => _setOperation(selection.first),
        ),
        const SizedBox(height: 20),
        Text('Source', style: textTheme.titleMedium),
        const SizedBox(height: 8),
        SegmentedButton<_InputMode>(
          segments: [
            ButtonSegment(
              value: _InputMode.text,
              label: Text(_operation == GzipOperation.compress ? 'Text' : 'Base64 text'),
            ),
            const ButtonSegment(value: _InputMode.file, label: Text('File')),
          ],
          selected: {_inputMode},
          onSelectionChanged: (selection) => _setInputMode(selection.first),
        ),
        const SizedBox(height: 12),
        if (_inputMode == _InputMode.text)
          TextField(
            controller: _textController,
            maxLines: 14,
            minLines: 8,
            style: AppTheme.monospace,
            decoration: InputDecoration(
              border: const OutlineInputBorder(),
              hintText: _operation == GzipOperation.compress
                  ? 'Type or paste text to compress'
                  : 'Paste a Base64-encoded gzip stream',
            ),
          )
        else
          FileDropField(
            onFilesPicked: _onFilePicked,
            acceptedTypes: _operation == GzipOperation.decompress ? const [_gzipTypeGroup] : const [],
            hint: _operation == GzipOperation.compress ? 'Any file' : 'A .gz file',
            loadedSummary: _file == null ? null : '${_file!.name} · ${formatFileSize(_file!.byteSize)}',
          ),
      ],
    );
  }

  Widget _buildOutputPanel(BuildContext context) {
    if (_error != null) return _errorBanner(context, _error!);

    final result = _result;
    if (result == null) {
      return const Text('Provide some input on the left to see the result here.');
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _statsCard(context, result),
        const SizedBox(height: 16),
        if (result.operation == GzipOperation.decompress) _decompressedPreview(context, result),
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: _save,
          icon: const Icon(Icons.save_outlined),
          label: Text(
            result.operation == GzipOperation.compress ? 'Save as .gz…' : 'Save decompressed file…',
          ),
        ),
        if (_saveStatus != null) ...[
          const SizedBox(height: 8),
          _saveWasError ? _errorBanner(context, _saveStatus!) : _successBanner(context, _saveStatus!),
        ],
      ],
    );
  }

  Widget _decompressedPreview(BuildContext context, GzipConversionResult result) {
    final text = result.textOrNull;
    if (text == null) {
      return Text(
        'Decompressed payload is ${formatFileSize(result.outputSize)} of binary data — save it to view.',
        style: Theme.of(context).textTheme.bodyMedium,
      );
    }
    return Container(
      width: double.infinity,
      constraints: const BoxConstraints(maxHeight: 260),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).dividerColor),
        borderRadius: BorderRadius.circular(8),
      ),
      child: SingleChildScrollView(child: SelectableText(text, style: AppTheme.monospace)),
    );
  }

  Widget _statsCard(BuildContext context, GzipConversionResult result) {
    final percent = result.spaceSavingPercent;
    final percentLabel =
        percent >= 0 ? '${percent.toStringAsFixed(1)}% smaller' : '${(-percent).toStringAsFixed(1)}% larger';

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _statRow(context, 'Original', formatFileSize(result.originalSize)),
            _statRow(context, 'Compressed', formatFileSize(result.compressedSize)),
            _statRow(context, 'Ratio', '${(result.compressionRatio * 100).toStringAsFixed(1)}%'),
            _statRow(context, 'Change', percentLabel),
            const SizedBox(height: 4),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: result.compressionRatio.clamp(0, 1),
                minHeight: 6,
                backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _statRow(BuildContext context, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodyMedium),
          Text(value, style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  Widget _errorBanner(BuildContext context, String message) {
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

  Widget _successBanner(BuildContext context, String message) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.tertiaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.check_circle_outline, color: scheme.onTertiaryContainer),
            const SizedBox(width: 8),
            Expanded(child: Text(message, style: TextStyle(color: scheme.onTertiaryContainer))),
          ],
        ),
      ),
    );
  }
}
