import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:livekit_client/livekit_client.dart' as lk;
import 'package:flutter_background/flutter_background.dart';

import 'api.dart';

/// Owns the media room, one-speaker floor lease, and push-to-talk lifecycle.
/// The microphone is only enabled after the server grants the floor.
class RadioController extends ChangeNotifier with WidgetsBindingObserver {
  RadioController(this._api) {
    WidgetsBinding.instance.addObserver(this);
  }

  final RelayApi _api;
  ChannelSession? session;
  lk.Room? room;
  bool connecting = false;
  bool backgroundListening = false;
  bool backgroundChanging = false;
  bool _backgrounded = false;
  bool transmitting = false;
  bool claiming = false;
  bool leaving = false;
  bool _pressed = false;
  bool _ending = false;
  bool _closed = false;
  String? errorMessage;
  String? floorSpeaker;
  String? _leaseId;
  Timer? _heartbeat;
  Timer? _floorPoll;
  Timer? _leaseDeadline;
  Timer? _sessionRefresh;
  bool _renewing = false;
  int _leaseExpiresAt = 0;

  bool get connected =>
      room != null && room!.connectionState == lk.ConnectionState.connected;
  bool get isBusy => floorSpeaker != null && !transmitting;
  int get listenerCount => (room?.remoteParticipants.length ?? 0) + (connected ? 1 : 0);
  List<String> get onlineNames => [
    if (connected) 'You',
    ...?room?.remoteParticipants.values.map(
      (person) => person.name.isNotEmpty ? person.name : 'Participant',
    ),
  ];
  String? get audibleSpeaker {
    if (transmitting) return 'You';
    final others = room?.remoteParticipants.values;
    if (others != null) {
      for (final person in others) {
        if (person.isSpeaking) return person.name.isNotEmpty ? person.name : 'Participant';
      }
    }
    return floorSpeaker;
  }

  Future<void> open(ChannelSession next) async {
    if (connecting || room != null) return;
    connecting = true;
    errorMessage = null;
    _notify();
    final nextRoom = lk.Room();
    try {
      await nextRoom.connect(next.credentials.serverUrl, next.credentials.participantToken);
      nextRoom.addListener(_onRoomChanged);
      session = next;
      room = nextRoom;
      _floorPoll = Timer.periodic(const Duration(seconds: 2), (_) => _pollFloor());
      unawaited(_pollFloor());
      _scheduleRefresh();
    } catch (e) {
      await nextRoom.dispose();
      errorMessage = 'Unable to connect to the voice channel: $e';
      rethrow;
    } finally {
      connecting = false;
      _notify();
    }
  }

  void _onRoomChanged() {
    _applyListening();
    if (!connected && (transmitting || claiming || _leaseId != null)) {
      unawaited(endTalking());
    }
    _notify();
  }

