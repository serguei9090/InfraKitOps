import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/utility/base64_converter.dart';
import '../../../core/utility/data_format_converter.dart';
import '../../../core/utility/radix_date_converter.dart';
import '../../../core/utility/web_encoders.dart';
import '../shell/tool_detail_scaffold.dart';

enum _ConverterKind {
  dataFormat('Data Format Converter'),
  base64('Base64 Encoder/Decoder'),
  url('URL Encoder/Decoder'),
  html('HTML Entity Escaper'),
  radix('Radix Converter'),
  roman('Roman Numeral Converter'),
  timestamp('Epoch ↔ ISO-8601');

  const _ConverterKind(this.label);

  final String label;
}

/// "Converters & Encoders" tool screen (spec section 2.2, Phase 1).
///
/// A single dropdown at the top of the input panel switches between the
/// seven converters backed by the pure-Dart use cases in
/// `lib/core/utility/`. Each sub-converter keeps its own controllers/results
/// so switching back and forth does not lose previously entered work. Built
/// entirely on the shared [ToolDetailScaffold] for visual consistency.
class ConvertersScreen extends StatefulWidget {
  const ConvertersScreen({super.key});

  @override
  State<ConvertersScreen> createState() => _ConvertersScreenState();
}

class _ConvertersScreenState extends State<ConvertersScreen> {
  static const _dataFormatConverter = DataFormatConverter();
  static const _base64Converter = Base64Converter();
  static const _webEncoder = WebEncoder();
  static const _radixConverter = RadixConverter();
  static const _romanConverter = RomanNumeralConverter();
  static const _timestampConverter = TimestampConverter();

  _ConverterKind _kind = _ConverterKind.dataFormat;

  final _dfSourceController = TextEditingController();
  DataFormat _dfSourceFormat = DataFormat.json;
  DataFormat _dfTargetFormat = DataFormat.yaml;
  String _dfOutput = '';
  String? _dfError;

  final _b64Controller = TextEditingController();
  Base64Operation _b64Operation = Base64Operation.encode;
  String _b64Output = '';
  String? _b64Error;

  final _urlController = TextEditingController();
  WebEncodingOperation _urlOperation = WebEncodingOperation.urlEncode;
  String _urlOutput = '';
  String? _urlError;

  final _htmlController = TextEditingController();
  WebEncodingOperation _htmlOperation = WebEncodingOperation.htmlEscape;
  String _htmlOutput = '';
  String? _htmlError;

  final _radixController = TextEditingController();
  NumberBase _radixFromBase = NumberBase.decimal;
  NumberBase _radixToBase = NumberBase.hexadecimal;
  String _radixOutput = '';
  String? _radixError;

  final _romanController = TextEditingController();
  RomanNumeralOperation _romanOperation = RomanNumeralOperation.toRoman;
  String _romanOutput = '';
  String? _romanError;

  final _tsController = TextEditingController();
  TimestampDirection _tsDirection = TimestampDirection.epochToIso;
  EpochUnit _tsUnit = EpochUnit.seconds;
  String _tsOutput = '';
  String? _tsError;

  @override
  void initState() {
    super.initState();
    _dfSourceController.addListener(_recomputeDataFormat);
    _b64Controller.addListener(_recomputeBase64);
    _urlController.addListener(_recomputeUrl);
    _htmlController.addListener(_recomputeHtml);
    _radixController.addListener(_recomputeRadix);
    _romanController.addListener(_recomputeRoman);
    _tsController.addListener(_recomputeTimestamp);
  }

  @override
  void dispose() {
    _dfSourceController.dispose();
    _b64Controller.dispose();
    _urlController.dispose();
    _htmlController.dispose();
    _radixController.dispose();
    _romanController.dispose();
    _tsController.dispose();
    super.dispose();
  }

  void _recomputeDataFormat() {
    setState(() {
      if (_dfSourceController.text.trim().isEmpty) {
        _dfOutput = '';
        _dfError = null;
        return;
      }
      try {
        final result = _dataFormatConverter.execute(
          DataFormatConversionInput(
            source: _dfSourceController.text,
            sourceFormat: _dfSourceFormat,
            targetFormat: _dfTargetFormat,
          ),
        );
        _dfOutput = result.output;
        _dfError = null;
      } catch (e) {
        _dfOutput = '';
        _dfError = _messageOf(e);
      }
    });
  }

