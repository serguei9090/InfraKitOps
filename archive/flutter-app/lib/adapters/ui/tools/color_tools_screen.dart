import 'package:flutter/material.dart';
import 'package:flutter_colorpicker/flutter_colorpicker.dart';

import '../../../core/office_media/color_tools.dart';
import '../shell/tool_detail_scaffold.dart';

Color _toFlutterColor(RgbColor c) => Color.fromARGB(255, c.r, c.g, c.b);

/// Reads the 8-bit channels back out of a Flutter [Color].
///
/// Goes through `toARGB32()` rather than the (now floating-point) `.r/.g/.b`
/// accessors so the result is exactly the byte the swatch was painted with.
RgbColor _toRgbColor(Color c) {
  final argb = c.toARGB32();
  return RgbColor(r: (argb >> 16) & 0xFF, g: (argb >> 8) & 0xFF, b: argb & 0xFF);
}

const Map<ColorBlindnessType, String> _cvdLabels = {
  ColorBlindnessType.protanopia: 'Protanopia (red-blind)',
  ColorBlindnessType.deuteranopia: 'Deuteranopia (green-blind)',
  ColorBlindnessType.tritanopia: 'Tritanopia (blue-blind)',
};

/// Quick-pick presets: the Material 500 ramp plus black/white, which covers
/// the hues people reach for when sanity-checking a palette.
const List<Color> _presetSwatches = [
  Color(0xFF000000),
  Color(0xFF6B7280),
  Color(0xFFFFFFFF),
  Color(0xFFEF4444),
  Color(0xFFF97316),
  Color(0xFFF59E0B),
  Color(0xFF84CC16),
  Color(0xFF22C55E),
  Color(0xFF14B8A6),
  Color(0xFF06B6D4),
  Color(0xFF3B82F6),
  Color(0xFF4F46E5),
  Color(0xFF8B5CF6),
  Color(0xFFD946EF),
  Color(0xFFEC4899),
];

/// "Color Tools" screen (spec section 3.3): a visual saturation/value picker
/// with a hue slider, backed by Hex/RGB/HSL text entry, plus a
/// color-blindness (CVD) simulation comparison strip.
///
/// Built on the shared [ToolDetailScaffold] split-panel layout: the left
/// panel holds the [ColorPicker] gradient area, the preset swatches and the
/// hex/RGB/HSL fields; the right panel renders the same color through each
/// [ColorBlindnessSimulator] simulation side by side with the original, so
/// differences are visible at a glance.
///
/// Everything reads from and writes back to a single [RgbColor] source of
/// truth, so the picker and the three text representations stay two-way
/// synced: dragging the picker rewrites the fields, and typing a valid value
/// into any field moves the picker.
class ColorToolsScreen extends StatefulWidget {
  const ColorToolsScreen({super.key});

  @override
  State<ColorToolsScreen> createState() => _ColorToolsScreenState();
}

class _ColorToolsScreenState extends State<ColorToolsScreen> {
  static const _simulator = ColorBlindnessSimulator();

  late final TextEditingController _hexController;
  late final TextEditingController _rController;
  late final TextEditingController _gController;
  late final TextEditingController _bController;
  late final TextEditingController _hController;
  late final TextEditingController _sController;
  late final TextEditingController _lController;

  /// Single source of truth every field reads from and writes back to.
  RgbColor _rgb = const RgbColor(r: 79, g: 70, b: 229); // brand indigo

  /// The picker's own HSV state, kept alongside [_rgb] and fed back in via
  /// `ColorPicker.pickerHsvColor`.
  ///
  /// Without this, every drag would round-trip through RGB and back through
  /// `HSVColor.fromColor`, which cannot recover the hue once saturation or
  /// value hits zero — so the thumb would snap to red the moment you dragged
  /// into the white or black corner. Holding the HSV separately keeps the
  /// thumb where the user put it.
  HSVColor _hsv = HSVColor.fromColor(const Color(0xFF4F46E5));

  /// Guards against a programmatic controller.text update re-triggering its
  /// own listener and recomputing from (possibly reformatted) text.
  bool _syncing = false;

