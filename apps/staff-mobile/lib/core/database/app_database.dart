import 'dart:io';
import 'package:uuid/uuid.dart';
import '../sync/sync_scope.dart';
import '../network/generated/sync_wire_client.dart';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

export 'package:drift/drift.dart' show Value, OrderingTerm;

part 'app_database.g.dart';

/// Enfants synchronisés localement (sous-ensemble du serveur).
/// C09 : `siteId` présent (utilisé par checkIn dans la liste des enfants).
class LocalChildren extends Table {
  TextColumn get id => text()();
  TextColumn get organizationId => text()();
  TextColumn get siteId => text()();
  TextColumn get roomId => text().nullable()();
  TextColumn get firstNameFr => text()();
  TextColumn get firstNameAr => text().nullable()();
  TextColumn get lastNameFr => text()();
  TextColumn get lastNameAr => text().nullable()();
  TextColumn get dateOfBirth => text()();
  TextColumn get photoUrl => text().nullable()();
  TextColumn get status => text()();
  BoolColumn get isWalking => boolean().withDefault(const Constant(false))();
  TextColumn get allergiesSummary => text().nullable()();
  TextColumn get emergencyContactName => text().nullable()();
  TextColumn get emergencyContactPhone => text().nullable()();
  IntColumn get serverVersion => integer().withDefault(const Constant(0))();
  TextColumn get syncedAt => text().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

/// Sessions de présence du jour (miroir local).
class LocalAttendanceSessions extends Table {
  TextColumn get id => text()();
  TextColumn get organizationId => text()();
  TextColumn get childId => text()();
  TextColumn get sessionDate => text()();
  TextColumn get status => text()();
  TextColumn get updatedAt => text()();
  IntColumn get serverVersion => integer().withDefault(const Constant(0))();

  @override
  Set<Column> get primaryKey => {id};
}

/// Événements de journal en attente ou reçus (append-only).
class LocalDailyEvents extends Table {
  TextColumn get id => text()();
  TextColumn get organizationId => text()();
  TextColumn get childId => text()();
  TextColumn get eventDate => text()();
  TextColumn get eventType => text()();
  TextColumn get occurredAt => text()();
  TextColumn get payloadJson => text()();
  BoolColumn get isSynced => boolean().withDefault(const Constant(false))();
  TextColumn get syncEventId => text().nullable()();
  TextColumn get createdAt => text()();

  @override
  Set<Column> get primaryKey => {id};
}

/// File d'opérations à synchroniser (offline-first).
class PendingOperations extends Table {
  TextColumn get id => text()();
  TextColumn get eventId => text()();
  TextColumn get command => text()();
  TextColumn get entityType => text()();
  TextColumn get entityId => text().nullable()();
  TextColumn get payloadJson => text()();
  IntColumn get baseVersion => integer().nullable()();
  TextColumn get occurredAtDevice => text()();
  IntColumn get clientSequence => integer()();
  IntColumn get attempts => integer().withDefault(const Constant(0))();
  TextColumn get status => text().withDefault(const Constant('pending'))();
  TextColumn get lastError => text().nullable()();
  TextColumn get createdAt => text()();

  @override
  Set<Column> get primaryKey => {id};
}

@DriftDatabase(
  tables: [
    LocalChildren,
    LocalAttendanceSessions,
    LocalDailyEvents,
    PendingOperations,
  ],
)
class AppDatabase extends _$AppDatabase {
  AppDatabase.forScope(this.scope) : super(_openConnection(scope));
  AppDatabase.testing(this.scope, QueryExecutor executor) : super(executor);
  final SyncScope scope;

  @override
  int get schemaVersion => 3;

  // Metadata uses Drift custom SQL to avoid hand-editing generated table code.
  Future<void> _createSyncState() => customStatement("""
    CREATE TABLE IF NOT EXISTS sync_state (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
      organization_id TEXT NOT NULL, user_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL, device_id TEXT,
      cursor TEXT NOT NULL DEFAULT '0', client_sequence INTEGER NOT NULL DEFAULT 0
    )
  """);

  // Registered media metadata only: downloads/consent remain online-authorized.
  // Custom SQL avoids hand-editing generated Drift code, like sync_state.
  Future<void> _createMediaMirror() => customStatement('''
    CREATE TABLE IF NOT EXISTS local_media (
      id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL,
      child_id TEXT, media_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  ''');

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (m) async { await m.createAll(); await _createSyncState(); await _createMediaMirror(); },
    onUpgrade: (m, from, to) async {
      if (from < 2) {
        final rows = await customSelect('SELECT (SELECT count(*) FROM pending_operations) + (SELECT count(*) FROM local_children) + (SELECT count(*) FROM local_attendance_sessions) + (SELECT count(*) FROM local_daily_events) AS n').getSingle();
        if (rows.read<int>('n') != 0) throw StateError('Legacy data requires explicit scope recovery');
        await _createSyncState();
      }
      if (from < 3) await _createMediaMirror();
    },
  );

  Future<Map<String, dynamic>> syncState() async {
    await customStatement(
      'INSERT OR IGNORE INTO sync_state(singleton,organization_id,user_id,fingerprint) VALUES(1,?,?,?)',
      [scope.organizationId, scope.userId, const Uuid().v4()],
    );
    final row = (await customSelect('SELECT * FROM sync_state WHERE singleton=1').getSingle()).data;
    if (row['organization_id'] != scope.organizationId || row['user_id'] != scope.userId) {
      throw StateError('Local database scope mismatch');
    }
    syncCursor(row['cursor']);
    return row;
  }

  Future<void> saveDevice(String id) async {
    validateSync('RegisterResponse', {'device_id': id});
    await customStatement('UPDATE sync_state SET device_id=? WHERE singleton=1', [id]);
  }

  Future<void> saveCursor(String cursor) async {
    syncCursor(cursor);
    await customStatement('UPDATE sync_state SET cursor=? WHERE singleton=1', [cursor]);
  }

  /// Called in the SAME transaction as inserting the pending operation.
  Future<int> nextClientSequence() async {
    final state = await syncState();
    final next = (state['client_sequence'] as int) + 1;
    if (next > 9007199254740991) throw StateError('Client sequence exhausted');
    await customStatement('UPDATE sync_state SET client_sequence=? WHERE singleton=1', [next]);
    return next;
  }

  static QueryExecutor _openConnection(SyncScope scope) {
    return LazyDatabase(() async {
      final dir = await getApplicationDocumentsDirectory();
      // The old unscoped staffapp.db is QUARANTINED: never read, delete or adopt.
      final file = File(p.join(dir.path, 'staffapp-v2-${scope.key}.db'));
      return NativeDatabase.createInBackground(file);
    });
  }
}
