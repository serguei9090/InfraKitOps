import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';

import '../../../core/office_media/image_converter.dart';
import '../shell/file_drop_field.dart';
import '../shell/tool_detail_scaffold.dart';

/// "Image Format Converter & Compressor" tool screen (spec section 3.2).
///
/// ## File input/output
/// The source image arrives through [FileDropField] (drag-and-drop or the
/// native file browser) and the converted bytes go out through
/// [saveBytesWithDialog]'s native Save-As dialog, so no filesystem path is
/// ever typed or needed and the screen behaves the same on desktop and web.
/// The core conversion logic in `ImageConverter` is untouched by this — the
/// UI only talks to it through `Uint8List` in and out.
///
/// Left panel: source drop zone, target format, quality, optional resize
/// bounds, and the Convert action. Right panel: before/after preview
/// (`Image.memory`), file-size/compression-ratio stats, and a Save action
/// for the converted bytes.
/// Extension filter for the source picker. Covers everything
/// `package:image` can decode that a user is likely to hand this tool.
const _imageTypeGroup = XTypeGroup(
  label: 'Images',
  extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff'],
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'],
);

class ImageConverterScreen extends StatefulWidget {
  const ImageConverterScreen({super.key});

  @override
  State<ImageConverterScreen> createState() => _ImageConverterScreenState();
}

class _ImageConverterScreenState extends State<ImageConverterScreen> {
  static const _converter = ImageConverter();

  final _maxWidthController = TextEditingController();
  final _maxHeightController = TextEditingController();

  ImageOutputFormat _targetFormat = ImageOutputFormat.jpeg;
  double _quality = 85;

  PickedFileData? _source;

  ImageConversionResult? _result;
  String? _conversionError;

  String? _saveStatus;
  bool _saveWasError = false;

  @override
  void dispose() {
    _maxWidthController.dispose();
    _maxHeightController.dispose();
    super.dispose();
  }

  void _onSourcePicked(List<PickedFileData> files) {
    setState(() {
      _source = files.first;
      _result = null;
      _conversionError = null;
      _saveStatus = null;
    });
  }

  void _convert() {
    final source = _source?.bytes;
    if (source == null) {
      setState(() => _conversionError = 'Load a source image first.');
      return;
    }

    final maxWidth = _parsePositiveInt(_maxWidthController.text);
    final maxHeight = _parsePositiveInt(_maxHeightController.text);

    setState(() {
      _conversionError = null;
      _result = null;
      _saveStatus = null;
    });

    try {
      final result = _converter.execute(
        ImageConversionInput(
          sourceBytes: source,
          targetFormat: _targetFormat,
          quality: _quality.round(),
          maxWidth: maxWidth,
          maxHeight: maxHeight,
        ),
      );
      setState(() => _result = result);
    } catch (e) {
      // Decode/encode failures (corrupt bytes, non-image file, bad
      // options) are caught here and shown inline rather than crashing
      // the screen.
      setState(() => _conversionError = _describeError(e));
    }
  }

  Future<void> _save() async {
    final result = _result;
    if (result == null) {
      setState(() {
        _saveWasError = true;
        _saveStatus = 'Convert an image first.';
      });
      return;
    }

    final extension = result.outputFormat.extension;
    try {
      final savedTo = await saveBytesWithDialog(
        bytes: result.outputBytes,
        suggestedName: _suggestedOutputName(extension),
        mimeType: _mimeTypeFor(result.outputFormat),
        acceptedTypes: [
          XTypeGroup(label: extension.toUpperCase(), extensions: [extension]),
        ],
      );
      if (!mounted) return;
      setState(() {
        // Cancelling the dialog is a normal outcome, not an error.
        _saveWasError = false;
        _saveStatus = savedTo == null
            ? 'Save cancelled — nothing was written.'
            : 'Saved ${formatFileSize(result.outputByteSize)} to $savedTo';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saveWasError = true;
        _saveStatus = 'Could not save file: $e';
      });
    }
  }

  /// Suggests `sourceStem.newExtension` so the Save-As dialog opens
  /// pre-filled with something recognisable.
  String _suggestedOutputName(String extension) {
    final name = _source?.name ?? 'converted';
    final dot = name.lastIndexOf('.');
    final stem = dot > 0 ? name.substring(0, dot) : name;
    return '$stem.$extension';
  }

  static String _mimeTypeFor(ImageOutputFormat format) => switch (format) {
        ImageOutputFormat.jpeg => 'image/jpeg',
        ImageOutputFormat.png => 'image/png',
        ImageOutputFormat.webp => 'image/webp',
      };

  int? _parsePositiveInt(String text) {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return null;
    final value = int.tryParse(trimmed);
    if (value == null || value <= 0) return null;
    return value;
  }

