import 'dart:typed_data';

import 'package:desktop_drop/desktop_drop.dart';
import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';

import 'app_theme.dart';

/// A file loaded through [FileDropField] — carries the bytes plus the
/// original name. [path] is null on web (browsers never expose real
/// filesystem paths), so nothing downstream should depend on it.
class PickedFileData {
  const PickedFileData({required this.name, required this.bytes, this.path});

  final String name;
  final Uint8List bytes;
  final String? path;

  int get byteSize => bytes.length;
}

/// The app's one way to get a file *in*: a drop zone that also opens the
/// native file browser on click/Browse. Replaces the old "type an absolute
/// path into a TextField" fallback that every file-handling tool used
/// before `file_selector`/`desktop_drop` were available — typing paths by
/// hand was the single worst UX in the app. See design.md.
///
/// Works on desktop and web: `file_selector` opens the native/browser
/// picker, `desktop_drop` handles OS drag-and-drop (and HTML5 drag events
/// on web). Neither needs a filesystem path, so this is web-safe with no
/// conditional import.
class FileDropField extends StatefulWidget {
  const FileDropField({
    super.key,
    required this.onFilesPicked,
    this.acceptedTypes = const [],
    this.allowMultiple = false,
    this.hint,
    this.loadedSummary,
  });

  /// Called with one entry (or several when [allowMultiple]) once files are
  /// dropped or chosen. Never called with an empty list.
  final void Function(List<PickedFileData> files) onFilesPicked;

  /// Extension filter for the native picker, e.g.
  /// `[XTypeGroup(label: 'PDF', extensions: ['pdf'])]`. Empty accepts any
  /// file. Note this filters the *picker dialog* only — dropped files are
  /// not extension-checked here, so callers must still validate content.
  final List<XTypeGroup> acceptedTypes;

  final bool allowMultiple;

  /// Extra line under the main prompt, e.g. 'PNG, JPEG or WebP'.
  final String? hint;

  /// Shown in place of the prompt once something is loaded, e.g.
  /// 'photo.png · 1.2 MB'.
  final String? loadedSummary;

  @override
  State<FileDropField> createState() => _FileDropFieldState();
}

class _FileDropFieldState extends State<FileDropField> {
  bool _dragging = false;
  bool _busy = false;
  String? _error;

  Future<void> _handleDrop(DropDoneDetails details) async {
    final dropped = widget.allowMultiple ? details.files : details.files.take(1);
    if (dropped.isEmpty) return;
    await _readAll([for (final f in dropped) (name: f.name, path: f.path, read: f.readAsBytes)]);
  }

  Future<void> _handleBrowse() async {
    try {
      final picked = widget.allowMultiple
          ? await openFiles(acceptedTypeGroups: widget.acceptedTypes)
          : [if (await openFile(acceptedTypeGroups: widget.acceptedTypes) case final XFile f) f];
      if (picked.isEmpty) return;
      await _readAll([for (final f in picked) (name: f.name, path: f.path, read: f.readAsBytes)]);
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not open file picker: $e');
    }
  }

  Future<void> _readAll(List<({String name, String? path, Future<Uint8List> Function() read})> sources) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final loaded = <PickedFileData>[];
      for (final source in sources) {
        loaded.add(PickedFileData(name: source.name, bytes: await source.read(), path: source.path));
      }
      if (!mounted) return;
      setState(() => _busy = false);
      widget.onFilesPicked(loaded);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = 'Could not read file: $e';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final active = _dragging;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DropTarget(
          onDragDone: _handleDrop,
          onDragEntered: (_) => setState(() => _dragging = true),
          onDragExited: (_) => setState(() => _dragging = false),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: _busy ? null : _handleBrowse,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 120),
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
              decoration: BoxDecoration(
                color: active ? scheme.primaryContainer.withValues(alpha: 0.3) : scheme.surfaceContainerHighest.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: active ? scheme.primary : scheme.outlineVariant,
                  width: active ? 1.6 : 1,
                ),
              ),
              child: Column(
                children: [
                  if (_busy)
                    const SizedBox(height: 28, width: 28, child: CircularProgressIndicator(strokeWidth: 2))
                  else
                    Icon(
                      widget.loadedSummary != null ? Icons.check_circle_outline : Icons.cloud_upload_outlined,
                      size: 28,
                      color: active ? scheme.primary : scheme.onSurfaceVariant,
                    ),
                  const SizedBox(height: 10),
                  Text(
                    widget.loadedSummary ??
                        (widget.allowMultiple ? 'Drop files here, or click to browse' : 'Drop a file here, or click to browse'),
                    textAlign: TextAlign.center,
                    style: textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                  ),
                  if (widget.hint != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      widget.hint!,
                      textAlign: TextAlign.center,
                      style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ],
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _handleBrowse,
                    icon: const Icon(Icons.folder_open, size: 18),
                    label: Text(widget.loadedSummary != null ? 'Choose a different file' : 'Browse…'),
                  ),
                ],
              ),
            ),
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(_error!, style: textTheme.bodySmall?.copyWith(color: scheme.error)),
        ],
      ],
    );
  }
}

/// Opens the native "save as" dialog and writes [bytes] where the user
/// chose. Returns the saved location, or null if they cancelled. Use this
/// instead of asking the user to type a destination path.
///
/// Throws if the write itself fails; callers should catch and surface it
/// as inline error text.
Future<String?> saveBytesWithDialog({
  required Uint8List bytes,
  required String suggestedName,
  String? mimeType,
  List<XTypeGroup> acceptedTypes = const [],
}) async {
  final location = await getSaveLocation(suggestedName: suggestedName, acceptedTypeGroups: acceptedTypes);
  if (location == null) return null;

  final file = XFile.fromData(bytes, mimeType: mimeType, name: suggestedName);
  await file.saveTo(location.path);
  return location.path;
}

/// Compact "1.2 MB"-style formatter for showing file sizes in drop-zone
/// summaries and conversion results.
String formatFileSize(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(2)} MB';
}

/// Shared monospace style re-export point so tool screens that show file
/// paths/output alongside a [FileDropField] don't each import app_theme
/// separately for one style.
TextStyle get monospaceFileStyle => AppTheme.monospace;
