import 'dart:convert';

import 'package:http/http.dart' as http;

const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'https://relay-walkie-api.jeremylimguanfong.workers.dev',
);

class ApiFailure implements Exception {
  const ApiFailure(this.message, [this.status = 0]);
  final String message;
  final int status;
  @override
  String toString() => message;
}

class ChannelCredentials {
  const ChannelCredentials({
    required this.serverUrl,
    required this.participantToken,
    required this.sessionToken,
    required this.participantId,
  });
  final String serverUrl;
  final String participantToken;
  final String sessionToken;
  final String participantId;

  factory ChannelCredentials.fromJson(Map<String, dynamic> data) =>
      ChannelCredentials(
        serverUrl: data['serverUrl'] as String,
        participantToken: data['participantToken'] as String,
        sessionToken: data['sessionToken'] as String,
        participantId: data['participantId'] as String,
      );
}

class ChannelSession {
  ChannelSession({
    required this.id,
    required this.name,
    required this.credentials,
    this.inviteCode,
  });
  final String id;
  final String name;
  final String? inviteCode;
  ChannelCredentials credentials;

  factory ChannelSession.fromJson(Map<String, dynamic> data) {
    final channel = data['channel'] as Map<String, dynamic>;
    return ChannelSession(
      id: channel['id'] as String,
      name: channel['name'] as String,
      inviteCode: channel['code'] as String?,
      credentials: ChannelCredentials.fromJson(
        data['credentials'] as Map<String, dynamic>,
      ),
    );
  }
}

class FloorLease {
  const FloorLease({required this.id, required this.expiresAt});
  final String id;
  final int expiresAt;
}

class FloorStatus {
  const FloorStatus({required this.busy, this.speaker});
  final bool busy;
  final String? speaker;
}

/// Times a lease with this device's clock when the server reports its duration,
/// so a phone clock ahead of the server cannot cancel every press.
int leaseExpiry(Map<String, dynamic> response, {int? now}) {
  final duration = response['leaseDurationMs'];
  if (duration is int) return (now ?? DateTime.now().millisecondsSinceEpoch) + duration;
  return response['expiresAt'] as int;
}

class RelayApi {
  RelayApi({http.Client? client}) : _http = client ?? http.Client();
  final http.Client _http;

  Future<Map<String, dynamic>> _request(
    String method,
    String route, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    try {
      final url = Uri.parse('$apiBaseUrl$route');
      final headers = <String, String>{
        'Accept': 'application/json',
        if (method == 'POST') 'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      };
      final http.Response res;
      if (method == 'POST') {
        res = await _http
            .post(url, headers: headers, body: jsonEncode(body ?? {}))
            .timeout(const Duration(seconds: 8));
      } else {
        res = await _http
            .get(url, headers: headers)
            .timeout(const Duration(seconds: 8));
      }
      Map<String, dynamic> data;
      try {
        data = jsonDecode(res.body) as Map<String, dynamic>;
      } catch (_) {
        throw const ApiFailure('Unexpected response from server.');
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw ApiFailure(
          data['error']?.toString() ?? 'Server rejected the request.',
          res.statusCode,
        );
      }
      return data;
    } on ApiFailure {
      rethrow;
    } catch (_) {
      throw const ApiFailure(
        'Cannot reach the Cockie Talkie server. Check your internet connection and API URL.',
      );
    }
  }

  /// Joins one of the 20 shared numbered channels used by the browser app.
  Future<ChannelSession> tuneChannel(int number, String displayName) async {
    final response = await _request(
      'POST',
      '/v1/channels/tune',
      body: {'number': number, 'displayName': displayName},
    );
    return ChannelSession.fromJson(response);
  }

  /// Starts a private family channel; the response carries its invite code.
  Future<ChannelSession> createChannel(String name, String displayName) async {
    final response = await _request(
      'POST',
      '/v1/channels',
      body: {'name': name, 'displayName': displayName},
    );
    return ChannelSession.fromJson(response);
  }

  Future<ChannelSession> joinChannel(String code, String displayName) async {
    final response = await _request(
      'POST',
      '/v1/channels/join',
      body: {'code': code, 'displayName': displayName},
    );
    return ChannelSession.fromJson(response);
  }

  Future<FloorLease> claimFloor(String token) async {
    final response = await _request(
      'POST',
      '/v1/floor/claim',
      token: token,
    );
    return FloorLease(id: response['leaseId'] as String, expiresAt: leaseExpiry(response));
  }

  Future<int> renewFloor(String token, String leaseId) async {
    final response = await _request(
      'POST',
      '/v1/floor/renew',
      token: token,
      body: {'leaseId': leaseId},
    );
    return leaseExpiry(response);
  }

  Future<void> releaseFloor(String token, String leaseId) async {
    await _request(
      'POST',
      '/v1/floor/release',
      token: token,
      body: {'leaseId': leaseId},
    );
  }

  Future<FloorStatus> floorStatus(String token) async {
    final data = await _request(
      'POST',
      '/v1/floor/status',
      token: token,
    );
    return FloorStatus(
      busy: data['busy'] as bool? ?? false,
      speaker: data['speaker'] as String?,
    );
  }

  Future<ChannelCredentials> refreshSession(String token) async {
    final data = await _request('POST', '/v1/session/refresh', token: token);
    return ChannelCredentials.fromJson(data['credentials'] as Map<String, dynamic>);
  }

  void dispose() => _http.close();
}
