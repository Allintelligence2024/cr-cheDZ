import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:uuid/uuid.dart';
import '../database/app_database.dart';
import '../network/sync_client.dart';
import '../network/generated/sync_wire_client.dart';

enum SyncStatus { idle, syncing, error, offline, authenticationRequired, contractError, deviceRevoked }

class _DeviceRevoked implements Exception {}
class _RetryableSync implements Exception {}
class _Stopped implements Exception {}

/// One engine + one database + one immutable API session per tenant/user scope.
class SyncEngine {
  SyncEngine(this._db, this._client, {
    Future<bool> Function()? isOnline,
    Stream<bool>? connectionChanges,
    String? platform,
  }) : _isOnline = isOnline ?? (() async => !(await Connectivity().checkConnectivity()).contains(ConnectivityResult.none)),
       _changes = connectionChanges ?? Connectivity().onConnectivityChanged.map((r) => !r.contains(ConnectivityResult.none)),
       _platform = platform ?? (Platform.isIOS ? 'ios' : 'android');

  final AppDatabase _db;
  final SyncClient _client;
  final Future<bool> Function() _isOnline;
  final Stream<bool> _changes;
  final String _platform;
  final _uuid = const Uuid();
  AppDatabase get database => _db;
  final _statusController = StreamController<SyncStatus>.broadcast();
  Stream<SyncStatus> get statusStream => _statusController.stream;
  SyncStatus currentStatus = SyncStatus.idle;
  Future<void>? _flight;
  Future<void>? _closing;
  bool _stopped = false;
  bool _blocked = false;
  Timer? _syncTimer;
  Timer? _backoffTimer;
  StreamSubscription<bool>? _subscription;
  int _listenerEpoch = 0;
  int _backoffSeconds = 2;

  void startPeriodicSync({Duration interval = const Duration(seconds: 30)}) {
    stopPeriodicSync();
    if (_stopped || _blocked) return;
    final epoch = _listenerEpoch;
    _syncTimer = Timer.periodic(interval, (_) => unawaited(sync()));
    _subscription = _changes.listen((online) {
      if (_stopped || _blocked || epoch != _listenerEpoch) return;
      if (online) { unawaited(sync()); } else { _setStatus(SyncStatus.offline); }
    });
  }

  void stopPeriodicSync() {
    _listenerEpoch++;
    _syncTimer?.cancel(); _syncTimer = null;
    _backoffTimer?.cancel(); _backoffTimer = null;
    final sub = _subscription; _subscription = null;
    if (sub != null) unawaited(sub.cancel());
  }

  void _ensureRunning() { if (_stopped) throw _Stopped(); }

  Future<String> enqueue({required String command, required String entityType,
    String? entityId, required Map<String, dynamic> payload, int? baseVersion}) async {
    _ensureRunning();
    final eventId = _uuid.v4();
    await _db.transaction(() async {
      _ensureRunning();
      final sequence = await _db.nextClientSequence();
      await _db.into(_db.pendingOperations).insert(PendingOperationsCompanion.insert(
        id: _uuid.v4(), eventId: eventId, command: command, entityType: entityType,
        entityId: Value(entityId), payloadJson: jsonEncode(payload), baseVersion: Value(baseVersion),
        occurredAtDevice: DateTime.now().toUtc().toIso8601String(), clientSequence: sequence,
        createdAt: DateTime.now().toUtc().toIso8601String(),
      ));
      _ensureRunning();
    });
    unawaited(sync());
    return eventId;
  }

  Future<void> sync() {
    if (_stopped || _blocked) return Future.value();
    // Set the single-flight guard BEFORE the first connectivity/network await.
    return _flight ??= _run().whenComplete(() => _flight = null);
  }

  Future<void> _run() async {
    try {
      if (!await _isOnline()) { _setStatus(SyncStatus.offline); return; }
      _ensureRunning(); _setStatus(SyncStatus.syncing);
      final state = await _db.syncState();
      _ensureRunning();
      var device = state['device_id'] as String?;
      if (device == null) {
        // Fingerprint already committed: retry after lost response reuses it.
        device = await _client.register(state['fingerprint'] as String, _platform);
        _ensureRunning();
        await _db.saveDevice(device);
      }
      // Bounded cycles keep the UI responsive; periodic sync drains the rest.
      for (var n = 0; n < 10; n++) { if (!await _pushPending(device)) break; }
      for (var n = 0; n < 20; n++) { if (!await _pullPage(device)) break; }
      _ensureRunning(); _backoffSeconds = 2; _setStatus(SyncStatus.idle);
    } on _Stopped { return;
    } on _DeviceRevoked { _block(SyncStatus.deviceRevoked);
    } on FormatException { _block(SyncStatus.contractError);
    } on TypeError { _block(SyncStatus.contractError);
    } on StateError { _block(SyncStatus.contractError);
    } on DioException catch (error) {
      if (_stopped) return;
      final code = error.response?.statusCode;
      if (code == 401) { _block(SyncStatus.authenticationRequired); }
      else if (code == 403) { _block(SyncStatus.deviceRevoked); }
      else if (code != null && code >= 400 && code < 500 && code != 429 && code != 408) { _block(SyncStatus.contractError); }
      else { _retry(); }
    } catch (_) { if (!_stopped) _retry(); }
  }

