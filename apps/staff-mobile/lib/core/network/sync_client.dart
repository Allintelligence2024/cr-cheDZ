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
            serverVersion: Value(payload['version'] as int? ?? 0),
          ),
        );
      }
      else { throw const FormatException('Incomplete attendance event'); }
      return;
    }
    if (type == 'child') {
      final child = event['payload'] as Map<String, dynamic>;
      final id = _uuid(child['id']);
      final organizationId = _uuid(child['organization_id']);
      if (organizationId != db.scope.organizationId || _uuid(event['aggregate_id']) != id) {
        throw const FormatException('Cross-scope or mismatched child identity');
      }
      final version = child['version'];
      if (version is! int || version < 1) throw const FormatException('Invalid child version');
      final kind = event['event_type'];
      if (kind == 'deleted') {
        final removedAt = child['deleted_at'];
        if (removedAt is! String || !removedAt.contains('T') || DateTime.tryParse(removedAt) == null) {
          throw const FormatException('Invalid child tombstone');
        }
        // Only remove the child mirror. NEVER delete/reassign its operation queue.
        // The engine encloses projection changes and cursor in the same transaction.
        await (db.delete(db.localChildren)..where((t) => t.id.equals(id))).go();
        return;
      }
      if (kind != 'created' && kind != 'updated' && kind != 'snapshot') {
        throw FormatException('Unsupported child event: $kind');
      }
      final birth = child['date_of_birth'];
      final parsedBirth = birth is String ? DateTime.tryParse(birth) : null;
      if (birth is! String || !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(birth) ||
          parsedBirth == null || parsedBirth.toIso8601String().substring(0, 10) != birth) {
        throw const FormatException('Invalid child calendar date');
      }
      final walking = child['is_walking'];
      if (walking is! bool) throw const FormatException('Invalid child walking flag');
      await db.into(db.localChildren).insertOnConflictUpdate(
        LocalChildrenCompanion.insert(
          id: id, organizationId: organizationId,
          siteId: _uuid(child['site_id']),
          roomId: Value<String?>(child['room_id'] == null ? null : _uuid(child['room_id'])),
          firstNameFr: child['first_name_fr'] as String,
          firstNameAr: Value<String?>(child['first_name_ar'] as String?),
          lastNameFr: child['last_name_fr'] as String,
          lastNameAr: Value<String?>(child['last_name_ar'] as String?),
          dateOfBirth: birth,
          photoUrl: Value<String?>(child['photo_url'] as String?),
          status: child['status'] as String,
          isWalking: Value(walking), serverVersion: Value(version),
          syncedAt: Value(DateTime.now().toIso8601String()),
        ),
      );
      return;
    }
    if (type != 'attendance' && type != 'child') {
      throw FormatException('Unsupported projection: $type');
    }
  }

  static String _uuid(Object? value) {
    if (value is! String || !RegExp(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$').hasMatch(value)) {
      throw const FormatException('Invalid child identity');
    }
    return value.toLowerCase();
  }

}