  void _recomputeBase64() {
    setState(() {
      if (_b64Controller.text.isEmpty) {
        _b64Output = '';
        _b64Error = null;
        return;
      }
      try {
        final result = _base64Converter.execute(
          Base64ConversionInput(text: _b64Controller.text, operation: _b64Operation),
        );
        _b64Output = result.output;
        _b64Error = null;
      } catch (e) {
        _b64Output = '';
        _b64Error = _messageOf(e);
      }
    });
  }

  void _recomputeUrl() {
    setState(() {
      if (_urlController.text.isEmpty) {
        _urlOutput = '';
        _urlError = null;
        return;
      }
      try {
        final result = _webEncoder.execute(
          WebEncodingInput(text: _urlController.text, operation: _urlOperation),
        );
        _urlOutput = result.output;
        _urlError = null;
      } catch (e) {
        _urlOutput = '';
        _urlError = _messageOf(e);
      }
    });
  }

  void _recomputeHtml() {
    setState(() {
      if (_htmlController.text.isEmpty) {
        _htmlOutput = '';
        _htmlError = null;
        return;
      }
      try {
        final result = _webEncoder.execute(
          WebEncodingInput(text: _htmlController.text, operation: _htmlOperation),
        );
        _htmlOutput = result.output;
        _htmlError = null;
      } catch (e) {
        _htmlOutput = '';
        _htmlError = _messageOf(e);
      }
    });
  }

  void _recomputeRadix() {
    setState(() {
      if (_radixController.text.trim().isEmpty) {
        _radixOutput = '';
        _radixError = null;
        return;
      }
      try {
        final result = _radixConverter.execute(
          RadixConversionInput(value: _radixController.text, fromBase: _radixFromBase, toBase: _radixToBase),
        );
        _radixOutput = result.value;
        _radixError = null;
      } catch (e) {
        _radixOutput = '';
        _radixError = _messageOf(e);
      }
    });
  }

  void _recomputeRoman() {
    setState(() {
      if (_romanController.text.trim().isEmpty) {
        _romanOutput = '';
        _romanError = null;
        return;
      }
      try {
        final result = _romanConverter.execute(
          RomanNumeralInput(value: _romanController.text, operation: _romanOperation),
        );
        _romanOutput = result.value;
        _romanError = null;
      } catch (e) {
        _romanOutput = '';
        _romanError = _messageOf(e);
      }
    });
  }

  void _recomputeTimestamp() {
    setState(() {
      if (_tsController.text.trim().isEmpty) {
        _tsOutput = '';
        _tsError = null;
        return;
      }
      try {
        final result = _timestampConverter.execute(
          TimestampConversionInput(value: _tsController.text, direction: _tsDirection, unit: _tsUnit),
        );
        _tsOutput = result.value;
        _tsError = null;
      } catch (e) {
        _tsOutput = '';
        _tsError = _messageOf(e);
      }
    });
  }

  String _messageOf(Object e) {
    if (e is ArgumentError) return e.message?.toString() ?? e.toString();
    if (e is FormatException) return e.message;
    return e.toString();
  }

