import 'package:flutter/material.dart';

import '../../../core/utility/password_generator.dart';
import '../../../core/utility/password_strength_analyzer.dart';
import '../shell/tool_detail_scaffold.dart';

enum _SecretMode { password, passphrase }

/// Screen for generating passwords and word-based passphrases, built on the
/// shared [ToolDetailScaffold] split-panel layout: length/toggles and a
/// password/passphrase mode switch on the left, the generated secret plus its
/// live strength rating on the right.
class PasswordGeneratorScreen extends StatefulWidget {
  const PasswordGeneratorScreen({super.key});

  @override
  State<PasswordGeneratorScreen> createState() =>
      _PasswordGeneratorScreenState();
}

class _PasswordGeneratorScreenState extends State<PasswordGeneratorScreen> {
  static const PasswordGenerator _passwordGenerator = PasswordGenerator();
  static const PassphraseGenerator _passphraseGenerator = PassphraseGenerator();
  static const PasswordStrengthAnalyzer _strengthAnalyzer =
      PasswordStrengthAnalyzer();

  _SecretMode _mode = _SecretMode.password;

  double _length = 16;
  bool _includeUppercase = true;
  bool _includeLowercase = true;
  bool _includeDigits = true;
  bool _includeSymbols = true;

  double _wordCount = 4;
  bool _capitalizeWords = false;
  bool _includeNumber = false;
  late final TextEditingController _separatorController =
      TextEditingController(text: '-');

  String? _secret;
  PasswordStrengthResult? _strength;
  String? _errorText;

  void _generate() {
    setState(() {
      _errorText = null;
      try {
        final String value;
        if (_mode == _SecretMode.password) {
          value = _passwordGenerator
              .execute(
                PasswordGeneratorInput(
                  length: _length.round(),
                  includeUppercase: _includeUppercase,
                  includeLowercase: _includeLowercase,
                  includeDigits: _includeDigits,
                  includeSymbols: _includeSymbols,
                ),
              )
              .password;
        } else {
          value = _passphraseGenerator
              .execute(
                PassphraseGeneratorInput(
                  wordCount: _wordCount.round(),
                  separator: _separatorController.text,
                  capitalizeWords: _capitalizeWords,
                  includeNumber: _includeNumber,
                ),
              )
              .passphrase;
        }
        _secret = value;
        _strength =
            _strengthAnalyzer.execute(PasswordStrengthInput(password: value));
      } on ArgumentError catch (e) {
        _errorText = e.message?.toString() ?? 'Invalid input';
      }
    });
  }

  @override
  void dispose() {
    _separatorController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'Password & Secret Generator',
      copyText: _secret,
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SegmentedButton<_SecretMode>(
            segments: const [
              ButtonSegment(
                value: _SecretMode.password,
                label: Text('Password'),
                icon: Icon(Icons.password),
              ),
              ButtonSegment(
                value: _SecretMode.passphrase,
                label: Text('Passphrase'),
                icon: Icon(Icons.short_text),
              ),
            ],
            selected: {_mode},
            onSelectionChanged: (selection) =>
                setState(() => _mode = selection.first),
          ),
          const SizedBox(height: 20),
          if (_mode == _SecretMode.password)
            ..._buildPasswordControls(context)
          else
            ..._buildPassphraseControls(context),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _generate,
            icon: const Icon(Icons.auto_awesome),
            label: const Text('Generate'),
          ),
          if (_errorText != null) ...[
            const SizedBox(height: 12),
            Text(
              _errorText!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
        ],
      ),
      outputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Generated secret', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          SelectableText(
            _secret ?? 'Press Generate to create a secret',
            style: const TextStyle(fontFamily: 'monospace', fontSize: 16),
          ),
          const SizedBox(height: 24),
          if (_strength != null) ...[
            Text('Strength', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(Icons.shield, color: _ratingColor(_strength!.rating)),
                const SizedBox(width: 8),
                Text(
                  _ratingLabel(_strength!.rating),
                  style: TextStyle(
                    color: _ratingColor(_strength!.rating),
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(width: 12),
                Text('~${_strength!.entropyBits.toStringAsFixed(1)} bits'),
              ],
            ),
          ],
        ],
      ),
    );
  }

  List<Widget> _buildPasswordControls(BuildContext context) {
    return [
      Text('Length: ${_length.round()}'),
      Slider(
        value: _length,
        min: 4,
        max: 64,
        divisions: 60,
        label: _length.round().toString(),
        onChanged: (value) => setState(() => _length = value),
      ),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Uppercase (A-Z)'),
        value: _includeUppercase,
        onChanged: (value) => setState(() => _includeUppercase = value),
      ),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Lowercase (a-z)'),
        value: _includeLowercase,
        onChanged: (value) => setState(() => _includeLowercase = value),
      ),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Digits (0-9)'),
        value: _includeDigits,
        onChanged: (value) => setState(() => _includeDigits = value),
      ),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Symbols (!@#...)'),
        value: _includeSymbols,
        onChanged: (value) => setState(() => _includeSymbols = value),
      ),
    ];
  }

  List<Widget> _buildPassphraseControls(BuildContext context) {
    return [
      Text('Word count: ${_wordCount.round()}'),
      Slider(
        value: _wordCount,
        min: 3,
        max: 10,
        divisions: 7,
        label: _wordCount.round().toString(),
        onChanged: (value) => setState(() => _wordCount = value),
      ),
      TextField(
        controller: _separatorController,
        decoration: const InputDecoration(
          labelText: 'Separator',
          border: OutlineInputBorder(),
        ),
      ),
      const SizedBox(height: 12),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Capitalize words'),
        value: _capitalizeWords,
        onChanged: (value) => setState(() => _capitalizeWords = value),
      ),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Append a random number'),
        value: _includeNumber,
        onChanged: (value) => setState(() => _includeNumber = value),
      ),
    ];
  }

  Color _ratingColor(PasswordStrengthRating rating) {
    switch (rating) {
      case PasswordStrengthRating.weak:
        return Colors.red;
      case PasswordStrengthRating.fair:
        return Colors.orange;
      case PasswordStrengthRating.strong:
        return Colors.lightGreen;
      case PasswordStrengthRating.veryStrong:
        return Colors.green;
    }
  }

  String _ratingLabel(PasswordStrengthRating rating) {
    switch (rating) {
      case PasswordStrengthRating.weak:
        return 'Weak';
      case PasswordStrengthRating.fair:
        return 'Fair';
      case PasswordStrengthRating.strong:
        return 'Strong';
      case PasswordStrengthRating.veryStrong:
        return 'Very strong';
    }
  }
}
