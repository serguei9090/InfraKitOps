import 'dart:typed_data';

import 'package:image/image.dart' as img;
import 'package:zxing2/qrcode.dart';

import '../ports/i_tool_use_case.dart';

/// Why a decode attempt ended the way it did.
enum QrDecodeStatus {
  /// A barcode was found and its payload read.
  decoded,

  /// The image decoded fine but contains no readable QR code. This is a
  /// normal outcome, not an error — the caller gets a result, not a throw.
  notFound,

  /// The bytes could not be decoded as an image at all (wrong file type,
  /// truncated download, unsupported format).
  unreadableImage,
}

/// One label/value pair of a parsed structured payload, ready to render.
class QrPayloadField {
  const QrPayloadField(this.label, this.value);

  final String label;
  final String value;
}

/// A recognized structured payload, parsed back into its parts.
///
/// These mirror the payload formats
/// `lib/core/office_media/qr_payload_builder.dart` *writes*, so a code this
/// app generated round-trips into a readable breakdown instead of a raw
/// string. Anything unrecognized falls back to [PlainTextQrPayload].
sealed class DecodedQrPayload {
  const DecodedQrPayload();

  /// Human-readable payload kind, e.g. "Wi-Fi network".
  String get kind;

  /// The parsed parts, in display order. Empty values are omitted.
  List<QrPayloadField> get fields;
}

/// `WIFI:T:WPA;S:ssid;P:secret;H:false;;`
class WifiQrPayload extends DecodedQrPayload {
  const WifiQrPayload({
    required this.ssid,
    required this.security,
    required this.password,
    required this.hidden,
  });

  final String ssid;

  /// As written in the payload: `WPA`, `WEP`, `nopass`, or whatever else was
  /// found there — reported verbatim rather than coerced into an enum.
  final String security;

  final String password;
  final bool hidden;

  @override
  String get kind => 'Wi-Fi network';

  @override
  List<QrPayloadField> get fields => [
        QrPayloadField('Network (SSID)', ssid),
        QrPayloadField('Security', security.isEmpty ? 'unspecified' : security),
        if (password.isNotEmpty) QrPayloadField('Password', password),
        QrPayloadField('Hidden network', hidden ? 'yes' : 'no'),
      ];
}

/// `tel:+15551234567`
class PhoneQrPayload extends DecodedQrPayload {
  const PhoneQrPayload(this.number);

  final String number;

  @override
  String get kind => 'Phone number';

  @override
  List<QrPayloadField> get fields => [QrPayloadField('Number', number)];
}

/// `SMSTO:+15551234567:message text`
class SmsQrPayload extends DecodedQrPayload {
  const SmsQrPayload({required this.number, required this.message});

  final String number;
  final String message;

  @override
  String get kind => 'SMS message';

  @override
  List<QrPayloadField> get fields => [
        QrPayloadField('Number', number),
        if (message.isNotEmpty) QrPayloadField('Message', message),
      ];
}

/// `mailto:someone@example.com?subject=...&body=...`
class EmailQrPayload extends DecodedQrPayload {
  const EmailQrPayload({required this.address, required this.subject, required this.body});

  final String address;
  final String subject;
  final String body;

  @override
  String get kind => 'Email';

  @override
  List<QrPayloadField> get fields => [
        QrPayloadField('To', address),
        if (subject.isNotEmpty) QrPayloadField('Subject', subject),
        if (body.isNotEmpty) QrPayloadField('Body', body),
      ];
}

/// `BEGIN:VCARD ... END:VCARD`
class VCardQrPayload extends DecodedQrPayload {
  const VCardQrPayload({
    required this.fullName,
    required this.organization,
    required this.title,
    required this.phone,
    required this.email,
    required this.url,
    required this.address,
  });

  final String fullName;
  final String organization;
  final String title;
  final String phone;
  final String email;
  final String url;

  /// The ADR components rejoined with commas, e.g. "1 Main St, Springfield".
  final String address;

  @override
  String get kind => 'Contact card (vCard)';

  @override
  List<QrPayloadField> get fields => [
        if (fullName.isNotEmpty) QrPayloadField('Name', fullName),
        if (organization.isNotEmpty) QrPayloadField('Organization', organization),
        if (title.isNotEmpty) QrPayloadField('Title', title),
        if (phone.isNotEmpty) QrPayloadField('Phone', phone),
        if (email.isNotEmpty) QrPayloadField('Email', email),
        if (url.isNotEmpty) QrPayloadField('Website', url),
        if (address.isNotEmpty) QrPayloadField('Address', address),
      ];
}

