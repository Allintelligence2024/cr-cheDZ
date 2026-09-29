// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_database_drift.dart';

// ignore_for_file: type=lint
class $CachedDashboardEntriesTable extends CachedDashboardEntries
    with TableInfo<$CachedDashboardEntriesTable, CachedDashboardEntry> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedDashboardEntriesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _dateMeta = const VerificationMeta('date');
  @override
  late final GeneratedColumn<String> date = GeneratedColumn<String>(
      'date', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _savedAtMeta =
      const VerificationMeta('savedAt');
  @override
  late final GeneratedColumn<int> savedAt = GeneratedColumn<int>(
      'saved_at', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _payloadMeta =
      const VerificationMeta('payload');
  @override
  late final GeneratedColumn<String> payload = GeneratedColumn<String>(
      'payload', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [date, savedAt, payload];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_dashboard_entries';
  @override
  VerificationContext validateIntegrity(
      Insertable<CachedDashboardEntry> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('date')) {
      context.handle(
          _dateMeta, date.isAcceptableOrUnknown(data['date']!, _dateMeta));
    } else if (isInserting) {
      context.missing(_dateMeta);
    }
    if (data.containsKey('saved_at')) {
      context.handle(_savedAtMeta,
          savedAt.isAcceptableOrUnknown(data['saved_at']!, _savedAtMeta));
    } else if (isInserting) {
      context.missing(_savedAtMeta);
    }
    if (data.containsKey('payload')) {
      context.handle(_payloadMeta,
          payload.isAcceptableOrUnknown(data['payload']!, _payloadMeta));
    } else if (isInserting) {
      context.missing(_payloadMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {date};
  @override
  CachedDashboardEntry map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedDashboardEntry(
      date: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}date'])!,
      savedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}saved_at'])!,
      payload: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}payload'])!,
    );
  }

  @override
  $CachedDashboardEntriesTable createAlias(String alias) {
    return $CachedDashboardEntriesTable(attachedDatabase, alias);
  }
}

