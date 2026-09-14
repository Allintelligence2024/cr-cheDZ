import 'dart:convert';
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
    if (type == 'daily_log' || type == 'media') {
      final id = _uuid(event['aggregate_id']);
      final organizationId = db.scope.organizationId;
      // The current minimal payload has no tenant field; scope comes from the
      // authenticated pull and scoped database. Reject contradictory envelopes.
      if (payload.containsKey('organization_id') && _uuid(payload['organization_id']) != organizationId) {
        throw const FormatException('Cross-scope projection');
      }
      final createdAt = _instant(event['created_at']);
      if (type == 'daily_log') {
        final kind = payload['event_type'];
        const kinds = {'meal', 'nap_start', 'nap_end', 'diaper', 'activity',
          'temperature', 'note', 'health_observation', 'incident'};
        if (kind is! String || !kinds.contains(kind) || event['event_type'] != kind) {
          throw const FormatException('Unsupported or mismatched journal kind');
        }
        final childId = _uuid(payload['child_id']);
        final day = _calendarDate(payload['event_date']);
        final occurredAt = _instant(payload['occurred_at']);
        // Explicit whitelist: never copy future private/medical fields silently.
        final metadata = {'child_id': childId, 'event_type': kind,
          'event_date': day, 'occurred_at': occurredAt};
        await db.into(db.localDailyEvents).insertOnConflictUpdate(
          LocalDailyEventsCompanion.insert(
            id: id, organizationId: organizationId, childId: childId,
            eventDate: day, eventType: kind, occurredAt: occurredAt,
            payloadJson: jsonEncode(metadata), isSynced: const Value(true),
            createdAt: createdAt,
          ),
        );
      } else {
        if (_uuid(payload['media_id']) != id || event['event_type'] != 'media_registered') {
          throw const FormatException('Unsupported or mismatched media identity');
        }
        final kind = payload['media_type'];
        if (kind != 'photo' && kind != 'document') throw const FormatException('Unsupported media type');
        final childId = payload['child_id'] == null ? null : _uuid(payload['child_id']);
        await db.customStatement(
          'INSERT INTO local_media(id,organization_id,child_id,media_type,created_at) VALUES(?,?,?,?,?) '
          'ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id, '
          'child_id=excluded.child_id,media_type=excluded.media_type,created_at=excluded.created_at',
          [id, organizationId, childId, kind, createdAt],
        );
      }
      return;
    }
    throw FormatException('Unsupported projection: $type');
  }

  static String _calendarDate(Object? value) {
    final parsed = value is String ? DateTime.tryParse(value) : null;
    if (value is! String || !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value) ||
        parsed == null || parsed.toIso8601String().substring(0, 10) != value) {
      throw const FormatException('Invalid journal calendar date');
    }
    return value;
  }

  static String _instant(Object? value) {
    if (value is! String || !value.contains('T') || DateTime.tryParse(value) == null) {
      throw const FormatException('Invalid projection timestamp');
    }
    return value;
  }

  static String _uuid(Object? value) {
    if (value is! String || !RegExp(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$').hasMatch(value)) {
      throw const FormatException('Invalid projection identity');
    }
    return value.toLowerCase();
  }

}
