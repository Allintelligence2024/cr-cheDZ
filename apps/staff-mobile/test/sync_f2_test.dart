import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:staff_mobile/main.dart';
import 'package:flutter/material.dart';
import 'package:staff_mobile/features/children/children_list_page.dart';
import 'dart:async';
import 'dart:io';
import 'package:drift/native.dart';
import 'package:dio/dio.dart';
import 'package:staff_mobile/core/database/app_database.dart';
import 'package:staff_mobile/core/sync/sync_engine.dart';
import 'package:staff_mobile/core/sync/sync_scope.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:staff_mobile/core/network/api_client.dart';
import 'package:staff_mobile/core/network/sync_client.dart';

class RecordingApi extends ApiClient {
  final calls = <String>[];
  @override
  Future<T> post<T>(String path, [Object? body]) async {
    calls.add(path);
    return <String, dynamic>{'accepted': [], 'rejected': [], 'conflicts': [], 'next_cursor': '0'} as T;
  }
  @override
  Future<T> get<T>(String path, {Map<String, dynamic>? query}) async {
    calls.add(path);
    return <String, dynamic>{'events': [], 'next_cursor': '0'} as T;
  }
}

void wireTests() {
  test('push without a registered device must never reach transport', () async {
    final api = RecordingApi();
    try { await SyncClient(api).push([]); } catch (_) { /* blocked locally */ }
    expect(api.calls, isEmpty);
  });
  test('pull without a registered device must never reach transport', () async {
    final api = RecordingApi();
    try { await SyncClient(api).pull(0); } catch (_) { /* blocked locally */ }
    expect(api.calls, isEmpty);
  });
}

const org = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const device = '33333333-3333-4333-8333-333333333333';
const child = '44444444-4444-4444-8444-444444444444';
const session = '55555555-5555-4555-8555-555555555555';

class FakeApi extends ApiClient {
  final requests = <Map<String, dynamic>>[];
  Future<Map<String, dynamic>> Function(String, Map<String, dynamic>)? handlePost;
  Future<Map<String, dynamic>> Function(Map<String, dynamic>)? handlePull;
  @override
  Future<T> post<T>(String path, [Object? body]) async {
    final data = body! as Map<String, dynamic>;
    requests.add({'path': path, 'data': data});
    if (handlePost != null) return await handlePost!(path, data) as T;
    if (path == '/devices') return {'device_id': device} as T;
    return {'accepted': (data['operations'] as List).map((op) => op['event_id']).toList(),
      'rejected': [], 'conflicts': [], 'next_cursor': '9223372036854775807'} as T;
  }
  @override
  Future<T> get<T>(String path, {Map<String, dynamic>? query}) async {
    requests.add({'path': path, 'data': query!});
    if (handlePull != null) return await handlePull!(query) as T;
    return {'events': [], 'next_cursor': query['cursor']} as T;
  }
}

class Harness {
  Harness({File? file, SyncScope? scope}) {
    db = AppDatabase.testing(scope ?? SyncScope(org, user), file == null ? NativeDatabase.memory() : NativeDatabase(file));
    engine = SyncEngine(db, SyncClient(api), isOnline: () async => online, connectionChanges: connections.stream, platform: 'android');
  }
  late final AppDatabase db;
  final api = FakeApi();
  late final SyncEngine engine;
  bool online = false;
  final connections = StreamController<bool>.broadcast();
  Future<String> enqueue() async {
    final id = await engine.enqueue(command: 'check_in', entityType: 'attendance', payload: {'child_id': child});
    await engine.sync();
    return id;
  }
  Future<void> close() async { await engine.close(); await db.close(); await connections.close(); }
}

Map<String, dynamic> attendance(String sequence, {bool malformed = false}) => {
  'sync_seq': sequence, 'type': 'attendance', 'aggregate_id': child, 'event_type': 'check_in',
  'payload': malformed ? {} : {'session_id': session, 'child_id': child, 'session_date': '2026-09-14', 'status': 'present'},
  'created_at': '2026-09-14T08:00:00Z',
};
DioException failure(int status) => DioException(requestOptions: RequestOptions(path: '/sync'),
  response: Response(requestOptions: RequestOptions(path: '/sync'), statusCode: status));

