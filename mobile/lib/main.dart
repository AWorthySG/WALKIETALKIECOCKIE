import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'radio_controller.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const RelayApp());
}

const ink = Color(0xFF071522);
const panel = Color(0xFF102335);
const panelHighlight = Color(0xFF192F42);
const green = Color(0xFFCBF77B);
const mint = Color(0xFF85DBC6);
const cream = Color(0xFFF2F4EB);
const secondary = Color(0xFF8EA6B5);
const danger = Color(0xFFFFB7A8);

class RelayApp extends StatelessWidget {
  const RelayApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Cockie Talkie',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      fontFamily: 'Nunito',
      brightness: Brightness.dark,
      scaffoldBackgroundColor: ink,
      colorScheme: const ColorScheme.dark(
        primary: green,
        onPrimary: ink,
        surface: panel,
        onSurface: cream,
      ),
      textTheme: const TextTheme(
        headlineLarge: TextStyle(
          fontSize: 34,
          fontWeight: FontWeight.w800,
          color: cream,
          letterSpacing: -1.0,
        ),
        headlineSmall: TextStyle(
          fontSize: 24,
          fontWeight: FontWeight.w800,
          color: cream,
          letterSpacing: -0.6,
        ),
        bodyMedium: TextStyle(fontSize: 14, color: cream, height: 1.45),
      ),
    ),
    home: const RelayHome(),
  );
}

class RelayHome extends StatefulWidget {
  const RelayHome({super.key});
  @override
  State<RelayHome> createState() => _RelayHomeState();
}

class _RelayHomeState extends State<RelayHome> {
  late final RelayApi _api;
  late final RadioController _radio;
  final _name = TextEditingController();
  final _channelName = TextEditingController();
  final _inviteCode = TextEditingController();
  bool _creating = true;
  bool _loading = false;
  bool _showParticipants = false;
  String? _formError;

  @override
  void initState() {
    super.initState();
    _api = RelayApi();
    _radio = RadioController(_api)..addListener(_refresh);
    _loadName();
  }

  Future<void> _loadName() async {
    final prefs = await SharedPreferences.getInstance();
    if (mounted && _name.text.isEmpty) _name.text = prefs.getString('relay_display_name') ?? '';
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _radio.removeListener(_refresh);
    _radio.dispose();
    _api.dispose();
    _name.dispose();
    _channelName.dispose();
    _inviteCode.dispose();
    super.dispose();
  }

