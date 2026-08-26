/// Renders a [FormFlowSchema] as a **fillable PDF form** (an AcroForm with
/// real interactive widgets), so a FormFlow schema can be handed to someone
/// who fills it in Acrobat/Preview/Chrome rather than in the app.
///
/// ## "Pure-ish" Dart, not pure Dart
/// `lib/core/**` is normally zero-Flutter-import pure Dart. This file follows
/// the precedent already set by `lib/core/office_media/pdf_split_merge.dart`
/// and `pdf_inspector.dart`: it imports `syncfusion_flutter_pdf` plus
/// `dart:ui`'s geometry types (`Rect`/`Size`), which the Syncfusion API
/// surface requires. There is no `package:flutter/...` import anywhere in
/// this file or in `syncfusion_flutter_pdf`'s own `pdf.dart` entrypoint —
/// the package is widget-free and only reaches into `dart:ui` for `Rect`,
/// `Size`, `Offset` and `Color`. The property the hexagonal boundary is
/// protecting (no UI framework, unit-testable headlessly) still holds: every
/// test in `test/core/form_flow/pdf_form_generator_test.dart` runs without
/// pumping a single widget.
///
/// ## Verified Syncfusion API (read from the pub cache, not guessed)
/// `%LOCALAPPDATA%\Pub\Cache\hosted\pub.dev\syncfusion_flutter_pdf-27.2.5\lib\
/// src\pdf\implementation\forms\`:
/// - `PdfTextBoxField(PdfPage page, String name, Rect bounds, {String? text,
///   PdfFont? font, bool multiline, PdfColor? borderColor, int? borderWidth,
///   String? tooltip, ...})` — `pdf_text_box_field.dart`.
/// - `PdfCheckBoxField(PdfPage page, String name, Rect bounds,
///   {bool isChecked, PdfCheckBoxStyle style, PdfColor? borderColor,
///   int? borderWidth, String? tooltip, ...})` — `pdf_check_box_field.dart`.
/// - `PdfComboBoxField(PdfPage page, String name, Rect bounds,
///   {`List<PdfListFieldItem>?` items, ...})` — `pdf_combo_box_field.dart`.
///   Unused here: [FieldType] has no enumeration/choice case to map onto it.
/// - `document.form.fields.add(field)` — `pdf_form_field_collection.dart`.
///
/// The field is bound to its page *by the constructor's `page` argument*, not
/// by adding it to a page: `PdfFormFieldCollection._doAdd` pushes the field's
/// widget annotation onto `field.page.annotations` for you. `bounds` is in
/// the page's **client-area** coordinate space (origin at the top-left inside
/// the margins, y growing downward) — the same space `page.graphics.drawString`
/// uses — because `PdfAnnotationHelper` maps annotation bounds through
/// `PdfSectionHelper.pointToNativePdf`. That is why [_Layout] lays everything
/// out against `page.getClientSize()`.
library;

import 'dart:typed_data';
import 'dart:ui' show Offset, Rect, Size;

import 'package:syncfusion_flutter_pdf/pdf.dart';

import 'schema_model.dart';