  String _describeError(Object e) {
    if (e is FormatException) {
      return e.message;
    }
    if (e is ArgumentError) {
      return e.message?.toString() ?? e.toString();
    }
    return e.toString();
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'Image Format Converter & Compressor',
      inputPanel: _buildInputPanel(context),
      outputPanel: _buildOutputPanel(context),
    );
  }

  Widget _buildInputPanel(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final source = _source;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Source image', style: textTheme.titleMedium),
        const SizedBox(height: 8),
        FileDropField(
          onFilesPicked: _onSourcePicked,
          acceptedTypes: const [_imageTypeGroup],
          hint: 'JPEG, PNG, WebP, GIF, BMP or TIFF',
          loadedSummary: source == null ? null : '${source.name} · ${formatFileSize(source.byteSize)}',
        ),
        if (source != null) ...[
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.memory(
              source.bytes,
              height: 140,
              fit: BoxFit.contain,
              // A file that isn't a decodable image must show inline text,
              // never throw out of the widget tree.
              errorBuilder: (context, error, stackTrace) =>
                  _errorBanner(context, 'This file could not be previewed as an image.'),
            ),
          ),
        ],
        const SizedBox(height: 24),
        Text('Target format', style: textTheme.titleMedium),
        const SizedBox(height: 8),
        SegmentedButton<ImageOutputFormat>(
          segments: const [
            ButtonSegment(value: ImageOutputFormat.jpeg, label: Text('JPEG')),
            ButtonSegment(value: ImageOutputFormat.png, label: Text('PNG')),
            ButtonSegment(value: ImageOutputFormat.webp, label: Text('WebP')),
          ],
          selected: {_targetFormat},
          onSelectionChanged: (selection) => setState(() => _targetFormat = selection.first),
        ),
        const SizedBox(height: 20),
        Text(_qualityLabel, style: textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(_qualityHint, style: textTheme.bodySmall),
        Slider(
          value: _quality,
          min: 1,
          max: 100,
          divisions: 99,
          label: _quality.round().toString(),
          onChanged: _targetFormat == ImageOutputFormat.webp
              ? null
              : (value) => setState(() => _quality = value),
        ),
        const SizedBox(height: 12),
        Text('Resize (optional)', style: textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          'Leave blank to keep the original size. Aspect ratio is always preserved.',
          style: textTheme.bodySmall,
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _maxWidthController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'Max width (px)'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: _maxHeightController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'Max height (px)'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: _convert,
          icon: const Icon(Icons.transform),
          label: const Text('Convert'),
        ),
      ],
    );
  }

  String get _qualityLabel => switch (_targetFormat) {
        ImageOutputFormat.jpeg => 'Quality: ${_quality.round()}',
        ImageOutputFormat.png => 'Compression effort: ${_quality.round()}',
        ImageOutputFormat.webp => 'Quality (not applicable)',
      };

  String get _qualityHint => switch (_targetFormat) {
        ImageOutputFormat.jpeg => 'Lower values shrink the file more but lose more detail.',
        ImageOutputFormat.png =>
          'PNG is always lossless — this only trades encode time for a smaller file, not visual quality.',
        ImageOutputFormat.webp =>
          "package:image's WebP encoder only supports lossless output (no lossy VP8 encoder available), "
              'so quality has no effect here.',
      };

  Widget _buildOutputPanel(BuildContext context) {
    if (_conversionError != null) {
      return _errorBanner(context, _conversionError!);
    }

    final result = _result;
    if (result == null) {
      return const Text('Load a source image and press "Convert" to see the result here.');
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Image.memory(result.outputBytes, height: 140, fit: BoxFit.contain),
        ),
        const SizedBox(height: 16),
        _statsCard(context, result),
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: _save,
          icon: const Icon(Icons.save_outlined),
          label: Text('Save as .${result.outputFormat.extension}…'),
        ),
        if (_saveStatus != null) ...[
          const SizedBox(height: 8),
          _saveWasError ? _errorBanner(context, _saveStatus!) : _successBanner(context, _saveStatus!),
        ],
      ],
    );
  }

  Widget _statsCard(BuildContext context, ImageConversionResult result) {
    final textTheme = Theme.of(context).textTheme;
    final percent = result.percentSaved;
    final percentLabel = percent >= 0
        ? '${percent.toStringAsFixed(1)}% smaller'
        : '${(-percent).toStringAsFixed(1)}% larger';

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _statRow(context, 'Dimensions', '${result.sourceWidth}×${result.sourceHeight} → ${result.outputWidth}×${result.outputHeight}'),
            _statRow(context, 'Before', formatFileSize(result.sourceByteSize)),
            _statRow(context, 'After', formatFileSize(result.outputByteSize)),
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
            const SizedBox(height: 2),
            Text('Output is ${(result.compressionRatio * 100).toStringAsFixed(0)}% of the original size', style: textTheme.bodySmall),
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