  Future<void> _enter() async {
    final displayName = _name.text.trim();
    final channel = _channelName.text.trim();
    final code = _inviteCode.text.trim();
    if (displayName.length < 2) {
      setState(() => _formError = 'Enter a name of at least 2 characters.');
      return;
    }
    if (_creating && channel.length < 2) {
      setState(() => _formError = 'Give your channel a name.');
      return;
    }
    if (!_creating && code.isEmpty) {
      setState(() => _formError = 'Enter the invite code you received.');
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() { _loading = true; _formError = null; });
    try {
      final session = _creating
          ? await _api.createChannel(channel, displayName)
          : await _api.joinChannel(code, displayName);
      await _radio.open(session);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('relay_display_name', displayName);
    } catch (e) {
      if (mounted) setState(() => _formError = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _leave() async {
    await _radio.leave();
    if (mounted) setState(() => _showParticipants = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          const Positioned.fill(child: _BackgroundDecoration()),
          SafeArea(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 250),
              child: _radio.session == null ? _buildLobby() : _buildChannel(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLobby() => SingleChildScrollView(
    key: const ValueKey('lobby'),
    padding: const EdgeInsets.fromLTRB(25, 22, 25, 36),
    child: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 470),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const _Wordmark(),
            const SizedBox(height: 20),
            Center(child: Image.asset('assets/brand/sticker.png', height: 270, fit: BoxFit.contain, semanticLabel: 'Cockie Talkie sausage characters')),
            const SizedBox(height: 20),
            const _Eyebrow('INSTANT VOICE. ANY DISTANCE.'),
            const SizedBox(height: 12),
            const Text('Your people,\none button away.', style: TextStyle(
              color: cream, fontWeight: FontWeight.w800, fontSize: 39,
              letterSpacing: -1.9, height: 1.08,
            )),
            const SizedBox(height: 15),
            const Text(
              'Make a private channel and speak to your group in real time, over Wi-Fi or mobile data.',
              style: TextStyle(color: secondary, fontSize: 15, height: 1.55),
            ),
            const SizedBox(height: 32),
            Container(
              padding: const EdgeInsets.all(21),
              decoration: BoxDecoration(
                color: panel,
                borderRadius: BorderRadius.circular(25),
                border: Border.all(color: Colors.white.withValues(alpha: .08)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Expanded(child: _ModeButton(
                      label: 'Create channel', selected: _creating,
                      onTap: () => setState(() { _creating = true; _formError = null; }),
                    )),
                    const SizedBox(width: 8),
                    Expanded(child: _ModeButton(
                      label: 'Join with code', selected: !_creating,
                      onTap: () => setState(() { _creating = false; _formError = null; }),
                    )),
                  ]),
                  const SizedBox(height: 26),
                  const _FieldLabel('YOUR NAME'),
                  const SizedBox(height: 8),
                  _TextField(controller: _name, hint: 'What should others call you?', icon: Icons.person_outline_rounded, maxLength: 24),
                  const SizedBox(height: 18),
                  _FieldLabel(_creating ? 'CHANNEL NAME' : 'INVITE CODE'),
                  const SizedBox(height: 8),
                  _creating
                      ? _TextField(controller: _channelName, hint: 'e.g. Family radio', icon: Icons.graphic_eq_rounded, maxLength: 40)
                      : _TextField(controller: _inviteCode, hint: 'XXXX-XXXX-XXXX-XXXX', icon: Icons.key_rounded, maxLength: 30, caps: true),
                  if (_formError != null) ...[
                    const SizedBox(height: 16),
                    Text(_formError!, style: const TextStyle(color: danger, fontSize: 13)),
                  ],
                  const SizedBox(height: 22),
                  FilledButton.icon(
                    onPressed: _loading ? null : _enter,
                    icon: _loading
                        ? const SizedBox(width: 17, height: 17, child: CircularProgressIndicator(strokeWidth: 2, color: ink))
                        : Icon(_creating ? Icons.arrow_forward_rounded : Icons.login_rounded),
                    label: Text(_loading ? 'Connecting…' : (_creating ? 'Create & connect' : 'Join channel')),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(55),
                      backgroundColor: green, foregroundColor: ink,
                      textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 22),
            const Row(children: [
              Icon(Icons.lock_outline_rounded, size: 16, color: mint),
              SizedBox(width: 9),
              Expanded(child: Text('Only people with your invite code can join.', style: TextStyle(color: secondary, fontSize: 12))),
            ]),
          ],
        ),
      ),
    ),
  );

  Widget _buildChannel() {
    final channel = _radio.session!;
    final speaking = _radio.transmitting;
    final finding = _radio.claiming && !speaking;
    final online = _radio.connected;
    final canSpeak = online && !_radio.leaving;
    final voice = _radio.audibleSpeaker;
    return LayoutBuilder(builder: (context, constraints) {
      return SingleChildScrollView(
        key: const ValueKey('channel'),
        padding: const EdgeInsets.fromLTRB(22, 18, 22, 32),
        child: Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: 530, minHeight: constraints.maxHeight - 50),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(children: [
                  const Expanded(child: _Wordmark()),
                  TextButton.icon(
                    onPressed: _radio.leaving ? null : _leave,
                    icon: const Icon(Icons.logout_rounded, size: 16),
                    label: const Text('Leave'),
                    style: TextButton.styleFrom(foregroundColor: secondary),
                  ),
                ]),
                const SizedBox(height: 32),
                const _Eyebrow('CURRENT CHANNEL'),
                const SizedBox(height: 8),
                Text(channel.name, style: Theme.of(context).textTheme.headlineLarge),
                const SizedBox(height: 15),
                Row(children: [
                  _Pill(
                    icon: Icons.circle,
                    label: online ? 'Connected' : 'Reconnecting',
                    tone: online ? mint : danger,
                  ),
                  const SizedBox(width: 9),
                  _Pill(icon: Icons.people_alt_outlined, label: '${_radio.listenerCount} online', tone: cream),
                ]),
                if (channel.inviteCode != null) ...[
                  const SizedBox(height: 18),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
                    decoration: BoxDecoration(color: panel, borderRadius: BorderRadius.circular(14)),
                    child: Row(children: [
                      const Icon(Icons.key_outlined, size: 19, color: mint),
                      const SizedBox(width: 11),
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        const Text('SHARE THIS INVITE CODE', style: TextStyle(color: secondary, fontSize: 9, fontWeight: FontWeight.w700, letterSpacing: 1)),
                        const SizedBox(height: 3),
                        FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft,
                          child: Text(channel.inviteCode!, style: const TextStyle(color: cream, fontSize: 15, fontWeight: FontWeight.w800, letterSpacing: 1.2))),
                      ])),
                      IconButton(
                        tooltip: 'Copy invite code',
                        icon: const Icon(Icons.copy_rounded, size: 19, color: green),
                        onPressed: () {
                          Clipboard.setData(ClipboardData(text: channel.inviteCode!));
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Invite code copied')));
                        },
                      ),
                    ]),
                  ),
                ],
                const SizedBox(height: 36),
                Center(child: Text(
                  speaking ? 'YOU ARE LIVE' : finding ? 'REQUESTING AIRTIME' : voice != null ? 'NOW TRANSMITTING' : 'CHANNEL IS CLEAR',
                  style: TextStyle(color: speaking ? green : secondary, letterSpacing: 2.2, fontSize: 11, fontWeight: FontWeight.w800),
                )),
                const SizedBox(height: 11),
                Center(child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 160),
                  child: Text(
                    speaking ? 'You' : finding ? 'One moment…' : voice ?? 'Ready to talk',
                    key: ValueKey('$speaking-$finding-$voice'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 23, color: cream, fontWeight: FontWeight.w700),
                  ),
                )),
                const SizedBox(height: 16),
                _TalkControl(
                  enabled: canSpeak,
                  transmitting: speaking,
                  acquiring: finding,
                  busy: _radio.isBusy,
                  onPress: () { unawaited(_radio.beginTalking()); },
                  onRelease: () { unawaited(_radio.endTalking()); },
                ),
                const SizedBox(height: 6),
                Center(child: Text(
                  speaking ? 'Release to stop transmitting' : 'Hold to talk  ·  Release to listen',
                  style: const TextStyle(color: secondary, fontSize: 13),
                )),
                if (_radio.errorMessage != null) ...[
                  const SizedBox(height: 13),
                  Center(child: Text(_radio.errorMessage!, textAlign: TextAlign.center,
                    style: const TextStyle(color: danger, fontSize: 12))),
                ],
                const SizedBox(height: 22),
                SwitchListTile.adaptive(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12),
                  title: const Text('Background listening'),
                  subtitle: const Text('Hear incoming speech while away. Microphone stays off. Android shows a quiet listening notification; iPhone reception depends on iOS.'),
                  value: _radio.backgroundListening,
                  onChanged: _radio.backgroundChanging || !online ? null : (value) { unawaited(_radio.setBackgroundListening(value)); },
                ),
                const SizedBox(height: 33),
                Container(
                  decoration: BoxDecoration(
                    color: panel, borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: Colors.white.withValues(alpha: .06)),
                  ),
                  child: Column(children: [
                    InkWell(
                      borderRadius: BorderRadius.circular(20),
                      onTap: () => setState(() => _showParticipants = !_showParticipants),
                      child: Padding(
                        padding: const EdgeInsets.all(18),
                        child: Row(children: [
                          const Icon(Icons.headset_mic_rounded, color: mint, size: 22),
                          const SizedBox(width: 12),
                          Expanded(child: Text('People on this channel', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700))),
                          Icon(_showParticipants ? Icons.keyboard_arrow_up_rounded : Icons.keyboard_arrow_down_rounded, color: secondary),
                        ]),
                      ),
                    ),
                    if (_showParticipants) ...[
                      const Divider(height: 1, color: panelHighlight),
                      for (final person in _radio.onlineNames)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(20, 11, 20, 11),
                          child: Row(children: [
                            const Icon(Icons.circle, color: mint, size: 8),
                            const SizedBox(width: 12),
                            Expanded(child: Text(person, style: const TextStyle(color: cream))),
                          ]),
                        ),
                    ],
                  ]),
                ),
                const SizedBox(height: 22),
                const Text(
                  'Your microphone stays off until you hold the button and receive airtime. Leave the channel when finished.',
                  style: TextStyle(color: secondary, fontSize: 11, height: 1.5),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      );
    });
  }
}

