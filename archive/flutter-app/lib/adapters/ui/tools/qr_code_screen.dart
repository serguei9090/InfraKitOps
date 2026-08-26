import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../../core/office_media/qr_payload_builder.dart';
import '../shell/tool_detail_scaffold.dart';

/// The payload kinds the screen can build. Order here is the order the
/// selector chips appear in.
enum _QrMode {
  text('Text / URL', Icons.link),
  wifi('Wi-Fi', Icons.wifi),
  phone('Phone', Icons.call),
  sms('SMS', Icons.sms),
  email('Email', Icons.mail_outline),
  vcard('Contact', Icons.contact_page_outlined),
  geo('Location', Icons.place_outlined),
  event('Event', Icons.event_outlined);

  const _QrMode(this.label, this.icon);

  final String label;
  final IconData icon;
}

const List<Color> _swatchPalette = [
  Colors.black,
  Colors.white,
  Color(0xFF4F46E5), // brand indigo, matches AppTheme's seed
  Color(0xFFDC2626),
  Color(0xFF16A34A),
  Color(0xFF2563EB),
  Color(0xFFEA580C),
];

/// "Customizable QR Code Generator" tool screen (spec section 3.3).
///
/// Built on the shared [ToolDetailScaffold] split-panel layout: the left
/// panel picks one of the eight payload kinds in [_QrMode] via a wrapped
/// chip selector (a SegmentedButton can't fit eight options), shows only the
/// fields relevant to that kind, and offers foreground/background/size
/// customization; the right panel renders the live [QrImageView] fed by
/// [QrPayloadBuilder]'s output, with the raw payload text underneath so it
/// can be copied via the scaffold's toolbar copy button.
///
/// All validation flows through [QrPayloadBuilder], which signals bad input
/// by throwing [ArgumentError]; [_computePayload] catches that and turns it
/// into an inline message, so an exception can never escape into a build.
class QrCodeScreen extends StatefulWidget {
  const QrCodeScreen({super.key});

  @override
  State<QrCodeScreen> createState() => _QrCodeScreenState();
}

class _QrCodeScreenState extends State<QrCodeScreen> {
  static const _payloadBuilder = QrPayloadBuilder();

  _QrMode _mode = _QrMode.text;

  final _textController = TextEditingController(text: 'https://example.com');

  // Wi-Fi
  final _ssidController = TextEditingController();
  final _passwordController = TextEditingController();
  WifiSecurityType _security = WifiSecurityType.wpa;
  bool _hidden = false;
  bool _obscurePassword = true;

  // Phone / SMS
  final _phoneController = TextEditingController();
  final _smsNumberController = TextEditingController();
  final _smsMessageController = TextEditingController();

  // Email
  final _emailAddressController = TextEditingController();
  final _emailSubjectController = TextEditingController();
  final _emailBodyController = TextEditingController();

  // vCard
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  final _orgController = TextEditingController();
  final _titleController = TextEditingController();
  final _cardPhoneController = TextEditingController();
  final _cardEmailController = TextEditingController();
  final _cardUrlController = TextEditingController();
  final _streetController = TextEditingController();
  final _cityController = TextEditingController();
  final _regionController = TextEditingController();
  final _postalController = TextEditingController();
  final _countryController = TextEditingController();

  // Geo
  final _latController = TextEditingController();
  final _lonController = TextEditingController();
  final _altController = TextEditingController();

  // Calendar event
  final _eventSummaryController = TextEditingController();
  final _eventLocationController = TextEditingController();
  final _eventDescriptionController = TextEditingController();
  DateTime _eventStart = _defaultEventStart();
  DateTime _eventEnd = _defaultEventStart().add(const Duration(hours: 1));

  Color _foregroundColor = Colors.black;
  Color _backgroundColor = Colors.white;
  double _size = 220;

