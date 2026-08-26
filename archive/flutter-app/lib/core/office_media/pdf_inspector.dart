/// PDF inspection/metadata logic built on `syncfusion_flutter_pdf`'s
/// [PdfDocument] — see the library-level doc comment in
/// `pdf_split_merge.dart` for why a `syncfusion_flutter_pdf` dependency
/// (and its transitive `dart:ui` usage) is acceptable in `lib/core/**` for
/// this vertical slice specifically.
///
/// ## Encryption detection: a real, documented API limitation
/// The task asks this class to report "whether it's encrypted" via
/// `PdfDocument`'s security-related properties. Reading the actual package
/// source (`syncfusion_flutter_pdf-27.2.5/lib/src/pdf/implementation/
/// pdf_document/pdf_document.dart`) turned up no public `isEncrypted`
/// boolean anywhere: the document loader computes one internally
/// (`PdfDocumentHelper.isEncrypted`, set from `checkEncryption()`), but
/// `PdfDocumentHelper` is never exported from the package's public barrel
/// (`lib/pdf.dart` only `show`s `PdfDocument, PdfPasswordArgs,
/// PdfPasswordCallback` from that file) — so application code has no way to
/// read that flag directly. `PdfDocument.security` isn't a substitute
/// either: it's a getter that lazily creates a brand-new, default-valued
/// [PdfSecurity] the first time it's read, for both encrypted and
/// unencrypted loaded documents alike whenever the encryption dictionary
/// didn't already populate it — so its mere non-nullness proves nothing,
/// and its field values (algorithm, key size, etc.) can't be reliably
/// distinguished from an unencrypted document's freshly-manufactured
/// defaults without also inspecting private state.
///
/// The one thing that *is* observable through the public API is whether
/// `PdfDocument(inputBytes: ...)` can open the file **without** a password:
/// loading throws for any document whose encryption requires a password the
/// caller didn't supply (or supplied incorrectly). So [PdfInspector] reports
/// [PdfInspectionResult.isEncrypted] as "opening this file without a
/// password failed, or opening it with the given password succeeded" —
/// i.e. it reliably detects password-protected PDFs, but a PDF encrypted
/// with only an *owner* password (no password needed to open/view it, only
/// to change permissions) will be reported as `isEncrypted: false` here,
/// since nothing in the public API distinguishes that case from a plain
/// unencrypted PDF. This is stated plainly rather than guessed at.
library;

import 'dart:typed_data';

import 'package:syncfusion_flutter_pdf/pdf.dart';

import '../ports/i_tool_use_case.dart';

/// Document metadata pulled from [PdfDocument.documentInformation]. Plain
/// data only — no Syncfusion types — so the UI layer never needs to import
/// `syncfusion_flutter_pdf` itself just to display an inspection result.
///
/// Every field is `null` when Syncfusion reports it as an empty string
/// (its own default for "not set" — `PdfDocumentInformation` fields are
/// non-nullable `String`s that default to `''`), so the UI can cleanly
/// distinguish "field present" from "field absent" with `!= null`.
class PdfDocumentInfo {
  const PdfDocumentInfo({this.title, this.author, this.subject, this.keywords, this.creator, this.producer});

  final String? title;
  final String? author;
  final String? subject;
  final String? keywords;
  final String? creator;
  final String? producer;

  /// True when none of the metadata fields carried a value.
  bool get isEmpty =>
      title == null && author == null && subject == null && keywords == null && creator == null && producer == null;
}

/// Result of inspecting one PDF file. Plain data class — see
/// [PdfDocumentInfo] for why Syncfusion types don't leak into this shape.
class PdfInspectionResult {
  const PdfInspectionResult({
    required this.pageCount,
    required this.fileSizeBytes,
    required this.isEncrypted,
    required this.isReadable,
    required this.info,
  });

  /// Number of pages, or `0` when the document couldn't be opened at all
  /// (see [isReadable]).
  final int pageCount;

  /// Size of the original input bytes, in bytes.
  final int fileSizeBytes;

  /// Whether the document required a password to open (see the
  /// library-level doc comment above for exactly what this does and does
  /// not detect).
  final bool isEncrypted;

  /// Whether [PdfInspector] was actually able to open the document and read
  /// [pageCount]/[info] from it. False only when the document is
  /// password-protected and either no password was supplied or the
  /// supplied password was wrong — in that case [pageCount] is `0` and
  /// [info] is empty, since nothing about the document's contents could be
  /// read.
  final bool isReadable;

  final PdfDocumentInfo info;
}

/// Input for [PdfInspector.execute]: the PDF's raw bytes, plus an optional
/// password to try if the document turns out to be password-protected.
class PdfInspectInput {
  const PdfInspectInput({required this.bytes, this.password});

  final Uint8List bytes;

  /// Tried only if opening [bytes] without a password fails. Left `null` (or
  /// wrong), a password-protected document is still reported — with
  /// [PdfInspectionResult.isEncrypted] `true` and [PdfInspectionResult.isReadable]
  /// `false` — rather than throwing, since "this file is encrypted" is a
  /// legitimate, expected inspection outcome rather than an error.
  final String? password;
}

/// Reads a PDF's page count, document-info metadata, encryption status, and
/// file size, returning a plain [PdfInspectionResult] (see that class and
/// the library-level doc comment for what "encrypted" does and doesn't mean
/// here).
class PdfInspector implements IToolUseCase<PdfInspectInput, PdfInspectionResult> {
  const PdfInspector();

  @override
  PdfInspectionResult execute(PdfInspectInput input) {
    final fileSize = input.bytes.length;

    PdfDocument? document;
    var isEncrypted = false;
    try {
      document = PdfDocument(inputBytes: input.bytes);
    } catch (_) {
      isEncrypted = true;
      final password = input.password;
      if (password != null && password.isNotEmpty) {
        try {
          document = PdfDocument(inputBytes: input.bytes, password: password);
        } catch (_) {
          document = null;
        }
      }
    }

    if (document == null) {
      return PdfInspectionResult(
        pageCount: 0,
        fileSizeBytes: fileSize,
        isEncrypted: isEncrypted,
        isReadable: false,
        info: const PdfDocumentInfo(),
      );
    }

    try {
      final pageCount = document.pages.count;
      final docInfo = document.documentInformation;
      final info = PdfDocumentInfo(
        title: _nullIfEmpty(docInfo.title),
        author: _nullIfEmpty(docInfo.author),
        subject: _nullIfEmpty(docInfo.subject),
        keywords: _nullIfEmpty(docInfo.keywords),
        creator: _nullIfEmpty(docInfo.creator),
        producer: _nullIfEmpty(docInfo.producer),
      );
      return PdfInspectionResult(
        pageCount: pageCount,
        fileSizeBytes: fileSize,
        isEncrypted: isEncrypted,
        isReadable: true,
        info: info,
      );
    } finally {
      document.dispose();
    }
  }

  String? _nullIfEmpty(String value) => value.isEmpty ? null : value;
}
