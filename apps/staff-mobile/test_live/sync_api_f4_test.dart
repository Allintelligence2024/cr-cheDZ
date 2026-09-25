// Real Dio + generated client + SyncEngine + native Drift against a live API.
// Run explicitly by scripts/test-sync-api-flutter.mjs, never as a skipped F2 test.
import 'dart:convert';
import 'dart:io';
import 'package:drift/native.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:staff_mobile/core/database/app_database.dart';
import 'package:staff_mobile/core/network/api_client.dart';
import 'package:staff_mobile/core/network/sync_client.dart';
import 'package:staff_mobile/core/sync/sync_engine.dart';
import 'package:staff_mobile/core/sync/sync_scope.dart';

class Device {
  Device(String base, String token, File file) {
    db = AppDatabase.testing(SyncScope.fromAccessToken(token), NativeDatabase(file));
    final api = ApiClient(baseUrl: base)..accessToken = token;
    client = SyncClient(api);
    engine = SyncEngine(db, client, isOnline: () async => online, connectionChanges: const Stream.empty());
  }
  late final AppDatabase db;
  late final SyncClient client;
  late final SyncEngine engine;
  bool online = false;
  Future<void> sync() async { online = true; await engine.sync(); expect(engine.currentStatus, SyncStatus.idle); }
  Future<String> enqueue(String command, String child, {int? baseVersion, Map<String, dynamic> extra = const {}}) async {
    online = false;
    final id = await engine.enqueue(command: command, entityType: command.startsWith('log_') ? 'daily_log' : command == 'add_photo' ? 'media' : 'attendance', payload: {'child_id': child, ...extra}, baseVersion: baseVersion);
    await engine.sync(); return id;
  }
  Future<void> replay(String event) async {
    // Simulate restart before local ACK persistence: same stored operation/sequence.
    await (db.update(db.pendingOperations)..where((t) => t.eventId.equals(event)))
      .write(const PendingOperationsCompanion(status: Value('pending')));
    await sync();
  }
  Future<void> close() async { await engine.close(); await db.close(); }
}

