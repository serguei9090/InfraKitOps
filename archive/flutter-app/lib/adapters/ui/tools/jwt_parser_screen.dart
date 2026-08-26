import 'package:flutter/material.dart';

import '../../../core/utility/jwt_parser.dart';
import '../shell/app_theme.dart';
import '../shell/tool_detail_scaffold.dart';

/// "JWT Parser & Debugger" tool screen.
///
/// Left panel: the raw compact-serialization token (a `Bearer ` prefix and
/// wrapped whitespace from a terminal copy/paste are tolerated by the core).
/// Right panel: the decoded header and payload as pretty JSON, a claims
/// table with humanized dates for `exp`/`nbf`/`iat`, a valid/expired status
/// chip, and — above everything else, always — the security notice that the
/// signature was never checked.
///
/// ## This screen decodes; it does not verify
///
/// [JwtParser] never performs a cryptographic check, so nothing rendered
/// here should ever be read as "this token is legitimate". The banner
/// built by [_SignatureNotVerifiedBanner] is deliberately the first thing
/// in the output panel, in every state (empty, error, or a fully decoded
/// token), so it can never be scrolled past or missed the way a footnote
/// would be.
class JwtParserScreen extends StatefulWidget {
  const JwtParserScreen({super.key});

  @override
  State<JwtParserScreen> createState() => _JwtParserScreenState();
}

class _JwtParserScreenState extends State<JwtParserScreen> {
  static const _parser = JwtParser();

  final _tokenController = TextEditingController();
  JwtParseResult? _result;

  @override
  void initState() {
    super.initState();
    _tokenController.addListener(_recompute);
  }

  @override
  void dispose() {
    _tokenController.dispose();
    super.dispose();
  }

  void _recompute() {
    final text = _tokenController.text;
    setState(() {
      // An empty box should read as "nothing entered yet", not as an error.
      _result = text.trim().isEmpty ? null : _parser.execute(JwtParseInput(token: text));
    });
  }

  String? get _copyText {
    final result = _result;
    if (result == null || !result.isValidStructure) return null;
    return 'HEADER\n${result.headerJson}\n\nPAYLOAD\n${result.payloadJson}';
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'JWT Parser & Debugger',
      copyText: _copyText,
      inputPanel: _buildInputPanel(context),
      outputPanel: _buildOutputPanel(context),
    );
  }

  Widget _buildInputPanel(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Token', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          'Paste a JWT (header.payload.signature). A "Bearer " prefix and '
          'line-wrapped whitespace are stripped automatically.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _tokenController,
          maxLines: 12,
          minLines: 8,
          style: AppTheme.monospace,
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            hintText: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            alignLabelWithHint: true,
          ),
        ),
      ],
    );
  }

  Widget _buildOutputPanel(BuildContext context) {
    final result = _result;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Always first, always visible — see class doc.
        const _SignatureNotVerifiedBanner(),
        const SizedBox(height: 16),
        if (result == null)
          Text('Enter a token above to decode it here.', style: Theme.of(context).textTheme.bodyMedium)
        else if (!result.isValidStructure)
          _errorBanner(context, result.errorMessage ?? 'This token could not be decoded.')
        else
          _DecodedTokenView(result: result),
      ],
    );
  }

  Widget _errorBanner(BuildContext context, String message) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.error_outline, color: scheme.onErrorContainer),
            const SizedBox(width: 8),
            Expanded(child: Text(message, style: TextStyle(color: scheme.onErrorContainer))),
          ],
        ),
      ),
    );
  }
}