/// `geo:52.5,13.4` or `geo:52.5,13.4,34`
class GeoQrPayload extends DecodedQrPayload {
  const GeoQrPayload({required this.latitude, required this.longitude, this.altitudeMeters});

  final String latitude;
  final String longitude;
  final String? altitudeMeters;

  @override
  String get kind => 'Map location';

  @override
  List<QrPayloadField> get fields => [
        QrPayloadField('Latitude', latitude),
        QrPayloadField('Longitude', longitude),
        if (altitudeMeters != null) QrPayloadField('Altitude (m)', altitudeMeters!),
      ];
}

/// `BEGIN:VEVENT ... END:VEVENT`
class CalendarEventQrPayload extends DecodedQrPayload {
  const CalendarEventQrPayload({
    required this.summary,
    required this.location,
    required this.description,
    required this.start,
    required this.end,
  });

  final String summary;
  final String location;
  final String description;

  /// Raw `DTSTART` / `DTEND` values as written (e.g. `20260824T130000Z`).
  final String start;
  final String end;

  @override
  String get kind => 'Calendar event';

  @override
  List<QrPayloadField> get fields => [
        if (summary.isNotEmpty) QrPayloadField('Title', summary),
        if (start.isNotEmpty) QrPayloadField('Starts', start),
        if (end.isNotEmpty) QrPayloadField('Ends', end),
        if (location.isNotEmpty) QrPayloadField('Location', location),
        if (description.isNotEmpty) QrPayloadField('Description', description),
      ];
}

/// An `http://` / `https://` URL.
class UrlQrPayload extends DecodedQrPayload {
  const UrlQrPayload(this.url);

  final String url;

  @override
  String get kind => 'Web link';

  @override
  List<QrPayloadField> get fields => [QrPayloadField('URL', url)];
}

/// Anything that isn't one of the recognized structured formats.
class PlainTextQrPayload extends DecodedQrPayload {
  const PlainTextQrPayload(this.text);

  final String text;

  @override
  String get kind => 'Plain text';

  @override
  List<QrPayloadField> get fields => [QrPayloadField('Text', text)];
}

/// Outcome of one decode attempt. Never an exception for the ordinary
/// "no QR code in this picture" case — check [status].
class QrDecodeResult {
  const QrDecodeResult({
    required this.status,
    this.text = '',
    this.format,
    this.errorCorrectionLevel,
    this.symbolVersion,
    this.payload,
    this.message,
  });

  /// The clean "there's no QR code here" outcome.
  factory QrDecodeResult.notFound([String? message]) => QrDecodeResult(
        status: QrDecodeStatus.notFound,
        message: message ?? 'No QR code was found in this image.',
      );

  /// The "these bytes aren't a picture" outcome.
  factory QrDecodeResult.unreadableImage([String? message]) => QrDecodeResult(
        status: QrDecodeStatus.unreadableImage,
        message: message ?? 'These bytes could not be decoded as an image.',
      );

  final QrDecodeStatus status;

  /// The raw decoded payload string. Empty unless [status] is
  /// [QrDecodeStatus.decoded].
  final String text;

  /// Barcode symbology reported by the reader — always `BarcodeFormat.qrCode`
  /// here, since only the QR reader is run.
  final BarcodeFormat? format;

  /// `L`, `M`, `Q` or `H`, when the decoder reported it.
  final String? errorCorrectionLevel;

  /// QR symbol version (1..40), when reported.
  final int? symbolVersion;

  /// The structured breakdown of [text], or null when nothing was decoded.
  final DecodedQrPayload? payload;

  /// Human-readable explanation for a non-[QrDecodeStatus.decoded] status.
  final String? message;

  bool get isDecoded => status == QrDecodeStatus.decoded;

  /// `QR Code` — a short display name for [format].
  String get formatLabel => format == BarcodeFormat.qrCode ? 'QR Code' : (format?.name ?? 'unknown');
}

/// Reads a QR code out of an image and, where possible, parses the payload
/// back into structured parts.
///
/// This is the read half of the app's QR support: `QrPayloadBuilder` writes
/// the payload strings and the Flutter layer renders the matrix, while this
/// decodes an image someone dropped in.
///
/// Both dependencies are pure Dart, so this stays core-safe:
///   * `package:image` turns arbitrary PNG/JPEG/etc. bytes into pixels;
///   * `package:zxing2` (a port of Google's ZXing) does detection + decoding
///     via `RGBLuminanceSource` -> `HybridBinarizer` -> `BinaryBitmap` ->
///     `QRCodeReader`.
class QrDecoder implements IToolUseCase<Uint8List, QrDecodeResult> {
  const QrDecoder();

