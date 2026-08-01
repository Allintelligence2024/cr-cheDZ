import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

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
class AppDatabase extends $AppDatabase {
  AppDatabase() : super(_openConnection());

  @override
  int get schemaVersion => 1;

  static QueryExecutor _openConnection() {
    return LazyDatabase(() async {
      final dir = await getApplicationDocumentsDirectory();
      final file = File(p.join(dir.path, 'staffapp.db'));
      return NativeDatabase.createInBackground(file);
    });
  }
}
