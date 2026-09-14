import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:staff_mobile/core/network/sync_client.dart';
import 'package:staff_mobile/core/sync/sync_engine.dart';
import 'package:staff_mobile/features/children/children_list_page.dart';
import 'sync_f2_test.dart' as f2;

Map<String, dynamic> childEvent(String sequence, {String kind = 'created'}) => {
  'sync_seq': sequence, 'type': 'child', 'aggregate_id': f2.child,
  'event_type': kind, 'created_at': '2026-09-14T08:00:00Z',
  'payload': {
    'id': f2.child, 'organization_id': f2.org, 'site_id': f2.org,
    'room_id': null, 'first_name_fr': 'Synthetic', 'first_name_ar': null,
    'last_name_fr': 'Child', 'last_name_ar': null, 'date_of_birth': '2024-02-29',
    'photo_url': null, 'status': 'active', 'is_walking': false, 'version': 1,
  },
};
Map<String, dynamic> deletedEvent(String sequence) => {
  ...childEvent(sequence), 'event_type': 'deleted',
  'payload': {'id': f2.child, 'organization_id': f2.org, 'version': 2,
    'deleted_at': '2026-09-14T09:00:00Z'},
};

void main() {
  test('child tombstone removes the mirror atomically, keeps operation history and advances cursor', () async {
    final h = f2.Harness(); addTearDown(h.close);
    await h.enqueue(); h.online = true;
    // An ACK changes status, but a tombstone must not erase operation history.
    h.api.handlePost = (path, data) async => path == '/devices'
      ? {'device_id': f2.device}
      : {'accepted': [data['operations'][0]['event_id']], 'rejected': [], 'conflicts': [], 'next_cursor': '0'};
    h.api.handlePull = (q) async => {'events': q['cursor'] == '0' ? [childEvent('1'), deletedEvent('2')] : [], 'next_cursor': '2'};
    await h.engine.sync();
    expect(h.engine.currentStatus, SyncStatus.idle);
    expect(await h.db.select(h.db.localChildren).get(), isEmpty);
    expect((await h.db.syncState())['cursor'], '2');
    expect(await h.db.select(h.db.pendingOperations).get(), hasLength(1));
    await h.engine.sync();
    expect(await h.db.select(h.db.pendingOperations).get(), hasLength(1));
  });
  test('tombstone leaves genuinely pending offline work intact and is idempotent', () async {
    final h = f2.Harness(); addTearDown(h.close);
    await h.enqueue();
    final before = await h.db.select(h.db.pendingOperations).get();
    expect(before.single.status, 'pending');
    final client = SyncClient(h.api);
    await client.applyRemoteEvent(h.db, childEvent('1'));
    await client.applyRemoteEvent(h.db, deletedEvent('2'));
    await client.applyRemoteEvent(h.db, deletedEvent('2'));
    expect(await h.db.select(h.db.localChildren).get(), isEmpty);
    expect(await h.db.select(h.db.pendingOperations).get(), before);
  });
  testWidgets('deleted child disappears from the real children screen after sync', (tester) async {
    final h = f2.Harness(); addTearDown(h.close);
    await tester.runAsync(() async { await h.db.syncState(); });
    await tester.pumpWidget(MaterialApp(home: ChildrenListPage(syncEngine: h.engine)));
    await tester.pumpAndSettle(); h.online = true;
    h.api.handlePull = (q) async => {'events': q['cursor'] == '0' ? [childEvent('1')] : [], 'next_cursor': '1'};
    await tester.runAsync(h.engine.sync); await tester.pumpAndSettle();
    expect(find.text('Synthetic Child'), findsOneWidget);
    h.api.handlePull = (q) async => {'events': q['cursor'] == '1' ? [deletedEvent('2')] : [], 'next_cursor': '2'};
    await tester.runAsync(h.engine.sync); await tester.pumpAndSettle();
    expect(find.text('Synthetic Child'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  for (final defect in ['identity', 'kind', 'date', 'version', 'deleted_at']) {
    test('malformed child $defect rolls back the WHOLE page and cursor', () async {
      final h = f2.Harness(); addTearDown(h.close); h.online = true;
      final bad = childEvent('2');
      if (defect == 'identity') bad['aggregate_id'] = f2.session;
      if (defect == 'kind') bad['event_type'] = 'future_child_event';
      if (defect == 'date') bad['payload']['date_of_birth'] = '2024-02-31';
      if (defect == 'version') bad['payload']['version'] = -1;
      if (defect == 'deleted_at') bad['event_type'] = 'deleted';
      h.api.handlePull = (_) async => {'events': [childEvent('1'), bad], 'next_cursor': '2'};
      await h.engine.sync();
      expect(h.engine.currentStatus, SyncStatus.contractError);
      expect(await h.db.select(h.db.localChildren).get(), isEmpty);
      expect((await h.db.syncState())['cursor'], '0');
    });
  }
  test('cross-tenant tombstone never removes an owned mirror row', () async {
    final h = f2.Harness(); addTearDown(h.close);
    final client = SyncClient(h.api);
    await client.applyRemoteEvent(h.db, childEvent('1'));
    final bad = deletedEvent('2'); bad['payload']['organization_id'] = f2.user;
    await expectLater(client.applyRemoteEvent(h.db, bad), throwsFormatException);
    expect(await h.db.select(h.db.localChildren).get(), hasLength(1));
  });
}
