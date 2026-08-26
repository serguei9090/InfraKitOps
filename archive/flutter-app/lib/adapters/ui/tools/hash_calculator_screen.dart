import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/utility/hash_calculator.dart';
import '../shell/tool_detail_scaffold.dart';

/// "Hash & Checksum Calculator" tool screen (spec section 2.1).
///
/// Left panel: the text to hash plus an optional HMAC secret key. Right
/// panel: every computed digest (MD5 / SHA-1 / SHA-256 / SHA-512 / BLAKE2b-512,
/// and their HMAC counterparts once a secret key is entered), each with its
/// own copy button. Built entirely on the shared [ToolDetailScaffold] so it
/// stays visually consistent with every other tool screen.
class HashCalculatorScreen extends StatefulWidget {
  const HashCalculatorScreen({super.key});

  @override
  State<HashCalculatorScreen> createState() => _HashCalculatorScreenState();
}

class _HashCalculatorScreenState extends State<HashCalculatorScreen> {
  static const _useCase = HashCalculator();

  final _textController = TextEditingController();
  final _secretController = TextEditingController();

  HashCalculatorResult _result = const HashCalculatorResult(digests: [], hmacDigests: []);

  @override
  void initState() {
    super.initState();
    _recompute();
    _textController.addListener(_recompute);
    _secretController.addListener(_recompute);
  }

  @override
  void dispose() {
    _textController.dispose();
    _secretController.dispose();
    super.dispose();
  }

  void _recompute() {
    final secret = _secretController.text;
    setState(() {
      _result = _useCase.execute(
        HashCalculatorInput(
          text: _textController.text,
          hmacSecretKey: secret.isEmpty ? null : secret,
        ),
      );
    });
  }

  String get _allDigestsAsText {
    final buffer = StringBuffer();
    for (final d in _result.digests) {
      buffer.writeln('${d.algorithmLabel}: ${d.hex}');
    }
    for (final d in _result.hmacDigests) {
      buffer.writeln('${d.algorithmLabel}: ${d.hex}');
    }
    return buffer.toString().trimRight();
  }

  Future<void> _copy(String label, String value) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$label copied to clipboard'), duration: const Duration(seconds: 1)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'Hash & Checksum Calculator',
      copyText: _allDigestsAsText.isEmpty ? null : _allDigestsAsText,
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Input', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          TextField(
            controller: _textController,
            maxLines: 8,
            minLines: 4,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: 'Enter text to hash...',
            ),
          ),
          const SizedBox(height: 24),
          Text('HMAC secret key (optional)', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          TextField(
            controller: _secretController,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: 'Leave blank to skip HMAC generation',
              prefixIcon: Icon(Icons.key),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'When set, HMAC-MD5 / HMAC-SHA-1 / HMAC-SHA-256 / HMAC-SHA-512 are '
            'computed for this key alongside the plain digests.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
      outputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Digests', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          for (final d in _result.digests) _DigestRow(digest: d, onCopy: _copy),
          if (_result.hmacDigests.isNotEmpty) ...[
            const SizedBox(height: 24),
            Text('HMAC digests', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final d in _result.hmacDigests) _DigestRow(digest: d, onCopy: _copy),
          ],
        ],
      ),
    );
  }
}

class _DigestRow extends StatelessWidget {
  const _DigestRow({required this.digest, required this.onCopy});

  final HashDigestResult digest;
  final Future<void> Function(String label, String value) onCopy;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(digest.algorithmLabel, style: Theme.of(context).textTheme.labelLarge),
                    const SizedBox(height: 4),
                    SelectableText(
                      digest.hex,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontFamily: 'monospace'),
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'Copy ${digest.algorithmLabel}',
                icon: const Icon(Icons.copy, size: 18),
                onPressed: () => onCopy(digest.algorithmLabel, digest.hex),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