  Future<void> setBackgroundListening(bool enabled) async {
    if (backgroundChanging || session == null || _closed) return;
    backgroundChanging = true;
    errorMessage = null;
    final current = session;
    _notify();
    try {
      if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
        if (enabled) {
          const config = FlutterBackgroundAndroidConfig(
            notificationTitle: 'Cockie Talkie is listening',
            notificationText: 'Background listening enabled. Open the app to stop listening.',
            showBadge: false,
            enableWifiLock: true,
            shouldRequestBatteryOptimizationsOff: true,
          );
          if (!await FlutterBackground.initialize(androidConfig: config)) {
            throw StateError('Allow background execution to keep listening.');
          }
          if (_closed || session != current || leaving) return;
          if (!await FlutterBackground.enableBackgroundExecution()) {
            throw StateError('Background listening could not start.');
          }
          if (_closed || session != current || leaving) {
            await FlutterBackground.disableBackgroundExecution();
            return;
          }
        } else if (FlutterBackground.isBackgroundExecutionEnabled) {
          await FlutterBackground.disableBackgroundExecution();
        }
      }
      if (_closed || session != current || leaving) return;
      backgroundListening = enabled;
      _applyListening();
    } catch (_) {
      errorMessage = 'Background listening could not be changed. Check the app permissions and try again.';
    } finally {
      backgroundChanging = false;
      _notify();
    }
  }

  void _applyListening() {
    final audible = !_backgrounded || backgroundListening;
    for (final person in room?.remoteParticipants.values ?? <lk.RemoteParticipant>[]) {
      for (final publication in person.audioTrackPublications) {
        final track = publication.track;
        if (track != null && track.mediaStreamTrack.enabled != audible) {
          track.mediaStreamTrack.enabled = audible;
        }
      }
    }
  }

  Future<void> _pollFloor() async {
    final current = session;
    if (current == null || !connected) return;
    try {
      final status = await _api.floorStatus(current.credentials.sessionToken);
      if (session != current || _closed) return;
      floorSpeaker = status.busy ? status.speaker : null;
      _notify();
    } catch (_) {
      // Floor polling is informational; claiming still checks the server.
    }
  }

  Future<void> beginTalking() async {
    _pressed = true;
    if (_backgrounded || !connected || session == null || claiming || transmitting || _ending || leaving) return;
    claiming = true;
    errorMessage = null;
    _notify();
    final current = session!;
    try {
      final lease = await _api.claimFloor(current.credentials.sessionToken);
      _leaseId = lease.id;
      _armDeadline(lease.expiresAt);
      if (!_pressed || !connected || leaving || session != current ||
          DateTime.now().millisecondsSinceEpoch >= _leaseExpiresAt) {
        await _finishTalking();
        return;
      }
      await room!.localParticipant?.setMicrophoneEnabled(true);
      if (!_pressed || !connected || leaving || session != current ||
          DateTime.now().millisecondsSinceEpoch >= _leaseExpiresAt) {
        await _finishTalking();
        return;
      }
      transmitting = true;
      floorSpeaker = 'You';
      _heartbeat?.cancel();
      _heartbeat = Timer.periodic(const Duration(seconds: 5), (_) async {
        final lease = _leaseId;
        if (lease == null || session != current || _renewing) return;
        _renewing = true;
        try {
          final expiresAt = await _api.renewFloor(current.credentials.sessionToken, lease);
          if (_leaseId == lease && transmitting) _armDeadline(expiresAt);
        } catch (_) {
          if (_leaseId == lease) {
            errorMessage = 'Transmission stopped because the server connection was lost.';
            await endTalking();
          }
        } finally {
          _renewing = false;
        }
      });
    } on ApiFailure catch (e) {
      errorMessage = e.message;
      if (e.status == 409) unawaited(_pollFloor());
      if (_leaseId != null) await _finishTalking();
    } catch (e) {
      errorMessage = 'Microphone unavailable: $e';
      if (_leaseId != null) await _finishTalking();
    } finally {
      claiming = false;
      _notify();
    }
  }

  Future<void> endTalking() async {
    _pressed = false;
    // If the publish call is in flight, let beginTalking() finish it before
    // muting. Otherwise mute(false) could race publish(true).
    if (claiming || _leaseId == null || _ending) {
      _notify();
      return;
    }
    await _finishTalking();
  }

  void _armDeadline(int expiresAt) {
    _leaseExpiresAt = expiresAt - 500;
    _leaseDeadline?.cancel();
    final remaining = expiresAt - DateTime.now().millisecondsSinceEpoch - 500;
    _leaseDeadline = Timer(Duration(milliseconds: remaining > 0 ? remaining : 0), () {
      errorMessage = 'Transmission stopped because the speaking turn expired.';
      unawaited(endTalking());
    });
  }

  void _scheduleRefresh([Duration delay = const Duration(minutes: 50)]) {
    _sessionRefresh?.cancel();
    _sessionRefresh = Timer(delay, () => unawaited(_refreshSession()));
  }

  Future<void> _refreshSession() async {
    final current = session;
    if (current == null || leaving || _closed) return;
    try {
      final credentials = await _api.refreshSession(current.credentials.sessionToken);
      if (session != current || leaving || _closed) return;
      current.credentials = credentials;
      _scheduleRefresh();
    } on ApiFailure catch (e) {
      if (session != current || leaving || _closed) return;
      if (e.status == 401) {
        errorMessage = e.message;
        await endTalking();
      } else {
        _scheduleRefresh(const Duration(seconds: 30));
      }
    }
  }

  Future<void> _finishTalking() async {
    if (_ending) return;
    _ending = true;
    _heartbeat?.cancel();
    _heartbeat = null;
    _leaseDeadline?.cancel();
    _leaseDeadline = null;
    transmitting = false;
    _notify();
    final leaseId = _leaseId;
    _leaseId = null;
    final current = session;
    try {
      await room?.localParticipant?.setMicrophoneEnabled(false);
    } catch (_) {
      // Floor is still released even if the local media engine has failed.
    } finally {
      if (current != null && leaseId != null) {
        try {
          await _api.releaseFloor(current.credentials.sessionToken, leaseId);
        } catch (_) {
          // Server lease expires automatically if release cannot be delivered.
        }
      }
      floorSpeaker = null;
      _ending = false;
      _notify();
    }
  }

  Future<void> leave() async {
    if (leaving) return;
    leaving = true;
    _pressed = false;
    _notify();
    _floorPoll?.cancel();
    _floorPoll = null;
    _sessionRefresh?.cancel();
    _leaseDeadline?.cancel();
    await endTalking();
    // If a floor request is in flight, beginTalking() will release it when done.
    while (claiming) {
      await Future<void>.delayed(const Duration(milliseconds: 30));
    }
    backgroundListening = false;
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android &&
        FlutterBackground.isBackgroundExecutionEnabled) {
      try { await FlutterBackground.disableBackgroundExecution(); } catch (_) {}
    }
    final previousRoom = room;
    room = null;
    session = null;
    floorSpeaker = null;
    try {
      previousRoom?.removeListener(_onRoomChanged);
      await previousRoom?.disconnect();
      await previousRoom?.dispose();
    } finally {
      leaving = false;
      _notify();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _backgrounded = state != AppLifecycleState.resumed;
    _applyListening();
    if (state == AppLifecycleState.resumed) {
      unawaited(_refreshSession());
    }
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden ||
        state == AppLifecycleState.detached) {
      // Never allow a latched microphone when the app loses foreground focus.
      unawaited(endTalking());
    }
  }

  void _notify() {
    if (!_closed) notifyListeners();
  }

  @override
  void dispose() {
    _closed = true;
    WidgetsBinding.instance.removeObserver(this);
    _heartbeat?.cancel();
    _floorPoll?.cancel();
    _leaseDeadline?.cancel();
    _sessionRefresh?.cancel();
    unawaited(leave());
    super.dispose();
  }
}
