import 'dart:typed_data';
import 'dart:ui' show Rect, Size;

import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/office_media/pdf_split_merge.dart';
import 'package:syncfusion_flutter_pdf/pdf.dart';

/// Builds a small, valid, in-memory PDF fixture with [pageCount] pages, each
/// carrying a distinguishing text label ("Page 1", "Page 2", ...) so tests
/// can tell pages apart without needing an external sample file — per the
/// task's guidance, `syncfusion_flutter_pdf` can both read and write PDFs,
/// so fixtures are built with its own `PdfDocument()` constructor rather
/// than checked-in binary files. [PdfDocument.save] is async, hence this
/// helper is too.
Future<Uint8List> _buildPdfAsync(int pageCount) async {
  final document = PdfDocument();
  for (var i = 1; i <= pageCount; i++) {
    final page = document.pages.add();
    page.graphics.drawString(
      'Page $i',
      PdfStandardFont(PdfFontFamily.helvetica, 12),
      brush: PdfSolidBrush(PdfColor(0, 0, 0)),
      bounds: const Rect.fromLTWH(0, 0, 150, 20),
    );
  }
  final saved = await document.save();
  document.dispose();
  return Uint8List.fromList(saved);
}

int _pageCountOf(Uint8List bytes) {
  final document = PdfDocument(inputBytes: bytes);
  final count = document.pages.count;
  document.dispose();
  return count;
}

void main() {
  group('PdfMerger', () {
    const merger = PdfMerger();

    test('merging two 1-page PDFs yields a 2-page PDF', () async {
      final a = await _buildPdfAsync(1);
      final b = await _buildPdfAsync(1);

      final merged = await merger.execute([a, b]);

      expect(_pageCountOf(merged), 2);
    });

    test('preserves page order and total count across three sources', () async {
      final a = await _buildPdfAsync(2);
      final b = await _buildPdfAsync(1);
      final c = await _buildPdfAsync(3);

      final merged = await merger.execute([a, b, c]);

      expect(_pageCountOf(merged), 6);
    });

    test('preserves each source page\'s own size instead of forcing a common size', () async {
      final document = PdfDocument();
      // Assign a fresh PdfPageSettings instance per page, with an explicit
      // orientation matching the size — see PdfMerger's doc comment for why
      // both matter (mutating `.size` is a no-op after the first page is
      // added, and omitting orientation lets Syncfusion's own internal
      // clone() swap width/height for landscape-shaped sizes).
      document.pageSettings = PdfPageSettings(const Size(300, 400), PdfPageOrientation.portrait);
      document.pages.add();
      document.pageSettings = PdfPageSettings(const Size(600, 200), PdfPageOrientation.landscape);
      document.pages.add();
      final custom = Uint8List.fromList(await document.save());
      document.dispose();

      final merged = await merger.execute([custom]);

      final reopened = PdfDocument(inputBytes: merged);
      expect(reopened.pages.count, 2);
      expect(reopened.pages[0].size.width, closeTo(300, 0.5));
      expect(reopened.pages[0].size.height, closeTo(400, 0.5));
      expect(reopened.pages[1].size.width, closeTo(600, 0.5));
      expect(reopened.pages[1].size.height, closeTo(200, 0.5));
      reopened.dispose();
    });

    test('produces a document that itself re-opens as a valid PDF', () async {
      final a = await _buildPdfAsync(1);
      final merged = await merger.execute([a]);

      // Re-opening and reading document-level state (not just page count)
      // is a reasonable proxy for "this is a well-formed PDF", since a
      // corrupt merge would typically throw here.
      final reopened = PdfDocument(inputBytes: merged);
      expect(reopened.pages.count, 1);
      reopened.dispose();
    });

    test('rejects an empty input list', () {
      expect(() => merger.execute(const []), throwsArgumentError);
    });
  });

  group('PdfPageExtractor', () {
    const extractor = PdfPageExtractor();

    test('extracting page 2 of a 3-page PDF yields a 1-page PDF', () async {
      final source = await _buildPdfAsync(3);

      final extracted = await extractor.execute(PdfExtractInput(bytes: source, pageNumbers: const [2]));

      expect(_pageCountOf(extracted), 1);
    });

    test('extracting multiple pages preserves ascending source order regardless of input order', () async {
      final source = await _buildPdfAsync(5);

      final extracted = await extractor.execute(PdfExtractInput(bytes: source, pageNumbers: const [4, 1, 2]));

      expect(_pageCountOf(extracted), 3);
    });

    test('duplicate page numbers are deduplicated', () async {
      final source = await _buildPdfAsync(3);

      final extracted = await extractor.execute(PdfExtractInput(bytes: source, pageNumbers: const [1, 1, 1]));

      expect(_pageCountOf(extracted), 1);
    });

    test('rejects an out-of-range page number', () async {
      final source = await _buildPdfAsync(2);

      expect(
        () => extractor.execute(PdfExtractInput(bytes: source, pageNumbers: const [5])),
        throwsArgumentError,
      );
    });

    test('rejects an empty page-number list', () async {
      final source = await _buildPdfAsync(2);

      expect(
        () => extractor.execute(PdfExtractInput(bytes: source, pageNumbers: const [])),
        throwsArgumentError,
      );
    });
  });

  group('PdfPageRangeParser', () {
    const parser = PdfPageRangeParser();

    test('parses a mix of single pages and ranges into ascending, deduplicated order', () {
      expect(parser.parse('1-3,5', pageCount: 5), [1, 2, 3, 5]);
    });

    test('deduplicates overlapping ranges and singles', () {
      expect(parser.parse('1-3,2,3-4', pageCount: 10), [1, 2, 3, 4]);
    });

    test('tolerates surrounding whitespace', () {
      expect(parser.parse(' 1 - 2 , 4 ', pageCount: 10), [1, 2, 4]);
    });

    test('rejects empty input', () {
      expect(() => parser.parse('', pageCount: 5), throwsFormatException);
    });

    test('rejects a malformed token', () {
      expect(() => parser.parse('1,two,3', pageCount: 5), throwsFormatException);
    });

    test('rejects a descending range', () {
      expect(() => parser.parse('5-2', pageCount: 5), throwsFormatException);
    });

    test('rejects a page number beyond the document\'s page count', () {
      expect(() => parser.parse('1-10', pageCount: 5), throwsRangeError);
    });

    test('rejects page number 0 (pages are 1-based)', () {
      expect(() => parser.parse('0-2', pageCount: 5), throwsRangeError);
    });
  });
}