/// Turns a [FormFlowSchema] (plus optionally the values currently held by the
/// builder screen) into a fillable PDF form.
///
/// ## Field mapping
/// | [FieldType] | PDF widget |
/// |---|---|
/// | `text`, `number` | [PdfTextBoxField] |
/// | `boolean` | [PdfCheckBoxField] |
/// | `object` | an indented sub-section heading + its children |
/// | `array` | the item template repeated N times under numbered headings |
///
/// ## Array repetition count
/// A PDF form has no `[+ Add Item]` button — AcroForm fields are static. So a
/// repeating group has to be flattened to a fixed number of blocks at
/// generation time: the number of items actually present in [values], or
/// [blankArrayRepetitions] when generating from a schema alone. Anything the
/// filler needs beyond that has to come from a regenerated PDF.
///
/// ## Field names
/// Every field gets a **path-qualified, unique** name (`servers.1.host`).
/// This is not cosmetic: `PdfForm.fieldAutoNaming` defaults to `true`, and
/// `PdfFormHelper.getCorrectName` silently replaces the *second* field that
/// shares a name with a random GUID — so two array items both naming their
/// field `host` would produce one usable field and one unaddressable
/// `abc123…`-named one. Building unique names up front keeps every field
/// addressable and stable. Dots inside a schema key are rewritten to `_` so a
/// key's own dot can never forge a path segment.
class PdfFormGenerator {
  const PdfFormGenerator({
    this.blankArrayRepetitions = 3,
    this.pageSize = a4PortraitPoints,
    this.margin = 40,
  })  : assert(blankArrayRepetitions > 0, 'Need at least one repetition'),
        assert(margin >= 0, 'Margin cannot be negative');

  /// A4 in PostScript points, the PDF unit — matches Syncfusion's own default
  /// page size, restated here so [pageSize] has a `const` default.
  static const Size a4PortraitPoints = Size(595, 842);

  /// How many blank blocks an `array` field gets when [generate] is called
  /// without values for it (a PDF form cannot grow rows after the fact).
  final int blankArrayRepetitions;

  final Size pageSize;

  /// Page margin in points, applied on all four sides.
  final double margin;

  /// Builds the PDF and returns its bytes.
  ///
  /// [values] is the same nested shape the builder screen keeps and
  /// [FormFlowParser.render] consumes: `Map` for `object`, `List<Map>` for
  /// `array`, raw scalars for leaves. Missing or mis-shaped entries simply
  /// render as blank fields — this never throws on a values/schema mismatch,
  /// because the schema is always the authority on structure.
  Future<Uint8List> generate(
    FormFlowSchema schema, {
    Map<String, Object?> values = const {},
    String? title,
  }) async {
    final document = PdfDocument();
    // Both must be set *before* the first page is added: PdfSection captures
    // the settings when it is created, so mutating them afterwards is a
    // silent no-op (the same trap documented in pdf_split_merge.dart).
    document.pageSettings.size = pageSize;
    document.pageSettings.margins.all = margin;

    final layout = _Layout(document);
    layout.drawTitle(title ?? _titleFor(schema));
    _emitFields(layout, schema.fields, values, const []);

    final bytes = await document.save();
    document.dispose();
    return Uint8List.fromList(bytes);
  }

  String _titleFor(FormFlowSchema schema) => '${schema.rootName} — ${schema.format.label} form';

  // -----------------------------------------------------------------------
  // Emission
  // -----------------------------------------------------------------------

  void _emitFields(
    _Layout layout,
    List<SchemaField> fields,
    Map<String, Object?> values,
    List<String> path, {
    int depth = 0,
  }) {
    for (final field in fields) {
      _emitField(layout, field, values[field.key], [...path, _sanitize(field.key)], depth: depth);
    }
  }

  void _emitField(
    _Layout layout,
    SchemaField field,
    Object? value,
    List<String> path, {
    required int depth,
  }) {
    final name = path.join('.');
    switch (field.type) {
      case FieldType.text:
        layout.drawTextBox(name: name, label: field.displayLabel, value: _asText(value, field), depth: depth);
      case FieldType.number:
        layout.drawTextBox(name: name, label: field.displayLabel, value: _asText(value, field), depth: depth);
      case FieldType.boolean:
        layout.drawCheckBox(name: name, label: field.displayLabel, checked: _asBool(value, field), depth: depth);
      case FieldType.object:
        layout.drawSectionHeading(field.displayLabel, depth: depth);
        final childValues = value is Map ? Map<String, Object?>.from(value) : const <String, Object?>{};
        _emitFields(layout, field.children, childValues, path, depth: depth + 1);
      case FieldType.array:
        _emitArray(layout, field, value, path, depth: depth);
    }
  }

