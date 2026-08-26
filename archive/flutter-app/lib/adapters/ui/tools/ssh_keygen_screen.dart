import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/utility/ssh_key_generator.dart';
import '../shell/tool_detail_scaffold.dart';

/// "SSH Key Pair Generator" tool screen (spec section 2.1).
///
/// Left panel: key type picker (Ed25519 / RSA-4096), an optional comment
/// field, and a Generate button. Right panel: the resulting public key line
/// and private key PEM, each with their own copy button, plus a standing
/// warning banner about this being a developer convenience tool rather than
/// a hardened key-generation appliance.
///
/// Built on the shared [ToolDetailScaffold] split-panel layout.
class SshKeygenScreen extends StatefulWidget {
  const SshKeygenScreen({super.key});

  @override
  State<SshKeygenScreen> createState() => _SshKeygenScreenState();
}

class _SshKeygenScreenState extends State<SshKeygenScreen> {
  static const _generator = SshKeyGenerator();

  final TextEditingController _commentController = TextEditingController();

  SshKeyType _keyType = SshKeyType.ed25519;
  bool _isGenerating = false;
  SshKeyGenResult? _result;
  String? _errorText;

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _generate() async {
    setState(() {
      _isGenerating = true;
      _errorText = null;
    });

    try {
      final result = await _generator.execute(
        SshKeyGenInput(keyType: _keyType, comment: _commentController.text),
      );
      if (!mounted) return;
      setState(() {
        _result = result;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _result = null;
        _errorText = e is UnsupportedError
            ? (e.message ?? e.toString())
            : 'Key generation failed: $e';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isGenerating = false;
        });
      }
    }
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
      title: 'SSH Key Pair Generator',
      copyText: _result?.publicKeyLine,
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Key type', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          SegmentedButton<SshKeyType>(
            segments: const [
              ButtonSegment(value: SshKeyType.ed25519, label: Text('Ed25519'), icon: Icon(Icons.bolt)),
              ButtonSegment(value: SshKeyType.rsa4096, label: Text('RSA-4096'), icon: Icon(Icons.vpn_key)),
            ],
            selected: {_keyType},
            onSelectionChanged: (selection) => setState(() => _keyType = selection.first),
          ),
          if (_keyType == SshKeyType.rsa4096) ...[
            const SizedBox(height: 8),
            Text(
              'RSA-4096 generation is not available in this build — see the '
              'note below. Ed25519 is fully supported.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.error,
                  ),
            ),
          ],
          const SizedBox(height: 20),
          Text('Comment (optional)', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          TextField(
            controller: _commentController,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: 'e.g. you@yourhost',
            ),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _isGenerating ? null : _generate,
            icon: _isGenerating
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.key),
            label: Text(_isGenerating ? 'Generating…' : 'Generate'),
          ),
        ],
      ),
      outputPanel: _buildOutput(context),
    );
  }

  Widget _buildOutput(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    if (_errorText != null) {
      return Card(
        color: scheme.errorContainer,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.info_outline, color: scheme.onErrorContainer),
              const SizedBox(width: 8),
              Expanded(
                child: Text(_errorText!, style: TextStyle(color: scheme.onErrorContainer)),
              ),
            ],
          ),
        ),
      );
    }

    final result = _result;
    if (result == null) {
      return const Text('Pick a key type and press "Generate" to create a key pair.');
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _warningBanner(context),
        const SizedBox(height: 20),
        Text('Public key (OpenSSH wire format)', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        _copyableBlock(context, result.publicKeyLine, tooltip: 'Copy public key'),
        const SizedBox(height: 20),
        Text(
          'Private key (unencrypted OpenSSH "openssh-key-v1" PEM)',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 8),
        _copyableBlock(context, result.privateKeyPem, tooltip: 'Copy private key'),
      ],
    );
  }

  Widget _warningBanner(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.tertiaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.warning_amber_rounded, color: scheme.onTertiaryContainer),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'This is a developer convenience tool, not a hardened '
                'HSM-grade key generator. The private key material is '
                'produced in-process and shown in plain text on screen. '
                'For anything you actually depend on — production servers, '
                'anything you cannot easily rotate — generate the key with '
                '"ssh-keygen" on a trusted machine instead, or at minimum '
                'regenerate this key if you have any doubt about how it was '
                'handled after being displayed here.',
                style: TextStyle(color: scheme.onTertiaryContainer),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _copyableBlock(BuildContext context, String text, {required String tooltip}) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: SelectableText(
                text,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontFamily: 'monospace'),
              ),
            ),
            IconButton(
              tooltip: tooltip,
              icon: const Icon(Icons.copy, size: 18),
              onPressed: () => _copy(text),
            ),
          ],
        ),
      ),
    );
  }
}