void main() {
  // No widget binding / mock HTTP transport: these tests require actual sockets.
  HttpOverrides.global = null;
  const path = String.fromEnvironment('F4_CONFIG');
  if (path.isEmpty) throw StateError('F4_CONFIG required; no skip/fake API fallback');
  final config = jsonDecode(File(path).readAsStringSync()) as Map<String, dynamic>;
  final dir = Directory.systemTemp.createTempSync('f4-drift-');
  final base = config['base_url'] as String;
  final auth = ApiClient(baseUrl: base);
  Device? a, b, other;
  late String token, child, acceptedEvent, conflictEvent;
  Map<String, dynamic>? savedB;
  final report = <String, dynamic>{};
  Future<void> initialize() async {
    final login = await auth.post<Map<String, dynamic>>('/auth/login', {'email': config['email'], 'password': config['password']});
    token = login['access_token'] as String; auth.accessToken = token;
    child = (await auth.post<Map<String, dynamic>>('/children', {'site_id': config['site_id'], 'first_name_fr': 'F4', 'last_name_fr': 'Synthetic', 'date_of_birth': '2024-02-29'}))['id'] as String;
    a = Device(base, token, File('${dir.path}/a.db'));
    b = Device(base, token, File('${dir.path}/b.db'));
    await a!.sync(); await b!.sync();
    final sa = await a!.db.syncState(), sb = await b!.db.syncState();
    expect(sa['device_id'], isNot(sb['device_id']));
    expect(await b!.db.select(b!.db.localChildren).get(), hasLength(1));
    acceptedEvent = await a!.enqueue('check_in', child); await a!.sync(); await b!.sync();
    report.addAll({'child_id': child, 'accepted_event': acceptedEvent, 'device_a': sa['device_id'], 'device_b': sb['device_id']});
  }
  setUpAll(initialize);
  tearDownAll(() async {
    if (a != null) await a!.close(); if (b != null) await b!.close(); if (other != null) await other!.close();
    auth.close(); dir.deleteSync(recursive: true);
  });
  test('register -> real engine push -> second device pull -> replay without duplicate', () async {
    final session = (await b!.db.select(b!.db.localAttendanceSessions).get()).single;
    expect(session.childId, child); expect(session.status, 'present');
    final before = (await b!.db.syncState())['cursor'];
    await a!.replay(acceptedEvent); await b!.sync();
    expect((await b!.db.syncState())['cursor'], before);
    expect(await b!.db.select(b!.db.localAttendanceSessions).get(), hasLength(1));
    expect((await a!.db.select(a!.db.pendingOperations).get()).single.status, 'accepted');
  });
  test('attendance projection preserves the Algiers calendar date', () async {
    final session = (await b!.db.select(b!.db.localAttendanceSessions).get()).single;
    final today = DateTime.now().toUtc().add(const Duration(hours: 1)).toIso8601String().substring(0, 10);
    expect(session.sessionDate, today);
    expect((await b!.engine.attendanceStatusByChild(DateTime.parse(today)))[child], 'present');
  });
  test('attendance projection supplies the PRE-correction version to the real client', () async {
    expect((await b!.db.select(b!.db.localAttendanceSessions).get()).single.serverVersion, 1);
  });
  test('stale correction conflicts without effects and replays the same outcome', () async {
    final before = (await b!.db.syncState())['cursor'];
    conflictEvent = await a!.enqueue('correct_attendance', child, baseVersion: 0, extra: {'action': 'check_out', 'reason': 'F4 stale'});
    await a!.sync();
    final row = await (a!.db.select(a!.db.pendingOperations)..where((t) => t.eventId.equals(conflictEvent))).getSingle();
    expect(row.status, 'conflict'); expect(row.lastError, 'VERSION_MISMATCH');
    await a!.replay(conflictEvent); await b!.sync();
    expect((await b!.db.syncState())['cursor'], before);
    expect((await b!.db.select(b!.db.localAttendanceSessions).get()).single.status, 'present');
    report['conflict_event'] = conflictEvent;
  });
  test('eight journal commands and HTTP health observation -> mirror -> replay', () async {
    final ids = <String>[];
    for (final kind in ['meal', 'nap_start', 'nap_end', 'diaper', 'activity', 'temperature', 'note', 'incident']) {
      ids.add(await a!.enqueue('log_$kind', child, extra: {
        'meal_quantity': 'all', 'diaper_type': 'wet', 'temperature_celsius': 37.2,
        'note_text': 'Synthetic F4', 'activity_name': 'Synthetic F4',
      }));
    }
    report['journal_events'] = ids;
    await a!.sync();
    await auth.post<Map<String, dynamic>>('/journal/events', {'child_id': child, 'event_type': 'health_observation', 'health_observation': 'Synthetic F4'});
    await b!.sync();
    final rows = await b!.db.select(b!.db.localDailyEvents).get();
    expect(rows, hasLength(9));
    final today = DateTime.now().toUtc().add(const Duration(hours: 1)).toIso8601String().substring(0, 10);
    for (final row in rows) { expect(row.childId, child); expect(row.eventDate, today); expect(row.isSynced, true); }
    final cursor = (await b!.db.syncState())['cursor'];
    for (final id in ids) { await a!.replay(id); }
    await b!.sync();
    expect((await b!.db.syncState())['cursor'], cursor);
    expect(await b!.db.select(b!.db.localDailyEvents).get(), hasLength(9));
  });
  test('media from real HTTP is projected ; la photo HORS LIGNE est REFUSÉE (D6, option c)', () async {
    final org = a!.db.scope.organizationId;
    final registered = await auth.post<Map<String, dynamic>>('/media', {
      'child_id': child, 'storage_key': '$org/photos/f4-http.jpg', 'mime_type': 'image/jpeg',
    });
    // Independent red proof for media, even when the preceding journal projection fails.
    final response = await b!.client.pull('0', deviceId: (await b!.db.syncState())['device_id'] as String);
    final event = (response['events'] as List).cast<Map<String, dynamic>>().singleWhere((e) => e['aggregate_id'] == registered['id']);
    await b!.client.applyRemoteEvent(b!.db, event);
    final id = await a!.enqueue('add_photo', child, extra: {'storage_key': '$org/photos/f4-offline.jpg', 'mime_type': 'image/jpeg'});
    report['photo_event'] = id;
    await auth.post<Map<String, dynamic>>('/media', {'storage_key': '$org/documents/f4.pdf', 'mime_type': 'application/pdf'});
    await a!.sync(); await b!.sync();
    // D6 (option c, 2026-09-25) : la photo hors ligne est refusée par l'API. Le
    // moteur le SAIT et le dit (statut + motif persistés localement) au lieu de
    // laisser croire à un envoi — le refus n'est donc pas muet.
    final refused = (await a!.db.select(a!.db.pendingOperations).get())
        .singleWhere((o) => o.eventId == id);
    expect(refused.status, 'rejected');
    expect(refused.lastError, 'OFFLINE_PHOTO_UNSUPPORTED');
    report['offline_photo_refused'] = true;
    final rows = await b!.db.customSelect('SELECT * FROM local_media').get();
    expect(rows, hasLength(2));
    expect(rows.where((r) => r.data['media_type'] == 'photo'), hasLength(1));
    expect(rows.where((r) => r.data['media_type'] == 'document'), hasLength(1));
    for (final row in rows) { expect(row.data['child_id'], row.data['media_type'] == 'photo' ? child : null); expect(row.data['organization_id'], org); }
    final cursor = (await b!.db.syncState())['cursor'];
    await a!.replay(id); await b!.sync();
    expect((await b!.db.syncState())['cursor'], cursor);
    expect(await b!.db.customSelect('SELECT * FROM local_media').get(), hasLength(2));
  });
  test('device restart restores identity/cursor and tenant switch cannot reuse the mirror', () async {
    savedB = await b!.db.syncState(); await b!.close(); b = null;
    b = Device(base, token, File('${dir.path}/b.db')); await b!.sync();
    final restored = await b!.db.syncState();
    expect(await b!.db.select(b!.db.localDailyEvents).get(), hasLength(9));
    expect(await b!.db.customSelect('SELECT * FROM local_media').get(), hasLength(2));
    for (final field in ['device_id', 'fingerprint', 'cursor']) { expect(restored[field], savedB![field]); }
    final login = await auth.post<Map<String, dynamic>>('/auth/login', {'email': config['other_email'], 'password': config['password']});
    other = Device(base, login['access_token'] as String, File('${dir.path}/other.db')); await other!.sync();
    expect(await other!.db.select(other!.db.localChildren).get(), isEmpty);
    expect(await other!.db.select(other!.db.localDailyEvents).get(), isEmpty);
    expect(await other!.db.customSelect('SELECT * FROM local_media').get(), isEmpty);
    expect(await other!.db.select(other!.db.pendingOperations).get(), isEmpty);
    expect((await other!.db.syncState())['cursor'], '0');
    // A real HTTP request cannot borrow an old tenant's registered device.
    await expectLater(other!.client.pull('0', deviceId: restored['device_id'] as String), throwsA(isA<DioException>().having((e) => e.response?.statusCode, 'HTTP status', 403)));
    report['restart_and_tenant_isolation'] = true;
    File(config['report_path'] as String).writeAsStringSync(jsonEncode(report));
  });
}