  @override
  void initState() {
    super.initState();
    _hexController = TextEditingController()..addListener(_onHexChanged);
    _rController = TextEditingController()..addListener(_onRgbFieldChanged);
    _gController = TextEditingController()..addListener(_onRgbFieldChanged);
    _bController = TextEditingController()..addListener(_onRgbFieldChanged);
    _hController = TextEditingController()..addListener(_onHslFieldChanged);
    _sController = TextEditingController()..addListener(_onHslFieldChanged);
    _lController = TextEditingController()..addListener(_onHslFieldChanged);

    _syncControllersFrom(_rgb);
  }

  @override
  void dispose() {
    for (final c in [
      _hexController,
      _rController,
      _gController,
      _bController,
      _hController,
      _sController,
      _lController,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  void _onHexChanged() {
    if (_syncing) return;
    try {
      final rgb = ColorConverter.hexToRgb(_hexController.text);
      _applyRgb(rgb, skip: {_hexController});
    } on ArgumentError {
      // Incomplete/invalid hex mid-edit (e.g. "#1"). Wait for a valid value.
    }
  }

  void _onRgbFieldChanged() {
    if (_syncing) return;
    final r = int.tryParse(_rController.text.trim());
    final g = int.tryParse(_gController.text.trim());
    final b = int.tryParse(_bController.text.trim());
    if (r == null || g == null || b == null) return;
    if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) return;
    _applyRgb(RgbColor(r: r, g: g, b: b), skip: {_rController, _gController, _bController});
  }

  void _onHslFieldChanged() {
    if (_syncing) return;
    final h = double.tryParse(_hController.text.trim());
    final s = double.tryParse(_sController.text.trim());
    final l = double.tryParse(_lController.text.trim());
    if (h == null || s == null || l == null) return;
    if (s < 0 || s > 100 || l < 0 || l > 100) return;
    final rgb = ColorConverter.hslToRgb(HslColor(h: h, s: s, l: l));
    _applyRgb(rgb, skip: {_hController, _sController, _lController});
  }

  /// Applies a color that came from a *text field* (or a preset swatch): the
  /// picker's HSV state is rebuilt from the RGB value, which is correct here
  /// because the user expressed the color in RGB/HSL terms, not by pointing
  /// at the gradient.
  void _applyRgb(RgbColor rgb, {required Set<TextEditingController> skip}) {
    setState(() {
      _rgb = rgb;
      _hsv = HSVColor.fromColor(_toFlutterColor(rgb));
    });
    _syncControllersFrom(rgb, skip: skip);
  }

  /// Applies a color that came from the *picker*, keeping its HSV as given so
  /// the thumb doesn't drift. Nothing is skipped: every text field should
  /// follow the drag.
  void _applyHsvFromPicker(HSVColor hsv) {
    final rgb = _toRgbColor(hsv.toColor());
    setState(() {
      _hsv = hsv;
      _rgb = rgb;
    });
    _syncControllersFrom(rgb);
  }

  void _syncControllersFrom(RgbColor rgb, {Set<TextEditingController> skip = const {}}) {
    _syncing = true;
    final hsl = ColorConverter.rgbToHsl(rgb);

    void setText(TextEditingController c, String text) {
      if (skip.contains(c)) return;
      if (c.text != text) c.text = text;
    }

    setText(_hexController, ColorConverter.rgbToHex(rgb));
    setText(_rController, '${rgb.r}');
    setText(_gController, '${rgb.g}');
    setText(_bController, '${rgb.b}');
    setText(_hController, hsl.h.round().toString());
    setText(_sController, hsl.s.round().toString());
    setText(_lController, hsl.l.round().toString());

    _syncing = false;
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'Color Tools',
      copyText: ColorConverter.rgbToHex(_rgb),
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildPicker(context),
          const SizedBox(height: 20),
          Text('Presets', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 10),
          _buildPresets(context),
          const SizedBox(height: 24),
          Text('Manual entry', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            'Type into any field to move the picker.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 16),
          Text('Hex', style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 8),
          TextField(
            controller: _hexController,
            decoration: const InputDecoration(border: OutlineInputBorder(), hintText: '#RRGGBB'),
          ),
          const SizedBox(height: 20),
          Text('RGB', style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(child: _numberField(_rController, 'R')),
              const SizedBox(width: 10),
              Expanded(child: _numberField(_gController, 'G')),
              const SizedBox(width: 10),
              Expanded(child: _numberField(_bController, 'B')),
            ],
          ),
          const SizedBox(height: 20),
          Text('HSL', style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(child: _numberField(_hController, 'H°')),
              const SizedBox(width: 10),
              Expanded(child: _numberField(_sController, 'S%')),
              const SizedBox(width: 10),
              Expanded(child: _numberField(_lController, 'L%')),
            ],
          ),
        ],
      ),
      outputPanel: _buildSimulationComparison(context),
    );
  }

  /// The visual picker: `PaletteType.hsvWithHue` gives the familiar
  /// saturation/value gradient square plus a hue slider underneath — the
  /// layout every design tool uses — where `hueWheel`/`MaterialPicker`/
  /// `BlockPicker` would give a wheel or a fixed grid instead. Alpha is
  /// switched off because the rest of this tool is opaque-RGB only, and the
  /// package's own RGB/HSV/HSL labels are switched off because the text
  /// fields below already own that job.
  Widget _buildPicker(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth.isFinite
            ? constraints.maxWidth.clamp(220.0, 360.0)
            : 300.0;

        return Center(
          child: ColorPicker(
            pickerColor: _toFlutterColor(_rgb),
            pickerHsvColor: _hsv,
            onColorChanged: (_) {
              // Handled via onHsvColorChanged, which preserves hue at the
              // achromatic edges. Required (non-null) by the widget's API.
            },
            onHsvColorChanged: _applyHsvFromPicker,
            paletteType: PaletteType.hsvWithHue,
            enableAlpha: false,
            labelTypes: const [],
            displayThumbColor: true,
            portraitOnly: true,
            colorPickerWidth: width,
            pickerAreaHeightPercent: 0.7,
            pickerAreaBorderRadius: BorderRadius.circular(12),
          ),
        );
      },
    );
  }

  Widget _buildPresets(BuildContext context) {
    final selectedArgb = _toFlutterColor(_rgb).toARGB32();

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: _presetSwatches.map((color) {
        final isSelected = color.toARGB32() == selectedArgb;
        return Tooltip(
          message: ColorConverter.rgbToHex(_toRgbColor(color)),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () => _applyRgb(_toRgbColor(color), skip: const {}),
            child: Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(
                color: color,
                shape: BoxShape.circle,
                border: Border.all(
                  color: isSelected
                      ? Theme.of(context).colorScheme.primary
                      : Theme.of(context).colorScheme.outlineVariant,
                  width: isSelected ? 3 : 1,
                ),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _numberField(TextEditingController controller, String label) {
    return TextField(
      controller: controller,
      keyboardType: const TextInputType.numberWithOptions(signed: false),
      decoration: InputDecoration(border: const OutlineInputBorder(), labelText: label),
    );
  }

  Widget _buildSimulationComparison(BuildContext context) {
    final simulated = _simulator.execute(_rgb);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Color-blindness simulation',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 4),
        Text(
          'How this color would appear under each common form of color '
          'vision deficiency, compared to the original.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 16,
          runSpacing: 16,
          children: [
            _swatchCard(context, label: 'Original', rgb: _rgb),
            for (final type in ColorBlindnessType.values)
              _swatchCard(context, label: _cvdLabels[type]!, rgb: simulated[type]!),
          ],
        ),
      ],
    );
  }

  Widget _swatchCard(BuildContext context, {required String label, required RgbColor rgb}) {
    return SizedBox(
      width: 150,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                height: 64,
                decoration: BoxDecoration(
                  color: _toFlutterColor(rgb),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
                ),
              ),
              const SizedBox(height: 8),
              Text(label, style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 2),
              Text(
                ColorConverter.rgbToHex(rgb),
                style: Theme.of(context).textTheme.bodySmall?.copyWith(fontFamily: 'monospace'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