  void _block(SyncStatus status) {
    if (_stopped) return;
    _blocked = true; stopPeriodicSync(); _setStatus(status);
  }
  void _retry() {
    if (_stopped || _blocked) return;
    _setStatus(SyncStatus.error); _backoffTimer?.cancel();
    _backoffTimer = Timer(Duration(seconds: _backoffSeconds), () => unawaited(sync()));
    _backoffSeconds = (_backoffSeconds * 2).clamp(2, 60);
  }

  Future<bool> _pushPending(String device) async {
    _ensureRunning();
    final pending = await (_db.select(_db.pendingOperations)
      ..where((t) => t.status.equals('pending'))
      ..orderBy([(t) => OrderingTerm.asc(t.clientSequence)])..limit(50)).get();
    if (pending.isEmpty) return false;
    final operations = pending.map((op) => <String, dynamic>{
      'event_id': op.eventId, 'client_sequence': op.clientSequence, 'schema_version': 1,
      'command': op.command, 'entity_type': op.entityType, 'entity_id': op.entityId,
      'payload': jsonDecode(op.payloadJson), 'base_version': op.baseVersion,
      'occurred_at_device': op.occurredAtDevice,
    }).toList();
    final result = await _client.push(operations, deviceId: device);
    _ensureRunning();
    final sent = pending.map((op) => op.eventId).toSet();
    final outcomes = <String, Map<String, String>>{};
    void record(String id, String status, String message) {
      if (!sent.contains(id) || outcomes.containsKey(id)) throw const FormatException('Ambiguous push acknowledgement');
      outcomes[id] = {'status': status, 'message': message};
    }
    for (final id in result['accepted'] as List) { record(id as String, 'accepted', ''); }
    for (final item in result['rejected'] as List) {
      if (item['reason'] == 'DEVICE_REVOKED') throw _DeviceRevoked();
      record(item['event_id'] as String, item['reason'] == 'INTERNAL_ERROR' ? 'pending' : 'rejected', item['reason'] as String);
    }
    for (final item in result['conflicts'] as List) { record(item['event_id'] as String, 'conflict', item['reason'] as String); }
    await _db.transaction(() async {
      _ensureRunning();
      for (final entry in outcomes.entries) {
        await (_db.update(_db.pendingOperations)..where((t) => t.eventId.equals(entry.key)))
          .write(PendingOperationsCompanion(status: Value(entry.value['status']!), lastError: Value(entry.value['message'])));
      }
      _ensureRunning();
    });
    // Missing or transient outcomes remain pending, never silently acknowledged.
    if (outcomes.length != sent.length || outcomes.values.any((v) => v['status'] == 'pending')) throw _RetryableSync();
    // result.next_cursor is NOT a pull acknowledgement.
    return pending.length == 50;
  }

  Future<bool> _pullPage(String device) async {
    _ensureRunning();
    final cursor = syncCursor((await _db.syncState())['cursor']);
    final page = await _client.pull(cursor, deviceId: device);
    _ensureRunning();
    final next = syncCursor(page['next_cursor']);
    final events = (page['events'] as List).cast<Map<String, dynamic>>();
    var previous = BigInt.parse(cursor);
    for (final event in events) {
      final sequence = BigInt.parse(syncCursor(event['sync_seq']));
      if (sequence <= previous) throw const FormatException('Non-monotonic page');
      previous = sequence;
    }
    if (next != (events.isEmpty ? cursor : events.last['sync_seq'])) throw const FormatException('Invalid page watermark');
    await _db.transaction(() async {
      _ensureRunning();
      for (final event in events) { await _client.applyRemoteEvent(_db, event); _ensureRunning(); }
      await _db.saveCursor(next);
      _ensureRunning();
    });
    return events.isNotEmpty;
  }

  Future<Map<String, String>> attendanceStatusByChild(DateTime day) async {
    final date = day.toIso8601String().substring(0, 10);
    final rows = await _db.select(_db.localAttendanceSessions).get();
    return {for (final row in rows) if (row.sessionDate == date) row.childId: row.status};
  }
  void _setStatus(SyncStatus status) {
    if (_stopped) return;
    currentStatus = status; _statusController.add(status);
  }

  Future<void> close() => _closing ??= _close();
  Future<void> _close() async {
    _stopped = true; stopPeriodicSync(); _client.close();
    await _flight;
    await _statusController.close();
  }
  void dispose() { unawaited(close()); }
}
