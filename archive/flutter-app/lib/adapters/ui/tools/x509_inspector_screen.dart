import 'dart:convert';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';

import '../../../core/utility/x509_inspector.dart';
import '../shell/app_theme.dart';
import '../shell/file_drop_field.dart';
import '../shell/tool_detail_scaffold.dart';

/// "X.509 Certificate Inspector" tool screen.
///
/// ## Input: file or paste, both feed the same pipeline
/// A `.pem`/`.crt`/`.cer` file can be dropped/browsed via [FileDropField],
/// *or* PEM text can be pasted directly into the text area below it — both
/// paths converge on the same [_pemController], which is what actually
/// drives parsing. Dropping a file simply fills the text box with its
/// (possibly DER-derived) PEM text, so either input method, or a mix of
/// both across edits, always shows the same live result.
///
/// Right panel: one card per certificate found — a PEM bundle parses as a
/// chain, and one bad member does not hide the good ones (see
/// [X509InspectResult.errors]). Every exception, including a whole-input
/// parse failure, is caught here and shown inline; nothing escapes to
/// crash the widget tree.
class X509InspectorScreen extends StatefulWidget {
  const X509InspectorScreen({super.key});

  @override
  State<X509InspectorScreen> createState() => _X509InspectorScreenState();
}

class _X509InspectorScreenState extends State<X509InspectorScreen> {
  static const _inspector = X509Inspector();

  final _pemController = TextEditingController();
  String? _loadedFileSummary;

  X509InspectResult? _result;
  String? _wholeInputError;

  @override
  void initState() {
    super.initState();
    _pemController.addListener(_recompute);
  }

  @override
  void dispose() {
    _pemController.dispose();
    super.dispose();
  }

  void _recompute() {
    final text = _pemController.text;
    if (text.trim().isEmpty) {
      setState(() {
        _result = null;
        _wholeInputError = null;
      });
      return;
    }
    try {
      final result = _inspector.execute(X509InspectInput(pemText: text));
      setState(() {
        _result = result;
        _wholeInputError = null;
      });
    } catch (e) {
      // Every failure — malformed PEM, no certificate block at all, an
      // unexpected parser exception — must stay inline, never reach the UI
      // as an unhandled error.
      setState(() {
        _result = null;
        _wholeInputError = _describeError(e);
      });
    }
  }

  String _describeError(Object e) {
    if (e is X509InspectException) return e.message;
    return e.toString();
  }

