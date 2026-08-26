import 'dart:math' as math;

import '../ports/i_tool_use_case.dart';

/// A plain sRGB color value — deliberately not `dart:ui`'s `Color`, since
/// `lib/core` must stay Flutter-free.
class RgbColor {
  const RgbColor({required this.r, required this.g, required this.b});

  /// 0-255.
  final int r;

  /// 0-255.
  final int g;

  /// 0-255.
  final int b;

  @override
  bool operator ==(Object other) =>
      other is RgbColor && other.r == r && other.g == g && other.b == b;

  @override
  int get hashCode => Object.hash(r, g, b);

  @override
  String toString() => 'rgb($r, $g, $b)';
}

/// A plain HSL color value.
class HslColor {
  const HslColor({required this.h, required this.s, required this.l});

  /// Hue in degrees, 0-360.
  final double h;

  /// Saturation as a percentage, 0-100.
  final double s;

  /// Lightness as a percentage, 0-100.
  final double l;

  @override
  bool operator ==(Object other) =>
      other is HslColor && other.h == h && other.s == s && other.l == l;

  @override
  int get hashCode => Object.hash(h, s, l);

  @override
  String toString() =>
      'hsl(${h.round()}, ${s.round()}%, ${l.round()}%)';
}

/// Clamps a color channel to the valid byte range, rounding first.
int _clampByte(num value) {
  final rounded = value.round();
  if (rounded < 0) return 0;
  if (rounded > 255) return 255;
  return rounded;
}

/// Pure-Dart Hex ⟷ RGB ⟷ HSL color model conversions.
class ColorConverter {
  const ColorConverter._();

  /// Parses a `#RGB`, `#RRGGBB`, `RGB` or `RRGGBB` hex string into an
  /// [RgbColor]. Throws [ArgumentError] if the string isn't a valid hex
  /// color.
  static RgbColor hexToRgb(String hex) {
    var value = hex.trim();
    if (value.startsWith('#')) {
      value = value.substring(1);
    }
    if (value.length == 3) {
      value = value.split('').map((c) => '$c$c').join();
    }
    if (value.length != 6 || !RegExp(r'^[0-9a-fA-F]{6}$').hasMatch(value)) {
      throw ArgumentError('Invalid hex color: $hex');
    }

    return RgbColor(
      r: int.parse(value.substring(0, 2), radix: 16),
      g: int.parse(value.substring(2, 4), radix: 16),
      b: int.parse(value.substring(4, 6), radix: 16),
    );
  }

  /// Formats an [RgbColor] as an uppercase `#RRGGBB` hex string.
  static String rgbToHex(RgbColor rgb) {
    String byteHex(int v) => _clampByte(v).toRadixString(16).padLeft(2, '0');
    return '#${byteHex(rgb.r)}${byteHex(rgb.g)}${byteHex(rgb.b)}'
        .toUpperCase();
  }

  /// Converts sRGB to HSL.
  static HslColor rgbToHsl(RgbColor rgb) {
    final r = rgb.r / 255.0;
    final g = rgb.g / 255.0;
    final b = rgb.b / 255.0;

    final maxC = math.max(r, math.max(g, b));
    final minC = math.min(r, math.min(g, b));
    final delta = maxC - minC;

    double h;
    if (delta == 0) {
      h = 0;
    } else if (maxC == r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (maxC == g) {
      h = 60 * (((b - r) / delta) + 2);
    } else {
      h = 60 * (((r - g) / delta) + 4);
    }
    if (h < 0) h += 360;

    final l = (maxC + minC) / 2;
    final s = delta == 0 ? 0.0 : delta / (1 - (2 * l - 1).abs());

    return HslColor(h: h, s: s * 100, l: l * 100);
  }

  /// Converts HSL to sRGB.
  static RgbColor hslToRgb(HslColor hsl) {
    final h = hsl.h % 360;
    final s = (hsl.s / 100).clamp(0.0, 1.0);
    final l = (hsl.l / 100).clamp(0.0, 1.0);

    final c = (1 - (2 * l - 1).abs()) * s;
    final x = c * (1 - ((h / 60) % 2 - 1).abs());
    final m = l - c / 2;

    double r1, g1, b1;
    if (h < 60) {
      r1 = c;
      g1 = x;
      b1 = 0;
    } else if (h < 120) {
      r1 = x;
      g1 = c;
      b1 = 0;
    } else if (h < 180) {
      r1 = 0;
      g1 = c;
      b1 = x;
    } else if (h < 240) {
      r1 = 0;
      g1 = x;
      b1 = c;
    } else if (h < 300) {
      r1 = x;
      g1 = 0;
      b1 = c;
    } else {
      r1 = c;
      g1 = 0;
      b1 = x;
    }

    return RgbColor(
      r: _clampByte((r1 + m) * 255),
      g: _clampByte((g1 + m) * 255),
      b: _clampByte((b1 + m) * 255),
    );
  }
}

/// The color vision deficiency types [ColorBlindnessSimulator] can simulate.
enum ColorBlindnessType { protanopia, deuteranopia, tritanopia }

/// Simulates how an sRGB color would appear to someone with red-blind
/// (protanopia), green-blind (deuteranopia) or blue-blind (tritanopia)
/// color vision, using the 100%-severity dichromacy simulation matrices from
/// Machado, Oliveira & Fairchild, "A Physiologically-based Model for
/// Simulation of Color Vision Deficiency" (IEEE TVCG, 2009).
///
/// These are the same published coefficients used by widely-deployed
/// real-time CVD simulators (e.g. the Coblis web tool and the
/// `jsColorblindSimulator` library), applied directly to normalized sRGB
/// channels — the common real-time simplification that skips a full
/// linear-light/LMS round trip in exchange for a single 3x3 matrix multiply
/// per pixel.
class ColorBlindnessSimulator
    implements IToolUseCase<RgbColor, Map<ColorBlindnessType, RgbColor>> {
  const ColorBlindnessSimulator();

  static const Map<ColorBlindnessType, List<double>> _matrices = {
    ColorBlindnessType.protanopia: [
      0.152286, 1.052583, -0.204868,
      0.114503, 0.786281, 0.099216,
      -0.003882, -0.048116, 1.051998,
    ],
    ColorBlindnessType.deuteranopia: [
      0.367322, 0.860646, -0.227968,
      0.280085, 0.672501, 0.047413,
      -0.011820, 0.042940, 0.968881,
    ],
    ColorBlindnessType.tritanopia: [
      1.255528, -0.076749, -0.178779,
      -0.078411, 0.930809, 0.147602,
      0.004733, 0.691367, 0.303900,
    ],
  };

  @override
  Map<ColorBlindnessType, RgbColor> execute(RgbColor input) {
    return {
      for (final type in ColorBlindnessType.values) type: simulate(input, type),
    };
  }

  /// Simulates a single [ColorBlindnessType] for [input].
  RgbColor simulate(RgbColor input, ColorBlindnessType type) {
    final m = _matrices[type]!;
    final r = input.r / 255.0;
    final g = input.g / 255.0;
    final b = input.b / 255.0;

    final simR = m[0] * r + m[1] * g + m[2] * b;
    final simG = m[3] * r + m[4] * g + m[5] * b;
    final simB = m[6] * r + m[7] * g + m[8] * b;

    return RgbColor(
      r: _clampByte(simR * 255),
      g: _clampByte(simG * 255),
      b: _clampByte(simB * 255),
    );
  }
}
