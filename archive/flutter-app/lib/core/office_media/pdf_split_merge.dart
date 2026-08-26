/// PDF merge/split logic built on `syncfusion_flutter_pdf`'s [PdfDocument].
///
/// ## "Pure-ish" Dart, not pure Dart
/// `lib/core/**` is normally zero-Flutter-import pure Dart, but this file is
/// the one place in this vertical slice that's allowed to break that rule:
/// the task explicitly calls for building PDF logic on top of
/// `syncfusion_flutter_pdf`'s `PdfDocument`, which is itself a Flutter
/// package (it pulls in `dart:ui` for geometry types like [Offset] and
/// `Size`, even though it never imports `package:flutter/material.dart` or
/// anything widget-related). There is no `package:flutter/...` import here —
/// only `dart:ui` (transitively required by the Syncfusion API surface) and
/// `syncfusion_flutter_pdf` itself. This keeps the logic UI-framework-free
/// and unit-testable, which is the actual property the hexagonal boundary is
/// protecting.
///
/// ## Why templates instead of "import page" APIs
/// Syncfusion's .NET/WinForms PDF library has `PdfDocument.ImportPageRange`/
/// `ImportPage` style APIs, and online examples for *other* Syncfusion
/// products reference them. The actual Flutter package installed here
/// (`syncfusion_flutter_pdf: ^27.2.5`) does **not** ship any such method —
/// verified by reading the package source under the pub cache
/// (`%LOCALAPPDATA%\Pub\Cache\hosted\pub.dev\syncfusion_flutter_pdf-27.2.5\
/// lib\src\pdf\implementation\pages\pdf_page_collection.dart` and
/// `pdf_document\pdf_document.dart`): there is no `importPage`,
/// `importPageRange`, or `PdfDocument.merge` anywhere in this version's
/// public API. The package's own doc comments instead point at
/// [PdfPage.createTemplate] (snapshots a page's rendered content as a
/// [PdfTemplate]) plus [PdfGraphics.drawPdfTemplate] (stamps that template
/// onto another page) as the supported way to copy page content between
/// documents, so [PdfMerger] uses that pattern.
///
/// ## Why extraction uses page removal, not templates
/// Extracting a page range only ever involves a *single* source document, so
/// there's a simpler, higher-fidelity option than the template/draw dance
/// used for merging: load the source once and delete every page that
/// wasn't requested via the public `PdfPageCollection.removeAt`. This keeps
/// the original page objects (and anything on them — text, forms,
/// annotations) completely untouched rather than re-rendering them as a
/// flattened template image/content-stream copy, so [PdfPageExtractor] uses
/// that approach instead.
library;

import 'dart:typed_data';
import 'dart:ui' show Offset;

import 'package:syncfusion_flutter_pdf/pdf.dart';

import '../ports/i_tool_use_case.dart';

