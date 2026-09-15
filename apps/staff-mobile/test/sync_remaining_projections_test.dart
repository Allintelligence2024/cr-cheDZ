import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:staff_mobile/core/network/sync_client.dart';
import 'package:staff_mobile/core/sync/sync_engine.dart';
import 'sync_f2_test.dart' as f2;
import 'sync_children_f3b_test.dart' as children;

Map<String, dynamic> journal(String seq, {String kind = 'meal'}) => {
  'sync_seq': seq, 'type': 'daily_log', 'aggregate_id': f2.session,
  'event_type': kind, 'created_at': '2026-09-14T08:00:00Z',
  'payload': {'child_id': f2.child, 'event_type': kind, 'event_date': '2026-09-14', 'occurred_at': '2026-09-14T08:00:00Z'},
};
Map<String, dynamic> media(String seq, {bool document = false}) => {
  'sync_seq': seq, 'type': 'media', 'aggregate_id': f2.device,
  'event_type': 'media_registered', 'created_at': '2026-09-14T08:00:00Z',
  'payload': {'media_id': f2.device, 'child_id': document ? null : f2.child, 'media_type': document ? 'document' : 'photo'},
};
void main() {
  test('mixed page persists all four produced types and advances cursor atomically', () async {
    final h = f2.Harness(); addTearDown(h.close); h.online = true;
    final events = [children.childEvent('1'), f2.attendance('2'), journal('3'), media('4')];
    h.api.handlePull = (q) async => {'events': q['cursor'] == '0' ? events : [], 'next_cursor': '4'};
    await h.engine.sync();
    expect(h.engine.currentStatus, SyncStatus.idle);
    expect((await h.db.syncState())['cursor'], '4');
    expect(await h.db.select(h.db.localChildren).get(), hasLength(1));
    expect(await h.db.select(h.db.localAttendanceSessions).get(), hasLength(1));
    expect((await h.db.select(h.db.localDailyEvents).get()).single.isSynced, true);
    expect(await h.db.customSelect('SELECT * FROM local_media').get(), hasLength(1));
    await h.engine.sync();
    expect(await h.db.select(h.db.localDailyEvents).get(), hasLength(1));
    expect(await h.db.customSelect('SELECT * FROM local_media').get(), hasLength(1));
  });
  for (final kind in ['meal', 'nap_start', 'nap_end', 'diaper', 'activity', 'temperature', 'note', 'health_observation', 'incident']) {
    test('journal $kind projects only the published metadata, replay is idempotent', () async {
      final h = f2.Harness(); addTearDown(h.close); final client = SyncClient(h.api);
      final event = journal('1', kind: kind);
      event['payload']['note_text'] = 'NOT PART OF THE OFFLINE CONTRACT';
      await client.applyRemoteEvent(h.db, event); await client.applyRemoteEvent(h.db, event);
      final row = (await h.db.select(h.db.localDailyEvents).get()).single;
      expect(row.id, f2.session); expect(row.eventType, kind); expect(row.eventDate, '2026-09-14');
      expect(row.payloadJson, isNot(contains('NOT PART OF')));
    });
  }
  test('document without child is durable metadata, never a storage key or signed URL', () async {
    final h = f2.Harness(); addTearDown(h.close); final client = SyncClient(h.api);
    final event = media('1', document: true);
    event['payload']['storage_key'] = 'NOT PART OF THE OFFLINE CONTRACT';
    await client.applyRemoteEvent(h.db, event); await client.applyRemoteEvent(h.db, event);
    final row = (await h.db.customSelect('SELECT * FROM local_media').get()).single.data;
    expect(row['child_id'], null); expect(row['media_type'], 'document'); expect(row['organization_id'], f2.org);
    expect(row.containsKey('storage_key'), false);
  });
  for (final defect in ['journal date', 'journal time', 'journal kind', 'media identity', 'media child', 'media kind', 'scope', 'unknown type']) {
    test('$defect rolls back ALL mirrors and cursor, keeps pending work', () async {
      final h = f2.Harness(); addTearDown(h.close); await h.enqueue();
      final bad = defect.startsWith('journal') ? journal('5') : media('5');
      if (defect == 'journal date') bad['payload']['event_date'] = '2026-02-30';
      if (defect == 'journal time') bad['payload']['occurred_at'] = 'invalid';
      if (defect == 'journal kind') bad['event_type'] = 'incident';
      if (defect == 'media identity') bad['payload']['media_id'] = f2.org;
      if (defect == 'media child') bad['payload']['child_id'] = 'bad';
      if (defect == 'media kind') bad['event_type'] = 'future_visibility';
      if (defect == 'scope') bad['payload']['organization_id'] = f2.user;
      if (defect == 'unknown type') bad['type'] = 'future_projection';
      h.online = true;
      h.api.handlePull = (_) async => {'events': [children.childEvent('1'), f2.attendance('2'), journal('3'), media('4'), bad], 'next_cursor': '5'};
      await h.engine.sync();
      expect(h.engine.currentStatus, SyncStatus.contractError);
      expect((await h.db.syncState())['cursor'], '0');
      expect(await h.db.select(h.db.localChildren).get(), isEmpty);
      expect(await h.db.select(h.db.localAttendanceSessions).get(), isEmpty);
      expect(await h.db.select(h.db.localDailyEvents).get(), isEmpty);
      expect(await h.db.customSelect('SELECT * FROM local_media').get(), isEmpty);
      expect(await h.db.select(h.db.pendingOperations).get(), hasLength(1));
    });
  }
  test('v2 -> v3 preserves on-disk identity, cursor and pending sequence', () async {
    final dir = Directory.systemTemp.createTempSync('f-close-upgrade-');
    addTearDown(() => dir.deleteSync(recursive: true));
    final file = File('${dir.path}/scoped.db'); final old = f2.Harness(file: file);
    await old.enqueue(); await old.db.saveDevice(f2.device); await old.db.saveCursor('42');
    final state = await old.db.syncState(); final operations = await old.db.select(old.db.pendingOperations).get();
    // The exact v2 layout: same four Drift tables + sync_state, no media table.
    await old.db.customStatement('DROP TABLE IF EXISTS local_media');
    await old.db.customStatement('PRAGMA user_version = 2'); await old.close();
    final upgraded = f2.Harness(file: file); addTearDown(upgraded.close);
    expect(await upgraded.db.syncState(), state);
    expect(await upgraded.db.select(upgraded.db.pendingOperations).get(), operations);
    await SyncClient(upgraded.api).applyRemoteEvent(upgraded.db, media('43'));
    expect(await upgraded.db.customSelect('SELECT * FROM local_media').get(), hasLength(1));
    expect(await upgraded.db.nextClientSequence(), 2);
  });
}