  void _emitArray(_Layout layout, SchemaField field, Object? value, List<String> path, {required int depth}) {
    final items = value is List ? value : const [];
    // An array with no item template has nothing to repeat — emit the heading
    // so the reader can see the group exists, but no (zero-field) blocks.
    if (field.children.isEmpty) {
      layout.drawSectionHeading('${field.displayLabel} (no item fields detected)', depth: depth);
      return;
    }
    final count = items.isEmpty ? blankArrayRepetitions : items.length;
    layout.drawSectionHeading('${field.displayLabel} (${count > 1 ? '$count entries' : '1 entry'})', depth: depth);
    for (var i = 0; i < count; i++) {
      final raw = i < items.length ? items[i] : null;
      final itemValues = raw is Map ? Map<String, Object?>.from(raw) : const <String, Object?>{};
      layout.drawItemHeading('${field.displayLabel} #${i + 1}', depth: depth + 1);
      // Index segment keeps sibling repetitions from colliding on a name.
      _emitFields(layout, field.children, itemValues, [...path, '${i + 1}'], depth: depth + 2);
    }
  }

  String _asText(Object? value, SchemaField field) {
    if (value == null) return field.defaultValue ?? '';
    if (value is Map || value is List) return '';
    return value.toString();
  }

  bool _asBool(Object? value, SchemaField field) {
    if (value is bool) return value;
    if (value is Map || value is List) return false;
    return (value?.toString() ?? field.defaultValue ?? 'false').toLowerCase() == 'true';
  }

  /// A schema key is arbitrary user data (an XML tag, a JSON property). `.` is
  /// the AcroForm hierarchy separator, so it is rewritten before being used as
  /// a path segment.
  String _sanitize(String key) => key.replaceAll('.', '_');
}

/// A tiny top-down flow layout over a growing [PdfDocument].
///
/// ## Pagination
/// Everything is emitted through [_reserve], which is the *only* place that
/// consumes vertical space: it checks whether the requested block still fits
/// below the current cursor inside the page's client height and, if not,
/// starts a fresh page and resets the cursor to the top before returning the
/// y offset to draw at. Because fields are bound to a page by the
/// `PdfTextBoxField(page, …)` constructor argument, the *page* handed to the
/// field constructor is whatever [page] is after that check — so a field that
/// triggered a page break is created on the new page, never stranded off the
/// bottom of the old one.
///
/// Section headings reserve `heading + one row` together, so a heading can
/// never be orphaned as the last thing on a page with its fields overleaf.
class _Layout {
  _Layout(this.document) {
    _startPage();
  }

  final PdfDocument document;

  static const double _titleHeight = 26;
  static const double _headingHeight = 18;
  static const double _itemHeadingHeight = 16;
  static const double _fieldHeight = 18;
  static const double _labelHeight = 11;
  static const double _rowGap = 8;
  static const double _indentStep = 14;

  /// Total vertical space one label+widget row occupies.
  static const double rowHeight = _fieldHeight + _rowGap;

  final PdfFont _titleFont = PdfStandardFont(PdfFontFamily.helvetica, 16, style: PdfFontStyle.bold);
  final PdfFont _headingFont = PdfStandardFont(PdfFontFamily.helvetica, 11, style: PdfFontStyle.bold);
  final PdfFont _itemFont = PdfStandardFont(PdfFontFamily.helvetica, 9, style: PdfFontStyle.italic);
  final PdfFont _labelFont = PdfStandardFont(PdfFontFamily.helvetica, 9);
  final PdfFont _valueFont = PdfStandardFont(PdfFontFamily.helvetica, 9);
  final PdfBrush _ink = PdfSolidBrush(PdfColor(20, 20, 20));
  final PdfBrush _muted = PdfSolidBrush(PdfColor(90, 90, 90));
  final PdfColor _border = PdfColor(140, 140, 140);