  /// Above this many pixels the source is downscaled before binarization.
  /// A 12-megapixel phone photo of a QR code decodes no better than a 2 MP
  /// one and costs many seconds of luminance conversion.
  static const int _maxPixels = 4000000;

  @override
  QrDecodeResult execute(Uint8List input) => decodeImageBytes(input);

  /// Decodes [bytes] (any format `package:image` supports) and returns the
  /// outcome. Does not throw for ordinary failures — inspect
  /// [QrDecodeResult.status].
  QrDecodeResult decodeImageBytes(Uint8List bytes) {
    if (bytes.isEmpty) {
      return QrDecodeResult.unreadableImage('The file is empty.');
    }

    img.Image? decoded;
    try {
      decoded = img.decodeImage(bytes);
    } catch (e) {
      return QrDecodeResult.unreadableImage('This file could not be read as an image ($e).');
    }
    if (decoded == null) {
      return QrDecodeResult.unreadableImage(
        'This file could not be read as an image. PNG, JPEG, GIF, BMP, TIFF and WebP are supported.',
      );
    }

    if (decoded.width * decoded.height > _maxPixels) {
      final scale = (_maxPixels / (decoded.width * decoded.height));
      final factor = _sqrtApprox(scale);
      final targetWidth = (decoded.width * factor).round().clamp(1, decoded.width);
      try {
        decoded = img.copyResize(decoded, width: targetWidth);
      } catch (_) {
        // Resizing is an optimization; if it fails, decode the original.
      }
    }

    // Null-checked above; the resize branch either reassigns to a non-null
    // result or leaves the original non-null value in place on failure —
    // flow analysis just can't see that across the try/catch.
    return decodePixels(decoded!);
  }

  /// Runs the QR reader over an already-decoded [img.Image].
  QrDecodeResult decodePixels(img.Image image) {
    final width = image.width;
    final height = image.height;
    if (width < 8 || height < 8) {
      return QrDecodeResult.notFound('The image is too small to contain a QR code.');
    }

    final pixels = _toArgb(image);
    final source = RGBLuminanceSource(width, height, pixels);

    // Two passes: the ordinary detector first, then `tryHarder`, which lets
    // ZXing consider rotated/skewed candidates it skips on the fast path.
    for (final hints in [DecodeHints(), DecodeHints()..put(DecodeHintType.tryHarder)]) {
      try {
        final bitmap = BinaryBitmap(HybridBinarizer(source));
        final result = QRCodeReader().decode(bitmap, hints: hints);
        return _resultFrom(result);
      } on NotFoundException {
        continue;
      } on FormatReaderException {
        continue;
      } on ChecksumException {
        return QrDecodeResult.notFound(
          'A QR code was detected but is too damaged to read — try a sharper, straighter image.',
        );
      } catch (_) {
        // ZXing ports occasionally surface range/state errors on hostile
        // input instead of a ReaderException. Treat any of it as "not read".
        continue;
      }
    }

    return QrDecodeResult.notFound();
  }

  QrDecodeResult _resultFrom(Result result) {
    final ec = result.resultMetadata[ResultMetadataType.errorCorrectionLevel];
    return QrDecodeResult(
      status: QrDecodeStatus.decoded,
      text: result.text,
      format: result.format,
      errorCorrectionLevel: ec?.toString(),
      symbolVersion: result.version,
      payload: parsePayload(result.text),
    );
  }

