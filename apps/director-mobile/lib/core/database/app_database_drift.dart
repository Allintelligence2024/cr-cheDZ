import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// ITEM M2 — base offline Drift typée (V2.4).
///
/// Générée par `dart run build_runner build --delete-conflicting-outputs`
/// → `app_database_drift.g.dart` (tableaux `$...Table`).
///
/// Choix (HANDOFF M2, Option A) : les call sites continuent d'utiliser le
/// wrapper SharedPreferences (`app_database.dart` / `CacheService`) qui a la
/// même API — ce fichier fournit la VRAIE base SQLite `director_cache.db`
/// pour la migration progressive. Le wrapper est un sur-ensemble compat :
/// rien à changer côté pages pour basculer ensuite.
///
/// Tables : miroir des entrées de cache (dashboard / enfants / factures) —
/// jamais de PII hors ligne au-delà de ce que le cache JSON contient déjà.
part 'app_database_drift.g.dart';

const kDirectorCacheDbName = 'director_cache.db';

class CachedDashboardEntries extends Table {
  TextColumn get date => text()();
  IntColumn get savedAt => integer()();
  TextColumn get payload => text()();

  @override
  Set<Column> get primaryKey => {date};
}

class CachedListEntries extends Table {
  TextColumn get listKey => text()();
  IntColumn get savedAt => integer()();
  TextColumn get payload => text()();

  @override
  Set<Column> get primaryKey => {listKey};
}

@DriftDatabase(tables: [CachedDashboardEntries, CachedListEntries])
class DirectorCacheDb extends _$DirectorCacheDb {
  DirectorCacheDb() : super(_openConnection());

  DirectorCacheDb.forTesting(super.executor);

  @override
  int get schemaVersion => 1;

  static QueryExecutor _openConnection() => LazyDatabase(() async {
        final dir = await getApplicationDocumentsDirectory();
        final file = File(p.join(dir.path, kDirectorCacheDbName));
        return NativeDatabase.createInBackground(file);
      });
}
