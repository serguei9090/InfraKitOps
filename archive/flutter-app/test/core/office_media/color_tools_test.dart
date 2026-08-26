import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/office_media/color_tools.dart';

/// Standard sRGB relative luminance approximation (Rec. 601-ish weights),
/// used only to sanity-check that color blindness simulation doesn't wildly
/// darken/brighten a color, not as a precise colorimetric measurement.
double _luminance(RgbColor c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

void main() {
  group('ColorConverter hex <-> rgb', () {
    test('parses 6-digit hex', () {
      expect(ColorConverter.hexToRgb('#FF0000'), const RgbColor(r: 255, g: 0, b: 0));
      expect(ColorConverter.hexToRgb('00FF00'), const RgbColor(r: 0, g: 255, b: 0));
      expect(ColorConverter.hexToRgb('#0000ff'), const RgbColor(r: 0, g: 0, b: 255));
    });

    test('parses 3-digit shorthand hex', () {
      expect(ColorConverter.hexToRgb('#F00'), const RgbColor(r: 255, g: 0, b: 0));
      expect(ColorConverter.hexToRgb('0F0'), const RgbColor(r: 0, g: 255, b: 0));
    });

    test('formats rgb back to uppercase 6-digit hex', () {
      expect(ColorConverter.rgbToHex(const RgbColor(r: 255, g: 0, b: 0)), '#FF0000');
      expect(ColorConverter.rgbToHex(const RgbColor(r: 0, g: 128, b: 255)), '#0080FF');
    });

    test('rejects invalid hex strings', () {
      expect(() => ColorConverter.hexToRgb('not-a-color'), throwsArgumentError);
      expect(() => ColorConverter.hexToRgb('#12345'), throwsArgumentError);
    });
  });

  group('ColorConverter rgb <-> hsl round trip for known colors', () {
    test('#FF0000 == rgb(255,0,0) == hsl(0, 100%, 50%)', () {
      final rgb = ColorConverter.hexToRgb('#FF0000');
      expect(rgb, const RgbColor(r: 255, g: 0, b: 0));

      final hsl = ColorConverter.rgbToHsl(rgb);
      expect(hsl.h, closeTo(0, 0.01));
      expect(hsl.s, closeTo(100, 0.01));
      expect(hsl.l, closeTo(50, 0.01));

      final backToRgb = ColorConverter.hslToRgb(hsl);
      expect(backToRgb, rgb);
    });

    test('#00FF00 == hsl(120, 100%, 50%)', () {
      final rgb = ColorConverter.hexToRgb('#00FF00');
      final hsl = ColorConverter.rgbToHsl(rgb);
      expect(hsl.h, closeTo(120, 0.01));
      expect(hsl.s, closeTo(100, 0.01));
      expect(hsl.l, closeTo(50, 0.01));
      expect(ColorConverter.hslToRgb(hsl), rgb);
    });

    test('#0000FF == hsl(240, 100%, 50%)', () {
      final rgb = ColorConverter.hexToRgb('#0000FF');
      final hsl = ColorConverter.rgbToHsl(rgb);
      expect(hsl.h, closeTo(240, 0.01));
      expect(hsl.s, closeTo(100, 0.01));
      expect(hsl.l, closeTo(50, 0.01));
      expect(ColorConverter.hslToRgb(hsl), rgb);
    });

    test('#FFFFFF == hsl(_, 0%, 100%) and #000000 == hsl(_, 0%, 0%)', () {
      final white = ColorConverter.rgbToHsl(ColorConverter.hexToRgb('#FFFFFF'));
      expect(white.s, closeTo(0, 0.01));
      expect(white.l, closeTo(100, 0.01));

      final black = ColorConverter.rgbToHsl(ColorConverter.hexToRgb('#000000'));
      expect(black.s, closeTo(0, 0.01));
      expect(black.l, closeTo(0, 0.01));
    });

    test('round trip is stable for an arbitrary color (#3C7DBF)', () {
      final rgb = ColorConverter.hexToRgb('#3C7DBF');
      final hsl = ColorConverter.rgbToHsl(rgb);
      final backToRgb = ColorConverter.hslToRgb(hsl);
      // Allow +/-1 per channel for HSL's inherent rounding.
      expect((backToRgb.r - rgb.r).abs() <= 1, isTrue);
      expect((backToRgb.g - rgb.g).abs() <= 1, isTrue);
      expect((backToRgb.b - rgb.b).abs() <= 1, isTrue);
    });
  });

  group('ColorBlindnessSimulator', () {
    const simulator = ColorBlindnessSimulator();
    const red = RgbColor(r: 255, g: 0, b: 0);

    test('execute returns a result for all three simulation types', () {
      final result = simulator.execute(red);
      expect(result.keys, containsAll(ColorBlindnessType.values));
    });

    test('produces different output than input for a saturated color', () {
      final result = simulator.execute(red);
      for (final type in ColorBlindnessType.values) {
        expect(
          result[type],
          isNot(equals(red)),
          reason: '$type should alter a saturated red at all',
        );
      }
    });

    test('roughly preserves overall luminance (does not just black it out)', () {
      final originalLuminance = _luminance(red);
      final result = simulator.execute(red);

      for (final type in ColorBlindnessType.values) {
        final simulatedLuminance = _luminance(result[type]!);
        expect(
          (simulatedLuminance - originalLuminance).abs(),
          lessThan(80),
          reason: '$type shifted luminance implausibly far from the original',
        );
      }
    });

    test('individual simulate() matches the corresponding execute() entry', () {
      final result = simulator.execute(red);
      for (final type in ColorBlindnessType.values) {
        expect(simulator.simulate(red, type), result[type]);
      }
    });
  });
}
