import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';

import '../../../core/utility/base64_file_converter.dart';
import '../shell/app_theme.dart';
import '../shell/file_drop_field.dart';
import '../shell/tool_detail_scaffold.dart';

/// "Base64 File Encoder / Decoder" tool screen.
///
/// Two directions, switched independently of everything else:
/// * **Encode** — drop a file in through [FileDropField], get Base64 text
///   out (plain, a data URI, or a Kubernetes Secret manifest), copyable via
///   the scaffold's toolbar action.
/// * **Decode** — paste Base64 (or a data URI) in, save the recovered file
///   out through [saveBytesWithDialog]. Unlike the plain-text
///   `Base64Converter`, this round-trips arbitrary binary bytes exactly.
enum _Direction { encode, decode }

class Base64FileScreen extends StatefulWidget {
  const Base64FileScreen({super.key});

  @override
  State<Base64FileScreen> createState() => _Base64FileScreenState();
}

class _Base64FileScreenState extends State<Base64FileScreen> {
  static const _encoder = Base64FileEncoder();
  static const _decoder = Base64FileDecoder();

  final _decodeController = TextEditingController();
  final _mimeController = TextEditingController();
  final _secretNameController = TextEditingController(text: 'my-secret');
  final _secretKeyController = TextEditingController(text: 'file');

  _Direction _direction = _Direction.encode;
  PickedFileData? _source;
  Base64Wrapping _wrapping = Base64Wrapping.plain;

  Base64FileEncodeResult? _encodeResult;
  Base64FileDecodeResult? _decodeResult;
  String? _error;

  String? _saveStatus;
  bool _saveWasError = false;

  @override
  void initState() {
    super.initState();
    _decodeController.addListener(_recompute);
    _mimeController.addListener(_recompute);
    _secretNameController.addListener(_recompute);
    _secretKeyController.addListener(_recompute);
  }

  @override
  void dispose() {
    _decodeController.dispose();
    _mimeController.dispose();
    _secretNameController.dispose();
    _secretKeyController.dispose();
    super.dispose();
  }

  void _onSourcePicked(List<PickedFileData> files) {
    setState(() {
      _source = files.first;
      _mimeController.text = guessMimeType(files.first.name);
      _saveStatus = null;
    });
    _recompute();
  }

  void _setDirection(_Direction direction) {
    setState(() {
      _direction = direction;
      _error = null;
      _saveStatus = null;
    });
    _recompute();
  }

  void _setWrapping(Base64Wrapping wrapping) {
    setState(() => _wrapping = wrapping);
    _recompute();
  }

  void _recompute() {
    if (_direction == _Direction.encode) {
      _recomputeEncode();
    } else {
      _recomputeDecode();
    }
  }

  void _recomputeEncode() {
    final bytes = _source?.bytes;
    if (bytes == null || bytes.isEmpty) {
      setState(() {
        _encodeResult = null;
        _error = null;
      });
      return;
    }
    try {
      final result = _encoder.execute(
        Base64FileEncodeInput(
          bytes: bytes,
          wrapping: _wrapping,
          mimeType: _mimeController.text.trim().isEmpty ? null : _mimeController.text.trim(),
          secretName: _secretNameController.text.trim().isEmpty ? 'my-secret' : _secretNameController.text.trim(),
          secretKey: _secretKeyController.text.trim().isEmpty ? 'file' : _secretKeyController.text.trim(),
        ),
      );
      setState(() {
        _encodeResult = result;
        _error = null;
      });
    } catch (e) {
      setState(() {
        _encodeResult = null;
        _error = _describeError(e);
      });
    }
  }

  void _recomputeDecode() {
    final text = _decodeController.text;
    if (text.trim().isEmpty) {
      setState(() {
        _decodeResult = null;
        _error = null;
      });
      return;
    }
    try {
      final result = _decoder.execute(Base64FileDecodeInput(text: text));
      setState(() {
        _decodeResult = result;
        _error = null;
      });
    } catch (e) {
      setState(() {
        _decodeResult = null;
        _error = _describeError(e);
      });
    }
  }

  Future<void> _save() async {
    final result = _decodeResult;
    if (result == null) {
      setState(() {
        _saveWasError = true;
        _saveStatus = 'Decode something first.';
      });
      return;
    }

    final extension = extensionForMimeType(result.mimeType);
    try {
      final savedTo = await saveBytesWithDialog(
        bytes: result.bytes,
        suggestedName: 'decoded.$extension',
        mimeType: result.mimeType,
        acceptedTypes: [
          XTypeGroup(label: extension.toUpperCase(), extensions: [extension]),
        ],
      );
      if (!mounted) return;
      setState(() {
        _saveWasError = false;
        _saveStatus = savedTo == null
            ? 'Save cancelled — nothing was written.'
            : 'Saved ${formatFileSize(result.byteSize)} to $savedTo';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saveWasError = true;
        _saveStatus = 'Could not save file: $e';
      });
    }
  }

