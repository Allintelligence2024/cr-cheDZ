import '../database/app_database.dart';

/// Client de synchronisation — push (file d'opérations) + pull (changelog).
/// C02 : le curseur serveur est une séquence (sync_seq), jamais l'horloge.
class SyncClient {
  SyncClient(this._api);

  final dynamic _api; // ApiClient — typé dans api_client.dart

  Future<Map<String, dynamic>> push(List<Map<String, dynamic>> operations) async {
    return _api.post<Map<String, dynamic>>('/sync/push', {'operations': operations});
  }

  Future<Map<String, dynamic>> pull(int cursor) async {
    return _api.get<Map<String, dynamic>>('/sync/pull', query: {'cursor': cursor});
  }

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
        // L'organisation est déduite des enfants locaux (une seule org/appareil).
        final childRow = await (db.select(db.localChildren)
              ..where((t) => t.id.equals(childId))
              ..limit(1))
            .getSingleOrNull();
        final orgId = childRow?.organizationId ?? '';
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
      return;
    }
    if (type == 'child') {
      final child = event['payload'] as Map<String, dynamic>;
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
    // attendance_event / daily_log / media : Phase 5-6 (synchro complète).
  }
}
