import 'dart:convert';
import '../network/generated/sync_wire_client.dart';

/// Local namespace only, NEVER an authorization decision. API verifies the JWT.
class SyncScope {
  SyncScope(String organizationId, String userId)
      : organizationId = organizationId.toLowerCase(), userId = userId.toLowerCase() {
    validateSync('RegisterResponse', {'device_id': this.organizationId});
    validateSync('RegisterResponse', {'device_id': this.userId});
  }
  final String organizationId;
  final String userId;
  String get key => '$organizationId-$userId';

  factory SyncScope.fromAccessToken(String token) {
    final parts = token.split('.');
    if (parts.length != 3) throw const FormatException('Invalid access token');
    final payload = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(parts[1])))) as Map<String, dynamic>;
    if (payload['purpose'] != 'access' || payload['organizationId'] is! String || payload['sub'] is! String) {
      throw const FormatException('Staff session requires an organization');
    }
    return SyncScope(payload['organizationId'] as String, payload['sub'] as String);
  }
}
