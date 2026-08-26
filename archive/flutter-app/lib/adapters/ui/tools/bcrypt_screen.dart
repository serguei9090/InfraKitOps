import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/utility/bcrypt_tool.dart';
import '../shell/tool_detail_scaffold.dart';

enum _BcryptMode { hash, verify }

/// "bcrypt Hash & Verify" tool screen (spec section 2.1).
///
/// bcrypt is one-way and self-salting, so unlike the generic hash list it
/// gets a small two-mode screen of its own:
/// - Hash mode: plaintext in, a fresh salted bcrypt hash out.
/// - Verify mode: plaintext + an existing bcrypt hash in, a match/no-match
///   result out (recomputed using the salt embedded in that hash).
///
/// Built on the shared [ToolDetailScaffold] for visual consistency with the
/// rest of the app.
class BcryptScreen extends StatefulWidget {
  const BcryptScreen({super.key});

  @override
  State<BcryptScreen> createState() => _BcryptScreenState();
}

class _BcryptScreenState extends State<BcryptScreen> {
  static const _hasher = BcryptHasher();
  static const _verifier = BcryptVerifier();

  _BcryptMode _mode = _BcryptMode.hash;

  final _hashPlaintextController = TextEditingController();
  double _logRounds = kBcryptDefaultLogRounds.toDouble();

  final _verifyPlaintextController = TextEditingController();
  final _verifyHashController = TextEditingController();

  String? _hashOutput;
  String? _hashError;

  bool? _verifyMatches;
  String? _verifyError;

  @override
  void dispose() {
    _hashPlaintextController.dispose();
    _verifyPlaintextController.dispose();
    _verifyHashController.dispose();
    super.dispose();
  }

  void _runHash() {
    setState(() {
      _hashError = null;
      _hashOutput = null;
      try {
        final result = _hasher.execute(
          BcryptHashInput(plaintext: _hashPlaintextController.text, logRounds: _logRounds.round()),
        );
        _hashOutput = result.hash;
      } on ArgumentError catch (e) {
        _hashError = e.message?.toString() ?? e.toString();
      }
    });
  }

  void _runVerify() {
    setState(() {
      _verifyError = null;
      _verifyMatches = null;
      try {
        final result = _verifier.execute(
          BcryptVerifyInput(plaintext: _verifyPlaintextController.text, hash: _verifyHashController.text),
        );
        _verifyMatches = result.matches;
      } catch (e) {
        _verifyError = 'Could not evaluate that hash: $e';
      }
    });
  }

  Future<void> _copy(String value) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Copied to clipboard'), duration: Duration(seconds: 1)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'bcrypt Hash & Verify',
      copyText: _mode == _BcryptMode.hash ? _hashOutput : null,
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SegmentedButton<_BcryptMode>(
            segments: const [
              ButtonSegment(value: _BcryptMode.hash, label: Text('Hash'), icon: Icon(Icons.enhanced_encryption)),
              ButtonSegment(value: _BcryptMode.verify, label: Text('Verify'), icon: Icon(Icons.fact_check)),
            ],
            selected: {_mode},
            onSelectionChanged: (selection) => setState(() => _mode = selection.first),
          ),
          const SizedBox(height: 24),
          if (_mode == _BcryptMode.hash) _buildHashInputs(context) else _buildVerifyInputs(context),
        ],
      ),
      outputPanel: _mode == _BcryptMode.hash ? _buildHashOutput(context) : _buildVerifyOutput(context),
    );
  }

  Widget _buildHashInputs(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Plaintext', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _hashPlaintextController,
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Password or secret to hash'),
          onSubmitted: (_) => _runHash(),
        ),
        const SizedBox(height: 16),
        Text('Cost factor (log2 rounds): ${_logRounds.round()}', style: Theme.of(context).textTheme.bodyMedium),
        Slider(
          value: _logRounds,
          min: kBcryptMinLogRounds.toDouble(),
          max: 16, // higher costs are valid but impractically slow for an interactive UI
          divisions: 16 - kBcryptMinLogRounds,
          label: '${_logRounds.round()}',
          onChanged: (v) => setState(() => _logRounds = v),
        ),
        const SizedBox(height: 8),
        FilledButton.icon(
          onPressed: _runHash,
          icon: const Icon(Icons.enhanced_encryption),
          label: const Text('Generate bcrypt hash'),
        ),
      ],
    );
  }

  Widget _buildHashOutput(BuildContext context) {
    if (_hashError != null) {
      return Text(_hashError!, style: TextStyle(color: Theme.of(context).colorScheme.error));
    }
    if (_hashOutput == null) {
      return const Text('Enter a plaintext and press "Generate bcrypt hash".');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('bcrypt hash', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Expanded(
                  child: SelectableText(
                    _hashOutput!,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontFamily: 'monospace'),
                  ),
                ),
                IconButton(
                  tooltip: 'Copy hash',
                  icon: const Icon(Icons.copy, size: 18),
                  onPressed: () => _copy(_hashOutput!),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildVerifyInputs(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Plaintext', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _verifyPlaintextController,
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Password to check'),
        ),
        const SizedBox(height: 16),
        Text('Existing bcrypt hash', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _verifyHashController,
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: r'$2a$10$...'),
          style: const TextStyle(fontFamily: 'monospace'),
        ),
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: _runVerify,
          icon: const Icon(Icons.fact_check),
          label: const Text('Verify'),
        ),
      ],
    );
  }

  Widget _buildVerifyOutput(BuildContext context) {
    if (_verifyError != null) {
      return Text(_verifyError!, style: TextStyle(color: Theme.of(context).colorScheme.error));
    }
    if (_verifyMatches == null) {
      return const Text('Enter a plaintext and a bcrypt hash, then press "Verify".');
    }
    final matches = _verifyMatches!;
    final scheme = Theme.of(context).colorScheme;
    return Row(
      children: [
        Icon(matches ? Icons.check_circle : Icons.cancel, color: matches ? Colors.green : scheme.error, size: 32),
        const SizedBox(width: 12),
        Text(
          matches ? 'Match' : 'No match',
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                color: matches ? Colors.green : scheme.error,
              ),
        ),
      ],
    );
  }
}
