import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:infrakit_studio/core/office_media/qr_decoder.dart';
import 'package:infrakit_studio/core/office_media/qr_payload_builder.dart';
import 'package:zxing2/qrcode.dart';

/// `zxing2` (^0.2.4) turns out to expose a real encoder alongside its
/// decoder: `package:zxing2/qrcode.dart` exports `Encoder` (a static
/// `Encoder.encode(text, ecLevel) -> QRCode`, whose `QRCode.matrix` is a
/// `ByteMatrix` of 0/1 modules — see
/// `<pub-cache>/zxing2-0.2.4/lib/src/qrcode/encoder/encoder.dart` and
/// `byte_matrix.dart`). That means a genuine encode -> render -> decode
/// round trip is possible without any extra dependency: this file renders
/// the matrix to a real PNG (via `package:image`, already a project
/// dependency) and feeds those bytes through [QrDecoder] exactly as the
/// image screen will. `ByteMatrix.get(x, y) == 1` is confirmed to mean a
/// dark/black module by inspecting `matrix_util.dart`'s finder-pattern
/// data (a black ring drawn with 1s around a white 0-ring).
///
/// So: the round-trip test IS exercised for real, on a real decoded QR
/// image. In addition, `QrDecoder.parsePayload` is public and is tested
/// directly against known payload strings, and the "not a QR" / "not an
/// image" paths are tested against non-QR image bytes built with
/// `package:image`.
Uint8List _renderQrPng(String text, {ErrorCorrectionLevel? ecLevel, int moduleSize = 8, int quietZone = 4}) {
  final qrCode = Encoder.encode(text, ecLevel ?? ErrorCorrectionLevel.m);
  final matrix = qrCode.matrix!;
  final dim = matrix.width;
  final size = (dim + quietZone * 2) * moduleSize;

  final image = img.Image(width: size, height: size);
  img.fill(image, color: img.ColorRgb8(255, 255, 255));

  for (var y = 0; y < dim; y++) {
    for (var x = 0; x < dim; x++) {
      if (matrix.get(x, y) == 1) {
        final px = (x + quietZone) * moduleSize;
        final py = (y + quietZone) * moduleSize;
        img.fillRect(
          image,
          x1: px,
          y1: py,
          x2: px + moduleSize - 1,
          y2: py + moduleSize - 1,
          color: img.ColorRgb8(0, 0, 0),
        );
      }
    }
  }

  return Uint8List.fromList(img.encodePng(image));
}

Uint8List _plainImagePng({int width = 200, int height = 200}) {
  final image = img.Image(width: width, height: height);
  img.fill(image, color: img.ColorRgb8(240, 240, 240));
  return Uint8List.fromList(img.encodePng(image));
}

