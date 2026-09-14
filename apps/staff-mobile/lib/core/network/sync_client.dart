import '../database/app_database.dart';
import 'api_client.dart';
import 'generated/sync_wire_client.dart';

/// Client de synchronisation — push (file d'opérations) + pull (changelog).
/// C02 : le curseur serveur est une séquence (sync_seq), jamais l'horloge.
class SyncClient {
  SyncClient(this._api) {
    _wire = SyncWireClient((method, path, data) => method == 'GET'
      ? _api.get<Map<String, dynamic>>(path, query: data)
      : _api.post<Map<String, dynamic>>(path, data));
  }
  final ApiClient _api;
  late final SyncWireClient _wire;
  void close() => _api.close();

  Future<String> register(String fingerprint, String platform) async {
    final response = await _wire.registerDevice({
      'name': 'Crèche personnel', 'device_fingerprint': fingerprint,
      'platform': platform, 'app_version': '0.1.0',
    });
    return response['device_id'] as String;
  }

  Future<Map<String, dynamic>> push(List<Map<String, dynamic>> operations, {String? deviceId}) =>
      _wire.push({'device_id': deviceId, 'operations': operations});

  Future<Map<String, dynamic>> pull(Object cursor, {String? deviceId}) =>
      _wire.pull({'device_id': deviceId, 'cursor': cursor});

  /// Mise à jour de la base locale à partir d'un événement du changelog.
  Future<void> applyRemoteEvent(AppDatabase db, Map<String, dynamic> event) async {
    final type = event['type'] as String;
    final payload = (event['payload'] as Map<String, dynamic>?) ?? {};
    if (type == 'attendance') {
      // Événement de présence : mise à jour du miroir local de la session.
      final sessionId = payload['session_id'] as String?;
      final childId = payload['child_id'] as String?;
      final sessionDate = payload['session_date'] as String?;
      final status = payload['status'] as String?;
      if (sessionId != null && childId != null && sessionDate != null && status != null) {
        final orgId = db.scope.organizationId;
        await db.into(db.localAttendanceSessions).insertOnConflictUpdate(
          LocalAttendanceSessionsCompanion.insert(
            id: sessionId,
            organizationId: orgId,
            childId: childId,
            sessionDate: sessionDate,
            status: status,
            updatedAt: DateTime.now().toIso8601String(),
          ),
        );
      }
      else { throw const FormatException('Incomplete attendance event'); }
      return;
    }
    if (type == 'child') {
      final child = event['payload'] as Map<String, dynamic>;
      if (child['organization_id'] != db.scope.organizationId) throw const FormatException('Cross-scope child event');
      await db.into(db.localChildren).insertOnConflictUpdate(
            LocalChildrenCompanion.insert(
              id: child['id'] as String,
              organizationId: child['organization_id'] as String,
              siteId: child['site_id'] as String,
              roomId: Value<String?>(child['room_id'] as String?),
              firstNameFr: child['first_name_fr'] as String,
              firstNameAr: Value<String?>(child['first_name_ar'] as String?),
              lastNameFr: child['last_name_fr'] as String,
              lastNameAr: Value<String?>(child['last_name_ar'] as String?),
              dateOfBirth: child['date_of_birth'] as String,
              photoUrl: Value<String?>(child['photo_url'] as String?),
              status: child['status'] as String,
              isWalking: Value(child['is_walking'] as bool? ?? false),
              serverVersion: Value(child['version'] as int? ?? 0),
              syncedAt: Value(DateTime.now().toIso8601String()),
            ),
          );
    }
    if (type != 'attendance' && type != 'child') {
      throw FormatException('Unsupported projection: $type');
    }
  }
}