  Future<void> _copy(String value) async {
    if (value.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: value));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Copied to clipboard'), duration: Duration(seconds: 1)),
    );
  }

  String? get _activeCopyText {
    switch (_kind) {
      case _ConverterKind.dataFormat:
        return _dfOutput.isEmpty ? null : _dfOutput;
      case _ConverterKind.base64:
        return _b64Output.isEmpty ? null : _b64Output;
      case _ConverterKind.url:
        return _urlOutput.isEmpty ? null : _urlOutput;
      case _ConverterKind.html:
        return _htmlOutput.isEmpty ? null : _htmlOutput;
      case _ConverterKind.radix:
        return _radixOutput.isEmpty ? null : _radixOutput;
      case _ConverterKind.roman:
        return _romanOutput.isEmpty ? null : _romanOutput;
      case _ConverterKind.timestamp:
        return _tsOutput.isEmpty ? null : _tsOutput;
    }
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'Converters & Encoders',
      copyText: _activeCopyText,
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          DropdownButtonFormField<_ConverterKind>(
            isExpanded: true,
            initialValue: _kind,
            decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'Converter'),
            items: [
              for (final kind in _ConverterKind.values)
                DropdownMenuItem(value: kind, child: Text(kind.label)),
            ],
            onChanged: (value) => setState(() => _kind = value ?? _kind),
          ),
          const SizedBox(height: 24),
          _buildActiveInput(context),
        ],
      ),
      outputPanel: _buildActiveOutput(context),
    );
  }

  Widget _buildActiveInput(BuildContext context) {
    switch (_kind) {
      case _ConverterKind.dataFormat:
        return _buildDataFormatInput(context);
      case _ConverterKind.base64:
        return _buildBase64Input(context);
      case _ConverterKind.url:
        return _buildUrlInput(context);
      case _ConverterKind.html:
        return _buildHtmlInput(context);
      case _ConverterKind.radix:
        return _buildRadixInput(context);
      case _ConverterKind.roman:
        return _buildRomanInput(context);
      case _ConverterKind.timestamp:
        return _buildTimestampInput(context);
    }
  }

  Widget _buildActiveOutput(BuildContext context) {
    switch (_kind) {
      case _ConverterKind.dataFormat:
        return _buildOutput(context, output: _dfOutput, error: _dfError, monospace: true);
      case _ConverterKind.base64:
        return _buildOutput(context, output: _b64Output, error: _b64Error, monospace: true);
      case _ConverterKind.url:
        return _buildOutput(context, output: _urlOutput, error: _urlError, monospace: true);
      case _ConverterKind.html:
        return _buildOutput(context, output: _htmlOutput, error: _htmlError, monospace: true);
      case _ConverterKind.radix:
        return _buildOutput(context, output: _radixOutput, error: _radixError, monospace: true);
      case _ConverterKind.roman:
        return _buildOutput(context, output: _romanOutput, error: _romanError, monospace: false);
      case _ConverterKind.timestamp:
        return _buildOutput(context, output: _tsOutput, error: _tsError, monospace: true);
    }
  }

  Widget _buildOutput(
    BuildContext context, {
    required String output,
    required String? error,
    required bool monospace,
  }) {
    if (error != null) {
      return Text(error, style: TextStyle(color: Theme.of(context).colorScheme.error));
    }
    if (output.isEmpty) {
      return Text('Output will appear here.', style: Theme.of(context).textTheme.bodyMedium);
    }
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: SelectableText(
                output,
                style: monospace ? Theme.of(context).textTheme.bodyMedium?.copyWith(fontFamily: 'monospace') : null,
              ),
            ),
            IconButton(
              tooltip: 'Copy output',
              icon: const Icon(Icons.copy, size: 18),
              onPressed: () => _copy(output),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDataFormatInput(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<DataFormat>(
                isExpanded: true,
                initialValue: _dfSourceFormat,
                decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'From'),
                items: [
                  for (final f in DataFormat.values) DropdownMenuItem(value: f, child: Text(f.label)),
                ],
                onChanged: (value) {
                  setState(() => _dfSourceFormat = value ?? _dfSourceFormat);
                  _recomputeDataFormat();
                },
              ),
            ),
            IconButton(
              tooltip: 'Swap',
              icon: const Icon(Icons.swap_horiz),
              onPressed: () {
                setState(() {
                  final tmp = _dfSourceFormat;
                  _dfSourceFormat = _dfTargetFormat;
                  _dfTargetFormat = tmp;
                });
                _recomputeDataFormat();
              },
            ),
            Expanded(
              child: DropdownButtonFormField<DataFormat>(
                isExpanded: true,
                initialValue: _dfTargetFormat,
                decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'To'),
                items: [
                  for (final f in DataFormat.values) DropdownMenuItem(value: f, child: Text(f.label)),
                ],
                onChanged: (value) {
                  setState(() => _dfTargetFormat = value ?? _dfTargetFormat);
                  _recomputeDataFormat();
                },
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _dfSourceController,
          maxLines: 12,
          minLines: 6,
          style: const TextStyle(fontFamily: 'monospace'),
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Paste source data here...'),
        ),
      ],
    );
  }

  Widget _buildBase64Input(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SegmentedButton<Base64Operation>(
          segments: const [
            ButtonSegment(value: Base64Operation.encode, label: Text('Encode'), icon: Icon(Icons.lock_outline)),
            ButtonSegment(value: Base64Operation.decode, label: Text('Decode'), icon: Icon(Icons.lock_open)),
          ],
          selected: {_b64Operation},
          onSelectionChanged: (selection) {
            setState(() => _b64Operation = selection.first);
            _recomputeBase64();
          },
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _b64Controller,
          maxLines: 8,
          minLines: 4,
          style: const TextStyle(fontFamily: 'monospace'),
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Text or Base64 to convert...'),
        ),
      ],
    );
  }

  Widget _buildUrlInput(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SegmentedButton<WebEncodingOperation>(
          segments: const [
            ButtonSegment(value: WebEncodingOperation.urlEncode, label: Text('Encode')),
            ButtonSegment(value: WebEncodingOperation.urlDecode, label: Text('Decode')),
          ],
          selected: {_urlOperation},
          onSelectionChanged: (selection) {
            setState(() => _urlOperation = selection.first);
            _recomputeUrl();
          },
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _urlController,
          maxLines: 6,
          minLines: 3,
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Text or percent-encoded URL...'),
        ),
      ],
    );
  }

  Widget _buildHtmlInput(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SegmentedButton<WebEncodingOperation>(
          segments: const [
            ButtonSegment(value: WebEncodingOperation.htmlEscape, label: Text('Escape')),
            ButtonSegment(value: WebEncodingOperation.htmlUnescape, label: Text('Unescape')),
          ],
          selected: {_htmlOperation},
          onSelectionChanged: (selection) {
            setState(() => _htmlOperation = selection.first);
            _recomputeHtml();
          },
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _htmlController,
          maxLines: 6,
          minLines: 3,
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'HTML text or entities...'),
        ),
      ],
    );
  }

  Widget _buildRadixInput(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<NumberBase>(
                isExpanded: true,
                initialValue: _radixFromBase,
                decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'From base'),
                items: [
                  for (final b in NumberBase.values) DropdownMenuItem(value: b, child: Text(b.name)),
                ],
                onChanged: (value) {
                  setState(() => _radixFromBase = value ?? _radixFromBase);
                  _recomputeRadix();
                },
              ),
            ),
            IconButton(
              tooltip: 'Swap',
              icon: const Icon(Icons.swap_horiz),
              onPressed: () {
                setState(() {
                  final tmp = _radixFromBase;
                  _radixFromBase = _radixToBase;
                  _radixToBase = tmp;
                });
                _recomputeRadix();
              },
            ),
            Expanded(
              child: DropdownButtonFormField<NumberBase>(
                isExpanded: true,
                initialValue: _radixToBase,
                decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'To base'),
                items: [
                  for (final b in NumberBase.values) DropdownMenuItem(value: b, child: Text(b.name)),
                ],
                onChanged: (value) {
                  setState(() => _radixToBase = value ?? _radixToBase);
                  _recomputeRadix();
                },
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _radixController,
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Number in the "From base"...'),
        ),
      ],
    );
  }

  Widget _buildRomanInput(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SegmentedButton<RomanNumeralOperation>(
          segments: const [
            ButtonSegment(value: RomanNumeralOperation.toRoman, label: Text('Decimal → Roman')),
            ButtonSegment(value: RomanNumeralOperation.toDecimal, label: Text('Roman → Decimal')),
          ],
          selected: {_romanOperation},
          onSelectionChanged: (selection) {
            setState(() => _romanOperation = selection.first);
            _recomputeRoman();
          },
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _romanController,
          decoration: InputDecoration(
            border: const OutlineInputBorder(),
            hintText: _romanOperation == RomanNumeralOperation.toRoman ? 'e.g. 1994' : 'e.g. MCMXCIV',
          ),
        ),
      ],
    );
  }

  Widget _buildTimestampInput(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SegmentedButton<TimestampDirection>(
          segments: const [
            ButtonSegment(value: TimestampDirection.epochToIso, label: Text('Epoch → ISO-8601')),
            ButtonSegment(value: TimestampDirection.isoToEpoch, label: Text('ISO-8601 → Epoch')),
          ],
          selected: {_tsDirection},
          onSelectionChanged: (selection) {
            setState(() => _tsDirection = selection.first);
            _recomputeTimestamp();
          },
        ),
        const SizedBox(height: 12),
        Text(
          _tsDirection == TimestampDirection.epochToIso ? 'Input epoch unit' : 'Output epoch unit',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 4),
        SegmentedButton<EpochUnit>(
          segments: const [
            ButtonSegment(value: EpochUnit.seconds, label: Text('Seconds')),
            ButtonSegment(value: EpochUnit.milliseconds, label: Text('Milliseconds')),
          ],
          selected: {_tsUnit},
          onSelectionChanged: (selection) {
            setState(() => _tsUnit = selection.first);
            _recomputeTimestamp();
          },
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _tsController,
          decoration: InputDecoration(
            border: const OutlineInputBorder(),
            hintText: _tsDirection == TimestampDirection.epochToIso
                ? 'Epoch timestamp, e.g. 1704067200'
                : 'ISO-8601 timestamp, e.g. 2024-01-01T00:00:00Z',
          ),
        ),
      ],
    );
  }
}