  late PdfPage page;
  late double _width;
  late double _height;
  double _y = 0;

  void _startPage() {
    page = document.pages.add();
    final client = page.getClientSize();
    _width = client.width;
    _height = client.height;
    _y = 0;
  }

  /// Claims [blockHeight] points of vertical space, paginating if needed, and
  /// returns the y offset (client-area coordinates) to draw at.
  ///
  /// [keepWithNext] is extra space that must *also* still be free below the
  /// block for it to stay on this page, without being consumed — used by
  /// headings so a heading plus its first row break together. The `_y > 0`
  /// guard stops a block taller than a whole empty page from looping into an
  /// endless run of blank pages: it draws (overflowing) rather than hanging.
  double _reserve(double blockHeight, {double keepWithNext = 0}) {
    if (_y > 0 && _y + blockHeight + keepWithNext > _height) {
      _startPage();
    }
    final top = _y;
    _y += blockHeight;
    return top;
  }

  double _labelColumnWidth() => _width * 0.42;

  void drawTitle(String text) {
    final top = _reserve(_titleHeight + 10);
    page.graphics.drawString(
      text,
      _titleFont,
      brush: _ink,
      bounds: Rect.fromLTWH(0, top, _width, _titleHeight),
    );
    page.graphics.drawLine(
      PdfPen(PdfColor(180, 180, 180)),
      Offset(0, top + _titleHeight + 2),
      Offset(_width, top + _titleHeight + 2),
    );
  }

  void drawSectionHeading(String text, {required int depth}) {
    // Keep the heading with one row so it cannot be orphaned at a page foot.
    final top = _reserve(_headingHeight + 4, keepWithNext: rowHeight);
    final x = depth * _indentStep;
    page.graphics.drawString(
      text,
      _headingFont,
      brush: _ink,
      bounds: Rect.fromLTWH(x, top, _width - x, _headingHeight),
    );
  }

  void drawItemHeading(String text, {required int depth}) {
    final top = _reserve(_itemHeadingHeight + 2, keepWithNext: rowHeight);
    final x = depth * _indentStep;
    page.graphics.drawString(
      text,
      _itemFont,
      brush: _muted,
      bounds: Rect.fromLTWH(x, top, _width - x, _itemHeadingHeight),
    );
  }

  void drawTextBox({required String name, required String label, required String value, required int depth}) {
    final top = _reserve(rowHeight);
    final x = depth * _indentStep;
    final labelWidth = _labelColumnWidth() - x;
    page.graphics.drawString(
      label,
      _labelFont,
      brush: _ink,
      bounds: Rect.fromLTWH(x, top + (_fieldHeight - _labelHeight) / 2, labelWidth, _labelHeight + 2),
    );
    final fieldX = _labelColumnWidth() + 6;
    document.form.fields.add(
      PdfTextBoxField(
        page,
        name,
        Rect.fromLTWH(fieldX, top, _width - fieldX, _fieldHeight),
        text: value,
        font: _valueFont,
        tooltip: label,
        borderColor: _border,
        borderWidth: 1,
      ),
    );
  }

  void drawCheckBox({required String name, required String label, required bool checked, required int depth}) {
    final top = _reserve(rowHeight);
    final x = depth * _indentStep;
    final labelWidth = _labelColumnWidth() - x;
    page.graphics.drawString(
      label,
      _labelFont,
      brush: _ink,
      bounds: Rect.fromLTWH(x, top + (_fieldHeight - _labelHeight) / 2, labelWidth, _labelHeight + 2),
    );
    final fieldX = _labelColumnWidth() + 6;
    document.form.fields.add(
      PdfCheckBoxField(
        page,
        name,
        Rect.fromLTWH(fieldX, top + 1, 14, 14),
        isChecked: checked,
        tooltip: label,
        borderColor: _border,
        borderWidth: 1,
      ),
    );
  }
}