class _BackgroundDecoration extends StatelessWidget {
  const _BackgroundDecoration();
  @override
  Widget build(BuildContext context) => IgnorePointer(
    child: Stack(children: [
      Positioned(top: -120, right: -130, child: Container(
        width: 345, height: 345,
        decoration: BoxDecoration(shape: BoxShape.circle,
          gradient: RadialGradient(colors: [const Color(0xFF20485A).withValues(alpha: .44), ink.withValues(alpha: 0)])),
      )),
      Positioned(bottom: -190, left: -170, child: Container(
        width: 425, height: 425,
        decoration: BoxDecoration(shape: BoxShape.circle,
          gradient: RadialGradient(colors: [const Color(0xFF2B433B).withValues(alpha: .25), ink.withValues(alpha: 0)])),
      )),
    ]),
  );
}

class _Wordmark extends StatelessWidget {
  const _Wordmark();
  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
    Image.asset('assets/brand/sticker.png', width: 52, height: 52, fit: BoxFit.contain),
    const SizedBox(width: 11),
    const Flexible(child: Text('COCKIE TALKIE', style: TextStyle(color: cream, fontWeight: FontWeight.w900, fontSize: 18, letterSpacing: 0.5))),

  ]);
}

class _Eyebrow extends StatelessWidget {
  const _Eyebrow(this.label);
  final String label;
  @override
  Widget build(BuildContext context) => Text(label,
    style: const TextStyle(color: mint, fontSize: 10, fontWeight: FontWeight.w900, letterSpacing: 2.1));
}

