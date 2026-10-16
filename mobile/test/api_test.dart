import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:relay_walkie/api.dart';

void main() {
  test('lease expiry uses the local clock when the server sends a duration', () {
    expect(leaseExpiry({'expiresAt': 5, 'leaseDurationMs': 12000}, now: 1000), 13000);
    expect(leaseExpiry({'expiresAt': 5}, now: 1000), 5);
  });

  test('tuneChannel posts the channel number and parses the session', () async {
    late Map<String, dynamic> sent;
    final client = MockClient((request) async {
      expect(request.url.path, '/v1/channels/tune');
      sent = jsonDecode(request.body) as Map<String, dynamic>;
      return http.Response(jsonEncode({
        'channel': {'id': 'numbered-07', 'name': 'Channel 7', 'number': 7, 'shared': true},
        'credentials': {'serverUrl': 'wss://x.livekit.cloud', 'participantToken': 'p', 'sessionToken': 's', 'participantId': 'id'},
      }), 200);
    });
    final session = await RelayApi(client: client).tuneChannel(7, 'Alice');
    expect(sent, {'number': 7, 'displayName': 'Alice'});
    expect(session.name, 'Channel 7');
    expect(session.inviteCode, isNull);
  });

  test('joinChannel posts the invite code', () async {
    late Map<String, dynamic> sent;
    final client = MockClient((request) async {
      expect(request.url.path, '/v1/channels/join');
      sent = jsonDecode(request.body) as Map<String, dynamic>;
      return http.Response(jsonEncode({
        'channel': {'id': 'c1', 'name': 'Family'},
        'credentials': {'serverUrl': 'wss://x.livekit.cloud', 'participantToken': 'p', 'sessionToken': 's', 'participantId': 'id'},
      }), 200);
    });
    final session = await RelayApi(client: client).joinChannel('ABCD-EFGH-JKMN-PQ23', 'Dad');
    expect(sent, {'code': 'ABCD-EFGH-JKMN-PQ23', 'displayName': 'Dad'});
    expect(session.name, 'Family');
  });

  test('server errors surface their message', () async {
    final client = MockClient((_) async => http.Response(jsonEncode({'error': 'Choose a channel from 1 to 20.'}), 400));
    expect(
      () => RelayApi(client: client).tuneChannel(21, 'Alice'),
      throwsA(isA<ApiFailure>().having((e) => e.message, 'message', 'Choose a channel from 1 to 20.')),
    );
  });
}
