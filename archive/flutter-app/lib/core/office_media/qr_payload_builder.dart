import '../ports/i_tool_use_case.dart';

/// Wi-Fi network security modes a QR "network config" payload can advertise.
enum WifiSecurityType {
  wpa,
  wep,

  /// Open network — no password. The payload's `P:` field is omitted
  /// entirely for this mode.
  nopass,
}

/// Union of the payload shapes [QrPayloadBuilder] knows how to build.
///
/// Sealed so `switch` in [QrPayloadBuilder.execute] is exhaustive at compile
/// time if a new variant is ever added.
sealed class QrPayloadInput {
  const QrPayloadInput();
}

/// Arbitrary text or URL — the payload is the text itself, unchanged.
class PlainTextQrInput extends QrPayloadInput {
  const PlainTextQrInput(this.text);

  final String text;
}

/// A Wi-Fi network to encode using the widely-supported
/// `WIFI:T:...;S:...;P:...;H:...;;` payload format that Android/iOS camera
/// apps recognize and offer to auto-join.
class WifiNetworkQrInput extends QrPayloadInput {
  const WifiNetworkQrInput({
    required this.ssid,
    this.password = '',
    this.security = WifiSecurityType.wpa,
    this.hidden = false,
  });

  final String ssid;
  final String password;
  final WifiSecurityType security;
  final bool hidden;
}

/// A phone number to encode as an RFC 3966 `tel:` URI, so scanning offers to
/// place a call.
class PhoneNumberQrInput extends QrPayloadInput {
  const PhoneNumberQrInput(this.number);

  /// Free-form as typed; visual separators are stripped during build.
  final String number;
}

/// A pre-composed SMS, encoded as `SMSTO:<number>:<message>` — the de-facto
/// form ZXing and virtually every phone camera app understands.
class SmsQrInput extends QrPayloadInput {
  const SmsQrInput({required this.number, this.message = ''});

  final String number;
  final String message;
}

/// A pre-composed email, encoded as an RFC 6068 `mailto:` URI with optional
/// percent-encoded `subject` / `body` query parameters.
class EmailQrInput extends QrPayloadInput {
  const EmailQrInput({
    required this.address,
    this.subject = '',
    this.body = '',
  });

  final String address;
  final String subject;
  final String body;
}

/// A contact card, encoded as a vCard 3.0 (RFC 2426) `BEGIN:VCARD` record.
///
/// vCard 3.0 rather than 4.0 because iOS Camera, Google Lens and the Android
/// stock scanners all import 3.0 reliably, whereas 4.0 support is patchy.
class VCardQrInput extends QrPayloadInput {
  const VCardQrInput({
    this.firstName = '',
    this.lastName = '',
    this.organization = '',
    this.title = '',
    this.phone = '',
    this.email = '',
    this.url = '',
    this.street = '',
    this.city = '',
    this.region = '',
    this.postalCode = '',
    this.country = '',
  });

  final String firstName;
  final String lastName;
  final String organization;
  final String title;
  final String phone;
  final String email;
  final String url;
  final String street;
  final String city;
  final String region;
  final String postalCode;
  final String country;

  bool get hasAddress =>
      street.isNotEmpty ||
      city.isNotEmpty ||
      region.isNotEmpty ||
      postalCode.isNotEmpty ||
      country.isNotEmpty;
}

/// A map coordinate, encoded as an RFC 5870 `geo:` URI.
class GeoLocationQrInput extends QrPayloadInput {
  const GeoLocationQrInput({
    required this.latitude,
    required this.longitude,
    this.altitudeMeters,
  });

  /// Decimal degrees, -90..90.
  final double latitude;

  /// Decimal degrees, -180..180.
  final double longitude;

  /// Optional third coordinate component, in meters.
  final double? altitudeMeters;
}