class _ModeButton extends StatelessWidget {
  const _ModeButton({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Material(
    color: selected ? panelHighlight : Colors.transparent,
    borderRadius: BorderRadius.circular(12),
    child: InkWell(
      onTap: onTap, borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 5),
        decoration: BoxDecoration(
          border: Border.all(color: selected ? mint.withValues(alpha: .35) : Colors.white.withValues(alpha: .07)),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(label, textAlign: TextAlign.center, style: TextStyle(
          color: selected ? cream : secondary, fontWeight: FontWeight.w700, fontSize: 12,
        )),
      ),
    ),
  );
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.label);
  final String label;
  @override
  Widget build(BuildContext context) => Text(label,
    style: const TextStyle(fontSize: 10, color: secondary, fontWeight: FontWeight.w800, letterSpacing: 1.5));
}

class _TextField extends StatelessWidget {
  const _TextField({required this.controller, required this.hint, required this.icon, required this.maxLength, this.caps = false});
  final TextEditingController controller;
  final String hint;
  final IconData icon;
  final int maxLength;
  final bool caps;
  @override
  Widget build(BuildContext context) => TextField(
    controller: controller,
    maxLength: maxLength,
    textCapitalization: caps ? TextCapitalization.characters : TextCapitalization.sentences,
    style: const TextStyle(color: cream, fontSize: 14),
    decoration: InputDecoration(
      filled: true,
      fillColor: ink.withValues(alpha: .55),
      hintText: hint, hintStyle: const TextStyle(color: secondary, fontSize: 13),
      prefixIcon: Icon(icon, color: secondary, size: 21),
      counterText: '',
      contentPadding: const EdgeInsets.symmetric(vertical: 16),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(13), borderSide: BorderSide(color: Colors.white.withValues(alpha: .09))),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(13), borderSide: const BorderSide(color: mint, width: 1.5)),
    ),
  );
}