/// The permanent "signature NOT verified" warning. Deliberately its own
/// widget (rather than inline) so it is obviously a fixed fixture of the
/// screen, not something that could be accidentally made conditional.
class _SignatureNotVerifiedBanner extends StatelessWidget {
  const _SignatureNotVerifiedBanner();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.error, width: 1.5),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.gpp_maybe, color: scheme.error, size: 26),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Signature NOT verified',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        color: scheme.onErrorContainer,
                        fontWeight: FontWeight.w800,
                      ),
                ),
                const SizedBox(height: 4),
                Text(
                  JwtParseResult.signatureNotice,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.onErrorContainer),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DecodedTokenView extends StatelessWidget {
  const _DecodedTokenView({required this.result});

  final JwtParseResult result;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            _StatusChip(result: result),
            if (result.isUnsignedAlgorithm) const _UnsignedAlgorithmChip(),
            if (result.algorithm != null) _infoChip(context, 'alg', result.algorithm!),
            if (result.tokenType != null) _infoChip(context, 'typ', result.tokenType!),
            if (result.keyId != null) _infoChip(context, 'kid', result.keyId!),
          ],
        ),
        const SizedBox(height: 20),
        if (result.registeredClaims.isNotEmpty) ...[
          Text('Registered claims', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          _ClaimsTable(claims: result.registeredClaims),
          const SizedBox(height: 20),
        ],
        Text('Header', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        _JsonBlock(json: result.headerJson),
        const SizedBox(height: 20),
        Text('Payload', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        _JsonBlock(json: result.payloadJson),
      ],
    );
  }

  Widget _infoChip(BuildContext context, String label, String value) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Text.rich(
        TextSpan(
          children: [
            TextSpan(text: '$label ', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12)),
            TextSpan(
              text: value,
              style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w600, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.result});

  final JwtParseResult result;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    final IconData icon;
    final Color background;
    final Color foreground;
    final String label;

    switch (result.temporalStatus) {
      case JwtTemporalStatus.expired:
        icon = Icons.event_busy;
        background = scheme.errorContainer;
        foreground = scheme.onErrorContainer;
        label = result.timeUntilExpiry != null
            ? 'Expired ${formatJwtDuration(result.timeUntilExpiry!)} ago'
            : 'Expired';
        break;
      case JwtTemporalStatus.notYetValid:
        icon = Icons.hourglass_top;
        background = scheme.secondaryContainer;
        foreground = scheme.onSecondaryContainer;
        label = result.timeUntilValid != null
            ? 'Not yet valid — usable in ${formatJwtDuration(result.timeUntilValid!)}'
            : 'Not yet valid';
        break;
      case JwtTemporalStatus.valid:
        icon = Icons.check_circle;
        background = scheme.primaryContainer;
        foreground = scheme.onPrimaryContainer;
        label = result.timeUntilExpiry != null
            ? 'Valid — expires in ${formatJwtDuration(result.timeUntilExpiry!)}'
            : 'Valid (no expiry claim)';
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(20)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: foreground),
          const SizedBox(width: 6),
          Text(label, style: TextStyle(color: foreground, fontWeight: FontWeight.w700, fontSize: 12)),
        ],
      ),
    );
  }
}

class _UnsignedAlgorithmChip extends StatelessWidget {
  const _UnsignedAlgorithmChip();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Tooltip(
      message: 'alg is "none" or the signature segment is empty — the classic '
          'unsecured-JWT forgery vector (CVE-2015-9235 family).',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(color: scheme.error, borderRadius: BorderRadius.circular(20)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.warning_amber_rounded, size: 16, color: scheme.onError),
            const SizedBox(width: 6),
            Text(
              'Unsigned (alg: none)',
              style: TextStyle(color: scheme.onError, fontWeight: FontWeight.w700, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}

class _ClaimsTable extends StatelessWidget {
  const _ClaimsTable({required this.claims});

  final List<JwtRegisteredClaim> claims;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Column(
        children: [
          for (var i = 0; i < claims.length; i++) ...[
            if (i > 0) Divider(height: 1, color: scheme.outlineVariant),
            _claimRow(context, claims[i]),
          ],
        ],
      ),
    );
  }

  Widget _claimRow(BuildContext context, JwtRegisteredClaim claim) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final isDate = claim.dateTime != null;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 130,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  claim.label,
                  style: textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
                ),
                Text(
                  claim.name,
                  style: textTheme.bodySmall?.copyWith(
                    fontFamily: 'monospace',
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SelectableText(
                  claim.displayValue,
                  style: textTheme.bodyMedium?.copyWith(
                    fontFamily: isDate ? 'monospace' : null,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(claim.meaning, style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _JsonBlock extends StatelessWidget {
  const _JsonBlock({required this.json});

  final String json;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: SelectableText(json, style: AppTheme.monospace),
    );
  }
}