/// A calendar entry, encoded as a bare iCalendar `BEGIN:VEVENT` block —
/// the shape ZXing's `VEventResultParser` (and therefore most scanners)
/// expects inside a QR code.
class CalendarEventQrInput extends QrPayloadInput {
  const CalendarEventQrInput({
    required this.summary,
    required this.start,
    required this.end,
    this.location = '',
    this.description = '',
  });

  final String summary;
  final DateTime start;
  final DateTime end;
  final String location;
  final String description;
}

/// Builds the correctly-formatted string payloads QR codes commonly encode.
///
/// This is deliberately just the *payload construction* — turning structured
/// input (a Wi-Fi network, a contact, some text) into the exact string a
/// QR-rendering widget should encode. The actual QR matrix rendering happens
/// in the Flutter adapter layer via the `qr_flutter` package, which is a UI
/// widget library and therefore cannot live in `lib/core`.
class QrPayloadBuilder implements IToolUseCase<QrPayloadInput, String> {
  const QrPayloadBuilder();

  /// vCard and iCalendar both mandate CRLF line breaks (RFC 2426 §2.1,
  /// RFC 5545 §3.1). Scanners tolerate bare LF, but there's no reason to be
  /// out of spec.
  static const String _crlf = '\r\n';

  @override
  String execute(QrPayloadInput input) {
    return switch (input) {
      PlainTextQrInput(:final text) => text,
      WifiNetworkQrInput() => _buildWifiPayload(input),
      PhoneNumberQrInput() => _buildTelPayload(input),
      SmsQrInput() => _buildSmsPayload(input),
      EmailQrInput() => _buildMailtoPayload(input),
      VCardQrInput() => _buildVCardPayload(input),
      GeoLocationQrInput() => _buildGeoPayload(input),
      CalendarEventQrInput() => _buildVEventPayload(input),
    };
  }

  // ---------------------------------------------------------------- Wi-Fi

  String _buildWifiPayload(WifiNetworkQrInput input) {
    if (input.ssid.isEmpty) {
      throw ArgumentError('ssid must not be empty');
    }

    final buffer = StringBuffer('WIFI:');
    buffer.write('T:${_securityCode(input.security)};');
    buffer.write('S:${_escape(input.ssid)};');
    if (input.security != WifiSecurityType.nopass) {
      buffer.write('P:${_escape(input.password)};');
    }
    buffer.write('H:${input.hidden};');
    buffer.write(';'); // terminates the whole record, per the WIFI: spec

    return buffer.toString();
  }

  String _securityCode(WifiSecurityType security) {
    switch (security) {
      case WifiSecurityType.wpa:
        return 'WPA';
      case WifiSecurityType.wep:
        return 'WEP';
      case WifiSecurityType.nopass:
        return 'nopass';
    }
  }

  /// Escapes the characters the `WIFI:` payload format treats as field
  /// delimiters/quoting: `\`, `;`, `,` and `"`. Backslash is escaped first
  /// so escaping the other characters afterwards doesn't double-escape it.
  String _escape(String value) {
    return value
        .replaceAll(r'\', r'\\')
        .replaceAll(';', r'\;')
        .replaceAll(',', r'\,')
        .replaceAll('"', r'\"');
  }

  // ------------------------------------------------------------ tel: / SMS

  String _buildTelPayload(PhoneNumberQrInput input) {
    return 'tel:${normalizePhoneNumber(input.number)}';
  }

  String _buildSmsPayload(SmsQrInput input) {
    final number = normalizePhoneNumber(input.number);
    // `SMSTO:` has no escaping convention; parsers split on the first two
    // colons only, so a message may contain colons freely. Embedded line
    // breaks *would* corrupt the record, so they are folded to spaces.
    final message = input.message.replaceAll(RegExp(r'[\r\n]+'), ' ');
    return 'SMSTO:$number:$message';
  }

  /// Strips the RFC 3966 "visual separators" (spaces, dashes, dots,
  /// parentheses) that scanners choke on, keeping a leading `+` and digits.
  ///
  /// Throws [ArgumentError] if nothing dialable remains.
  static String normalizePhoneNumber(String raw) {
    final trimmed = raw.trim();
    final isInternational = trimmed.startsWith('+');
    final digits = trimmed.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.isEmpty) {
      throw ArgumentError('Enter a phone number (digits only, optional +).');
    }
    return isInternational ? '+$digits' : digits;
  }