class _Pill extends StatelessWidget {
  const _Pill({required this.icon, required this.label, required this.tone});
  final IconData icon;
  final String label;
  final Color tone;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
    decoration: BoxDecoration(borderRadius: BorderRadius.circular(50), color: panel),
    child: Row(mainAxisSize: MainAxisSize.min, children: [
      Icon(icon, color: tone, size: 10), const SizedBox(width: 6),
      Text(label, style: TextStyle(color: tone, fontSize: 11, fontWeight: FontWeight.w700)),
    ]),
  );
}

class _TalkControl extends StatelessWidget {
  const _TalkControl({
    required this.enabled, required this.transmitting, required this.acquiring,
    required this.busy, required this.onPress, required this.onRelease,
  });
  final bool enabled;
  final bool transmitting;
  final bool acquiring;
  final bool busy;
  final VoidCallback onPress;
  final VoidCallback onRelease;

  @override
  Widget build(BuildContext context) {
    final colour = transmitting ? mint : (busy ? secondary : green);
    return Semantics(
      button: true,
      enabled: enabled,
      label: 'Push to talk. Hold while speaking, release to listen.',
      child: Listener(
        behavior: HitTestBehavior.opaque,
        onPointerDown: enabled ? (_) => onPress() : null,
        onPointerUp: enabled ? (_) => onRelease() : null,
        onPointerCancel: enabled ? (_) => onRelease() : null,
        child: Center(
          child: SizedBox(
            width: 292,
            height: 292,
            child: Stack(alignment: Alignment.center, children: [
              _TalkRing(size: 288, color: colour, opacity: transmitting ? .24 : .10),
              _TalkRing(size: 257, color: colour, opacity: transmitting ? .46 : .22),
              AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                width: 221, height: 221,
                decoration: BoxDecoration(
                  color: colour,
                  shape: BoxShape.circle,
                  boxShadow: [BoxShadow(
                    color: colour.withValues(alpha: transmitting ? .26 : .09),
                    blurRadius: transmitting ? 46 : 24,
                    spreadRadius: transmitting ? 9 : 0,
                  )],
                ),
                child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Icon(transmitting ? Icons.graphic_eq_rounded : Icons.mic_rounded,
                    color: ink, size: 57),
                  const SizedBox(height: 10),
                  Text(
                    transmitting ? 'TRANSMITTING' : acquiring ? 'CONNECTING' : 'PUSH TO TALK',
                    style: const TextStyle(color: ink, fontSize: 14, fontWeight: FontWeight.w900, letterSpacing: 1.4),
                  ),
                  const SizedBox(height: 5),
                  Text(transmitting ? 'ON AIR' : 'HOLD BUTTON', style: TextStyle(color: ink.withValues(alpha: .7), fontSize: 10, fontWeight: FontWeight.w800, letterSpacing: 1.8)),
                ]),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}

class _TalkRing extends StatelessWidget {
  const _TalkRing({required this.size, required this.color, required this.opacity});
  final double size;
  final Color color;
  final double opacity;
  @override
  Widget build(BuildContext context) => Container(
    width: size, height: size,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      border: Border.all(color: color.withValues(alpha: opacity), width: 2),
    ),
  );
}