class CachedDashboardEntry extends DataClass
    implements Insertable<CachedDashboardEntry> {
  final String date;
  final int savedAt;
  final String payload;
  const CachedDashboardEntry(
      {required this.date, required this.savedAt, required this.payload});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['date'] = Variable<String>(date);
    map['saved_at'] = Variable<int>(savedAt);
    map['payload'] = Variable<String>(payload);
    return map;
  }

  CachedDashboardEntriesCompanion toCompanion(bool nullToAbsent) {
    return CachedDashboardEntriesCompanion(
      date: Value(date),
      savedAt: Value(savedAt),
      payload: Value(payload),
    );
  }

  factory CachedDashboardEntry.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedDashboardEntry(
      date: serializer.fromJson<String>(json['date']),
      savedAt: serializer.fromJson<int>(json['savedAt']),
      payload: serializer.fromJson<String>(json['payload']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'date': serializer.toJson<String>(date),
      'savedAt': serializer.toJson<int>(savedAt),
      'payload': serializer.toJson<String>(payload),
    };
  }

  CachedDashboardEntry copyWith(
          {String? date, int? savedAt, String? payload}) =>
      CachedDashboardEntry(
        date: date ?? this.date,
        savedAt: savedAt ?? this.savedAt,
        payload: payload ?? this.payload,
      );
  CachedDashboardEntry copyWithCompanion(CachedDashboardEntriesCompanion data) {
    return CachedDashboardEntry(
      date: data.date.present ? data.date.value : this.date,
      savedAt: data.savedAt.present ? data.savedAt.value : this.savedAt,
      payload: data.payload.present ? data.payload.value : this.payload,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedDashboardEntry(')
          ..write('date: $date, ')
          ..write('savedAt: $savedAt, ')
          ..write('payload: $payload')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(date, savedAt, payload);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedDashboardEntry &&
          other.date == this.date &&
          other.savedAt == this.savedAt &&
          other.payload == this.payload);
}

class CachedDashboardEntriesCompanion
    extends UpdateCompanion<CachedDashboardEntry> {
  final Value<String> date;
  final Value<int> savedAt;
  final Value<String> payload;
  final Value<int> rowid;
  const CachedDashboardEntriesCompanion({
    this.date = const Value.absent(),
    this.savedAt = const Value.absent(),
    this.payload = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  CachedDashboardEntriesCompanion.insert({
    required String date,
    required int savedAt,
    required String payload,
    this.rowid = const Value.absent(),
  })  : date = Value(date),
        savedAt = Value(savedAt),
        payload = Value(payload);
  static Insertable<CachedDashboardEntry> custom({
    Expression<String>? date,
    Expression<int>? savedAt,
    Expression<String>? payload,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (date != null) 'date': date,
      if (savedAt != null) 'saved_at': savedAt,
      if (payload != null) 'payload': payload,
      if (rowid != null) 'rowid': rowid,
    });
  }

  CachedDashboardEntriesCompanion copyWith(
      {Value<String>? date,
      Value<int>? savedAt,
      Value<String>? payload,
      Value<int>? rowid}) {
    return CachedDashboardEntriesCompanion(
      date: date ?? this.date,
      savedAt: savedAt ?? this.savedAt,
      payload: payload ?? this.payload,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (date.present) {
      map['date'] = Variable<String>(date.value);
    }
    if (savedAt.present) {
      map['saved_at'] = Variable<int>(savedAt.value);
    }
    if (payload.present) {
      map['payload'] = Variable<String>(payload.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedDashboardEntriesCompanion(')
          ..write('date: $date, ')
          ..write('savedAt: $savedAt, ')
          ..write('payload: $payload, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $CachedListEntriesTable extends CachedListEntries
    with TableInfo<$CachedListEntriesTable, CachedListEntry> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedListEntriesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _listKeyMeta =
      const VerificationMeta('listKey');
  @override
  late final GeneratedColumn<String> listKey = GeneratedColumn<String>(
      'list_key', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _savedAtMeta =
      const VerificationMeta('savedAt');
  @override
  late final GeneratedColumn<int> savedAt = GeneratedColumn<int>(
      'saved_at', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _payloadMeta =
      const VerificationMeta('payload');
  @override
  late final GeneratedColumn<String> payload = GeneratedColumn<String>(
      'payload', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [listKey, savedAt, payload];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_list_entries';
  @override
  VerificationContext validateIntegrity(Insertable<CachedListEntry> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('list_key')) {
      context.handle(_listKeyMeta,
          listKey.isAcceptableOrUnknown(data['list_key']!, _listKeyMeta));
    } else if (isInserting) {
      context.missing(_listKeyMeta);
    }
    if (data.containsKey('saved_at')) {
      context.handle(_savedAtMeta,
          savedAt.isAcceptableOrUnknown(data['saved_at']!, _savedAtMeta));
    } else if (isInserting) {
      context.missing(_savedAtMeta);
    }
    if (data.containsKey('payload')) {
      context.handle(_payloadMeta,
          payload.isAcceptableOrUnknown(data['payload']!, _payloadMeta));
    } else if (isInserting) {
      context.missing(_payloadMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {listKey};
  @override
  CachedListEntry map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedListEntry(
      listKey: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}list_key'])!,
      savedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}saved_at'])!,
      payload: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}payload'])!,
    );
  }

  @override
  $CachedListEntriesTable createAlias(String alias) {
    return $CachedListEntriesTable(attachedDatabase, alias);
  }
}

class CachedListEntry extends DataClass implements Insertable<CachedListEntry> {
  final String listKey;
  final int savedAt;
  final String payload;
  const CachedListEntry(
      {required this.listKey, required this.savedAt, required this.payload});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['list_key'] = Variable<String>(listKey);
    map['saved_at'] = Variable<int>(savedAt);
    map['payload'] = Variable<String>(payload);
    return map;
  }

  CachedListEntriesCompanion toCompanion(bool nullToAbsent) {
    return CachedListEntriesCompanion(
      listKey: Value(listKey),
      savedAt: Value(savedAt),
      payload: Value(payload),
    );
  }

  factory CachedListEntry.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedListEntry(
      listKey: serializer.fromJson<String>(json['listKey']),
      savedAt: serializer.fromJson<int>(json['savedAt']),
      payload: serializer.fromJson<String>(json['payload']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'listKey': serializer.toJson<String>(listKey),
      'savedAt': serializer.toJson<int>(savedAt),
      'payload': serializer.toJson<String>(payload),
    };
  }

  CachedListEntry copyWith({String? listKey, int? savedAt, String? payload}) =>
      CachedListEntry(
        listKey: listKey ?? this.listKey,
        savedAt: savedAt ?? this.savedAt,
        payload: payload ?? this.payload,
      );
  CachedListEntry copyWithCompanion(CachedListEntriesCompanion data) {
    return CachedListEntry(
      listKey: data.listKey.present ? data.listKey.value : this.listKey,
      savedAt: data.savedAt.present ? data.savedAt.value : this.savedAt,
      payload: data.payload.present ? data.payload.value : this.payload,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedListEntry(')
          ..write('listKey: $listKey, ')
          ..write('savedAt: $savedAt, ')
          ..write('payload: $payload')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(listKey, savedAt, payload);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedListEntry &&
          other.listKey == this.listKey &&
          other.savedAt == this.savedAt &&
          other.payload == this.payload);
}

class CachedListEntriesCompanion extends UpdateCompanion<CachedListEntry> {
  final Value<String> listKey;
  final Value<int> savedAt;
  final Value<String> payload;
  final Value<int> rowid;
  const CachedListEntriesCompanion({
    this.listKey = const Value.absent(),
    this.savedAt = const Value.absent(),
    this.payload = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  CachedListEntriesCompanion.insert({
    required String listKey,
    required int savedAt,
    required String payload,
    this.rowid = const Value.absent(),
  })  : listKey = Value(listKey),
        savedAt = Value(savedAt),
        payload = Value(payload);
  static Insertable<CachedListEntry> custom({
    Expression<String>? listKey,
    Expression<int>? savedAt,
    Expression<String>? payload,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (listKey != null) 'list_key': listKey,
      if (savedAt != null) 'saved_at': savedAt,
      if (payload != null) 'payload': payload,
      if (rowid != null) 'rowid': rowid,
    });
  }

  CachedListEntriesCompanion copyWith(
      {Value<String>? listKey,
      Value<int>? savedAt,
      Value<String>? payload,
      Value<int>? rowid}) {
    return CachedListEntriesCompanion(
      listKey: listKey ?? this.listKey,
      savedAt: savedAt ?? this.savedAt,
      payload: payload ?? this.payload,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (listKey.present) {
      map['list_key'] = Variable<String>(listKey.value);
    }
    if (savedAt.present) {
      map['saved_at'] = Variable<int>(savedAt.value);
    }
    if (payload.present) {
      map['payload'] = Variable<String>(payload.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedListEntriesCompanion(')
          ..write('listKey: $listKey, ')
          ..write('savedAt: $savedAt, ')
          ..write('payload: $payload, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$DirectorCacheDb extends GeneratedDatabase {
  _$DirectorCacheDb(QueryExecutor e) : super(e);
  $DirectorCacheDbManager get managers => $DirectorCacheDbManager(this);
  late final $CachedDashboardEntriesTable cachedDashboardEntries =
      $CachedDashboardEntriesTable(this);
  late final $CachedListEntriesTable cachedListEntries =
      $CachedListEntriesTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities =>
      [cachedDashboardEntries, cachedListEntries];
}

typedef $$CachedDashboardEntriesTableCreateCompanionBuilder
    = CachedDashboardEntriesCompanion Function({
  required String date,
  required int savedAt,
  required String payload,
  Value<int> rowid,
});
typedef $$CachedDashboardEntriesTableUpdateCompanionBuilder
    = CachedDashboardEntriesCompanion Function({
  Value<String> date,
  Value<int> savedAt,
  Value<String> payload,
  Value<int> rowid,
});

class $$CachedDashboardEntriesTableFilterComposer
    extends Composer<_$DirectorCacheDb, $CachedDashboardEntriesTable> {
  $$CachedDashboardEntriesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get date => $composableBuilder(
      column: $table.date, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get savedAt => $composableBuilder(
      column: $table.savedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get payload => $composableBuilder(
      column: $table.payload, builder: (column) => ColumnFilters(column));
}

class $$CachedDashboardEntriesTableOrderingComposer
    extends Composer<_$DirectorCacheDb, $CachedDashboardEntriesTable> {
  $$CachedDashboardEntriesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get date => $composableBuilder(
      column: $table.date, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get savedAt => $composableBuilder(
      column: $table.savedAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get payload => $composableBuilder(
      column: $table.payload, builder: (column) => ColumnOrderings(column));
}

class $$CachedDashboardEntriesTableAnnotationComposer
    extends Composer<_$DirectorCacheDb, $CachedDashboardEntriesTable> {
  $$CachedDashboardEntriesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get date =>
      $composableBuilder(column: $table.date, builder: (column) => column);

  GeneratedColumn<int> get savedAt =>
      $composableBuilder(column: $table.savedAt, builder: (column) => column);

  GeneratedColumn<String> get payload =>
      $composableBuilder(column: $table.payload, builder: (column) => column);
}

class $$CachedDashboardEntriesTableTableManager extends RootTableManager<
    _$DirectorCacheDb,
    $CachedDashboardEntriesTable,
    CachedDashboardEntry,
    $$CachedDashboardEntriesTableFilterComposer,
    $$CachedDashboardEntriesTableOrderingComposer,
    $$CachedDashboardEntriesTableAnnotationComposer,
    $$CachedDashboardEntriesTableCreateCompanionBuilder,
    $$CachedDashboardEntriesTableUpdateCompanionBuilder,
    (
      CachedDashboardEntry,
      BaseReferences<_$DirectorCacheDb, $CachedDashboardEntriesTable,
          CachedDashboardEntry>
    ),
    CachedDashboardEntry,
    PrefetchHooks Function()> {
  $$CachedDashboardEntriesTableTableManager(
      _$DirectorCacheDb db, $CachedDashboardEntriesTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedDashboardEntriesTableFilterComposer(
                  $db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedDashboardEntriesTableOrderingComposer(
                  $db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedDashboardEntriesTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> date = const Value.absent(),
            Value<int> savedAt = const Value.absent(),
            Value<String> payload = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedDashboardEntriesCompanion(
            date: date,
            savedAt: savedAt,
            payload: payload,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String date,
            required int savedAt,
            required String payload,
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedDashboardEntriesCompanion.insert(
            date: date,
            savedAt: savedAt,
            payload: payload,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (
                    e.readTable<$CachedDashboardEntriesTable,
                        CachedDashboardEntry>(table),
                    BaseReferences<
                        _$DirectorCacheDb,
                        $CachedDashboardEntriesTable,
                        CachedDashboardEntry>(db, table, e)
                  ))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CachedDashboardEntriesTableProcessedTableManager
    = ProcessedTableManager<
        _$DirectorCacheDb,
        $CachedDashboardEntriesTable,
        CachedDashboardEntry,
        $$CachedDashboardEntriesTableFilterComposer,
        $$CachedDashboardEntriesTableOrderingComposer,
        $$CachedDashboardEntriesTableAnnotationComposer,
        $$CachedDashboardEntriesTableCreateCompanionBuilder,
        $$CachedDashboardEntriesTableUpdateCompanionBuilder,
        (
          CachedDashboardEntry,
          BaseReferences<_$DirectorCacheDb, $CachedDashboardEntriesTable,
              CachedDashboardEntry>
        ),
        CachedDashboardEntry,
        PrefetchHooks Function()>;
typedef $$CachedListEntriesTableCreateCompanionBuilder
    = CachedListEntriesCompanion Function({
  required String listKey,
  required int savedAt,
  required String payload,
  Value<int> rowid,
});
typedef $$CachedListEntriesTableUpdateCompanionBuilder
    = CachedListEntriesCompanion Function({
  Value<String> listKey,
  Value<int> savedAt,
  Value<String> payload,
  Value<int> rowid,
});

class $$CachedListEntriesTableFilterComposer
    extends Composer<_$DirectorCacheDb, $CachedListEntriesTable> {
  $$CachedListEntriesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get listKey => $composableBuilder(
      column: $table.listKey, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get savedAt => $composableBuilder(
      column: $table.savedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get payload => $composableBuilder(
      column: $table.payload, builder: (column) => ColumnFilters(column));
}

class $$CachedListEntriesTableOrderingComposer
    extends Composer<_$DirectorCacheDb, $CachedListEntriesTable> {
  $$CachedListEntriesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get listKey => $composableBuilder(
      column: $table.listKey, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get savedAt => $composableBuilder(
      column: $table.savedAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get payload => $composableBuilder(
      column: $table.payload, builder: (column) => ColumnOrderings(column));
}

class $$CachedListEntriesTableAnnotationComposer
    extends Composer<_$DirectorCacheDb, $CachedListEntriesTable> {
  $$CachedListEntriesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get listKey =>
      $composableBuilder(column: $table.listKey, builder: (column) => column);

  GeneratedColumn<int> get savedAt =>
      $composableBuilder(column: $table.savedAt, builder: (column) => column);

  GeneratedColumn<String> get payload =>
      $composableBuilder(column: $table.payload, builder: (column) => column);
}

class $$CachedListEntriesTableTableManager extends RootTableManager<
    _$DirectorCacheDb,
    $CachedListEntriesTable,
    CachedListEntry,
    $$CachedListEntriesTableFilterComposer,
    $$CachedListEntriesTableOrderingComposer,
    $$CachedListEntriesTableAnnotationComposer,
    $$CachedListEntriesTableCreateCompanionBuilder,
    $$CachedListEntriesTableUpdateCompanionBuilder,
    (
      CachedListEntry,
      BaseReferences<_$DirectorCacheDb, $CachedListEntriesTable,
          CachedListEntry>
    ),
    CachedListEntry,
    PrefetchHooks Function()> {
  $$CachedListEntriesTableTableManager(
      _$DirectorCacheDb db, $CachedListEntriesTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedListEntriesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedListEntriesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedListEntriesTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> listKey = const Value.absent(),
            Value<int> savedAt = const Value.absent(),
            Value<String> payload = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedListEntriesCompanion(
            listKey: listKey,
            savedAt: savedAt,
            payload: payload,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String listKey,
            required int savedAt,
            required String payload,
            Value<int> rowid = const Value.absent(),
          }) =>
              CachedListEntriesCompanion.insert(
            listKey: listKey,
            savedAt: savedAt,
            payload: payload,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (
                    e.readTable<$CachedListEntriesTable, CachedListEntry>(
                        table),
                    BaseReferences<_$DirectorCacheDb, $CachedListEntriesTable,
                        CachedListEntry>(db, table, e)
                  ))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$CachedListEntriesTableProcessedTableManager = ProcessedTableManager<
    _$DirectorCacheDb,
    $CachedListEntriesTable,
    CachedListEntry,
    $$CachedListEntriesTableFilterComposer,
    $$CachedListEntriesTableOrderingComposer,
    $$CachedListEntriesTableAnnotationComposer,
    $$CachedListEntriesTableCreateCompanionBuilder,
    $$CachedListEntriesTableUpdateCompanionBuilder,
    (
      CachedListEntry,
      BaseReferences<_$DirectorCacheDb, $CachedListEntriesTable,
          CachedListEntry>
    ),
    CachedListEntry,
    PrefetchHooks Function()>;

class $DirectorCacheDbManager {
  final _$DirectorCacheDb _db;
  $DirectorCacheDbManager(this._db);
  $$CachedDashboardEntriesTableTableManager get cachedDashboardEntries =>
      $$CachedDashboardEntriesTableTableManager(
          _db, _db.cachedDashboardEntries);
  $$CachedListEntriesTableTableManager get cachedListEntries =>
      $$CachedListEntriesTableTableManager(_db, _db.cachedListEntries);
}