  // -------------------------------------------------------------- mailto:

  /// Deliberately permissive but structural: exactly one `@`, no whitespace
  /// or URI delimiters, and a dotted domain.
  static final RegExp _emailPattern = RegExp(
    r'^[^\s@,;:<>"]+@[^\s@,;:<>"]+\.[^\s@,;:<>"]+$',
  );

  static bool isValidEmail(String address) =>
      _emailPattern.hasMatch(address.trim());

  String _buildMailtoPayload(EmailQrInput input) {
    final address = input.address.trim();
    if (address.isEmpty) {
      throw ArgumentError('Enter an email address.');
    }
    if (!isValidEmail(address)) {
      throw ArgumentError('"$address" is not a valid email address.');
    }

    // RFC 6068 allows the addr-spec to appear literally; only the hfields
    // need percent-encoding. Uri.encodeComponent escapes space as %20 (not
    // `+`), which is what RFC 6068 requires, and escapes `&`, `?`, `=`, `#`
    // and `+` so they can't be mistaken for query syntax.
    final params = <String>[
      if (input.subject.isNotEmpty)
        'subject=${Uri.encodeComponent(input.subject)}',
      if (input.body.isNotEmpty) 'body=${Uri.encodeComponent(input.body)}',
    ];

    return params.isEmpty
        ? 'mailto:$address'
        : 'mailto:$address?${params.join('&')}';
  }

  // ---------------------------------------------------------------- vCard

  String _buildVCardPayload(VCardQrInput input) {
    final first = input.firstName.trim();
    final last = input.lastName.trim();
    if (first.isEmpty && last.isEmpty) {
      throw ArgumentError('Enter at least a first or last name.');
    }

    final lines = <String>[
      'BEGIN:VCARD',
      'VERSION:3.0',
      // N is a structured value: Family;Given;Additional;Prefix;Suffix.
      // Every component is escaped independently so a comma or semicolon
      // inside one can't be read as a delimiter.
      'N:${_escapeVCard(last)};${_escapeVCard(first)};;;',
      'FN:${_escapeVCard([first, last].where((p) => p.isNotEmpty).join(' '))}',
      if (input.organization.trim().isNotEmpty)
        'ORG:${_escapeVCard(input.organization.trim())}',
      if (input.title.trim().isNotEmpty)
        'TITLE:${_escapeVCard(input.title.trim())}',
      if (input.phone.trim().isNotEmpty)
        'TEL;TYPE=CELL,VOICE:${normalizePhoneNumber(input.phone)}',
      if (input.email.trim().isNotEmpty)
        'EMAIL;TYPE=INTERNET:${_validatedVCardEmail(input.email)}',
      if (input.url.trim().isNotEmpty) 'URL:${_escapeVCard(input.url.trim())}',
      if (input.hasAddress) _vCardAdrLine(input),
      'END:VCARD',
    ];

    return lines.join(_crlf);
  }

  String _validatedVCardEmail(String email) {
    final address = email.trim();
    if (!isValidEmail(address)) {
      throw ArgumentError('"$address" is not a valid email address.');
    }
    return address;
  }

  String _vCardAdrLine(VCardQrInput input) {
    // ADR structured value:
    // PO Box;Extended;Street;Locality;Region;Postal Code;Country
    final components = [
      '', // PO box — not collected
      '', // extended address — not collected
      input.street.trim(),
      input.city.trim(),
      input.region.trim(),
      input.postalCode.trim(),
      input.country.trim(),
    ].map(_escapeVCard).join(';');
    return 'ADR;TYPE=HOME:$components';
  }

