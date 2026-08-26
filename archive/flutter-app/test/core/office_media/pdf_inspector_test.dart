import 'dart:typed_data';
import 'dart:ui' show Rect;

import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/office_media/pdf_inspector.dart';
import 'package:syncfusion_flutter_pdf/pdf.dart';

/// Builds a small, valid in-memory PDF fixture with [pageCount] pages,
/// optionally setting document-info metadata fields on it first.
Future<Uint8List> _buildPdf(
  int pageCount, {
  String? title,
  String? author,
  String? subject,
  String? keywords,
}) async {
  final document = PdfDocument();
  if (title != null) document.documentInformation.title = title;
  if (author != null) document.documentInformation.author = author;
  if (subject != null) document.documentInformation.subject = subject;
  if (keywords != null) document.documentInformation.keywords = keywords;

  for (var i = 1; i <= pageCount; i++) {
    document.pages.add().graphics.drawString(
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

/// Builds a password-protected PDF fixture.
Future<Uint8List> _buildEncryptedPdf({required String userPassword, int pageCount = 1}) async {
  final document = PdfDocument();
  document.security.userPassword = userPassword;
  document.security.ownerPassword = 'owner-$userPassword';
  for (var i = 1; i <= pageCount; i++) {
    document.pages.add();
  }
  final saved = await document.save();
  document.dispose();
  return Uint8List.fromList(saved);
}

void main() {
  const inspector = PdfInspector();

  group('metadata present', () {
    test('reads back page count, file size, and document-info fields', () async {
      final bytes = await _buildPdf(
        3,
        title: 'Quarterly Report',
        author: 'Jane Doe',
        subject: 'Finance',
        keywords: 'q3, finance, report',
      );

      final result = inspector.execute(PdfInspectInput(bytes: bytes));

      expect(result.pageCount, 3);
      expect(result.fileSizeBytes, bytes.length);
      expect(result.isEncrypted, isFalse);
      expect(result.isReadable, isTrue);
      expect(result.info.title, 'Quarterly Report');
      expect(result.info.author, 'Jane Doe');
      expect(result.info.subject, 'Finance');
      expect(result.info.keywords, 'q3, finance, report');
      expect(result.info.isEmpty, isFalse);
    });
  });

  group('no metadata set', () {
    test('reports null for every unset document-info field', () async {
      final bytes = await _buildPdf(1);

      final result = inspector.execute(PdfInspectInput(bytes: bytes));

      expect(result.pageCount, 1);
      expect(result.isEncrypted, isFalse);
      expect(result.isReadable, isTrue);
      expect(result.info.title, isNull);
      expect(result.info.author, isNull);
      expect(result.info.subject, isNull);
      expect(result.info.keywords, isNull);
      expect(result.info.isEmpty, isTrue);
    });
  });

  group('encrypted PDFs', () {
    test('a password-protected PDF opened without a password is reported as encrypted and unreadable', () async {
      final bytes = await _buildEncryptedPdf(userPassword: 'secret123');

      final result = inspector.execute(PdfInspectInput(bytes: bytes));

      expect(result.isEncrypted, isTrue);
      expect(result.isReadable, isFalse);
      expect(result.pageCount, 0);
      expect(result.info.isEmpty, isTrue);
      expect(result.fileSizeBytes, bytes.length);
    });

    test('a password-protected PDF opened with the correct password is readable', () async {
      final bytes = await _buildEncryptedPdf(userPassword: 'secret123', pageCount: 2);

      final result = inspector.execute(PdfInspectInput(bytes: bytes, password: 'secret123'));

      expect(result.isEncrypted, isTrue);
      expect(result.isReadable, isTrue);
      expect(result.pageCount, 2);
    });

    test('a password-protected PDF opened with the wrong password stays unreadable', () async {
      final bytes = await _buildEncryptedPdf(userPassword: 'secret123');

      final result = inspector.execute(PdfInspectInput(bytes: bytes, password: 'wrong-password'));

      expect(result.isEncrypted, isTrue);
      expect(result.isReadable, isFalse);
    });
  });
}