  String _describeError(Object e) {
    if (e is FormatException) return e.message;
    if (e is ArgumentError) return e.message?.toString() ?? e.toString();
    return e.toString();
  }

  @override
  Widget build(BuildContext context) {
    final copyText = _direction == _Direction.encode ? _encodeResult?.output : null;
    return ToolDetailScaffold(
      title: 'Base64 File Encoder / Decoder',
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
        Text('Direction', style: textTheme.titleMedium),
        const SizedBox(height: 8),
        SegmentedButton<_Direction>(
          segments: const [
            ButtonSegment(value: _Direction.encode, label: Text('Encode (file → Base64)')),
            ButtonSegment(value: _Direction.decode, label: Text('Decode (Base64 → file)')),
          ],
          selected: {_direction},
          onSelectionChanged: (selection) => _setDirection(selection.first),
        ),
        const SizedBox(height: 20),
        if (_direction == _Direction.encode) _buildEncodeInputs(context) else _buildDecodeInputs(context),
      ],
    );
  }

  Widget _buildEncodeInputs(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Source file', style: textTheme.titleMedium),
        const SizedBox(height: 8),
        FileDropField(
          onFilesPicked: _onSourcePicked,
          hint: 'Any file',
          loadedSummary: _source == null ? null : '${_source!.name} · ${formatFileSize(_source!.byteSize)}',
        ),
        const SizedBox(height: 20),
        Text('Output form', style: textTheme.titleMedium),
        const SizedBox(height: 8),
        SegmentedButton<Base64Wrapping>(
          segments: const [
            ButtonSegment(value: Base64Wrapping.plain, label: Text('Plain')),
            ButtonSegment(value: Base64Wrapping.dataUri, label: Text('Data URI')),
            ButtonSegment(value: Base64Wrapping.k8sSecret, label: Text('K8s Secret')),
          ],
          selected: {_wrapping},
          onSelectionChanged: (selection) => _setWrapping(selection.first),
        ),
        if (_wrapping == Base64Wrapping.dataUri) ...[
          const SizedBox(height: 12),
          TextField(
            controller: _mimeController,
            decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'MIME type'),
          ),
        ],
        if (_wrapping == Base64Wrapping.k8sSecret) ...[
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _secretNameController,
                  decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'Secret name'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _secretKeyController,
                  decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'Data key'),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }

  Widget _buildDecodeInputs(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Base64 input', style: textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          'Plain Base64 or a data: URI. Line breaks, missing padding and the URL-safe alphabet are all fine.',
          style: textTheme.bodySmall,
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _decodeController,
          maxLines: 14,
          minLines: 8,
          style: AppTheme.monospace,
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Paste Base64 or a data URI here'),
        ),
      ],
    );
  }

  Widget _buildOutputPanel(BuildContext context) {
    if (_error != null) return _errorBanner(context, _error!);

    if (_direction == _Direction.encode) {
      final result = _encodeResult;
      if (result == null) {
        return const Text('Drop a file on the left to see its Base64 form here.');
      }
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _statRow(context, 'Source size', formatFileSize(result.byteSize)),
          _statRow(context, 'Encoded length', '${result.encodedLength} chars'),
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            constraints: const BoxConstraints(maxHeight: 320),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              border: Border.all(color: Theme.of(context).dividerColor),
              borderRadius: BorderRadius.circular(8),
            ),
            child: SingleChildScrollView(child: SelectableText(result.output, style: AppTheme.monospace)),
          ),
        ],
      );
    }

    final result = _decodeResult;
    if (result == null) {
      return const Text('Paste Base64 on the left to decode it back into file bytes here.');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _statRow(context, 'Decoded size', formatFileSize(result.byteSize)),
        if (result.mimeType != null) _statRow(context, 'MIME type', result.mimeType!),
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: _save,
          icon: const Icon(Icons.save_outlined),
          label: const Text('Save decoded file…'),
        ),
        if (_saveStatus != null) ...[
          const SizedBox(height: 8),
          _saveWasError ? _errorBanner(context, _saveStatus!) : _successBanner(context, _saveStatus!),
        ],
      ],
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