  static DateTime _defaultEventStart() {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day, now.hour + 1);
  }

  List<TextEditingController> get _allControllers => [
    _textController,
    _ssidController,
    _passwordController,
    _phoneController,
    _smsNumberController,
    _smsMessageController,
    _emailAddressController,
    _emailSubjectController,
    _emailBodyController,
    _firstNameController,
    _lastNameController,
    _orgController,
    _titleController,
    _cardPhoneController,
    _cardEmailController,
    _cardUrlController,
    _streetController,
    _cityController,
    _regionController,
    _postalController,
    _countryController,
    _latController,
    _lonController,
    _altController,
    _eventSummaryController,
    _eventLocationController,
    _eventDescriptionController,
  ];

  @override
  void initState() {
    super.initState();
    for (final c in _allControllers) {
      c.addListener(_onInputChanged);
    }
  }

  @override
  void dispose() {
    for (final c in _allControllers) {
      c.dispose();
    }
    super.dispose();
  }

  void _onInputChanged() => setState(() {});

  /// Builds the [QrPayloadInput] for the active mode, or returns null when
  /// the user simply hasn't typed anything yet (an empty form is "not ready",
  /// not "invalid").
  QrPayloadInput? _buildInput() {
    switch (_mode) {
      case _QrMode.text:
        return PlainTextQrInput(_textController.text);

      case _QrMode.wifi:
        if (_ssidController.text.isEmpty) return null;
        return WifiNetworkQrInput(
          ssid: _ssidController.text,
          password: _passwordController.text,
          security: _security,
          hidden: _hidden,
        );

      case _QrMode.phone:
        if (_phoneController.text.trim().isEmpty) return null;
        return PhoneNumberQrInput(_phoneController.text);

      case _QrMode.sms:
        if (_smsNumberController.text.trim().isEmpty) return null;
        return SmsQrInput(
          number: _smsNumberController.text,
          message: _smsMessageController.text,
        );

      case _QrMode.email:
        if (_emailAddressController.text.trim().isEmpty) return null;
        return EmailQrInput(
          address: _emailAddressController.text,
          subject: _emailSubjectController.text,
          body: _emailBodyController.text,
        );

      case _QrMode.vcard:
        if (_firstNameController.text.trim().isEmpty &&
            _lastNameController.text.trim().isEmpty) {
          return null;
        }
        return VCardQrInput(
          firstName: _firstNameController.text,
          lastName: _lastNameController.text,
          organization: _orgController.text,
          title: _titleController.text,
          phone: _cardPhoneController.text,
          email: _cardEmailController.text,
          url: _cardUrlController.text,
          street: _streetController.text,
          city: _cityController.text,
          region: _regionController.text,
          postalCode: _postalController.text,
          country: _countryController.text,
        );

      case _QrMode.geo:
        final latText = _latController.text.trim();
        final lonText = _lonController.text.trim();
        if (latText.isEmpty && lonText.isEmpty) return null;
        final lat = double.tryParse(latText);
        final lon = double.tryParse(lonText);
        if (lat == null) {
          throw ArgumentError('Latitude must be a decimal number, e.g. 40.7187.');
        }
        if (lon == null) {
          throw ArgumentError('Longitude must be a decimal number, e.g. -73.989.');
        }
        final altText = _altController.text.trim();
        double? alt;
        if (altText.isNotEmpty) {
          alt = double.tryParse(altText);
          if (alt == null) {
            throw ArgumentError('Altitude must be a number of meters.');
          }
        }
        return GeoLocationQrInput(
          latitude: lat,
          longitude: lon,
          altitudeMeters: alt,
        );

      case _QrMode.event:
        if (_eventSummaryController.text.trim().isEmpty) return null;
        return CalendarEventQrInput(
          summary: _eventSummaryController.text,
          location: _eventLocationController.text,
          description: _eventDescriptionController.text,
          start: _eventStart,
          end: _eventEnd,
        );
    }
  }

  ({String? payload, String? error}) _computePayload() {
    try {
      final input = _buildInput();
      if (input == null) return (payload: null, error: null);
      final payload = _payloadBuilder.execute(input);
      if (payload.isEmpty) {
        return (payload: null, error: null);
      }
      return (payload: payload, error: null);
    } on ArgumentError catch (e) {
      return (payload: null, error: e.message?.toString() ?? 'Invalid input');
    } on FormatException catch (e) {
      return (payload: null, error: e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final computed = _computePayload();

    return ToolDetailScaffold(
      title: 'QR Code Generator',
      copyText: computed.payload,
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Content type', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 10),
          _modeSelector(context),
          const SizedBox(height: 20),
          ..._buildModeControls(context),
          const SizedBox(height: 24),
          Text('Appearance', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          Text('Foreground', style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 6),
          _colorSwatchRow(_foregroundColor, (c) => setState(() => _foregroundColor = c)),
          const SizedBox(height: 12),
          Text('Background', style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 6),
          _colorSwatchRow(_backgroundColor, (c) => setState(() => _backgroundColor = c)),
          const SizedBox(height: 12),
          Text('Size: ${_size.round()}px'),
          Slider(
            value: _size,
            min: 120,
            max: 360,
            divisions: 24,
            label: '${_size.round()}px',
            onChanged: (value) => setState(() => _size = value),
          ),
        ],
      ),
      outputPanel: _buildOutput(context, computed),
    );
  }

  /// Eight options don't fit a SegmentedButton, so the mode switch is a
  /// wrapped row of [ChoiceChip]s that reflows to whatever width the panel
  /// has.
  Widget _modeSelector(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: _QrMode.values.map((mode) {
        return ChoiceChip(
          avatar: Icon(
            mode.icon,
            size: 18,
            color: _mode == mode
                ? Theme.of(context).colorScheme.onSecondaryContainer
                : Theme.of(context).colorScheme.onSurfaceVariant,
          ),
          label: Text(mode.label),
          selected: _mode == mode,
          onSelected: (selected) {
            if (selected) setState(() => _mode = mode);
          },
        );
      }).toList(),
    );
  }

  List<Widget> _buildModeControls(BuildContext context) {
    switch (_mode) {
      case _QrMode.text:
        return _buildTextControls(context);
      case _QrMode.wifi:
        return _buildWifiControls(context);
      case _QrMode.phone:
        return _buildPhoneControls(context);
      case _QrMode.sms:
        return _buildSmsControls(context);
      case _QrMode.email:
        return _buildEmailControls(context);
      case _QrMode.vcard:
        return _buildVCardControls(context);
      case _QrMode.geo:
        return _buildGeoControls(context);
      case _QrMode.event:
        return _buildEventControls(context);
    }
  }

  // ------------------------------------------------------------- field kits

  Widget _sectionLabel(BuildContext context, String text) =>
      Text(text, style: Theme.of(context).textTheme.titleMedium);

  Widget _field(
    TextEditingController controller, {
    required String label,
    String? hint,
    int maxLines = 1,
    TextInputType? keyboardType,
    String? helper,
  }) {
    return TextField(
      controller: controller,
      maxLines: maxLines,
      minLines: 1,
      keyboardType: keyboardType,
      decoration: InputDecoration(
        border: const OutlineInputBorder(),
        labelText: label,
        hintText: hint,
        helperText: helper,
      ),
    );
  }

  List<Widget> _buildTextControls(BuildContext context) {
    return [
      _sectionLabel(context, 'Text or URL'),
      const SizedBox(height: 8),
      TextField(
        controller: _textController,
        maxLines: 3,
        minLines: 1,
        decoration: const InputDecoration(
          border: OutlineInputBorder(),
          hintText: 'https://example.com or any plain text',
        ),
      ),
    ];
  }

  List<Widget> _buildWifiControls(BuildContext context) {
    return [
      _sectionLabel(context, 'Network name (SSID)'),
      const SizedBox(height: 8),
      TextField(
        controller: _ssidController,
        decoration: const InputDecoration(
          border: OutlineInputBorder(),
          hintText: 'MyHomeNetwork',
        ),
      ),
      const SizedBox(height: 16),
      _sectionLabel(context, 'Security'),
      const SizedBox(height: 8),
      SegmentedButton<WifiSecurityType>(
        segments: const [
          ButtonSegment(value: WifiSecurityType.wpa, label: Text('WPA/WPA2')),
          ButtonSegment(value: WifiSecurityType.wep, label: Text('WEP')),
          ButtonSegment(value: WifiSecurityType.nopass, label: Text('Open')),
        ],
        selected: {_security},
        onSelectionChanged: (selection) => setState(() => _security = selection.first),
      ),
      if (_security != WifiSecurityType.nopass) ...[
        const SizedBox(height: 16),
        _sectionLabel(context, 'Password'),
        const SizedBox(height: 8),
        TextField(
          controller: _passwordController,
          obscureText: _obscurePassword,
          decoration: InputDecoration(
            border: const OutlineInputBorder(),
            hintText: 'Network password',
            suffixIcon: IconButton(
              icon: Icon(_obscurePassword ? Icons.visibility : Icons.visibility_off),
              onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
            ),
          ),
        ),
      ],
      const SizedBox(height: 8),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Hidden network'),
        value: _hidden,
        onChanged: (value) => setState(() => _hidden = value),
      ),
    ];
  }

  List<Widget> _buildPhoneControls(BuildContext context) {
    return [
      _sectionLabel(context, 'Phone number'),
      const SizedBox(height: 8),
      _field(
        _phoneController,
        label: 'Number',
        hint: '+1 212 555 1212',
        keyboardType: TextInputType.phone,
        helper: 'Use the international form so it dials from anywhere.',
      ),
    ];
  }

  List<Widget> _buildSmsControls(BuildContext context) {
    return [
      _sectionLabel(context, 'Pre-composed SMS'),
      const SizedBox(height: 8),
      _field(
        _smsNumberController,
        label: 'Recipient number',
        hint: '+1 800 555 1212',
        keyboardType: TextInputType.phone,
      ),
      const SizedBox(height: 12),
      _field(
        _smsMessageController,
        label: 'Message',
        hint: 'Message body (optional)',
        maxLines: 3,
        helper: 'Line breaks are folded to spaces — SMSTO is a single line.',
      ),
    ];
  }

  List<Widget> _buildEmailControls(BuildContext context) {
    return [
      _sectionLabel(context, 'Pre-composed email'),
      const SizedBox(height: 8),
      _field(
        _emailAddressController,
        label: 'To',
        hint: 'someone@example.com',
        keyboardType: TextInputType.emailAddress,
      ),
      const SizedBox(height: 12),
      _field(_emailSubjectController, label: 'Subject', hint: 'Optional'),
      const SizedBox(height: 12),
      _field(
        _emailBodyController,
        label: 'Body',
        hint: 'Optional',
        maxLines: 4,
        helper: 'Spaces and & are percent-encoded automatically.',
      ),
    ];
  }

  List<Widget> _buildVCardControls(BuildContext context) {
    return [
      _sectionLabel(context, 'Contact (vCard 3.0)'),
      const SizedBox(height: 8),
      Row(
        children: [
          Expanded(child: _field(_firstNameController, label: 'First name')),
          const SizedBox(width: 10),
          Expanded(child: _field(_lastNameController, label: 'Last name')),
        ],
      ),
      const SizedBox(height: 12),
      Row(
        children: [
          Expanded(child: _field(_orgController, label: 'Organization')),
          const SizedBox(width: 10),
          Expanded(child: _field(_titleController, label: 'Job title')),
        ],
      ),
      const SizedBox(height: 12),
      _field(
        _cardPhoneController,
        label: 'Phone',
        hint: '+1 212 555 1212',
        keyboardType: TextInputType.phone,
      ),
      const SizedBox(height: 12),
      _field(
        _cardEmailController,
        label: 'Email',
        hint: 'someone@example.com',
        keyboardType: TextInputType.emailAddress,
      ),
      const SizedBox(height: 12),
      _field(_cardUrlController, label: 'Website', hint: 'https://example.com'),
      const SizedBox(height: 16),
      Text('Address', style: Theme.of(context).textTheme.labelLarge),
      const SizedBox(height: 8),
      _field(_streetController, label: 'Street'),
      const SizedBox(height: 12),
      Row(
        children: [
          Expanded(child: _field(_cityController, label: 'City')),
          const SizedBox(width: 10),
          Expanded(child: _field(_regionController, label: 'State / region')),
        ],
      ),
      const SizedBox(height: 12),
      Row(
        children: [
          Expanded(child: _field(_postalController, label: 'Postal code')),
          const SizedBox(width: 10),
          Expanded(child: _field(_countryController, label: 'Country')),
        ],
      ),
    ];
  }

  List<Widget> _buildGeoControls(BuildContext context) {
    const decimal = TextInputType.numberWithOptions(decimal: true, signed: true);
    return [
      _sectionLabel(context, 'Map location'),
      const SizedBox(height: 8),
      Row(
        children: [
          Expanded(
            child: _field(
              _latController,
              label: 'Latitude',
              hint: '40.71872',
              keyboardType: decimal,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: _field(
              _lonController,
              label: 'Longitude',
              hint: '-73.98905',
              keyboardType: decimal,
            ),
          ),
        ],
      ),
      const SizedBox(height: 12),
      _field(
        _altController,
        label: 'Altitude (m)',
        hint: 'Optional',
        keyboardType: decimal,
        helper: 'Decimal degrees: latitude -90…90, longitude -180…180.',
      ),
    ];
  }

  List<Widget> _buildEventControls(BuildContext context) {
    return [
      _sectionLabel(context, 'Calendar event'),
      const SizedBox(height: 8),
      _field(_eventSummaryController, label: 'Title', hint: 'Team offsite'),
      const SizedBox(height: 12),
      _field(_eventLocationController, label: 'Location', hint: 'Optional'),
      const SizedBox(height: 12),
      _field(
        _eventDescriptionController,
        label: 'Description',
        hint: 'Optional',
        maxLines: 3,
      ),
      const SizedBox(height: 12),
      _dateTimeRow(context, label: 'Starts', value: _eventStart, isStart: true),
      const SizedBox(height: 8),
      _dateTimeRow(context, label: 'Ends', value: _eventEnd, isStart: false),
      const SizedBox(height: 6),
      Text(
        'Encoded as UTC (…Z) so the event lands at the same instant everywhere.',
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      ),
    ];
  }

  Widget _dateTimeRow(
    BuildContext context, {
    required String label,
    required DateTime value,
    required bool isStart,
  }) {
    return Row(
      children: [
        SizedBox(width: 62, child: Text(label, style: Theme.of(context).textTheme.labelLarge)),
        Expanded(
          child: OutlinedButton.icon(
            icon: const Icon(Icons.calendar_today, size: 16),
            label: Text(_formatLocal(value)),
            onPressed: () => _pickDateTime(isStart: isStart),
          ),
        ),
      ],
    );
  }

  String _formatLocal(DateTime value) {
    String two(int v) => v.toString().padLeft(2, '0');
    return '${value.year}-${two(value.month)}-${two(value.day)} '
        '${two(value.hour)}:${two(value.minute)}';
  }

  Future<void> _pickDateTime({required bool isStart}) async {
    final current = isStart ? _eventStart : _eventEnd;

    final date = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (date == null || !mounted) return;

    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(current),
    );
    if (time == null || !mounted) return;

    final picked = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    setState(() {
      if (isStart) {
        // Keep the original duration when the start moves, so the end never
        // silently ends up before the start.
        final duration = _eventEnd.difference(_eventStart);
        _eventStart = picked;
        _eventEnd = picked.add(duration.isNegative ? const Duration(hours: 1) : duration);
      } else {
        _eventEnd = picked;
      }
    });
  }

  Widget _colorSwatchRow(Color selected, ValueChanged<Color> onSelect) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: _swatchPalette.map((color) {
        final isSelected = color.toARGB32() == selected.toARGB32();
        return GestureDetector(
          onTap: () => onSelect(color),
          child: Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              border: Border.all(
                color: isSelected ? Theme.of(context).colorScheme.primary : Colors.grey,
                width: isSelected ? 3 : 1,
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildOutput(BuildContext context, ({String? payload, String? error}) computed) {
    final scheme = Theme.of(context).colorScheme;

    if (computed.error != null) {
      return Card(
        color: scheme.errorContainer,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.info_outline, color: scheme.onErrorContainer),
              const SizedBox(width: 8),
              Expanded(child: Text(computed.error!, style: TextStyle(color: scheme.onErrorContainer))),
            ],
          ),
        ),
      );
    }

    final payload = computed.payload;
    if (payload == null) {
      return const Text('Fill in the fields on the left to generate a QR code.');
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Center(
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: _backgroundColor,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: scheme.outlineVariant),
            ),
            child: QrImageView(
              data: payload,
              size: _size,
              backgroundColor: _backgroundColor,
              eyeStyle: QrEyeStyle(eyeShape: QrEyeShape.square, color: _foregroundColor),
              dataModuleStyle: QrDataModuleStyle(
                dataModuleShape: QrDataModuleShape.square,
                color: _foregroundColor,
              ),
              errorStateBuilder: (context, error) => SizedBox(
                width: _size,
                height: _size,
                child: Center(
                  child: Text(
                    'This payload is too long to encode as a QR code.\n'
                    'Shorten the content and try again.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: scheme.error),
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 20),
        Text('Payload text', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: SelectableText(
              payload,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontFamily: 'monospace'),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'Use the copy icon in the top bar to copy the payload text.',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
        ),
      ],
    );
  }
}
