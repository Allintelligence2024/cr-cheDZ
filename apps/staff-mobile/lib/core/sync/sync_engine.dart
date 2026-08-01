import 'dart:async';
import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../database/app_database.dart';
import '../network/sync_client.dart';

enum SyncStatus { idle, syncing, error, offline }

/// Moteur de synchronisation offline-first.
/// - push : file d'opérations locales (par lots de 50), idempotence par event_id.
/// - pull : changements serveur depuis le curseur (next_cursor).
/// - reprise : backoff exponentiel + déclenchement sur reconnexion.
class SyncEngine {
  SyncEngine(this._db, this._client);

  final AppDatabase _db;
  final SyncClient _client;
  final _uuid = const Uuid();

  /// Accès à la base locale (pages et repository).
  AppDatabase get database => _db;

  final _statusController = StreamController<SyncStatus>.broadcast();
  Stream<SyncStatus> get statusStream => _statusController.stream;

  SyncStatus currentStatus = SyncStatus.idle;
  bool _isSyncing = false;
  int _localSequence = 0;
  Timer? _syncTimer;
  Timer? _backoffTimer;
  int _backoffSeconds = 2;
  static const _cursorKey = 'sync_cursor';

  void startPeriodicSync({Duration interval = const Duration(seconds: 30)}) {
    _syncTimer?.cancel();
    _syncTimer = Timer.periodic(interval, (_) => sync());
    // Reconnexion → sync immédiate.
    Connectivity().onConnectivityChanged.listen((result) {
      if (result.contains(ConnectivityResult.none)) {
        _setStatus(SyncStatus.offline);
      } else {
        sync();
      }
    });
  }

  void stopPeriodicSync() {
    _syncTimer?.cancel();
    _backoffTimer?.cancel();
  }

  /// Enregistre une opération locale et tente une sync immédiate.
  Future<String> enqueue({
    required String command,
    required String entityType,
    String? entityId,
    required Map<String, dynamic> payload,
    int? baseVersion,
  }) async {
    final eventId = _uuid.v4();
    final operationId = _uuid.v4();
    _localSequence += 1;
    await _db.into(_db.pendingOperations).insert(
          PendingOperationsCompanion.insert(
            id: operationId,
            eventId: eventId,
            command: command,
            entityType: entityType,
            entityId: Value(entityId),
            payloadJson: jsonEncode(payload),
            baseVersion: Value(baseVersion),
            occurredAtDevice: DateTime.now().toIso8601String(),
            clientSequence: _localSequence,
            createdAt: DateTime.now().toIso8601String(),
          ),
        );
    sync();
    return eventId;
  }

  Future<void> sync() async {
    if (_isSyncing) return;
    final connectivity = await Connectivity().checkConnectivity();
    if (connectivity.contains(ConnectivityResult.none)) {
      _setStatus(SyncStatus.offline);
      return;
    }
    _isSyncing = true;
    _setStatus(SyncStatus.syncing);
    try {
      await _pushPending();
      await _pullChanges();
      _setStatus(SyncStatus.idle);
      _backoffSeconds = 2;
    } catch (_) {
      _setStatus(SyncStatus.error);
      // Backoff exponentiel : 2s, 4s, 8s… max 60s.
      _backoffTimer?.cancel();
      _backoffTimer = Timer(Duration(seconds: _backoffSeconds), sync);
      _backoffSeconds = (_backoffSeconds * 2).clamp(2, 60);
    } finally {
      _isSyncing = false;
    }
  }

  Future<void> _pushPending() async {
    final pending = await (_db.select(_db.pendingOperations)
          ..where((t) => t.status.equals('pending'))
          ..orderBy([(t) => OrderingTerm.asc(t.clientSequence)])
          ..limit(50))
        .get();
    if (pending.isEmpty) return;

    final operations = pending
        .map((op) => {
              'event_id': op.eventId,
              'client_sequence': op.clientSequence,
              'schema_version': 1,
              'command': op.command,
              'entity_type': op.entityType,
              'entity_id': op.entityId,
              'payload': jsonDecode(op.payloadJson),
              'base_version': op.baseVersion,
              'occurred_at_device': op.occurredAtDevice,
            })
        .toList();

    final result = await _client.push(operations);

    for (final eventId in (result['accepted'] as List<dynamic>? ?? [])) {
      await (_db.update(_db.pendingOperations)
            ..where((t) => t.eventId.equals(eventId as String)))
          .write(const PendingOperationsCompanion(status: Value('accepted')));
    }
    for (final rejected in (result['rejected'] as List<dynamic>? ?? [])) {
      final r = rejected as Map<String, dynamic>;
      await (_db.update(_db.pendingOperations)
            ..where((t) => t.eventId.equals(r['event_id'] as String)))
          .write(PendingOperationsCompanion(
        status: const Value('rejected'),
        lastError: Value(r['message'] as String? ?? 'rejected'),
      ));
    }
    for (final conflict in (result['conflicts'] as List<dynamic>? ?? [])) {
      final c = conflict as Map<String, dynamic>;
      await (_db.update(_db.pendingOperations)
            ..where((t) => t.eventId.equals(c['event_id'] as String)))
          .write(PendingOperationsCompanion(
        status: const Value('conflict'),
        lastError: Value(c['reason'] as String? ?? 'conflict'),
      ));
    }
  }

  Future<void> _pullChanges() async {
    final cursor = await _getLocalCursor();
    final result = await _client.pull(cursor);
    final events = result['events'] as List<dynamic>? ?? [];
    for (final event in events) {
      await _client.applyRemoteEvent(_db, event as Map<String, dynamic>);
    }
    // C09 : la clé serveur est `next_cursor` (pas `nextcursor`).
    final next = result['next_cursor'] as int? ?? cursor;
    if (next > cursor) {
      await _saveLocalCursor(next);
    }
  }

  Future<int> _getLocalCursor() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getInt(_cursorKey) ?? 0;
  }

  Future<void> _saveLocalCursor(int cursor) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_cursorKey, cursor);
  }

  /// Statut de présence du jour par enfant (depuis le miroir local).
  Future<Map<String, String>> attendanceStatusByChild(DateTime day) async {
    final dayStr = day.toIso8601String().substring(0, 10);
    final rows = await _db.select(_db.localAttendanceSessions).get();
    final map = <String, String>{};
    for (final row in rows) {
      if (row.sessionDate == dayStr) {
        map[row.childId] = row.status;
      }
    }
    return map;
  }

  void _setStatus(SyncStatus status) {
    currentStatus = status;
    _statusController.add(status);
  }

  void dispose() {
    stopPeriodicSync();
    _backoffTimer?.cancel();
    _statusController.close();
  }
}