void main() {
  wireTests();
  testWidgets('logout clears private modal routes before showing the next session', (tester) async {
    final token = 'header.${base64Url.encode(utf8.encode(jsonEncode({'purpose': 'access', 'organizationId': org, 'sub': user})))}.signature';
    FlutterSecureStorage.setMockInitialValues({'staff_access_token': token, 'staff_refresh_token': 'fixture'});
    await tester.pumpWidget(StaffApp(authApi: FakeApi(),
      databaseFactory: (scope) => AppDatabase.testing(scope, NativeDatabase.memory()),
      syncApiFactory: FakeApi.new,
      engineFactory: (db, client) => SyncEngine(db, client, isOnline: () async => false, connectionChanges: const Stream.empty()),
    ));
    await tester.pumpAndSettle();
    final page = tester.widget<ChildrenListPage>(find.byType(ChildrenListPage));
    unawaited(showDialog<void>(context: tester.element(find.byType(ChildrenListPage)),
      builder: (_) => const AlertDialog(content: Text('Private child from session A'))));
    await tester.pumpAndSettle(); expect(find.text('Private child from session A'), findsOneWidget);
    page.onLogout!(); await tester.pumpAndSettle();
    expect(find.text('Private child from session A'), findsNothing);
    expect(find.text('Se connecter'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('child screen renders Drift rows, refreshes after sync and exposes logout', (tester) async {
    final h = Harness(); addTearDown(h.close); var logout = false;
    await tester.runAsync(() async { await h.db.syncState(); });
    await tester.pumpWidget(MaterialApp(home: ChildrenListPage(syncEngine: h.engine, onLogout: () => logout = true)));
    await tester.pumpAndSettle();
    expect(find.text('Test Enfant'), findsNothing);
    h.api.handlePull = (q) async => {'events': q['cursor'] == '0' ? [{
      'sync_seq': '1', 'type': 'child', 'aggregate_id': child, 'event_type': 'created',
      'created_at': '2026-09-14T08:00:00Z', 'payload': {
        'id': child, 'organization_id': org, 'site_id': org, 'first_name_fr': 'Test',
        'last_name_fr': 'Enfant', 'date_of_birth': '2024-01-01', 'status': 'active',
      },
    }] : [], 'next_cursor': '1'};
    h.online = true; await tester.runAsync(h.engine.sync);
    await tester.pumpAndSettle(); expect(find.text('Test Enfant'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.logout)); expect(logout, true);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  test('register precedes push/pull; device sent every time; push cursor ignored', () async {
    final h = Harness(); addTearDown(h.close);
    await h.enqueue(); h.online = true; await h.engine.sync();
    expect(h.api.requests.map((r) => r['path']).toList(), ['/devices', '/sync/push', '/sync/pull']);
    for (final r in h.api.requests.skip(1)) { expect(r['data']['device_id'], device); }
    expect((await h.db.syncState())['cursor'], '0');
    expect((await h.db.select(h.db.pendingOperations).get()).single.status, 'accepted');
    await h.engine.sync(); expect(h.api.requests.where((r) => r['path'] == '/devices').length, 1);
  });
  test('fingerprint/device/sequence/cursor survive database and engine restart', () async {
    final dir = Directory.systemTemp.createTempSync('f2-drift-'); addTearDown(() => dir.deleteSync(recursive: true));
    final file = File('${dir.path}/scope.db');
    final first = Harness(file: file);
    await first.enqueue(); final before = await first.db.syncState();
    first.online = true;
    first.api.handlePull = (q) async => {'events': q['cursor'] == '0' ? [attendance('9007199254740993')] : [], 'next_cursor': '9007199254740993'};
    await first.engine.sync(); await first.close();
    final second = Harness(file: file); addTearDown(second.close);
    final after = await second.db.syncState();
    expect(after['fingerprint'], before['fingerprint']); expect(after['device_id'], device);
    expect(after['cursor'], '9007199254740993');
    await second.enqueue();
    final rows = await second.db.select(second.db.pendingOperations).get();
    expect(rows.map((r) => r.clientSequence).toSet(), {1, 2});
    second.online = true; await second.engine.sync();
    expect(second.api.requests.any((r) => r['path'] == '/devices'), false);
    expect(second.api.requests.last['data']['cursor'], '9007199254740993');
  });
  test('registration response loss preserves fingerprint for retry', () async {
    final h = Harness(); addTearDown(h.close); h.online = true;
    final fingerprints = <Object?>[];
    h.api.handlePost = (path, data) async { fingerprints.add(data['device_fingerprint']); throw failure(503); };
    await h.engine.sync(); await h.engine.sync();
    expect(fingerprints.length, 2); expect(fingerprints.toSet().length, 1);
    expect((await h.db.syncState())['device_id'], isNull);
  });
  test('page application and cursor rollback together on bad second event', () async {
    final h = Harness(); addTearDown(h.close); h.online = true;
    h.api.handlePull = (_) async => {'events': [attendance('1'), attendance('2', malformed: true)], 'next_cursor': '2'};
    await h.engine.sync();
    expect(h.engine.currentStatus, SyncStatus.contractError);
    expect((await h.db.syncState())['cursor'], '0');
    expect(await h.db.select(h.db.localAttendanceSessions).get(), isEmpty);
  });
  test('unknown projection never silently advances cursor', () async {
    final h = Harness(); addTearDown(h.close); h.online = true;
    h.api.handlePull = (_) async => {'events': [{...attendance('1'), 'type': 'future_entity'}], 'next_cursor': '1'};
    await h.engine.sync(); expect(h.engine.currentStatus, SyncStatus.contractError);
    expect((await h.db.syncState())['cursor'], '0');
  });
  test('overlapping sync calls share the first connectivity await', () async {
    final db = AppDatabase.testing(SyncScope(org, user), NativeDatabase.memory());
    final api = FakeApi(); final ready = Completer<bool>();
    final engine = SyncEngine(db, SyncClient(api), isOnline: () => ready.future, connectionChanges: const Stream.empty());
    addTearDown(() async { await engine.close(); await db.close(); });
    final first = engine.sync(); final second = engine.sync(); expect(identical(first, second), true);
    ready.complete(true); await Future.wait([first, second]);
    expect(api.requests.where((r) => r['path'] == '/devices').length, 1);
    expect(api.requests.where((r) => r['path'] == '/sync/pull').length, 1);
  });
  test('late response after close cannot mutate the old mirror/cursor', () async {
    final h = Harness(); addTearDown(h.close); h.online = true;
    final entered = Completer<void>(); final response = Completer<Map<String, dynamic>>();
    h.api.handlePull = (_) { entered.complete(); return response.future; };
    final flight = h.engine.sync(); await entered.future;
    final closing = h.engine.close();
    response.complete({'events': [attendance('1')], 'next_cursor': '1'});
    await closing; await flight;
    expect((await h.db.syncState())['cursor'], '0');
    expect(await h.db.select(h.db.localAttendanceSessions).get(), isEmpty);
  });
  test('another user/tenant gets no pending queue, cursor or identity', () async {
    final a = Harness(); final b = Harness(scope: SyncScope(org, child)); final c = Harness(scope: SyncScope(child, user));
    addTearDown(a.close); addTearDown(b.close); addTearDown(c.close);
    await a.enqueue(); await a.db.saveCursor('99');
    final sa = await a.db.syncState(), sb = await b.db.syncState(), sc = await c.db.syncState();
    expect({sa['fingerprint'], sb['fingerprint'], sc['fingerprint']}.length, 3);
    expect(sb['cursor'], '0'); expect(sc['cursor'], '0');
    expect(await b.db.select(b.db.pendingOperations).get(), isEmpty);
    expect(await c.db.select(c.db.pendingOperations).get(), isEmpty);
  });
  test('opening an existing file under another scope fails closed', () async {
    final dir = Directory.systemTemp.createTempSync('f2-owner-'); addTearDown(() => dir.deleteSync(recursive: true));
    final file = File('${dir.path}/owner.db'); final a = Harness(file: file);
    await a.db.syncState(); await a.close();
    final b = Harness(file: file, scope: SyncScope(org, child)); addTearDown(b.close);
    b.online = true; await b.engine.sync();
    expect(b.engine.currentStatus, SyncStatus.contractError); expect(b.api.requests, isEmpty);
  });
  for (final code in [400, 401, 403]) {
    test('$code is explicit and blocks automatic retries without losing pending work', () async {
      final h = Harness(); addTearDown(h.close); await h.enqueue(); await h.db.saveDevice(device);
      h.api.handlePost = (path, data) async => throw failure(code); h.online = true;
      await h.engine.sync(); await h.engine.sync();
      expect(h.engine.currentStatus, code == 401 ? SyncStatus.authenticationRequired : code == 403 ? SyncStatus.deviceRevoked : SyncStatus.contractError);
      expect(h.api.requests.length, 1); expect((await h.db.select(h.db.pendingOperations).get()).single.status, 'pending');
    });
  }
  test('INTERNAL_ERROR and omitted acknowledgements remain pending', () async {
    final h = Harness(); addTearDown(h.close); final a = await h.enqueue(); await h.enqueue(); h.online = true;
    h.api.handlePost = (path, data) async => path == '/devices' ? {'device_id': device} : {
      'accepted': [], 'rejected': [{'event_id': a, 'reason': 'INTERNAL_ERROR', 'message': 'retry'}], 'conflicts': [], 'next_cursor': '0',
    };
    await h.engine.sync(); expect(h.engine.currentStatus, SyncStatus.error);
    expect((await h.db.select(h.db.pendingOperations).get()).every((r) => r.status == 'pending'), true);
  });
  test('foreign/contradictory acknowledgements roll back all local outcomes', () async {
    final h = Harness(); addTearDown(h.close); final id = await h.enqueue(); h.online = true;
    h.api.handlePost = (path, data) async => path == '/devices' ? {'device_id': device} : {
      'accepted': [id], 'rejected': [{'event_id': id, 'reason': 'REJECTED', 'message': 'bad'}], 'conflicts': [], 'next_cursor': '0',
    };
    await h.engine.sync(); expect(h.engine.currentStatus, SyncStatus.contractError);
    expect((await h.db.select(h.db.pendingOperations).get()).single.status, 'pending');
  });
  test('connectivity listeners are cancelled on restart and close', () async {
    final h = Harness(); addTearDown(h.close);
    h.engine.startPeriodicSync(); expect(h.connections.hasListener, true);
    h.engine.startPeriodicSync(); expect(h.connections.hasListener, true);
    await h.engine.close(); expect(h.connections.hasListener, false);
  });
  test('concurrent enqueues allocate persistent unique sequences atomically', () async {
    final h = Harness(); addTearDown(h.close);
    await Future.wait(List.generate(20, (_) => h.enqueue()));
    final rows = await h.db.select(h.db.pendingOperations).get();
    expect(rows.map((r) => r.clientSequence).toSet(), {for (var i = 1; i <= 20; i++) i});
  });
}