void main() {
  const decoder = QrDecoder();
  const builder = QrPayloadBuilder();

  group('real encode -> render -> decode round trip (zxing2 Encoder + package:image)', () {
    test('plain text round-trips exactly', () {
      final png = _renderQrPng('Hello, InfraKit Studio!');
      final result = decoder.decodeImageBytes(png);

      expect(result.status, QrDecodeStatus.decoded);
      expect(result.isDecoded, isTrue);
      expect(result.text, 'Hello, InfraKit Studio!');
      expect(result.format, BarcodeFormat.qrCode);
      expect(result.formatLabel, 'QR Code');
      expect(result.payload, isA<PlainTextQrPayload>());
    });

    test('a URL round-trips and is classified as a web link', () {
      final png = _renderQrPng('https://example.com/path?x=1');
      final result = decoder.decodeImageBytes(png);

      expect(result.status, QrDecodeStatus.decoded);
      expect(result.text, 'https://example.com/path?x=1');
      expect(result.payload, isA<UrlQrPayload>());
      expect((result.payload as UrlQrPayload).url, 'https://example.com/path?x=1');
    });

    test('a builder-produced Wi-Fi payload round-trips and re-parses structurally', () {
      final payload = builder.execute(
        const WifiNetworkQrInput(ssid: 'MyHomeNetwork', password: 'sup3rSecret'),
      );
      final png = _renderQrPng(payload);
      final result = decoder.decodeImageBytes(png);

      expect(result.status, QrDecodeStatus.decoded);
      expect(result.text, payload);
      final wifi = result.payload;
      expect(wifi, isA<WifiQrPayload>());
      wifi as WifiQrPayload;
      expect(wifi.ssid, 'MyHomeNetwork');
      expect(wifi.password, 'sup3rSecret');
      expect(wifi.security, 'WPA');
      expect(wifi.hidden, isFalse);
    });

    test('a builder-produced vCard round-trips and re-parses structurally', () {
      final payload = builder.execute(
        const VCardQrInput(firstName: 'Ada', lastName: 'Lovelace', organization: 'Analytical Engines'),
      );
      final png = _renderQrPng(payload, ecLevel: ErrorCorrectionLevel.l);
      final result = decoder.decodeImageBytes(png);

      expect(result.status, QrDecodeStatus.decoded);
      final card = result.payload;
      expect(card, isA<VCardQrPayload>());
      card as VCardQrPayload;
      expect(card.fullName, 'Ada Lovelace');
      expect(card.organization, 'Analytical Engines');
    });

    test('a larger payload that needs a bigger symbol version still round-trips', () {
      final longText = 'A' * 300;
      final png = _renderQrPng(longText);
      final result = decoder.decodeImageBytes(png);

      expect(result.status, QrDecodeStatus.decoded);
      expect(result.text, longText);
      expect(result.symbolVersion, isNotNull);
    });
  });

  group('parsePayload classification (direct, no image round trip needed)', () {
    test('classifies a WIFI: payload', () {
      final payload = decoder.parsePayload('WIFI:T:WPA;S:CoffeeShop;P:beans123;H:false;;');
      expect(payload, isA<WifiQrPayload>());
      final wifi = payload as WifiQrPayload;
      expect(wifi.ssid, 'CoffeeShop');
      expect(wifi.password, 'beans123');
      expect(wifi.security, 'WPA');
      expect(wifi.kind, 'Wi-Fi network');
    });

    test('classifies a tel: payload', () {
      final payload = decoder.parsePayload('tel:+15551234567');
      expect(payload, isA<PhoneQrPayload>());
      expect((payload as PhoneQrPayload).number, '+15551234567');
    });

    test('classifies an SMSTO: payload', () {
      final payload = decoder.parsePayload('SMSTO:+15551234567:Running late');
      expect(payload, isA<SmsQrPayload>());
      final sms = payload as SmsQrPayload;
      expect(sms.number, '+15551234567');
      expect(sms.message, 'Running late');
    });

    test('classifies a mailto: payload with subject/body', () {
      final payload = decoder.parsePayload('mailto:a@b.com?subject=Hi%20there&body=See%20you');
      expect(payload, isA<EmailQrPayload>());
      final email = payload as EmailQrPayload;
      expect(email.address, 'a@b.com');
      expect(email.subject, 'Hi there');
      expect(email.body, 'See you');
    });

    test('classifies a BEGIN:VCARD payload', () {
      final payload = decoder.parsePayload(
        'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Grace Hopper\r\nORG:US Navy\r\nEND:VCARD',
      );
      expect(payload, isA<VCardQrPayload>());
      final card = payload as VCardQrPayload;
      expect(card.fullName, 'Grace Hopper');
      expect(card.organization, 'US Navy');
    });

    test('classifies a geo: payload, including altitude', () {
      final payload = decoder.parsePayload('geo:52.5,13.4,34');
      expect(payload, isA<GeoQrPayload>());
      final geo = payload as GeoQrPayload;
      expect(geo.latitude, '52.5');
      expect(geo.longitude, '13.4');
      expect(geo.altitudeMeters, '34');
    });

    test('classifies a BEGIN:VEVENT payload', () {
      final payload = decoder.parsePayload(
        'BEGIN:VEVENT\r\nSUMMARY:Standup\r\nDTSTART:20260101T090000Z\r\nDTEND:20260101T093000Z\r\nEND:VEVENT',
      );
      expect(payload, isA<CalendarEventQrPayload>());
      final event = payload as CalendarEventQrPayload;
      expect(event.summary, 'Standup');
      expect(event.start, '20260101T090000Z');
    });

    test('classifies an http(s) URL', () {
      expect(decoder.parsePayload('https://example.com'), isA<UrlQrPayload>());
      expect(decoder.parsePayload('http://example.com'), isA<UrlQrPayload>());
    });

    test('falls back to plain text for anything unrecognized', () {
      final payload = decoder.parsePayload('just some random text');
      expect(payload, isA<PlainTextQrPayload>());
      expect((payload as PlainTextQrPayload).text, 'just some random text');
    });

    test('an almost-WIFI payload with no SSID degrades to plain text rather than throwing', () {
      final payload = decoder.parsePayload('WIFI:T:WPA;H:false;;');
      expect(payload, isA<PlainTextQrPayload>());
    });

    test('empty text is plain text', () {
      expect(decoder.parsePayload(''), isA<PlainTextQrPayload>());
    });
  });

  group('"no QR code found" path (real non-QR image, no exception)', () {
    test('a plain solid-color image decodes as notFound, not an error', () {
      final png = _plainImagePng();
      final result = decoder.decodeImageBytes(png);

      expect(result.status, QrDecodeStatus.notFound);
      expect(result.isDecoded, isFalse);
      expect(result.message, isNotNull);
      expect(result.text, isEmpty);
    });

    test('an image too small to hold a QR code is notFound', () {
      final image = img.Image(width: 4, height: 4);
      img.fill(image, color: img.ColorRgb8(255, 255, 255));
      final png = Uint8List.fromList(img.encodePng(image));

      final result = decoder.decodeImageBytes(png);
      expect(result.status, QrDecodeStatus.notFound);
    });
  });

  group('"unreadable image" path', () {
    test('empty bytes are unreadable', () {
      final result = decoder.decodeImageBytes(Uint8List(0));
      expect(result.status, QrDecodeStatus.unreadableImage);
      expect(result.message, isNotNull);
    });

    test('bytes that are not any known image format are unreadable', () {
      final garbage = Uint8List.fromList(List<int>.generate(64, (i) => (i * 37) % 256));
      final result = decoder.decodeImageBytes(garbage);
      expect(result.status, QrDecodeStatus.unreadableImage);
    });
  });

  group('execute() (IToolUseCase contract)', () {
    test('delegates to decodeImageBytes', () {
      final png = _renderQrPng('via execute');
      final result = decoder.execute(png);
      expect(result.status, QrDecodeStatus.decoded);
      expect(result.text, 'via execute');
    });
  });
}
