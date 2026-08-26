import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/office_media/qr_payload_builder.dart';

void main() {
  const builder = QrPayloadBuilder();

  group('PlainTextQrInput', () {
    test('passes text/URL payloads through unchanged', () {
      const input = PlainTextQrInput('https://example.com/path?x=1&y=2');
      expect(builder.execute(input), 'https://example.com/path?x=1&y=2');
    });

    test('passes arbitrary plain text through unchanged', () {
      const input = PlainTextQrInput('Just some plain text, with punctuation!');
      expect(
        builder.execute(input),
        'Just some plain text, with punctuation!',
      );
    });
  });

  group('WifiNetworkQrInput', () {
    test('builds a standard WPA payload', () {
      const input = WifiNetworkQrInput(
        ssid: 'MyHomeNetwork',
        password: 'sup3rSecret',
      );

      expect(
        builder.execute(input),
        'WIFI:T:WPA;S:MyHomeNetwork;P:sup3rSecret;H:false;;',
      );
    });

    test('escapes special characters (; , " \\) in SSID and password', () {
      const input = WifiNetworkQrInput(
        ssid: 'Weird;SSID,"Name"',
        password: r'p\a;s,s"word',
        security: WifiSecurityType.wpa,
      );

      final payload = builder.execute(input);

      expect(
        payload,
        r'WIFI:T:WPA;S:Weird\;SSID\,\"Name\";P:p\\a\;s\,s\"word;H:false;;',
      );
    });

    test('escapes a literal backslash first so it is not double-escaped', () {
      const input = WifiNetworkQrInput(ssid: r'back\slash');
      final payload = builder.execute(input);
      expect(payload, contains(r'S:back\\slash;'));
    });

    test('nopass security omits the P: field entirely', () {
      const input = WifiNetworkQrInput(
        ssid: 'OpenNetwork',
        security: WifiSecurityType.nopass,
      );

      final payload = builder.execute(input);

      expect(payload, 'WIFI:T:nopass;S:OpenNetwork;H:false;;');
      expect(payload, isNot(contains('P:')));
    });

    test('WEP security uses the WEP security code', () {
      const input = WifiNetworkQrInput(
        ssid: 'OldRouter',
        password: 'wepkey123',
        security: WifiSecurityType.wep,
      );

      expect(
        builder.execute(input),
        'WIFI:T:WEP;S:OldRouter;P:wepkey123;H:false;;',
      );
    });

    test('hidden network sets H:true', () {
      const input = WifiNetworkQrInput(
        ssid: 'HiddenNet',
        password: 'hunter2',
        hidden: true,
      );

      expect(
        builder.execute(input),
        'WIFI:T:WPA;S:HiddenNet;P:hunter2;H:true;;',
      );
    });

    test('rejects an empty SSID', () {
      expect(
        () => builder.execute(const WifiNetworkQrInput(ssid: '')),
        throwsArgumentError,
      );
    });
  });

  group('PhoneNumberQrInput', () {
    test('builds a tel: URI keeping the international + prefix', () {
      expect(
        builder.execute(const PhoneNumberQrInput('+1 (212) 555-1212')),
        'tel:+12125551212',
      );
    });

    test('strips visual separators from a national number', () {
      expect(
        builder.execute(const PhoneNumberQrInput('0151 123-456.78')),
        'tel:015112345678',
      );
    });

    test('rejects input with no digits', () {
      expect(
        () => builder.execute(const PhoneNumberQrInput('not a number')),
        throwsArgumentError,
      );
    });
  });

  group('SmsQrInput', () {
    test('builds SMSTO:<number>:<message>', () {
      expect(
        builder.execute(
          const SmsQrInput(number: '+1 800 555 1212', message: 'Hello there'),
        ),
        'SMSTO:+18005551212:Hello there',
      );
    });

    test('leaves the message trailing colon-free but allows inner colons', () {
      // Parsers split on the first two colons only, so colons in the body
      // are passed through verbatim rather than escaped.
      expect(
        builder.execute(
          const SmsQrInput(number: '5551212', message: 'ETA: 12:30, bring keys'),
        ),
        'SMSTO:5551212:ETA: 12:30, bring keys',
      );
    });

    test('omits the message when empty, leaving a trailing colon', () {
      expect(
        builder.execute(const SmsQrInput(number: '+15551212')),
        'SMSTO:+15551212:',
      );
    });

    test('folds embedded newlines to spaces so the record stays intact', () {
      expect(
        builder.execute(
          const SmsQrInput(number: '5551212', message: 'line one\r\nline two'),
        ),
        'SMSTO:5551212:line one line two',
      );
    });

    test('rejects a number with no digits', () {
      expect(
        () => builder.execute(const SmsQrInput(number: '')),
        throwsArgumentError,
      );
    });
  });

  group('EmailQrInput', () {
    test('builds a bare mailto: when no subject/body given', () {
      expect(
        builder.execute(const EmailQrInput(address: 'someone@example.com')),
        'mailto:someone@example.com',
      );
    });

    test('percent-encodes spaces as %20 and & as %26 in subject and body', () {
      final payload = builder.execute(
        const EmailQrInput(
          address: 'someone@example.com',
          subject: 'Mail from Our Site',
          body: 'Hi Bob & Alice, see you soon',
        ),
      );

      expect(
        payload,
        'mailto:someone@example.com'
        '?subject=Mail%20from%20Our%20Site'
        '&body=Hi%20Bob%20%26%20Alice%2C%20see%20you%20soon',
      );
      // RFC 6068 requires %20, never `+`, for a literal space.
      expect(payload, isNot(contains('+')));
    });

    test('percent-encodes query delimiters and a literal plus sign', () {
      final payload = builder.execute(
        const EmailQrInput(
          address: 'a@b.co',
          body: 'a=1?b#c+d',
        ),
      );
      expect(payload, 'mailto:a@b.co?body=a%3D1%3Fb%23c%2Bd');
    });

    test('emits only body when subject is empty', () {
      expect(
        builder.execute(
          const EmailQrInput(address: 'a@b.co', body: 'just a body'),
        ),
        'mailto:a@b.co?body=just%20a%20body',
      );
    });

    test('rejects a malformed address', () {
      for (final bad in ['nope', 'a@b', 'a b@c.com', 'a@@b.com', '']) {
        expect(
          () => builder.execute(EmailQrInput(address: bad)),
          throwsArgumentError,
          reason: 'expected "$bad" to be rejected',
        );
      }
    });
  });

  group('VCardQrInput', () {
    test('builds a full vCard 3.0 record with CRLF line breaks', () {
      final payload = builder.execute(
        const VCardQrInput(
          firstName: 'Sean',
          lastName: 'Owen',
          organization: 'Google',
          title: 'Engineer',
          phone: '+1 212-555-1212',
          email: 'srowen@example.com',
          url: 'https://example.com/sean',
          street: '76 9th Avenue',
          city: 'New York',
          region: 'NY',
          postalCode: '10011',
          country: 'USA',
        ),
      );

      expect(
        payload,
        'BEGIN:VCARD\r\n'
        'VERSION:3.0\r\n'
        'N:Owen;Sean;;;\r\n'
        'FN:Sean Owen\r\n'
        'ORG:Google\r\n'
        'TITLE:Engineer\r\n'
        'TEL;TYPE=CELL,VOICE:+12125551212\r\n'
        'EMAIL;TYPE=INTERNET:srowen@example.com\r\n'
        'URL:https://example.com/sean\r\n'
        r'ADR;TYPE=HOME:;;76 9th Avenue;New York;NY;10011;USA'
        '\r\n'
        'END:VCARD',
      );
    });

    test('omits every optional property that is blank', () {
      final payload = builder.execute(
        const VCardQrInput(firstName: 'Ada', lastName: 'Lovelace'),
      );

      expect(
        payload,
        'BEGIN:VCARD\r\n'
        'VERSION:3.0\r\n'
        'N:Lovelace;Ada;;;\r\n'
        'FN:Ada Lovelace\r\n'
        'END:VCARD',
      );
      expect(payload, isNot(contains('ADR')));
      expect(payload, isNot(contains('TEL')));
    });

    test('escapes commas and semicolons inside a structured component', () {
      final payload = builder.execute(
        const VCardQrInput(
          firstName: 'Ann',
          lastName: 'Smith-Jones',
          organization: 'Acme, Inc.; R&D Division',
          street: '1 Main St, Apt; 4',
        ),
      );

      expect(payload, contains(r'ORG:Acme\, Inc.\; R&D Division'));
      expect(payload, contains(r'ADR;TYPE=HOME:;;1 Main St\, Apt\; 4;;;;'));
    });

    test('escapes a literal backslash first so it is not double-escaped', () {
      final payload = builder.execute(
        const VCardQrInput(firstName: r'A\B', lastName: 'C'),
      );
      expect(payload, contains(r'N:C;A\\B;;;'));
    });

    test('escapes newlines in a text value as the two-character \\n', () {
      final payload = builder.execute(
        const VCardQrInput(
          firstName: 'Ann',
          title: 'Head of\r\nEverything',
        ),
      );
      expect(payload, contains(r'TITLE:Head of\nEverything'));
      // The escape is literal text, not a real line break.
      expect(payload.split('\r\n'), isNot(contains('Everything')));
    });

    test('leaves colons unescaped so URL values stay usable', () {
      final payload = builder.execute(
        const VCardQrInput(firstName: 'Ann', url: 'https://a.example/x'),
      );
      expect(payload, contains('URL:https://a.example/x'));
    });

    test('emits FN with only the name part that was supplied', () {
      final payload = builder.execute(const VCardQrInput(lastName: 'Cher'));
      expect(payload, contains('N:Cher;;;;'));
      expect(payload, contains('FN:Cher'));
    });

    test('rejects a card with no name at all', () {
      expect(
        () => builder.execute(const VCardQrInput(organization: 'Acme')),
        throwsArgumentError,
      );
    });

    test('rejects a malformed contact email', () {
      expect(
        () => builder.execute(
          const VCardQrInput(firstName: 'Ann', email: 'not-an-email'),
        ),
        throwsArgumentError,
      );
    });
  });

  group('GeoLocationQrInput', () {
    test('builds a geo: URI with trailing zeros trimmed', () {
      expect(
        builder.execute(
          const GeoLocationQrInput(latitude: 40.71872, longitude: -73.98905),
        ),
        'geo:40.71872,-73.98905',
      );
    });

    test('appends altitude as a third component when supplied', () {
      expect(
        builder.execute(
          const GeoLocationQrInput(
            latitude: 40.71872,
            longitude: -73.98905,
            altitudeMeters: 100,
          ),
        ),
        'geo:40.71872,-73.98905,100',
      );
    });

    test('renders whole degrees without a decimal point', () {
      expect(
        builder.execute(
          const GeoLocationQrInput(latitude: 40, longitude: -73),
        ),
        'geo:40,-73',
      );
    });

    test('never emits exponent notation for tiny values', () {
      final payload = builder.execute(
        const GeoLocationQrInput(latitude: 0.0000001, longitude: 0),
      );
      expect(payload.substring('geo:'.length), isNot(contains('e')));
      expect(payload, 'geo:0,0');
    });

    test('rejects out-of-range latitude and longitude', () {
      expect(
        () => builder.execute(
          const GeoLocationQrInput(latitude: 91, longitude: 0),
        ),
        throwsArgumentError,
      );
      expect(
        () => builder.execute(
          const GeoLocationQrInput(latitude: 0, longitude: -181),
        ),
        throwsArgumentError,
      );
    });

    test('accepts the exact range boundaries', () {
      expect(
        builder.execute(
          const GeoLocationQrInput(latitude: -90, longitude: 180),
        ),
        'geo:-90,180',
      );
    });
  });

  group('CalendarEventQrInput', () {
    final start = DateTime.utc(2018, 6, 1, 7);
    final end = DateTime.utc(2018, 8, 31, 7);

    test('builds a VEVENT block with UTC DATE-TIME stamps', () {
      final payload = builder.execute(
        CalendarEventQrInput(
          summary: 'Summer Vacation',
          start: start,
          end: end,
        ),
      );

      expect(
        payload,
        'BEGIN:VEVENT\r\n'
        'SUMMARY:Summer Vacation\r\n'
        'DTSTART:20180601T070000Z\r\n'
        'DTEND:20180831T070000Z\r\n'
        'END:VEVENT',
      );
    });

    test('converts a local DateTime to UTC before formatting', () {
      final local = DateTime.utc(2026, 1, 2, 3, 4, 5).toLocal();
      final payload = builder.execute(
        CalendarEventQrInput(summary: 'Standup', start: local, end: local),
      );
      expect(payload, contains('DTSTART:20260102T030405Z'));
      expect(payload, contains('DTEND:20260102T030405Z'));
    });

    test('zero-pads every component of the timestamp', () {
      final payload = builder.execute(
        CalendarEventQrInput(
          summary: 'x',
          start: DateTime.utc(2026, 1, 2, 3, 4, 5),
          end: DateTime.utc(2026, 1, 2, 3, 4, 5),
        ),
      );
      expect(payload, contains('DTSTART:20260102T030405Z'));
    });

    test('includes location and description when supplied', () {
      final payload = builder.execute(
        CalendarEventQrInput(
          summary: 'Kickoff',
          location: 'Room 4',
          description: 'Bring notes',
          start: start,
          end: end,
        ),
      );
      expect(payload, contains('LOCATION:Room 4'));
      expect(payload, contains('DESCRIPTION:Bring notes'));
    });

    test('escapes commas, semicolons, backslashes and newlines in TEXT', () {
      final payload = builder.execute(
        CalendarEventQrInput(
          summary: r'Q3 review, part 2; final \ draft',
          location: 'Bldg A, Floor 3',
          description: 'Agenda:\nintro, then Q&A',
          start: start,
          end: end,
        ),
      );

      expect(payload, contains(r'SUMMARY:Q3 review\, part 2\; final \\ draft'));
      expect(payload, contains(r'LOCATION:Bldg A\, Floor 3'));
      expect(payload, contains(r'DESCRIPTION:Agenda:\nintro\, then Q&A'));
      // Colons stay unescaped — RFC 5545 TEXT does not escape them.
      expect(payload, isNot(contains(r'Agenda\:')));
    });

    test('rejects an empty summary', () {
      expect(
        () => builder.execute(
          CalendarEventQrInput(summary: '   ', start: start, end: end),
        ),
        throwsArgumentError,
      );
    });

    test('rejects an end that precedes the start', () {
      expect(
        () => builder.execute(
          CalendarEventQrInput(summary: 'Backwards', start: end, end: start),
        ),
        throwsArgumentError,
      );
    });
  });
}