  /// Converts an [img.Image] to the 0xAARRGGBB `Int32List` that
  /// [RGBLuminanceSource] expects, compositing any transparency over white.
  ///
  /// Compositing matters: QR PNGs are routinely exported with a transparent
  /// background, and a transparent pixel read as black would smear the whole
  /// quiet zone into the symbol and make detection fail.
  Int32List _toArgb(img.Image image) {
    final width = image.width;
    final height = image.height;
    final out = Int32List(width * height);
    var i = 0;
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        final pixel = image.getPixel(x, y);
        final a = pixel.a.toInt();
        var r = pixel.r.toInt();
        var g = pixel.g.toInt();
        var b = pixel.b.toInt();
        if (a < 255) {
          final alpha = a / 255.0;
          r = (r * alpha + 255 * (1 - alpha)).round();
          g = (g * alpha + 255 * (1 - alpha)).round();
          b = (b * alpha + 255 * (1 - alpha)).round();
        }
        out[i++] = (0xFF << 24) | ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF);
      }
    }
    return out;
  }

  double _sqrtApprox(double value) {
    if (value <= 0) return 1;
    var guess = value;
    for (var i = 0; i < 24; i++) {
      guess = 0.5 * (guess + value / guess);
    }
    return guess;
  }

  // ------------------------------------------------------- payload parsing

  /// Recognizes the structured payload formats this app generates and parses
  /// [text] back into its parts. Never throws: an almost-but-not-quite
  /// payload degrades to [PlainTextQrPayload] rather than failing.
  DecodedQrPayload parsePayload(String text) {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return PlainTextQrPayload(text);

    final upper = trimmed.toUpperCase();
    try {
      if (upper.startsWith('WIFI:')) return _parseWifi(trimmed);
      if (upper.startsWith('SMSTO:')) return _parseSms(trimmed);
      if (upper.startsWith('TEL:')) return PhoneQrPayload(trimmed.substring(4).trim());
      if (upper.startsWith('MAILTO:')) return _parseMailto(trimmed);
      if (upper.startsWith('BEGIN:VCARD')) return _parseVCard(trimmed);
      if (upper.startsWith('BEGIN:VEVENT')) return _parseVEvent(trimmed);
      if (upper.startsWith('GEO:')) return _parseGeo(trimmed);
      if (upper.startsWith('HTTP://') || upper.startsWith('HTTPS://')) {
        return UrlQrPayload(trimmed);
      }
    } catch (_) {
      // A malformed structured payload is still perfectly good plain text.
      return PlainTextQrPayload(text);
    }
    return PlainTextQrPayload(text);
  }

  DecodedQrPayload _parseWifi(String text) {
    final body = text.substring(5);
    final fields = _splitEscaped(body, ';');

    var ssid = '';
    var password = '';
    var security = '';
    var hidden = false;

    for (final field in fields) {
      if (field.isEmpty) continue;
      final colon = field.indexOf(':');
      if (colon <= 0) continue;
      final key = field.substring(0, colon).toUpperCase();
      final value = _unescapeWifi(field.substring(colon + 1));
      switch (key) {
        case 'S':
          ssid = value;
        case 'P':
          password = value;
        case 'T':
          security = value;
        case 'H':
          hidden = value.toLowerCase() == 'true';
      }
    }

    if (ssid.isEmpty) return PlainTextQrPayload(text);
    return WifiQrPayload(ssid: ssid, security: security, password: password, hidden: hidden);
  }

  DecodedQrPayload _parseSms(String text) {
    // SMSTO:<number>:<message> — the message may itself contain colons, so
    // only the first two are delimiters.
    final body = text.substring(6);
    final colon = body.indexOf(':');
    if (colon == -1) {
      return SmsQrPayload(number: body.trim(), message: '');
    }
    return SmsQrPayload(number: body.substring(0, colon).trim(), message: body.substring(colon + 1));
  }

  DecodedQrPayload _parseMailto(String text) {
    final body = text.substring(7);
    final question = body.indexOf('?');
    final address = (question == -1 ? body : body.substring(0, question)).trim();
    if (address.isEmpty) return PlainTextQrPayload(text);

    var subject = '';
    var mailBody = '';
    if (question != -1) {
      for (final pair in body.substring(question + 1).split('&')) {
        final eq = pair.indexOf('=');
        if (eq <= 0) continue;
        final key = pair.substring(0, eq).toLowerCase();
        final value = _decodeComponent(pair.substring(eq + 1));
        if (key == 'subject') subject = value;
        if (key == 'body') mailBody = value;
      }
    }
    return EmailQrPayload(address: address, subject: subject, body: mailBody);
  }

  DecodedQrPayload _parseGeo(String text) {
    final parts = text.substring(4).split(';').first.split(',');
    if (parts.length < 2) return PlainTextQrPayload(text);
    final lat = parts[0].trim();
    final lon = parts[1].trim();
    if (double.tryParse(lat) == null || double.tryParse(lon) == null) {
      return PlainTextQrPayload(text);
    }
    final alt = parts.length > 2 && double.tryParse(parts[2].trim()) != null ? parts[2].trim() : null;
    return GeoQrPayload(latitude: lat, longitude: lon, altitudeMeters: alt);
  }

  DecodedQrPayload _parseVCard(String text) {
    final props = _icalProperties(text);

    var fullName = props['FN'] ?? '';
    if (fullName.isEmpty && props.containsKey('N')) {
      // N is Family;Given;Additional;Prefix;Suffix.
      final n = _splitEscaped(props['N']!, ';');
      final family = n.isNotEmpty ? n[0] : '';
      final given = n.length > 1 ? n[1] : '';
      fullName = [given, family].where((p) => p.trim().isNotEmpty).join(' ').trim();
    }

    var address = '';
    if (props.containsKey('ADR')) {
      // PO Box;Extended;Street;Locality;Region;Postal;Country
      final parts = _splitEscaped(props['ADR']!, ';').map((p) => p.trim()).where((p) => p.isNotEmpty);
      address = parts.join(', ');
    }

    return VCardQrPayload(
      fullName: fullName,
      organization: props['ORG'] ?? '',
      title: props['TITLE'] ?? '',
      phone: props['TEL'] ?? '',
      email: props['EMAIL'] ?? '',
      url: props['URL'] ?? '',
      address: address,
    );
  }

  DecodedQrPayload _parseVEvent(String text) {
    final props = _icalProperties(text);
    return CalendarEventQrPayload(
      summary: props['SUMMARY'] ?? '',
      location: props['LOCATION'] ?? '',
      description: props['DESCRIPTION'] ?? '',
      start: props['DTSTART'] ?? '',
      end: props['DTEND'] ?? '',
    );
  }

  /// Parses vCard/iCalendar `NAME;PARAM=x:value` lines into a name -> value
  /// map, dropping the parameters and unescaping the value. Later duplicates
  /// of a name are ignored (first wins), matching how the builder emits at
  /// most one of each.
  Map<String, String> _icalProperties(String text) {
    final props = <String, String>{};
    for (final rawLine in text.split(RegExp(r'\r\n|\n|\r'))) {
      final line = rawLine.trim();
      if (line.isEmpty) continue;
      final colon = line.indexOf(':');
      if (colon <= 0) continue;
      var name = line.substring(0, colon);
      final semi = name.indexOf(';');
      if (semi != -1) name = name.substring(0, semi);
      name = name.trim().toUpperCase();
      if (name == 'BEGIN' || name == 'END' || name == 'VERSION') continue;

      final value = line.substring(colon + 1);
      // ADR/N keep their raw semicolons — the caller splits them itself.
      props.putIfAbsent(name, () => (name == 'ADR' || name == 'N') ? value : _unescapeText(value));
    }
    return props;
  }

  /// Splits on [delimiter] while honouring backslash escapes, so a `\;`
  /// inside a Wi-Fi password or a vCard component is not a field break.
  List<String> _splitEscaped(String value, String delimiter) {
    final parts = <String>[];
    final buffer = StringBuffer();
    var escaped = false;
    for (var i = 0; i < value.length; i++) {
      final ch = value[i];
      if (escaped) {
        buffer
          ..write(r'\')
          ..write(ch);
        escaped = false;
      } else if (ch == r'\') {
        escaped = true;
      } else if (ch == delimiter) {
        parts.add(buffer.toString());
        buffer.clear();
      } else {
        buffer.write(ch);
      }
    }
    if (escaped) buffer.write(r'\');
    parts.add(buffer.toString());
    return parts;
  }

  /// Reverses the `WIFI:` payload escaping (`\\`, `\;`, `\,`, `\"`, `\:`).
  String _unescapeWifi(String value) => _unescape(value, expandNewlines: false);

  /// Reverses vCard 3.0 / iCalendar TEXT escaping, including `\n`.
  String _unescapeText(String value) => _unescape(value, expandNewlines: true);

  String _unescape(String value, {required bool expandNewlines}) {
    final buffer = StringBuffer();
    for (var i = 0; i < value.length; i++) {
      final ch = value[i];
      if (ch != r'\' || i + 1 >= value.length) {
        buffer.write(ch);
        continue;
      }
      final next = value[i + 1];
      i++;
      if (expandNewlines && (next == 'n' || next == 'N')) {
        buffer.write('\n');
      } else {
        buffer.write(next);
      }
    }
    return buffer.toString();
  }

  /// Percent-decoding that tolerates a stray `%` rather than throwing.
  String _decodeComponent(String value) {
    try {
      return Uri.decodeComponent(value);
    } catch (_) {
      return value;
    }
  }
}
