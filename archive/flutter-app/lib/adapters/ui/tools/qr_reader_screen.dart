import 'package:flutter/material.dart';

import '../../../core/office_media/qr_decoder.dart';
import '../shell/app_theme.dart';
import '../shell/file_drop_field.dart';
import '../shell/tool_detail_scaffold.dart';

/// "QR Code Reader" screen: drop or browse to an image, decode any QR code
/// it contains, and show the raw payload text plus a structured breakdown
/// when the payload matches a format [QrDecoder] recognizes (Wi-Fi, vCard,
/// tel:, SMSTO:, mailto:, geo:, VEVENT, or a web link).
///
/// Built on the shared [ToolDetailScaffold] split-panel layout. [QrDecoder]
/// never throws for ordinary "no QR here" / "not an image" outcomes — those
/// are reported via [QrDecodeResult.status] — but the file read and the
/// decode call are still wrapped so nothing unexpected can escape into the
/// widget tree.
class QrReaderScreen extends StatefulWidget {
  const QrReaderScreen({super.key});

  @override
  State<QrReaderScreen> createState() => _QrReaderScreenState();
}

class _QrReaderScreenState extends State<QrReaderScreen> {
  static const _decoder = QrDecoder();

  PickedFileData? _file;
  QrDecodeResult? _result;
  String? _error;

  void _onFilesPicked(List<PickedFileData> files) {
    if (files.isEmpty) return;
    final file = files.first;
    setState(() {
      _file = file;
      _error = null;
      _result = null;
    });
    try {
      final result = _decoder.decodeImageBytes(file.bytes);
      if (!mounted) return;
      setState(() => _result = result);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _result = null;
        _error = 'Could not read this file: $e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    return ToolDetailScaffold(
      title: 'QR Code Reader',
      copyText: result != null && result.isDecoded ? result.text : null,
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Image', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 10),
          FileDropField(
            onFilesPicked: _onFilesPicked,
            hint: 'PNG, JPEG, GIF, BMP, TIFF or WebP',
            loadedSummary: _file == null ? null : '${_file!.name} · ${formatFileSize(_file!.byteSize)}',
          ),
          if (_file != null) ...[
            const SizedBox(height: 20),
            Text('Preview', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 10),
            _buildPreview(context),
          ],
        ],
      ),
      outputPanel: _buildOutput(context),
    );
  }

  Widget _buildPreview(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final file = _file!;
    return Container(
      constraints: const BoxConstraints(maxHeight: 260),
      decoration: BoxDecoration(
        border: Border.all(color: scheme.outlineVariant),
        borderRadius: BorderRadius.circular(12),
      ),
      clipBehavior: Clip.antiAlias,
      child: Image.memory(
        file.bytes,
        fit: BoxFit.contain,
        errorBuilder: (context, error, stackTrace) => Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.broken_image_outlined, color: scheme.onSurfaceVariant, size: 32),
              const SizedBox(height: 8),
              Text(
                'This file could not be previewed as an image.',
                textAlign: TextAlign.center,
                style: TextStyle(color: scheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildOutput(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    if (_error != null) {
      return _StatusCard(icon: Icons.error_outline, message: _error!, color: scheme.errorContainer, onColor: scheme.onErrorContainer);
    }

    final result = _result;
    if (result == null) {
      return const Text('Drop an image on the left to look for a QR code in it.');
    }

    switch (result.status) {
      case QrDecodeStatus.unreadableImage:
        return _StatusCard(
          icon: Icons.broken_image_outlined,
          message: result.message ?? 'This file could not be read as an image.',
          color: scheme.errorContainer,
          onColor: scheme.onErrorContainer,
        );
      case QrDecodeStatus.notFound:
        return _StatusCard(
          icon: Icons.qr_code_2,
          message: result.message ?? 'No QR code was found in this image.',
          color: scheme.surfaceContainerHighest,
          onColor: scheme.onSurfaceVariant,
        );
      case QrDecodeStatus.decoded:
        return _buildDecoded(context, result);
    }
  }

  Widget _buildDecoded(BuildContext context, QrDecodeResult result) {
    final scheme = Theme.of(context).colorScheme;
    final payload = result.payload;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            Chip(
              avatar: const Icon(Icons.check_circle_outline, size: 16),
              label: Text(result.formatLabel),
              backgroundColor: scheme.primaryContainer,
            ),
            if (result.symbolVersion != null)
              Chip(
                visualDensity: VisualDensity.compact,
                label: Text('Version ${result.symbolVersion}'),
              ),
            if (result.errorCorrectionLevel != null)
              Chip(
                visualDensity: VisualDensity.compact,
                label: Text('EC level ${result.errorCorrectionLevel}'),
              ),
          ],
        ),
        const SizedBox(height: 20),
        Text('Decoded text', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: SelectableText(result.text, style: AppTheme.monospace),
          ),
        ),
        if (payload != null && payload is! PlainTextQrPayload) ...[
          const SizedBox(height: 20),
          Text('${payload.kind} details', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Card(
            margin: EdgeInsets.zero,
            color: scheme.surfaceContainerLow,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final field in payload.fields) _FieldRow(label: field.label, value: field.value),
                ],
              ),
            ),
          ),
        ],
        const SizedBox(height: 8),
        Text(
          'Use the copy icon in the top bar to copy the decoded text.',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
        ),
      ],
    );
  }
}

class _FieldRow extends StatelessWidget {
  const _FieldRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 130, child: Text(label, style: Theme.of(context).textTheme.labelLarge)),
          const SizedBox(width: 12),
          Expanded(child: SelectableText(value)),
        ],
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.icon, required this.message, required this.color, required this.onColor});

  final IconData icon;
  final String message;
  final Color color;
  final Color onColor;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: color,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: onColor),
            const SizedBox(width: 8),
            Expanded(child: Text(message, style: TextStyle(color: onColor))),
          ],
        ),
      ),
    );
  }
}