  void _onFilePicked(List<PickedFileData> files) {
    final file = files.first;
    String text;
    try {
      final decoded = utf8.decode(file.bytes, allowMalformed: true);
      text = decoded.contains(X509Inspector.beginMarker) ? decoded : X509Inspector.derToPem(file.bytes);
    } catch (e) {
      setState(() {
        _loadedFileSummary = '${file.name} · ${formatFileSize(file.byteSize)}';
        _wholeInputError = 'Could not read "${file.name}": $e';
        _result = null;
      });
      return;
    }
    setState(() => _loadedFileSummary = '${file.name} · ${formatFileSize(file.byteSize)}');
    // Setting the text drives _recompute via the controller listener.
    _pemController.text = text;
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'X.509 Certificate Inspector',
      inputPanel: _buildInputPanel(context),
      outputPanel: _buildOutputPanel(context),
    );
  }

  Widget _buildInputPanel(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Certificate file', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        FileDropField(
          onFilesPicked: _onFilePicked,
          acceptedTypes: const [
            XTypeGroup(label: 'Certificates', extensions: ['pem', 'crt', 'cer'], mimeTypes: ['application/x-pem-file', 'application/x-x509-ca-cert']),
          ],
          hint: 'PEM, CRT or CER — a fullchain PEM with multiple certificates works too',
          loadedSummary: _loadedFileSummary,
        ),
        const SizedBox(height: 20),
        Row(
          children: [
            Expanded(child: Divider(color: scheme.outlineVariant)),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10),
              child: Text('or paste PEM text', style: Theme.of(context).textTheme.bodySmall),
            ),
            Expanded(child: Divider(color: scheme.outlineVariant)),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _pemController,
          maxLines: 14,
          minLines: 8,
          style: AppTheme.monospace,
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            hintText: '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----',
            alignLabelWithHint: true,
          ),
        ),
      ],
    );
  }

  Widget _buildOutputPanel(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final result = _result;
    final wholeInputError = _wholeInputError;

    if (wholeInputError != null) {
      return _errorBanner(context, wholeInputError);
    }
    if (result == null) {
      return Text('Load a certificate file or paste PEM text to inspect it here.', style: textTheme.bodyMedium);
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (result.isChain)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              '${result.certificates.length} of ${result.blocksFound} certificate(s) in this bundle parsed successfully.',
              style: textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
          ),
        if (result.errors.isNotEmpty) ...[
          _errorBanner(context, result.errors.join('\n')),
          const SizedBox(height: 16),
        ],
        for (var i = 0; i < result.certificates.length; i++) ...[
          if (i > 0) const SizedBox(height: 16),
          _CertificateCard(cert: result.certificates[i]),
        ],
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

class _CertificateCard extends StatelessWidget {
  const _CertificateCard({required this.cert});

  final CertificateInfo cert;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(cert.displayName, style: textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                ),
                _StatusBadge(cert: cert),
              ],
            ),
            const SizedBox(height: 4),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                if (cert.isSelfSigned) _tag(context, 'Self-signed', Icons.loop),
                if (cert.isCertificateAuthority == true) _tag(context, 'CA', Icons.workspace_premium_outlined),
              ],
            ),
            const Divider(height: 24),
            _section(context, 'Subject', cert.subject.formatted.isEmpty ? '(empty)' : cert.subject.formatted),
            _section(context, 'Issuer', cert.issuer.formatted.isEmpty ? '(empty)' : cert.issuer.formatted),
            const SizedBox(height: 8),
            _twoColumn(
              context,
              _section(context, 'Not before', _formatDate(cert.notBefore)),
              _section(context, 'Not after', _formatDate(cert.notAfter)),
            ),
            _twoColumn(
              context,
              _section(context, 'Serial (hex)', cert.serialNumberHex, mono: true),
              _section(context, 'Serial (decimal)', cert.serialNumberDecimal, mono: true),
            ),
            _twoColumn(
              context,
              _section(context, 'Version', 'v${cert.version}'),
              _section(context, 'Signature algorithm', cert.signatureAlgorithm),
            ),
            _section(context, 'Public key', _publicKeySummary(cert)),
            if (cert.subjectAlternativeNames.isNotEmpty)
              _section(context, 'Subject alternative names', cert.subjectAlternativeNames.join(', ')),
            if (cert.keyUsage.isNotEmpty) _section(context, 'Key usage', cert.keyUsage.join(', ')),
            if (cert.extendedKeyUsage.isNotEmpty)
              _section(context, 'Extended key usage', cert.extendedKeyUsage.join(', ')),
            if (cert.pathLengthConstraint != null)
              _section(context, 'Path length constraint', cert.pathLengthConstraint.toString()),
            if (cert.crlDistributionPoints.isNotEmpty)
              _section(context, 'CRL distribution points', cert.crlDistributionPoints.join('\n')),
            const SizedBox(height: 8),
            Text('Fingerprints', style: textTheme.labelLarge?.copyWith(color: scheme.onSurfaceVariant)),
            const SizedBox(height: 4),
            _fingerprintRow(context, 'SHA-256', cert.sha256Fingerprint),
            _fingerprintRow(context, 'SHA-1', cert.sha1Fingerprint),
            _fingerprintRow(context, 'MD5', cert.md5Fingerprint),
          ],
        ),
      ),
    );
  }

  String _publicKeySummary(CertificateInfo cert) {
    final parts = <String>[cert.publicKeyAlgorithm];
    if (cert.publicKeyBits != null) parts.add('${cert.publicKeyBits} bits');
    if (cert.publicKeyCurve != null) parts.add(cert.publicKeyCurve!);
    if (cert.publicKeyExponent != null) parts.add('exponent ${cert.publicKeyExponent}');
    return parts.join(' · ');
  }

  String _formatDate(DateTime d) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${d.year}-${two(d.month)}-${two(d.day)} ${two(d.hour)}:${two(d.minute)} UTC';
  }

  Widget _twoColumn(BuildContext context, Widget left, Widget right) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: left),
        const SizedBox(width: 16),
        Expanded(child: right),
      ],
    );
  }

  Widget _section(BuildContext context, String label, String value, {bool mono = false}) {
    final textTheme = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant, letterSpacing: 0.3)),
          const SizedBox(height: 2),
          SelectableText(
            value,
            style: textTheme.bodyMedium?.copyWith(fontFamily: mono ? 'monospace' : null),
          ),
        ],
      ),
    );
  }

  Widget _fingerprintRow(BuildContext context, String label, String hex) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 64, child: Text(label, style: Theme.of(context).textTheme.bodySmall)),
          Expanded(
            child: SelectableText(
              hex,
              style: AppTheme.monospace.copyWith(fontSize: 11.5),
            ),
          ),
        ],
      ),
    );
  }

  Widget _tag(BuildContext context, String label, IconData icon) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: scheme.secondaryContainer,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: scheme.onSecondaryContainer),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(fontSize: 11, color: scheme.onSecondaryContainer, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

/// The colored expiry status pill — the one place on this screen where
/// [ColorScheme] roles stand in for "green/amber/red" so it still reads
/// correctly in both light and dark themes.
class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.cert});

  final CertificateInfo cert;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    final IconData icon;
    final Color background;
    final Color foreground;
    final String label;

    switch (cert.status) {
      case CertificateValidityStatus.expired:
        icon = Icons.event_busy;
        background = scheme.errorContainer;
        foreground = scheme.onErrorContainer;
        label = 'Expired ${_daysLabel(-cert.daysUntilExpiry)} ago';
        break;
      case CertificateValidityStatus.notYetValid:
        icon = Icons.hourglass_top;
        background = scheme.secondaryContainer;
        foreground = scheme.onSecondaryContainer;
        label = 'Not yet valid';
        break;
      case CertificateValidityStatus.expiringSoon:
        icon = Icons.warning_amber_rounded;
        background = scheme.tertiaryContainer;
        foreground = scheme.onTertiaryContainer;
        label = 'Expires in ${_daysLabel(cert.daysUntilExpiry)}';
        break;
      case CertificateValidityStatus.valid:
        icon = Icons.verified;
        background = scheme.primaryContainer;
        foreground = scheme.onPrimaryContainer;
        label = 'Valid';
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(20)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: foreground),
          const SizedBox(width: 5),
          Text(label, style: TextStyle(color: foreground, fontWeight: FontWeight.w700, fontSize: 11.5)),
        ],
      ),
    );
  }

  String _daysLabel(int days) => days == 1 ? '1 day' : '$days days';
}
