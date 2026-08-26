import 'dart:typed_data';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';

import '../../../core/office_media/exif_viewer.dart';
import '../shell/file_drop_field.dart';
import '../shell/tool_detail_scaffold.dart';

/// "EXIF Metadata Viewer" tool screen (spec section 3.2).
///
/// ## File input
/// The image is loaded through [FileDropField] — drag-and-drop or the
/// native file browser — so no filesystem path is typed or needed, and the
/// screen behaves the same on desktop and web. Reading metadata is
/// read-only, so there is no save step.
///
/// Left panel: source drop zone and a small preview. Right panel: every
/// EXIF tag [ExifViewer] found, in a clean list, or a friendly "No EXIF
/// data found" empty state when the image has none (the common case for
/// PNGs, screenshots, and most web-optimized images).
class ExifViewerScreen extends StatefulWidget {
  const ExifViewerScreen({super.key});

  @override
  State<ExifViewerScreen> createState() => _ExifViewerScreenState();
}

class _ExifViewerScreenState extends State<ExifViewerScreen> {
  static const _viewer = ExifViewer();

  PickedFileData? _source;

  ExifMetadata? _metadata;
  String? _readError;

  void _onFilePicked(List<PickedFileData> files) {
    final file = files.first;
    setState(() {
      _source = file;
      _metadata = null;
      _readError = null;
    });
    _readExif(file.bytes);
  }

  void _readExif(Uint8List bytes) {
    try {
      final metadata = _viewer.execute(bytes);
      setState(() => _metadata = metadata);
    } catch (e) {
      // A non-image file or corrupt bytes must not crash the screen — show
      // the error inline instead.
      setState(() => _readError = _describeError(e));
    }
  }

  String _describeError(Object e) {
    if (e is FormatException) return e.message;
    return e.toString();
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'EXIF Metadata Viewer',
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
        Text('Image', style: textTheme.titleMedium),
        const SizedBox(height: 8),
        FileDropField(
          onFilesPicked: _onFilePicked,
          acceptedTypes: const [
            XTypeGroup(
              label: 'Images',
              extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff'],
              mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'],
            ),
          ],
          hint: 'JPEG, PNG, WebP, GIF, BMP or TIFF — EXIF is most common in JPEGs',
          loadedSummary: source == null ? null : '${source.name} · ${formatFileSize(source.byteSize)}',
        ),
        if (source != null) ...[
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.memory(
              source.bytes,
              height: 160,
              fit: BoxFit.contain,
              // A file that isn't a decodable image must show inline text,
              // never throw out of the widget tree.
              errorBuilder: (context, error, stackTrace) =>
                  _errorBanner(context, 'This file could not be previewed as an image.'),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildOutputPanel(BuildContext context) {
    if (_readError != null) {
      return _errorBanner(context, _readError!);
    }

    final metadata = _metadata;
    if (metadata == null) {
      return const Text('Load an image to view its EXIF metadata here.');
    }

    if (metadata.isEmpty) {
      return _emptyState(context);
    }

    final rows = <MapEntry<String, String>>[
      if (metadata.cameraMake != null) MapEntry('Camera make', metadata.cameraMake!),
      if (metadata.cameraModel != null) MapEntry('Camera model', metadata.cameraModel!),
      if (metadata.lensModel != null) MapEntry('Lens', metadata.lensModel!),
      if (metadata.software != null) MapEntry('Software', metadata.software!),
      if (metadata.dateTimeOriginal != null) MapEntry('Date taken', metadata.dateTimeOriginal!),
      if (metadata.exposureTime != null) MapEntry('Exposure time', metadata.exposureTime!),
      if (metadata.fNumber != null) MapEntry('Aperture', 'f/${metadata.fNumber!.toStringAsFixed(1)}'),
      if (metadata.isoSpeed != null) MapEntry('ISO speed', metadata.isoSpeed.toString()),
      if (metadata.focalLengthMm != null) MapEntry('Focal length', '${metadata.focalLengthMm!.toStringAsFixed(0)} mm'),
      if (metadata.orientationLabel != null) MapEntry('Orientation', metadata.orientationLabel!),
    ];

    final gps = metadata.gps;

    return ListView(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      children: [
        Text('Metadata', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Card(
          child: Column(
            children: [
              for (final row in rows) _metadataRow(context, row.key, row.value),
            ],
          ),
        ),
        if (gps != null) ...[
          const SizedBox(height: 20),
          Text('GPS location', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Card(
            child: Column(
              children: [
                _metadataRow(context, 'Latitude', gps.latitude.toStringAsFixed(6)),
                _metadataRow(context, 'Longitude', gps.longitude.toStringAsFixed(6)),
                if (gps.altitudeMeters != null)
                  _metadataRow(context, 'Altitude', '${gps.altitudeMeters!.toStringAsFixed(1)} m'),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _metadataRow(BuildContext context, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              )),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }

  Widget _emptyState(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.image_not_supported_outlined, color: scheme.onSurfaceVariant),
            const SizedBox(height: 8),
            Text('No EXIF data found', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              'This image decoded fine but carries no EXIF metadata — common for '
              'PNGs, screenshots, and images that have been re-saved or '
              'stripped by a web pipeline.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
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
}