/// Merges any number of source PDFs (as raw bytes, in the given order) into
/// a single output PDF. Every page from `input[0]` comes first, then every
/// page from `input[1]`, and so on — pages are never reordered within a
/// source document.
///
/// Each source page's own size is preserved on the corresponding output
/// page (mixed portrait/landscape or mixed paper sizes across the merged
/// set are handled correctly). Getting this right took a couple of false
/// starts worth documenting, both found by reading `pdf_page_settings.dart`
/// and `pdf_page_collection.dart` after the obvious-looking approaches
/// failed their tests:
///
/// 1. `output.pageSettings.size = sourcePage.size;` immediately before each
///    `output.pages.add()` looks right from the package's own doc-comment
///    examples, but is silently broken here: `PdfPageSettings.size`'s
///    *setter* is a no-op once `PdfPageSettingsHelper.isPageAdded` is
///    true — which becomes true forever the moment the *first* page is
///    added to the document — so it only ever takes effect for page 1.
/// 2. `output.pages.insert(output.pages.count, sourcePage.size)` for every
///    page avoids that lock (it doesn't touch `document.pageSettings` at
///    all), but throws a null-check error from the package's own
///    `_getValidParent`/`crossTable` on *any* unloaded (freshly
///    `PdfDocument()`-constructed) document, loaded or not — `insert` turns
///    out to only work on a document that was itself loaded from bytes
///    (confirmed by `PdfPageCollection.add()`'s own source, which only
///    calls `insert` when `isLoadedDocument` is true and takes a completely
///    different `PdfPage()` + `addPage()` path otherwise).
///
/// The combination that actually works: **replace** `output.pageSettings`
/// with a brand-new `PdfPageSettings(size, orientation)` instance — with
/// `orientation` explicitly computed from the size, not left to default —
/// before each `output.pages.add()`, rather than mutating the existing
/// instance's `.size`. A fresh instance's own `isPageAdded` starts false
/// regardless of how many pages the document already has, so the
/// setter-lock never applies. The explicit `orientation` argument matters
/// even though the constructor stores the raw size as given either way: the
/// package's internal `PdfPageSettingsHelper.clone()` (called by
/// `PdfPageCollectionHelper.addPage` whenever it opens a new section) copies
/// a settings object by setting `.size` then `.orientation` on a *new*
/// portrait-default instance — and since the `size` *setter* (unlike the
/// constructor) re-normalizes width/height against whatever orientation the
/// target instance currently has, a landscape-shaped size copied this way
/// gets width/height swapped unless the subsequent `.orientation = ...`
/// assignment (which `clone()` only makes when the source's own
/// `.orientation` says `landscape`) re-corrects it. In short: the size
/// survives the clone only if orientation was set correctly going in.
/// `PdfPageCollectionHelper.addPage` then does the right thing on its own
/// otherwise: it starts a new internal section (carrying this page size)
/// exactly when `document.pageSettings` differs from the previous page's
/// section, and reuses the existing section otherwise.
///
/// `execute` is asynchronous because [PdfDocument.save] is
/// (`Future<List<int>>`); see `SshKeyGenerator` in
/// `lib/core/utility/ssh_key_generator.dart` for the established precedent
/// of an [IToolUseCase] whose `TOutput` is itself a `Future`.
class PdfMerger implements IToolUseCase<List<Uint8List>, Future<Uint8List>> {
  const PdfMerger();

  @override
  Future<Uint8List> execute(List<Uint8List> input) async {
    if (input.isEmpty) {
      throw ArgumentError.value(input, 'input', 'At least one PDF is required to merge');
    }

    final output = PdfDocument();
    final sources = <PdfDocument>[];
    try {
      for (final bytes in input) {
        if (bytes.isEmpty) {
          throw ArgumentError.value(bytes, 'input', 'One of the source PDFs is empty');
        }
        final source = PdfDocument(inputBytes: bytes);
        sources.add(source);

        for (var i = 0; i < source.pages.count; i++) {
          final sourcePage = source.pages[i];
          final template = sourcePage.createTemplate();

          // See the class doc comment for why this must be a fresh
          // PdfPageSettings *instance* (not a mutation of the existing
          // one's `.size`) constructed with an explicit orientation that
          // matches the size (not left to default to portrait).
          final orientation = sourcePage.size.width > sourcePage.size.height
              ? PdfPageOrientation.landscape
              : PdfPageOrientation.portrait;
          output.pageSettings = PdfPageSettings(sourcePage.size, orientation);
          final newPage = output.pages.add();
          newPage.graphics.drawPdfTemplate(template, Offset.zero);
        }
      }

      final savedBytes = await output.save();
      return Uint8List.fromList(savedBytes);
    } finally {
      output.dispose();
      for (final source in sources) {
        source.dispose();
      }
    }
  }
}

/// Input for [PdfPageExtractor]: the source PDF's bytes plus the 1-based
/// page numbers to keep.
class PdfExtractInput {
  const PdfExtractInput({required this.bytes, required this.pageNumbers});

  /// Raw bytes of the source PDF.
  final Uint8List bytes;