  /// RFC 2426 §2 text escaping: backslash, semicolon, comma and newline.
  /// Backslash goes first so the later replacements aren't double-escaped.
  ///
  /// Colons are intentionally *not* escaped: RFC 2426's own text grammar
  /// admits a bare `:` and every real-world generator/parser (and `URL:`
  /// values such as `https://…`) depends on that.
  String _escapeVCard(String value) => _escapeStructuredText(value);

  // ------------------------------------------------------------------ geo

  String _buildGeoPayload(GeoLocationQrInput input) {
    final lat = input.latitude;
    final lon = input.longitude;
    if (lat.isNaN || lat < -90 || lat > 90) {
      throw ArgumentError('Latitude must be between -90 and 90.');
    }
    if (lon.isNaN || lon < -180 || lon > 180) {
      throw ArgumentError('Longitude must be between -180 and 180.');
    }

    final buffer = StringBuffer('geo:')
      ..write(_formatCoordinate(lat))
      ..write(',')
      ..write(_formatCoordinate(lon));

    final alt = input.altitudeMeters;
    if (alt != null) {
      if (alt.isNaN || alt.isInfinite) {
        throw ArgumentError('Altitude must be a number.');
      }
      buffer
        ..write(',')
        ..write(_formatCoordinate(alt));
    }

    return buffer.toString();
  }

  /// Fixed-notation decimal (never `1e-7`), with trailing zeros trimmed —
  /// RFC 5870 `num` doesn't permit exponents.
  String _formatCoordinate(double value) {
    var text = value.toStringAsFixed(6);
    if (text.contains('.')) {
      text = text.replaceFirst(RegExp(r'0+$'), '');
      text = text.replaceFirst(RegExp(r'\.$'), '');
    }
    return text == '-0' ? '0' : text;
  }

  // --------------------------------------------------------------- VEVENT

  String _buildVEventPayload(CalendarEventQrInput input) {
    final summary = input.summary.trim();
    if (summary.isEmpty) {
      throw ArgumentError('Enter an event title.');
    }
    if (input.end.isBefore(input.start)) {
      throw ArgumentError('The event end must not be before its start.');
    }

    final lines = <String>[
      'BEGIN:VEVENT',
      'SUMMARY:${_escapeICal(summary)}',
      if (input.location.trim().isNotEmpty)
        'LOCATION:${_escapeICal(input.location.trim())}',
      if (input.description.trim().isNotEmpty)
        'DESCRIPTION:${_escapeICal(input.description.trim())}',
      'DTSTART:${formatICalUtc(input.start)}',
      'DTEND:${formatICalUtc(input.end)}',
      'END:VEVENT',
    ];

    return lines.join(_crlf);
  }

  /// RFC 5545 UTC `DATE-TIME` form: `YYYYMMDDTHHMMSSZ`.
  static String formatICalUtc(DateTime value) {
    final utc = value.toUtc();
    String two(int v) => v.toString().padLeft(2, '0');
    return '${utc.year.toString().padLeft(4, '0')}'
        '${two(utc.month)}${two(utc.day)}'
        'T${two(utc.hour)}${two(utc.minute)}${two(utc.second)}Z';
  }

  /// RFC 5545 §3.3.11 TEXT escaping — the same four rules as vCard 3.0.
  String _escapeICal(String value) => _escapeStructuredText(value);

  /// Shared backslash-escaping used by both vCard 3.0 (RFC 2426 §2) and
  /// iCalendar (RFC 5545 §3.3.11): `\` → `\\`, `;` → `\;`, `,` → `\,`, and
  /// any line break → the literal two-character sequence `\n`.
  String _escapeStructuredText(String value) {
    return value
        .replaceAll(r'\', r'\\')
        .replaceAll(';', r'\;')
        .replaceAll(',', r'\,')
        .replaceAll('\r\n', r'\n')
        .replaceAll('\n', r'\n')
        .replaceAll('\r', r'\n');
  }
}