  /// 1-based page numbers to keep in the output, e.g. `[1, 2, 5]`. Order and
  /// duplicates in this list don't matter — the output always preserves the
  /// source document's own page order. Typically produced by parsing a
  /// user-facing range string (e.g. `"1-3,5"`) via [PdfPageRangeParser].
  final List<int> pageNumbers;
}

/// Extracts a subset of pages from one source PDF into a new output PDF,
/// preserving the source document's page order and page content exactly
/// (see the library-level doc comment above for why this uses page removal
/// rather than the template/draw approach [PdfMerger] uses).
class PdfPageExtractor implements IToolUseCase<PdfExtractInput, Future<Uint8List>> {
  const PdfPageExtractor();

  @override
  Future<Uint8List> execute(PdfExtractInput input) async {
    if (input.pageNumbers.isEmpty) {
      throw ArgumentError.value(input.pageNumbers, 'pageNumbers', 'At least one page number is required');
    }
    if (input.bytes.isEmpty) {
      throw ArgumentError.value(input.bytes, 'bytes', 'Source PDF is empty');
    }

    final document = PdfDocument(inputBytes: input.bytes);
    try {
      final pageCount = document.pages.count;
      final keep = input.pageNumbers.toSet();
      for (final pageNumber in keep) {
        if (pageNumber < 1 || pageNumber > pageCount) {
          throw ArgumentError.value(
            pageNumber,
            'pageNumbers',
            'Page $pageNumber is out of range — the document has $pageCount page(s)',
          );
        }
      }

      // Walk backwards so removing a page never shifts the index of a
      // not-yet-visited page still ahead of it.
      for (var index = pageCount - 1; index >= 0; index--) {
        final pageNumber = index + 1; // pages() is 0-based, page numbers are 1-based
        if (!keep.contains(pageNumber)) {
          document.pages.removeAt(index);
        }
      }

      final savedBytes = await document.save();
      return Uint8List.fromList(savedBytes);
    } finally {
      document.dispose();
    }
  }
}

/// Parses a user-facing page-range string like `"1-3,5,8-9"` into an
/// ascending, deduplicated list of 1-based page numbers, validated against
/// the document's actual page count.
///
/// This is plain string/int logic with no PDF dependency at all, kept in
/// this file only because it exists to feed [PdfExtractInput.pageNumbers].
class PdfPageRangeParser {
  const PdfPageRangeParser();

  /// Throws [FormatException] for empty input, malformed tokens (not an
  /// integer or `start-end` pair), or a range where `start > end`. Throws
  /// [RangeError] if a parsed page number falls outside `1..pageCount`.
  List<int> parse(String input, {required int pageCount}) {
    final trimmed = input.trim();
    if (trimmed.isEmpty) {
      throw const FormatException('Page range cannot be empty');
    }

    final pages = <int>{};
    for (final rawToken in trimmed.split(',')) {
      final token = rawToken.trim();
      if (token.isEmpty) continue;

      if (token.contains('-')) {
        final bounds = token.split('-');
        if (bounds.length != 2) {
          throw FormatException('Invalid range "$token" — expected "start-end"');
        }
        final start = int.tryParse(bounds[0].trim());
        final end = int.tryParse(bounds[1].trim());
        if (start == null || end == null) {
          throw FormatException('Invalid range "$token" — expected two numbers separated by "-"');
        }
        if (start > end) {
          throw FormatException('Invalid range "$token" — start must be <= end');
        }
        for (var page = start; page <= end; page++) {
          pages.add(page);
        }
      } else {
        final page = int.tryParse(token);
        if (page == null) {
          throw FormatException('Invalid page number "$token"');
        }
        pages.add(page);
      }
    }

    if (pages.isEmpty) {
      throw const FormatException('No page numbers found');
    }

    final sorted = pages.toList()..sort();
    if (sorted.first < 1 || sorted.last > pageCount) {
      throw RangeError('Page numbers must be between 1 and $pageCount (got ${sorted.first}..${sorted.last})');
    }
    return sorted;
  }
}
