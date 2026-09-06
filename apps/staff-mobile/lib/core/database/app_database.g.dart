// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_database.dart';

// ignore_for_file: type=lint
class $LocalChildrenTable extends LocalChildren
    with TableInfo<$LocalChildrenTable, LocalChildrenData> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalChildrenTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _organizationIdMeta =
      const VerificationMeta('organizationId');
  @override
  late final GeneratedColumn<String> organizationId = GeneratedColumn<String>(
      'organization_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _siteIdMeta = const VerificationMeta('siteId');
  @override
  late final GeneratedColumn<String> siteId = GeneratedColumn<String>(
      'site_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _roomIdMeta = const VerificationMeta('roomId');
  @override
  late final GeneratedColumn<String> roomId = GeneratedColumn<String>(
      'room_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _firstNameFrMeta =
      const VerificationMeta('firstNameFr');
  @override
  late final GeneratedColumn<String> firstNameFr = GeneratedColumn<String>(
      'first_name_fr', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _firstNameArMeta =
      const VerificationMeta('firstNameAr');
  @override
  late final GeneratedColumn<String> firstNameAr = GeneratedColumn<String>(
      'first_name_ar', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _lastNameFrMeta =
      const VerificationMeta('lastNameFr');
  @override
  late final GeneratedColumn<String> lastNameFr = GeneratedColumn<String>(
      'last_name_fr', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _lastNameArMeta =
      const VerificationMeta('lastNameAr');
  @override
  late final GeneratedColumn<String> lastNameAr = GeneratedColumn<String>(
      'last_name_ar', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _dateOfBirthMeta =
      const VerificationMeta('dateOfBirth');
  @override
  late final GeneratedColumn<String> dateOfBirth = GeneratedColumn<String>(
      'date_of_birth', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _photoUrlMeta =
      const VerificationMeta('photoUrl');
  @override
  late final GeneratedColumn<String> photoUrl = GeneratedColumn<String>(
      'photo_url', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
      'status', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _isWalkingMeta =
      const VerificationMeta('isWalking');
  @override
  late final GeneratedColumn<bool> isWalking = GeneratedColumn<bool>(
      'is_walking', aliasedName, false,
      type: DriftSqlType.bool,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('CHECK ("is_walking" IN (0, 1))'),
      defaultValue: const Constant(false));
  static const VerificationMeta _allergiesSummaryMeta =
      const VerificationMeta('allergiesSummary');
  @override
  late final GeneratedColumn<String> allergiesSummary = GeneratedColumn<String>(
      'allergies_summary', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _emergencyContactNameMeta =
      const VerificationMeta('emergencyContactName');
  @override
  late final GeneratedColumn<String> emergencyContactName =
      GeneratedColumn<String>('emergency_contact_name', aliasedName, true,
          type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _emergencyContactPhoneMeta =
      const VerificationMeta('emergencyContactPhone');
  @override
  late final GeneratedColumn<String> emergencyContactPhone =
      GeneratedColumn<String>('emergency_contact_phone', aliasedName, true,
          type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _serverVersionMeta =
      const VerificationMeta('serverVersion');
  @override
  late final GeneratedColumn<int> serverVersion = GeneratedColumn<int>(
      'server_version', aliasedName, false,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultValue: const Constant(0));
  static const VerificationMeta _syncedAtMeta =
      const VerificationMeta('syncedAt');
  @override
  late final GeneratedColumn<String> syncedAt = GeneratedColumn<String>(
      'synced_at', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        organizationId,
        siteId,
        roomId,
        firstNameFr,
        firstNameAr,
        lastNameFr,
        lastNameAr,
        dateOfBirth,
        photoUrl,
        status,
        isWalking,
        allergiesSummary,
        emergencyContactName,
        emergencyContactPhone,
        serverVersion,
        syncedAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_children';
  @override
  VerificationContext validateIntegrity(Insertable<LocalChildrenData> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('organization_id')) {
      context.handle(
          _organizationIdMeta,
          organizationId.isAcceptableOrUnknown(
              data['organization_id']!, _organizationIdMeta));
    } else if (isInserting) {
      context.missing(_organizationIdMeta);
    }
    if (data.containsKey('site_id')) {
      context.handle(_siteIdMeta,
          siteId.isAcceptableOrUnknown(data['site_id']!, _siteIdMeta));
    } else if (isInserting) {
      context.missing(_siteIdMeta);
    }
    if (data.containsKey('room_id')) {
      context.handle(_roomIdMeta,
          roomId.isAcceptableOrUnknown(data['room_id']!, _roomIdMeta));
    }
    if (data.containsKey('first_name_fr')) {
      context.handle(
          _firstNameFrMeta,
          firstNameFr.isAcceptableOrUnknown(
              data['first_name_fr']!, _firstNameFrMeta));
    } else if (isInserting) {
      context.missing(_firstNameFrMeta);
    }
    if (data.containsKey('first_name_ar')) {
      context.handle(
          _firstNameArMeta,
          firstNameAr.isAcceptableOrUnknown(
              data['first_name_ar']!, _firstNameArMeta));
    }
    if (data.containsKey('last_name_fr')) {
      context.handle(
          _lastNameFrMeta,
          lastNameFr.isAcceptableOrUnknown(
              data['last_name_fr']!, _lastNameFrMeta));
    } else if (isInserting) {
      context.missing(_lastNameFrMeta);
    }
    if (data.containsKey('last_name_ar')) {
      context.handle(
          _lastNameArMeta,
          lastNameAr.isAcceptableOrUnknown(
              data['last_name_ar']!, _lastNameArMeta));
    }
    if (data.containsKey('date_of_birth')) {
      context.handle(
          _dateOfBirthMeta,
          dateOfBirth.isAcceptableOrUnknown(
              data['date_of_birth']!, _dateOfBirthMeta));
    } else if (isInserting) {
      context.missing(_dateOfBirthMeta);
    }
    if (data.containsKey('photo_url')) {
      context.handle(_photoUrlMeta,
          photoUrl.isAcceptableOrUnknown(data['photo_url']!, _photoUrlMeta));
    }
    if (data.containsKey('status')) {
      context.handle(_statusMeta,
          status.isAcceptableOrUnknown(data['status']!, _statusMeta));
    } else if (isInserting) {
      context.missing(_statusMeta);
    }
    if (data.containsKey('is_walking')) {
      context.handle(_isWalkingMeta,
          isWalking.isAcceptableOrUnknown(data['is_walking']!, _isWalkingMeta));
    }
    if (data.containsKey('allergies_summary')) {
      context.handle(
          _allergiesSummaryMeta,
          allergiesSummary.isAcceptableOrUnknown(
              data['allergies_summary']!, _allergiesSummaryMeta));
    }
    if (data.containsKey('emergency_contact_name')) {
      context.handle(
          _emergencyContactNameMeta,
          emergencyContactName.isAcceptableOrUnknown(
              data['emergency_contact_name']!, _emergencyContactNameMeta));
    }
    if (data.containsKey('emergency_contact_phone')) {
      context.handle(
          _emergencyContactPhoneMeta,
          emergencyContactPhone.isAcceptableOrUnknown(
              data['emergency_contact_phone']!, _emergencyContactPhoneMeta));
    }
    if (data.containsKey('server_version')) {
      context.handle(
          _serverVersionMeta,
          serverVersion.isAcceptableOrUnknown(
              data['server_version']!, _serverVersionMeta));
    }
    if (data.containsKey('synced_at')) {
      context.handle(_syncedAtMeta,
          syncedAt.isAcceptableOrUnknown(data['synced_at']!, _syncedAtMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  LocalChildrenData map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalChildrenData(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      organizationId: attachedDatabase.typeMapping.read(
          DriftSqlType.string, data['${effectivePrefix}organization_id'])!,
      siteId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}site_id'])!,
      roomId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}room_id']),
      firstNameFr: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}first_name_fr'])!,
      firstNameAr: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}first_name_ar']),
      lastNameFr: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}last_name_fr'])!,
      lastNameAr: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}last_name_ar']),
      dateOfBirth: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}date_of_birth'])!,
      photoUrl: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}photo_url']),
      status: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}status'])!,
      isWalking: attachedDatabase.typeMapping
          .read(DriftSqlType.bool, data['${effectivePrefix}is_walking'])!,
      allergiesSummary: attachedDatabase.typeMapping.read(
          DriftSqlType.string, data['${effectivePrefix}allergies_summary']),
      emergencyContactName: attachedDatabase.typeMapping.read(
          DriftSqlType.string,
          data['${effectivePrefix}emergency_contact_name']),
      emergencyContactPhone: attachedDatabase.typeMapping.read(
          DriftSqlType.string,
          data['${effectivePrefix}emergency_contact_phone']),
      serverVersion: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}server_version'])!,
      syncedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}synced_at']),
    );
  }

  @override
  $LocalChildrenTable createAlias(String alias) {
    return $LocalChildrenTable(attachedDatabase, alias);
  }
}

class LocalChildrenData extends DataClass
    implements Insertable<LocalChildrenData> {
  final String id;
  final String organizationId;
  final String siteId;
  final String? roomId;
  final String firstNameFr;
  final String? firstNameAr;
  final String lastNameFr;
  final String? lastNameAr;
  final String dateOfBirth;
  final String? photoUrl;
  final String status;
  final bool isWalking;
  final String? allergiesSummary;
  final String? emergencyContactName;
  final String? emergencyContactPhone;
  final int serverVersion;
  final String? syncedAt;
  const LocalChildrenData(
      {required this.id,
      required this.organizationId,
      required this.siteId,
      this.roomId,
      required this.firstNameFr,
      this.firstNameAr,
      required this.lastNameFr,
      this.lastNameAr,
      required this.dateOfBirth,
      this.photoUrl,
      required this.status,
      required this.isWalking,
      this.allergiesSummary,
      this.emergencyContactName,
      this.emergencyContactPhone,
      required this.serverVersion,
      this.syncedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['organization_id'] = Variable<String>(organizationId);
    map['site_id'] = Variable<String>(siteId);
    if (!nullToAbsent || roomId != null) {
      map['room_id'] = Variable<String>(roomId);
    }
    map['first_name_fr'] = Variable<String>(firstNameFr);
    if (!nullToAbsent || firstNameAr != null) {
      map['first_name_ar'] = Variable<String>(firstNameAr);
    }
    map['last_name_fr'] = Variable<String>(lastNameFr);
    if (!nullToAbsent || lastNameAr != null) {
      map['last_name_ar'] = Variable<String>(lastNameAr);
    }
    map['date_of_birth'] = Variable<String>(dateOfBirth);
    if (!nullToAbsent || photoUrl != null) {
      map['photo_url'] = Variable<String>(photoUrl);
    }
    map['status'] = Variable<String>(status);
    map['is_walking'] = Variable<bool>(isWalking);
    if (!nullToAbsent || allergiesSummary != null) {
      map['allergies_summary'] = Variable<String>(allergiesSummary);
    }
    if (!nullToAbsent || emergencyContactName != null) {
      map['emergency_contact_name'] = Variable<String>(emergencyContactName);
    }
    if (!nullToAbsent || emergencyContactPhone != null) {
      map['emergency_contact_phone'] = Variable<String>(emergencyContactPhone);
    }
    map['server_version'] = Variable<int>(serverVersion);
    if (!nullToAbsent || syncedAt != null) {
      map['synced_at'] = Variable<String>(syncedAt);
    }
    return map;
  }

  LocalChildrenCompanion toCompanion(bool nullToAbsent) {
    return LocalChildrenCompanion(
      id: Value(id),
      organizationId: Value(organizationId),
      siteId: Value(siteId),
      roomId:
          roomId == null && nullToAbsent ? const Value.absent() : Value(roomId),
      firstNameFr: Value(firstNameFr),
      firstNameAr: firstNameAr == null && nullToAbsent
          ? const Value.absent()
          : Value(firstNameAr),
      lastNameFr: Value(lastNameFr),
      lastNameAr: lastNameAr == null && nullToAbsent
          ? const Value.absent()
          : Value(lastNameAr),
      dateOfBirth: Value(dateOfBirth),
      photoUrl: photoUrl == null && nullToAbsent
          ? const Value.absent()
          : Value(photoUrl),
      status: Value(status),
      isWalking: Value(isWalking),
      allergiesSummary: allergiesSummary == null && nullToAbsent
          ? const Value.absent()
          : Value(allergiesSummary),
      emergencyContactName: emergencyContactName == null && nullToAbsent
          ? const Value.absent()
          : Value(emergencyContactName),
      emergencyContactPhone: emergencyContactPhone == null && nullToAbsent
          ? const Value.absent()
          : Value(emergencyContactPhone),
      serverVersion: Value(serverVersion),
      syncedAt: syncedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(syncedAt),
    );
  }

  factory LocalChildrenData.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalChildrenData(
      id: serializer.fromJson<String>(json['id']),
      organizationId: serializer.fromJson<String>(json['organizationId']),
      siteId: serializer.fromJson<String>(json['siteId']),
      roomId: serializer.fromJson<String?>(json['roomId']),
      firstNameFr: serializer.fromJson<String>(json['firstNameFr']),
      firstNameAr: serializer.fromJson<String?>(json['firstNameAr']),
      lastNameFr: serializer.fromJson<String>(json['lastNameFr']),
      lastNameAr: serializer.fromJson<String?>(json['lastNameAr']),
      dateOfBirth: serializer.fromJson<String>(json['dateOfBirth']),
      photoUrl: serializer.fromJson<String?>(json['photoUrl']),
      status: serializer.fromJson<String>(json['status']),
      isWalking: serializer.fromJson<bool>(json['isWalking']),
      allergiesSummary: serializer.fromJson<String?>(json['allergiesSummary']),
      emergencyContactName:
          serializer.fromJson<String?>(json['emergencyContactName']),
      emergencyContactPhone:
          serializer.fromJson<String?>(json['emergencyContactPhone']),
      serverVersion: serializer.fromJson<int>(json['serverVersion']),
      syncedAt: serializer.fromJson<String?>(json['syncedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'organizationId': serializer.toJson<String>(organizationId),
      'siteId': serializer.toJson<String>(siteId),
      'roomId': serializer.toJson<String?>(roomId),
      'firstNameFr': serializer.toJson<String>(firstNameFr),
      'firstNameAr': serializer.toJson<String?>(firstNameAr),
      'lastNameFr': serializer.toJson<String>(lastNameFr),
      'lastNameAr': serializer.toJson<String?>(lastNameAr),
      'dateOfBirth': serializer.toJson<String>(dateOfBirth),
      'photoUrl': serializer.toJson<String?>(photoUrl),
      'status': serializer.toJson<String>(status),
      'isWalking': serializer.toJson<bool>(isWalking),
      'allergiesSummary': serializer.toJson<String?>(allergiesSummary),
      'emergencyContactName': serializer.toJson<String?>(emergencyContactName),
      'emergencyContactPhone':
          serializer.toJson<String?>(emergencyContactPhone),
      'serverVersion': serializer.toJson<int>(serverVersion),
      'syncedAt': serializer.toJson<String?>(syncedAt),
    };
  }

  LocalChildrenData copyWith(
          {String? id,
          String? organizationId,
          String? siteId,
          Value<String?> roomId = const Value.absent(),
          String? firstNameFr,
          Value<String?> firstNameAr = const Value.absent(),
          String? lastNameFr,
          Value<String?> lastNameAr = const Value.absent(),
          String? dateOfBirth,
          Value<String?> photoUrl = const Value.absent(),
          String? status,
          bool? isWalking,
          Value<String?> allergiesSummary = const Value.absent(),
          Value<String?> emergencyContactName = const Value.absent(),
          Value<String?> emergencyContactPhone = const Value.absent(),
          int? serverVersion,
          Value<String?> syncedAt = const Value.absent()}) =>
      LocalChildrenData(
        id: id ?? this.id,
        organizationId: organizationId ?? this.organizationId,
        siteId: siteId ?? this.siteId,
        roomId: roomId.present ? roomId.value : this.roomId,
        firstNameFr: firstNameFr ?? this.firstNameFr,
        firstNameAr: firstNameAr.present ? firstNameAr.value : this.firstNameAr,
        lastNameFr: lastNameFr ?? this.lastNameFr,
        lastNameAr: lastNameAr.present ? lastNameAr.value : this.lastNameAr,
        dateOfBirth: dateOfBirth ?? this.dateOfBirth,
        photoUrl: photoUrl.present ? photoUrl.value : this.photoUrl,
        status: status ?? this.status,
        isWalking: isWalking ?? this.isWalking,
        allergiesSummary: allergiesSummary.present
            ? allergiesSummary.value
            : this.allergiesSummary,
        emergencyContactName: emergencyContactName.present
            ? emergencyContactName.value
            : this.emergencyContactName,
        emergencyContactPhone: emergencyContactPhone.present
            ? emergencyContactPhone.value
            : this.emergencyContactPhone,
        serverVersion: serverVersion ?? this.serverVersion,
        syncedAt: syncedAt.present ? syncedAt.value : this.syncedAt,
      );
  LocalChildrenData copyWithCompanion(LocalChildrenCompanion data) {
    return LocalChildrenData(
      id: data.id.present ? data.id.value : this.id,
      organizationId: data.organizationId.present
          ? data.organizationId.value
          : this.organizationId,
      siteId: data.siteId.present ? data.siteId.value : this.siteId,
      roomId: data.roomId.present ? data.roomId.value : this.roomId,
      firstNameFr:
          data.firstNameFr.present ? data.firstNameFr.value : this.firstNameFr,
      firstNameAr:
          data.firstNameAr.present ? data.firstNameAr.value : this.firstNameAr,
      lastNameFr:
          data.lastNameFr.present ? data.lastNameFr.value : this.lastNameFr,
      lastNameAr:
          data.lastNameAr.present ? data.lastNameAr.value : this.lastNameAr,
      dateOfBirth:
          data.dateOfBirth.present ? data.dateOfBirth.value : this.dateOfBirth,
      photoUrl: data.photoUrl.present ? data.photoUrl.value : this.photoUrl,
      status: data.status.present ? data.status.value : this.status,
      isWalking: data.isWalking.present ? data.isWalking.value : this.isWalking,
      allergiesSummary: data.allergiesSummary.present
          ? data.allergiesSummary.value
          : this.allergiesSummary,
      emergencyContactName: data.emergencyContactName.present
          ? data.emergencyContactName.value
          : this.emergencyContactName,
      emergencyContactPhone: data.emergencyContactPhone.present
          ? data.emergencyContactPhone.value
          : this.emergencyContactPhone,
      serverVersion: data.serverVersion.present
          ? data.serverVersion.value
          : this.serverVersion,
      syncedAt: data.syncedAt.present ? data.syncedAt.value : this.syncedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalChildrenData(')
          ..write('id: $id, ')
          ..write('organizationId: $organizationId, ')
          ..write('siteId: $siteId, ')
          ..write('roomId: $roomId, ')
          ..write('firstNameFr: $firstNameFr, ')
          ..write('firstNameAr: $firstNameAr, ')
          ..write('lastNameFr: $lastNameFr, ')
          ..write('lastNameAr: $lastNameAr, ')
          ..write('dateOfBirth: $dateOfBirth, ')
          ..write('photoUrl: $photoUrl, ')
          ..write('status: $status, ')
          ..write('isWalking: $isWalking, ')
          ..write('allergiesSummary: $allergiesSummary, ')
          ..write('emergencyContactName: $emergencyContactName, ')
          ..write('emergencyContactPhone: $emergencyContactPhone, ')
          ..write('serverVersion: $serverVersion, ')
          ..write('syncedAt: $syncedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      id,
      organizationId,
      siteId,
      roomId,
      firstNameFr,
      firstNameAr,
      lastNameFr,
      lastNameAr,
      dateOfBirth,
      photoUrl,
      status,
      isWalking,
      allergiesSummary,
      emergencyContactName,
      emergencyContactPhone,
      serverVersion,
      syncedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalChildrenData &&
          other.id == this.id &&
          other.organizationId == this.organizationId &&
          other.siteId == this.siteId &&
          other.roomId == this.roomId &&
          other.firstNameFr == this.firstNameFr &&
          other.firstNameAr == this.firstNameAr &&
          other.lastNameFr == this.lastNameFr &&
          other.lastNameAr == this.lastNameAr &&
          other.dateOfBirth == this.dateOfBirth &&
          other.photoUrl == this.photoUrl &&
          other.status == this.status &&
          other.isWalking == this.isWalking &&
          other.allergiesSummary == this.allergiesSummary &&
          other.emergencyContactName == this.emergencyContactName &&
          other.emergencyContactPhone == this.emergencyContactPhone &&
          other.serverVersion == this.serverVersion &&
          other.syncedAt == this.syncedAt);
}

class LocalChildrenCompanion extends UpdateCompanion<LocalChildrenData> {
  final Value<String> id;
  final Value<String> organizationId;
  final Value<String> siteId;
  final Value<String?> roomId;
  final Value<String> firstNameFr;
  final Value<String?> firstNameAr;
  final Value<String> lastNameFr;
  final Value<String?> lastNameAr;
  final Value<String> dateOfBirth;
  final Value<String?> photoUrl;
  final Value<String> status;
  final Value<bool> isWalking;
  final Value<String?> allergiesSummary;
  final Value<String?> emergencyContactName;
  final Value<String?> emergencyContactPhone;
  final Value<int> serverVersion;
  final Value<String?> syncedAt;
  final Value<int> rowid;
  const LocalChildrenCompanion({
    this.id = const Value.absent(),
    this.organizationId = const Value.absent(),
    this.siteId = const Value.absent(),
    this.roomId = const Value.absent(),
    this.firstNameFr = const Value.absent(),
    this.firstNameAr = const Value.absent(),
    this.lastNameFr = const Value.absent(),
    this.lastNameAr = const Value.absent(),
    this.dateOfBirth = const Value.absent(),
    this.photoUrl = const Value.absent(),
    this.status = const Value.absent(),
    this.isWalking = const Value.absent(),
    this.allergiesSummary = const Value.absent(),
    this.emergencyContactName = const Value.absent(),
    this.emergencyContactPhone = const Value.absent(),
    this.serverVersion = const Value.absent(),
    this.syncedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalChildrenCompanion.insert({
    required String id,
    required String organizationId,
    required String siteId,
    this.roomId = const Value.absent(),
    required String firstNameFr,
    this.firstNameAr = const Value.absent(),
    required String lastNameFr,
    this.lastNameAr = const Value.absent(),
    required String dateOfBirth,
    this.photoUrl = const Value.absent(),
    required String status,
    this.isWalking = const Value.absent(),
    this.allergiesSummary = const Value.absent(),
    this.emergencyContactName = const Value.absent(),
    this.emergencyContactPhone = const Value.absent(),
    this.serverVersion = const Value.absent(),
    this.syncedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        organizationId = Value(organizationId),
        siteId = Value(siteId),
        firstNameFr = Value(firstNameFr),
        lastNameFr = Value(lastNameFr),
        dateOfBirth = Value(dateOfBirth),
        status = Value(status);
  static Insertable<LocalChildrenData> custom({
    Expression<String>? id,
    Expression<String>? organizationId,
    Expression<String>? siteId,
    Expression<String>? roomId,
    Expression<String>? firstNameFr,
    Expression<String>? firstNameAr,
    Expression<String>? lastNameFr,
    Expression<String>? lastNameAr,
    Expression<String>? dateOfBirth,
    Expression<String>? photoUrl,
    Expression<String>? status,
    Expression<bool>? isWalking,
    Expression<String>? allergiesSummary,
    Expression<String>? emergencyContactName,
    Expression<String>? emergencyContactPhone,
    Expression<int>? serverVersion,
    Expression<String>? syncedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (organizationId != null) 'organization_id': organizationId,
      if (siteId != null) 'site_id': siteId,
      if (roomId != null) 'room_id': roomId,
      if (firstNameFr != null) 'first_name_fr': firstNameFr,
      if (firstNameAr != null) 'first_name_ar': firstNameAr,
      if (lastNameFr != null) 'last_name_fr': lastNameFr,
      if (lastNameAr != null) 'last_name_ar': lastNameAr,
      if (dateOfBirth != null) 'date_of_birth': dateOfBirth,
      if (photoUrl != null) 'photo_url': photoUrl,
      if (status != null) 'status': status,
      if (isWalking != null) 'is_walking': isWalking,
      if (allergiesSummary != null) 'allergies_summary': allergiesSummary,
      if (emergencyContactName != null)
        'emergency_contact_name': emergencyContactName,
      if (emergencyContactPhone != null)
        'emergency_contact_phone': emergencyContactPhone,
      if (serverVersion != null) 'server_version': serverVersion,
      if (syncedAt != null) 'synced_at': syncedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalChildrenCompanion copyWith(
      {Value<String>? id,
      Value<String>? organizationId,
      Value<String>? siteId,
      Value<String?>? roomId,
      Value<String>? firstNameFr,
      Value<String?>? firstNameAr,
      Value<String>? lastNameFr,
      Value<String?>? lastNameAr,
      Value<String>? dateOfBirth,
      Value<String?>? photoUrl,
      Value<String>? status,
      Value<bool>? isWalking,
      Value<String?>? allergiesSummary,
      Value<String?>? emergencyContactName,
      Value<String?>? emergencyContactPhone,
      Value<int>? serverVersion,
      Value<String?>? syncedAt,
      Value<int>? rowid}) {
    return LocalChildrenCompanion(
      id: id ?? this.id,
      organizationId: organizationId ?? this.organizationId,
      siteId: siteId ?? this.siteId,
      roomId: roomId ?? this.roomId,
      firstNameFr: firstNameFr ?? this.firstNameFr,
      firstNameAr: firstNameAr ?? this.firstNameAr,
      lastNameFr: lastNameFr ?? this.lastNameFr,
      lastNameAr: lastNameAr ?? this.lastNameAr,
      dateOfBirth: dateOfBirth ?? this.dateOfBirth,
      photoUrl: photoUrl ?? this.photoUrl,
      status: status ?? this.status,
      isWalking: isWalking ?? this.isWalking,
      allergiesSummary: allergiesSummary ?? this.allergiesSummary,
      emergencyContactName: emergencyContactName ?? this.emergencyContactName,
      emergencyContactPhone:
          emergencyContactPhone ?? this.emergencyContactPhone,
      serverVersion: serverVersion ?? this.serverVersion,
      syncedAt: syncedAt ?? this.syncedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (organizationId.present) {
      map['organization_id'] = Variable<String>(organizationId.value);
    }
    if (siteId.present) {
      map['site_id'] = Variable<String>(siteId.value);
    }
    if (roomId.present) {
      map['room_id'] = Variable<String>(roomId.value);
    }
    if (firstNameFr.present) {
      map['first_name_fr'] = Variable<String>(firstNameFr.value);
    }
    if (firstNameAr.present) {
      map['first_name_ar'] = Variable<String>(firstNameAr.value);
    }
    if (lastNameFr.present) {
      map['last_name_fr'] = Variable<String>(lastNameFr.value);
    }
    if (lastNameAr.present) {
      map['last_name_ar'] = Variable<String>(lastNameAr.value);
    }
    if (dateOfBirth.present) {
      map['date_of_birth'] = Variable<String>(dateOfBirth.value);
    }
    if (photoUrl.present) {
      map['photo_url'] = Variable<String>(photoUrl.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (isWalking.present) {
      map['is_walking'] = Variable<bool>(isWalking.value);
    }
    if (allergiesSummary.present) {
      map['allergies_summary'] = Variable<String>(allergiesSummary.value);
    }
    if (emergencyContactName.present) {
      map['emergency_contact_name'] =
          Variable<String>(emergencyContactName.value);
    }
    if (emergencyContactPhone.present) {
      map['emergency_contact_phone'] =
          Variable<String>(emergencyContactPhone.value);
    }
    if (serverVersion.present) {
      map['server_version'] = Variable<int>(serverVersion.value);
    }
    if (syncedAt.present) {
      map['synced_at'] = Variable<String>(syncedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalChildrenCompanion(')
          ..write('id: $id, ')
          ..write('organizationId: $organizationId, ')
          ..write('siteId: $siteId, ')
          ..write('roomId: $roomId, ')
          ..write('firstNameFr: $firstNameFr, ')
          ..write('firstNameAr: $firstNameAr, ')
          ..write('lastNameFr: $lastNameFr, ')
          ..write('lastNameAr: $lastNameAr, ')
          ..write('dateOfBirth: $dateOfBirth, ')
          ..write('photoUrl: $photoUrl, ')
          ..write('status: $status, ')
          ..write('isWalking: $isWalking, ')
          ..write('allergiesSummary: $allergiesSummary, ')
          ..write('emergencyContactName: $emergencyContactName, ')
          ..write('emergencyContactPhone: $emergencyContactPhone, ')
          ..write('serverVersion: $serverVersion, ')
          ..write('syncedAt: $syncedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $LocalAttendanceSessionsTable extends LocalAttendanceSessions
    with TableInfo<$LocalAttendanceSessionsTable, LocalAttendanceSession> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalAttendanceSessionsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _organizationIdMeta =
      const VerificationMeta('organizationId');
  @override
  late final GeneratedColumn<String> organizationId = GeneratedColumn<String>(
      'organization_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _childIdMeta =
      const VerificationMeta('childId');
  @override
  late final GeneratedColumn<String> childId = GeneratedColumn<String>(
      'child_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _sessionDateMeta =
      const VerificationMeta('sessionDate');
  @override
  late final GeneratedColumn<String> sessionDate = GeneratedColumn<String>(
      'session_date', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
      'status', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _updatedAtMeta =
      const VerificationMeta('updatedAt');
  @override
  late final GeneratedColumn<String> updatedAt = GeneratedColumn<String>(
      'updated_at', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _serverVersionMeta =
      const VerificationMeta('serverVersion');
  @override
  late final GeneratedColumn<int> serverVersion = GeneratedColumn<int>(
      'server_version', aliasedName, false,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultValue: const Constant(0));
  @override
  List<GeneratedColumn> get $columns => [
        id,
        organizationId,
        childId,
        sessionDate,
        status,
        updatedAt,
        serverVersion
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_attendance_sessions';
  @override
  VerificationContext validateIntegrity(
      Insertable<LocalAttendanceSession> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('organization_id')) {
      context.handle(
          _organizationIdMeta,
          organizationId.isAcceptableOrUnknown(
              data['organization_id']!, _organizationIdMeta));
    } else if (isInserting) {
      context.missing(_organizationIdMeta);
    }
    if (data.containsKey('child_id')) {
      context.handle(_childIdMeta,
          childId.isAcceptableOrUnknown(data['child_id']!, _childIdMeta));
    } else if (isInserting) {
      context.missing(_childIdMeta);
    }
    if (data.containsKey('session_date')) {
      context.handle(
          _sessionDateMeta,
          sessionDate.isAcceptableOrUnknown(
              data['session_date']!, _sessionDateMeta));
    } else if (isInserting) {
      context.missing(_sessionDateMeta);
    }
    if (data.containsKey('status')) {
      context.handle(_statusMeta,
          status.isAcceptableOrUnknown(data['status']!, _statusMeta));
    } else if (isInserting) {
      context.missing(_statusMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(_updatedAtMeta,
          updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta));
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    if (data.containsKey('server_version')) {
      context.handle(
          _serverVersionMeta,
          serverVersion.isAcceptableOrUnknown(
              data['server_version']!, _serverVersionMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  LocalAttendanceSession map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalAttendanceSession(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      organizationId: attachedDatabase.typeMapping.read(
          DriftSqlType.string, data['${effectivePrefix}organization_id'])!,
      childId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}child_id'])!,
      sessionDate: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}session_date'])!,
      status: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}status'])!,
      updatedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}updated_at'])!,
      serverVersion: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}server_version'])!,
    );
  }

  @override
  $LocalAttendanceSessionsTable createAlias(String alias) {
    return $LocalAttendanceSessionsTable(attachedDatabase, alias);
  }
}

class LocalAttendanceSession extends DataClass
    implements Insertable<LocalAttendanceSession> {
  final String id;
  final String organizationId;
  final String childId;
  final String sessionDate;
  final String status;
  final String updatedAt;
  final int serverVersion;
  const LocalAttendanceSession(
      {required this.id,
      required this.organizationId,
      required this.childId,
      required this.sessionDate,
      required this.status,
      required this.updatedAt,
      required this.serverVersion});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['organization_id'] = Variable<String>(organizationId);
    map['child_id'] = Variable<String>(childId);
    map['session_date'] = Variable<String>(sessionDate);
    map['status'] = Variable<String>(status);
    map['updated_at'] = Variable<String>(updatedAt);
    map['server_version'] = Variable<int>(serverVersion);
    return map;
  }

  LocalAttendanceSessionsCompanion toCompanion(bool nullToAbsent) {
    return LocalAttendanceSessionsCompanion(
      id: Value(id),
      organizationId: Value(organizationId),
      childId: Value(childId),
      sessionDate: Value(sessionDate),
      status: Value(status),
      updatedAt: Value(updatedAt),
      serverVersion: Value(serverVersion),
    );
  }

  factory LocalAttendanceSession.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalAttendanceSession(
      id: serializer.fromJson<String>(json['id']),
      organizationId: serializer.fromJson<String>(json['organizationId']),
      childId: serializer.fromJson<String>(json['childId']),
      sessionDate: serializer.fromJson<String>(json['sessionDate']),
      status: serializer.fromJson<String>(json['status']),
      updatedAt: serializer.fromJson<String>(json['updatedAt']),
      serverVersion: serializer.fromJson<int>(json['serverVersion']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'organizationId': serializer.toJson<String>(organizationId),
      'childId': serializer.toJson<String>(childId),
      'sessionDate': serializer.toJson<String>(sessionDate),
      'status': serializer.toJson<String>(status),
      'updatedAt': serializer.toJson<String>(updatedAt),
      'serverVersion': serializer.toJson<int>(serverVersion),
    };
  }

  LocalAttendanceSession copyWith(
          {String? id,
          String? organizationId,
          String? childId,
          String? sessionDate,
          String? status,
          String? updatedAt,
          int? serverVersion}) =>
      LocalAttendanceSession(
        id: id ?? this.id,
        organizationId: organizationId ?? this.organizationId,
        childId: childId ?? this.childId,
        sessionDate: sessionDate ?? this.sessionDate,
        status: status ?? this.status,
        updatedAt: updatedAt ?? this.updatedAt,
        serverVersion: serverVersion ?? this.serverVersion,
      );
  LocalAttendanceSession copyWithCompanion(
      LocalAttendanceSessionsCompanion data) {
    return LocalAttendanceSession(
      id: data.id.present ? data.id.value : this.id,
      organizationId: data.organizationId.present
          ? data.organizationId.value
          : this.organizationId,
      childId: data.childId.present ? data.childId.value : this.childId,
      sessionDate:
          data.sessionDate.present ? data.sessionDate.value : this.sessionDate,
      status: data.status.present ? data.status.value : this.status,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
      serverVersion: data.serverVersion.present
          ? data.serverVersion.value
          : this.serverVersion,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalAttendanceSession(')
          ..write('id: $id, ')
          ..write('organizationId: $organizationId, ')
          ..write('childId: $childId, ')
          ..write('sessionDate: $sessionDate, ')
          ..write('status: $status, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('serverVersion: $serverVersion')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, organizationId, childId, sessionDate,
      status, updatedAt, serverVersion);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalAttendanceSession &&
          other.id == this.id &&
          other.organizationId == this.organizationId &&
          other.childId == this.childId &&
          other.sessionDate == this.sessionDate &&
          other.status == this.status &&
          other.updatedAt == this.updatedAt &&
          other.serverVersion == this.serverVersion);
}

class LocalAttendanceSessionsCompanion
    extends UpdateCompanion<LocalAttendanceSession> {
  final Value<String> id;
  final Value<String> organizationId;
  final Value<String> childId;
  final Value<String> sessionDate;
  final Value<String> status;
  final Value<String> updatedAt;
  final Value<int> serverVersion;
  final Value<int> rowid;
  const LocalAttendanceSessionsCompanion({
    this.id = const Value.absent(),
    this.organizationId = const Value.absent(),
    this.childId = const Value.absent(),
    this.sessionDate = const Value.absent(),
    this.status = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.serverVersion = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalAttendanceSessionsCompanion.insert({
    required String id,
    required String organizationId,
    required String childId,
    required String sessionDate,
    required String status,
    required String updatedAt,
    this.serverVersion = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        organizationId = Value(organizationId),
        childId = Value(childId),
        sessionDate = Value(sessionDate),
        status = Value(status),
        updatedAt = Value(updatedAt);
  static Insertable<LocalAttendanceSession> custom({
    Expression<String>? id,
    Expression<String>? organizationId,
    Expression<String>? childId,
    Expression<String>? sessionDate,
    Expression<String>? status,
    Expression<String>? updatedAt,
    Expression<int>? serverVersion,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (organizationId != null) 'organization_id': organizationId,
      if (childId != null) 'child_id': childId,
      if (sessionDate != null) 'session_date': sessionDate,
      if (status != null) 'status': status,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (serverVersion != null) 'server_version': serverVersion,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalAttendanceSessionsCompanion copyWith(
      {Value<String>? id,
      Value<String>? organizationId,
      Value<String>? childId,
      Value<String>? sessionDate,
      Value<String>? status,
      Value<String>? updatedAt,
      Value<int>? serverVersion,
      Value<int>? rowid}) {
    return LocalAttendanceSessionsCompanion(
      id: id ?? this.id,
      organizationId: organizationId ?? this.organizationId,
      childId: childId ?? this.childId,
      sessionDate: sessionDate ?? this.sessionDate,
      status: status ?? this.status,
      updatedAt: updatedAt ?? this.updatedAt,
      serverVersion: serverVersion ?? this.serverVersion,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (organizationId.present) {
      map['organization_id'] = Variable<String>(organizationId.value);
    }
    if (childId.present) {
      map['child_id'] = Variable<String>(childId.value);
    }
    if (sessionDate.present) {
      map['session_date'] = Variable<String>(sessionDate.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<String>(updatedAt.value);
    }
    if (serverVersion.present) {
      map['server_version'] = Variable<int>(serverVersion.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalAttendanceSessionsCompanion(')
          ..write('id: $id, ')
          ..write('organizationId: $organizationId, ')
          ..write('childId: $childId, ')
          ..write('sessionDate: $sessionDate, ')
          ..write('status: $status, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('serverVersion: $serverVersion, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $LocalDailyEventsTable extends LocalDailyEvents
    with TableInfo<$LocalDailyEventsTable, LocalDailyEvent> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalDailyEventsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _organizationIdMeta =
      const VerificationMeta('organizationId');
  @override
  late final GeneratedColumn<String> organizationId = GeneratedColumn<String>(
      'organization_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _childIdMeta =
      const VerificationMeta('childId');
  @override
  late final GeneratedColumn<String> childId = GeneratedColumn<String>(
      'child_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _eventDateMeta =
      const VerificationMeta('eventDate');
  @override
  late final GeneratedColumn<String> eventDate = GeneratedColumn<String>(
      'event_date', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _eventTypeMeta =
      const VerificationMeta('eventType');
  @override
  late final GeneratedColumn<String> eventType = GeneratedColumn<String>(
      'event_type', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _occurredAtMeta =
      const VerificationMeta('occurredAt');
  @override
  late final GeneratedColumn<String> occurredAt = GeneratedColumn<String>(
      'occurred_at', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _payloadJsonMeta =
      const VerificationMeta('payloadJson');
  @override
  late final GeneratedColumn<String> payloadJson = GeneratedColumn<String>(
      'payload_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _isSyncedMeta =
      const VerificationMeta('isSynced');
  @override
  late final GeneratedColumn<bool> isSynced = GeneratedColumn<bool>(
      'is_synced', aliasedName, false,
      type: DriftSqlType.bool,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('CHECK ("is_synced" IN (0, 1))'),
      defaultValue: const Constant(false));
  static const VerificationMeta _syncEventIdMeta =
      const VerificationMeta('syncEventId');
  @override
  late final GeneratedColumn<String> syncEventId = GeneratedColumn<String>(
      'sync_event_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _createdAtMeta =
      const VerificationMeta('createdAt');
  @override
  late final GeneratedColumn<String> createdAt = GeneratedColumn<String>(
      'created_at', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        organizationId,
        childId,
        eventDate,
        eventType,
        occurredAt,
        payloadJson,
        isSynced,
        syncEventId,
        createdAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_daily_events';
  @override
  VerificationContext validateIntegrity(Insertable<LocalDailyEvent> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('organization_id')) {
      context.handle(
          _organizationIdMeta,
          organizationId.isAcceptableOrUnknown(
              data['organization_id']!, _organizationIdMeta));
    } else if (isInserting) {
      context.missing(_organizationIdMeta);
    }
    if (data.containsKey('child_id')) {
      context.handle(_childIdMeta,
          childId.isAcceptableOrUnknown(data['child_id']!, _childIdMeta));
    } else if (isInserting) {
      context.missing(_childIdMeta);
    }
    if (data.containsKey('event_date')) {
      context.handle(_eventDateMeta,
          eventDate.isAcceptableOrUnknown(data['event_date']!, _eventDateMeta));
    } else if (isInserting) {
      context.missing(_eventDateMeta);
    }
    if (data.containsKey('event_type')) {
      context.handle(_eventTypeMeta,
          eventType.isAcceptableOrUnknown(data['event_type']!, _eventTypeMeta));
    } else if (isInserting) {
      context.missing(_eventTypeMeta);
    }
    if (data.containsKey('occurred_at')) {
      context.handle(
          _occurredAtMeta,
          occurredAt.isAcceptableOrUnknown(
              data['occurred_at']!, _occurredAtMeta));
    } else if (isInserting) {
      context.missing(_occurredAtMeta);
    }
    if (data.containsKey('payload_json')) {
      context.handle(
          _payloadJsonMeta,
          payloadJson.isAcceptableOrUnknown(
              data['payload_json']!, _payloadJsonMeta));
    } else if (isInserting) {
      context.missing(_payloadJsonMeta);
    }
    if (data.containsKey('is_synced')) {
      context.handle(_isSyncedMeta,
          isSynced.isAcceptableOrUnknown(data['is_synced']!, _isSyncedMeta));
    }
    if (data.containsKey('sync_event_id')) {
      context.handle(
          _syncEventIdMeta,
          syncEventId.isAcceptableOrUnknown(
              data['sync_event_id']!, _syncEventIdMeta));
    }
    if (data.containsKey('created_at')) {
      context.handle(_createdAtMeta,
          createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta));
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  LocalDailyEvent map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalDailyEvent(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      organizationId: attachedDatabase.typeMapping.read(
          DriftSqlType.string, data['${effectivePrefix}organization_id'])!,
      childId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}child_id'])!,
      eventDate: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}event_date'])!,
      eventType: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}event_type'])!,
      occurredAt: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}occurred_at'])!,
      payloadJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}payload_json'])!,
      isSynced: attachedDatabase.typeMapping
          .read(DriftSqlType.bool, data['${effectivePrefix}is_synced'])!,
      syncEventId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}sync_event_id']),
      createdAt: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}created_at'])!,
    );
  }

  @override
  $LocalDailyEventsTable createAlias(String alias) {
    return $LocalDailyEventsTable(attachedDatabase, alias);
  }
}

class LocalDailyEvent extends DataClass implements Insertable<LocalDailyEvent> {
  final String id;
  final String organizationId;
  final String childId;
  final String eventDate;
  final String eventType;
  final String occurredAt;
  final String payloadJson;
  final bool isSynced;
  final String? syncEventId;
  final String createdAt;
  const LocalDailyEvent(
      {required this.id,
      required this.organizationId,
      required this.childId,
      required this.eventDate,
      required this.eventType,
      required this.occurredAt,
      required this.payloadJson,
      required this.isSynced,
      this.syncEventId,
      required this.createdAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['organization_id'] = Variable<String>(organizationId);
    map['child_id'] = Variable<String>(childId);
    map['event_date'] = Variable<String>(eventDate);
    map['event_type'] = Variable<String>(eventType);
    map['occurred_at'] = Variable<String>(occurredAt);
    map['payload_json'] = Variable<String>(payloadJson);
    map['is_synced'] = Variable<bool>(isSynced);
    if (!nullToAbsent || syncEventId != null) {
      map['sync_event_id'] = Variable<String>(syncEventId);
    }
    map['created_at'] = Variable<String>(createdAt);
    return map;
  }

  LocalDailyEventsCompanion toCompanion(bool nullToAbsent) {
    return LocalDailyEventsCompanion(
      id: Value(id),
      organizationId: Value(organizationId),
      childId: Value(childId),
      eventDate: Value(eventDate),
      eventType: Value(eventType),
      occurredAt: Value(occurredAt),
      payloadJson: Value(payloadJson),
      isSynced: Value(isSynced),
      syncEventId: syncEventId == null && nullToAbsent
          ? const Value.absent()
          : Value(syncEventId),
      createdAt: Value(createdAt),
    );
  }

  factory LocalDailyEvent.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalDailyEvent(
      id: serializer.fromJson<String>(json['id']),
      organizationId: serializer.fromJson<String>(json['organizationId']),
      childId: serializer.fromJson<String>(json['childId']),
      eventDate: serializer.fromJson<String>(json['eventDate']),
      eventType: serializer.fromJson<String>(json['eventType']),
      occurredAt: serializer.fromJson<String>(json['occurredAt']),
      payloadJson: serializer.fromJson<String>(json['payloadJson']),
      isSynced: serializer.fromJson<bool>(json['isSynced']),
      syncEventId: serializer.fromJson<String?>(json['syncEventId']),
      createdAt: serializer.fromJson<String>(json['createdAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'organizationId': serializer.toJson<String>(organizationId),
      'childId': serializer.toJson<String>(childId),
      'eventDate': serializer.toJson<String>(eventDate),
      'eventType': serializer.toJson<String>(eventType),
      'occurredAt': serializer.toJson<String>(occurredAt),
      'payloadJson': serializer.toJson<String>(payloadJson),
      'isSynced': serializer.toJson<bool>(isSynced),
      'syncEventId': serializer.toJson<String?>(syncEventId),
      'createdAt': serializer.toJson<String>(createdAt),
    };
  }

  LocalDailyEvent copyWith(
          {String? id,
          String? organizationId,
          String? childId,
          String? eventDate,
          String? eventType,
          String? occurredAt,
          String? payloadJson,
          bool? isSynced,
          Value<String?> syncEventId = const Value.absent(),
          String? createdAt}) =>
      LocalDailyEvent(
        id: id ?? this.id,
        organizationId: organizationId ?? this.organizationId,
        childId: childId ?? this.childId,
        eventDate: eventDate ?? this.eventDate,
        eventType: eventType ?? this.eventType,
        occurredAt: occurredAt ?? this.occurredAt,
        payloadJson: payloadJson ?? this.payloadJson,
        isSynced: isSynced ?? this.isSynced,
        syncEventId: syncEventId.present ? syncEventId.value : this.syncEventId,
        createdAt: createdAt ?? this.createdAt,
      );
  LocalDailyEvent copyWithCompanion(LocalDailyEventsCompanion data) {
    return LocalDailyEvent(
      id: data.id.present ? data.id.value : this.id,
      organizationId: data.organizationId.present
          ? data.organizationId.value
          : this.organizationId,
      childId: data.childId.present ? data.childId.value : this.childId,
      eventDate: data.eventDate.present ? data.eventDate.value : this.eventDate,
      eventType: data.eventType.present ? data.eventType.value : this.eventType,
      occurredAt:
          data.occurredAt.present ? data.occurredAt.value : this.occurredAt,
      payloadJson:
          data.payloadJson.present ? data.payloadJson.value : this.payloadJson,
      isSynced: data.isSynced.present ? data.isSynced.value : this.isSynced,
      syncEventId:
          data.syncEventId.present ? data.syncEventId.value : this.syncEventId,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalDailyEvent(')
          ..write('id: $id, ')
          ..write('organizationId: $organizationId, ')
          ..write('childId: $childId, ')
          ..write('eventDate: $eventDate, ')
          ..write('eventType: $eventType, ')
          ..write('occurredAt: $occurredAt, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('isSynced: $isSynced, ')
          ..write('syncEventId: $syncEventId, ')
          ..write('createdAt: $createdAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, organizationId, childId, eventDate,
      eventType, occurredAt, payloadJson, isSynced, syncEventId, createdAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalDailyEvent &&
          other.id == this.id &&
          other.organizationId == this.organizationId &&
          other.childId == this.childId &&
          other.eventDate == this.eventDate &&
          other.eventType == this.eventType &&
          other.occurredAt == this.occurredAt &&
          other.payloadJson == this.payloadJson &&
          other.isSynced == this.isSynced &&
          other.syncEventId == this.syncEventId &&
          other.createdAt == this.createdAt);
}

class LocalDailyEventsCompanion extends UpdateCompanion<LocalDailyEvent> {
  final Value<String> id;
  final Value<String> organizationId;
  final Value<String> childId;
  final Value<String> eventDate;
  final Value<String> eventType;
  final Value<String> occurredAt;
  final Value<String> payloadJson;
  final Value<bool> isSynced;
  final Value<String?> syncEventId;
  final Value<String> createdAt;
  final Value<int> rowid;
  const LocalDailyEventsCompanion({
    this.id = const Value.absent(),
    this.organizationId = const Value.absent(),
    this.childId = const Value.absent(),
    this.eventDate = const Value.absent(),
    this.eventType = const Value.absent(),
    this.occurredAt = const Value.absent(),
    this.payloadJson = const Value.absent(),
    this.isSynced = const Value.absent(),
    this.syncEventId = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalDailyEventsCompanion.insert({
    required String id,
    required String organizationId,
    required String childId,
    required String eventDate,
    required String eventType,
    required String occurredAt,
    required String payloadJson,
    this.isSynced = const Value.absent(),
    this.syncEventId = const Value.absent(),
    required String createdAt,
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        organizationId = Value(organizationId),
        childId = Value(childId),
        eventDate = Value(eventDate),
        eventType = Value(eventType),
        occurredAt = Value(occurredAt),
        payloadJson = Value(payloadJson),
        createdAt = Value(createdAt);
  static Insertable<LocalDailyEvent> custom({
    Expression<String>? id,
    Expression<String>? organizationId,
    Expression<String>? childId,
    Expression<String>? eventDate,
    Expression<String>? eventType,
    Expression<String>? occurredAt,
    Expression<String>? payloadJson,
    Expression<bool>? isSynced,
    Expression<String>? syncEventId,
    Expression<String>? createdAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (organizationId != null) 'organization_id': organizationId,
      if (childId != null) 'child_id': childId,
      if (eventDate != null) 'event_date': eventDate,
      if (eventType != null) 'event_type': eventType,
      if (occurredAt != null) 'occurred_at': occurredAt,
      if (payloadJson != null) 'payload_json': payloadJson,
      if (isSynced != null) 'is_synced': isSynced,
      if (syncEventId != null) 'sync_event_id': syncEventId,
      if (createdAt != null) 'created_at': createdAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalDailyEventsCompanion copyWith(
      {Value<String>? id,
      Value<String>? organizationId,
      Value<String>? childId,
      Value<String>? eventDate,
      Value<String>? eventType,
      Value<String>? occurredAt,
      Value<String>? payloadJson,
      Value<bool>? isSynced,
      Value<String?>? syncEventId,
      Value<String>? createdAt,
      Value<int>? rowid}) {
    return LocalDailyEventsCompanion(
      id: id ?? this.id,
      organizationId: organizationId ?? this.organizationId,
      childId: childId ?? this.childId,
      eventDate: eventDate ?? this.eventDate,
      eventType: eventType ?? this.eventType,
      occurredAt: occurredAt ?? this.occurredAt,
      payloadJson: payloadJson ?? this.payloadJson,
      isSynced: isSynced ?? this.isSynced,
      syncEventId: syncEventId ?? this.syncEventId,
      createdAt: createdAt ?? this.createdAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (organizationId.present) {
      map['organization_id'] = Variable<String>(organizationId.value);
    }
    if (childId.present) {
      map['child_id'] = Variable<String>(childId.value);
    }
    if (eventDate.present) {
      map['event_date'] = Variable<String>(eventDate.value);
    }
    if (eventType.present) {
      map['event_type'] = Variable<String>(eventType.value);
    }
    if (occurredAt.present) {
      map['occurred_at'] = Variable<String>(occurredAt.value);
    }
    if (payloadJson.present) {
      map['payload_json'] = Variable<String>(payloadJson.value);
    }
    if (isSynced.present) {
      map['is_synced'] = Variable<bool>(isSynced.value);
    }
    if (syncEventId.present) {
      map['sync_event_id'] = Variable<String>(syncEventId.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<String>(createdAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalDailyEventsCompanion(')
          ..write('id: $id, ')
          ..write('organizationId: $organizationId, ')
          ..write('childId: $childId, ')
          ..write('eventDate: $eventDate, ')
          ..write('eventType: $eventType, ')
          ..write('occurredAt: $occurredAt, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('isSynced: $isSynced, ')
          ..write('syncEventId: $syncEventId, ')
          ..write('createdAt: $createdAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $PendingOperationsTable extends PendingOperations
    with TableInfo<$PendingOperationsTable, PendingOperation> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $PendingOperationsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _eventIdMeta =
      const VerificationMeta('eventId');
  @override
  late final GeneratedColumn<String> eventId = GeneratedColumn<String>(
      'event_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _commandMeta =
      const VerificationMeta('command');
  @override
  late final GeneratedColumn<String> command = GeneratedColumn<String>(
      'command', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _entityTypeMeta =
      const VerificationMeta('entityType');
  @override
  late final GeneratedColumn<String> entityType = GeneratedColumn<String>(
      'entity_type', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _entityIdMeta =
      const VerificationMeta('entityId');
  @override
  late final GeneratedColumn<String> entityId = GeneratedColumn<String>(
      'entity_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _payloadJsonMeta =
      const VerificationMeta('payloadJson');
  @override
  late final GeneratedColumn<String> payloadJson = GeneratedColumn<String>(
      'payload_json', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _baseVersionMeta =
      const VerificationMeta('baseVersion');
  @override
  late final GeneratedColumn<int> baseVersion = GeneratedColumn<int>(
      'base_version', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  static const VerificationMeta _occurredAtDeviceMeta =
      const VerificationMeta('occurredAtDevice');
  @override
  late final GeneratedColumn<String> occurredAtDevice = GeneratedColumn<String>(
      'occurred_at_device', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _clientSequenceMeta =
      const VerificationMeta('clientSequence');
  @override
  late final GeneratedColumn<int> clientSequence = GeneratedColumn<int>(
      'client_sequence', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _attemptsMeta =
      const VerificationMeta('attempts');
  @override
  late final GeneratedColumn<int> attempts = GeneratedColumn<int>(
      'attempts', aliasedName, false,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultValue: const Constant(0));
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
      'status', aliasedName, false,
      type: DriftSqlType.string,
      requiredDuringInsert: false,
      defaultValue: const Constant('pending'));
  static const VerificationMeta _lastErrorMeta =
      const VerificationMeta('lastError');
  @override
  late final GeneratedColumn<String> lastError = GeneratedColumn<String>(
      'last_error', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _createdAtMeta =
      const VerificationMeta('createdAt');
  @override
  late final GeneratedColumn<String> createdAt = GeneratedColumn<String>(
      'created_at', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        eventId,
        command,
        entityType,
        entityId,
        payloadJson,
        baseVersion,
        occurredAtDevice,
        clientSequence,
        attempts,
        status,
        lastError,
        createdAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'pending_operations';
  @override
  VerificationContext validateIntegrity(Insertable<PendingOperation> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('event_id')) {
      context.handle(_eventIdMeta,
          eventId.isAcceptableOrUnknown(data['event_id']!, _eventIdMeta));
    } else if (isInserting) {
      context.missing(_eventIdMeta);
    }
    if (data.containsKey('command')) {
      context.handle(_commandMeta,
          command.isAcceptableOrUnknown(data['command']!, _commandMeta));
    } else if (isInserting) {
      context.missing(_commandMeta);
    }
    if (data.containsKey('entity_type')) {
      context.handle(
          _entityTypeMeta,
          entityType.isAcceptableOrUnknown(
              data['entity_type']!, _entityTypeMeta));
    } else if (isInserting) {
      context.missing(_entityTypeMeta);
    }
    if (data.containsKey('entity_id')) {
      context.handle(_entityIdMeta,
          entityId.isAcceptableOrUnknown(data['entity_id']!, _entityIdMeta));
    }
    if (data.containsKey('payload_json')) {
      context.handle(
          _payloadJsonMeta,
          payloadJson.isAcceptableOrUnknown(
              data['payload_json']!, _payloadJsonMeta));
    } else if (isInserting) {
      context.missing(_payloadJsonMeta);
    }
    if (data.containsKey('base_version')) {
      context.handle(
          _baseVersionMeta,
          baseVersion.isAcceptableOrUnknown(
              data['base_version']!, _baseVersionMeta));
    }
    if (data.containsKey('occurred_at_device')) {
      context.handle(
          _occurredAtDeviceMeta,
          occurredAtDevice.isAcceptableOrUnknown(
              data['occurred_at_device']!, _occurredAtDeviceMeta));
    } else if (isInserting) {
      context.missing(_occurredAtDeviceMeta);
    }
    if (data.containsKey('client_sequence')) {
      context.handle(
          _clientSequenceMeta,
          clientSequence.isAcceptableOrUnknown(
              data['client_sequence']!, _clientSequenceMeta));
    } else if (isInserting) {
      context.missing(_clientSequenceMeta);
    }
    if (data.containsKey('attempts')) {
      context.handle(_attemptsMeta,
          attempts.isAcceptableOrUnknown(data['attempts']!, _attemptsMeta));
    }
    if (data.containsKey('status')) {
      context.handle(_statusMeta,
          status.isAcceptableOrUnknown(data['status']!, _statusMeta));
    }
    if (data.containsKey('last_error')) {
      context.handle(_lastErrorMeta,
          lastError.isAcceptableOrUnknown(data['last_error']!, _lastErrorMeta));
    }
    if (data.containsKey('created_at')) {
      context.handle(_createdAtMeta,
          createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta));
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  PendingOperation map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return PendingOperation(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      eventId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}event_id'])!,
      command: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}command'])!,
      entityType: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}entity_type'])!,
      entityId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}entity_id']),
      payloadJson: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}payload_json'])!,
      baseVersion: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}base_version']),
      occurredAtDevice: attachedDatabase.typeMapping.read(
          DriftSqlType.string, data['${effectivePrefix}occurred_at_device'])!,
      clientSequence: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}client_sequence'])!,
      attempts: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}attempts'])!,
      status: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}status'])!,
      lastError: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}last_error']),
      createdAt: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}created_at'])!,
    );
  }

  @override
  $PendingOperationsTable createAlias(String alias) {
    return $PendingOperationsTable(attachedDatabase, alias);
  }
}

class PendingOperation extends DataClass
    implements Insertable<PendingOperation> {
  final String id;
  final String eventId;
  final String command;
  final String entityType;
  final String? entityId;
  final String payloadJson;
  final int? baseVersion;
  final String occurredAtDevice;
  final int clientSequence;
  final int attempts;
  final String status;
  final String? lastError;
  final String createdAt;
  const PendingOperation(
      {required this.id,
      required this.eventId,
      required this.command,
      required this.entityType,
      this.entityId,
      required this.payloadJson,
      this.baseVersion,
      required this.occurredAtDevice,
      required this.clientSequence,
      required this.attempts,
      required this.status,
      this.lastError,
      required this.createdAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['event_id'] = Variable<String>(eventId);
    map['command'] = Variable<String>(command);
    map['entity_type'] = Variable<String>(entityType);
    if (!nullToAbsent || entityId != null) {
      map['entity_id'] = Variable<String>(entityId);
    }
    map['payload_json'] = Variable<String>(payloadJson);
    if (!nullToAbsent || baseVersion != null) {
      map['base_version'] = Variable<int>(baseVersion);
    }
    map['occurred_at_device'] = Variable<String>(occurredAtDevice);
    map['client_sequence'] = Variable<int>(clientSequence);
    map['attempts'] = Variable<int>(attempts);
    map['status'] = Variable<String>(status);
    if (!nullToAbsent || lastError != null) {
      map['last_error'] = Variable<String>(lastError);
    }
    map['created_at'] = Variable<String>(createdAt);
    return map;
  }

  PendingOperationsCompanion toCompanion(bool nullToAbsent) {
    return PendingOperationsCompanion(
      id: Value(id),
      eventId: Value(eventId),
      command: Value(command),
      entityType: Value(entityType),
      entityId: entityId == null && nullToAbsent
          ? const Value.absent()
          : Value(entityId),
      payloadJson: Value(payloadJson),
      baseVersion: baseVersion == null && nullToAbsent
          ? const Value.absent()
          : Value(baseVersion),
      occurredAtDevice: Value(occurredAtDevice),
      clientSequence: Value(clientSequence),
      attempts: Value(attempts),
      status: Value(status),
      lastError: lastError == null && nullToAbsent
          ? const Value.absent()
          : Value(lastError),
      createdAt: Value(createdAt),
    );
  }

  factory PendingOperation.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return PendingOperation(
      id: serializer.fromJson<String>(json['id']),
      eventId: serializer.fromJson<String>(json['eventId']),
      command: serializer.fromJson<String>(json['command']),
      entityType: serializer.fromJson<String>(json['entityType']),
      entityId: serializer.fromJson<String?>(json['entityId']),
      payloadJson: serializer.fromJson<String>(json['payloadJson']),
      baseVersion: serializer.fromJson<int?>(json['baseVersion']),
      occurredAtDevice: serializer.fromJson<String>(json['occurredAtDevice']),
      clientSequence: serializer.fromJson<int>(json['clientSequence']),
      attempts: serializer.fromJson<int>(json['attempts']),
      status: serializer.fromJson<String>(json['status']),
      lastError: serializer.fromJson<String?>(json['lastError']),
      createdAt: serializer.fromJson<String>(json['createdAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'eventId': serializer.toJson<String>(eventId),
      'command': serializer.toJson<String>(command),
      'entityType': serializer.toJson<String>(entityType),
      'entityId': serializer.toJson<String?>(entityId),
      'payloadJson': serializer.toJson<String>(payloadJson),
      'baseVersion': serializer.toJson<int?>(baseVersion),
      'occurredAtDevice': serializer.toJson<String>(occurredAtDevice),
      'clientSequence': serializer.toJson<int>(clientSequence),
      'attempts': serializer.toJson<int>(attempts),
      'status': serializer.toJson<String>(status),
      'lastError': serializer.toJson<String?>(lastError),
      'createdAt': serializer.toJson<String>(createdAt),
    };
  }

  PendingOperation copyWith(
          {String? id,
          String? eventId,
          String? command,
          String? entityType,
          Value<String?> entityId = const Value.absent(),
          String? payloadJson,
          Value<int?> baseVersion = const Value.absent(),
          String? occurredAtDevice,
          int? clientSequence,
          int? attempts,
          String? status,
          Value<String?> lastError = const Value.absent(),
          String? createdAt}) =>
      PendingOperation(
        id: id ?? this.id,
        eventId: eventId ?? this.eventId,
        command: command ?? this.command,
        entityType: entityType ?? this.entityType,
        entityId: entityId.present ? entityId.value : this.entityId,
        payloadJson: payloadJson ?? this.payloadJson,
        baseVersion: baseVersion.present ? baseVersion.value : this.baseVersion,
        occurredAtDevice: occurredAtDevice ?? this.occurredAtDevice,
        clientSequence: clientSequence ?? this.clientSequence,
        attempts: attempts ?? this.attempts,
        status: status ?? this.status,
        lastError: lastError.present ? lastError.value : this.lastError,
        createdAt: createdAt ?? this.createdAt,
      );
  PendingOperation copyWithCompanion(PendingOperationsCompanion data) {
    return PendingOperation(
      id: data.id.present ? data.id.value : this.id,
      eventId: data.eventId.present ? data.eventId.value : this.eventId,
      command: data.command.present ? data.command.value : this.command,
      entityType:
          data.entityType.present ? data.entityType.value : this.entityType,
      entityId: data.entityId.present ? data.entityId.value : this.entityId,
      payloadJson:
          data.payloadJson.present ? data.payloadJson.value : this.payloadJson,
      baseVersion:
          data.baseVersion.present ? data.baseVersion.value : this.baseVersion,
      occurredAtDevice: data.occurredAtDevice.present
          ? data.occurredAtDevice.value
          : this.occurredAtDevice,
      clientSequence: data.clientSequence.present
          ? data.clientSequence.value
          : this.clientSequence,
      attempts: data.attempts.present ? data.attempts.value : this.attempts,
      status: data.status.present ? data.status.value : this.status,
      lastError: data.lastError.present ? data.lastError.value : this.lastError,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('PendingOperation(')
          ..write('id: $id, ')
          ..write('eventId: $eventId, ')
          ..write('command: $command, ')
          ..write('entityType: $entityType, ')
          ..write('entityId: $entityId, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('baseVersion: $baseVersion, ')
          ..write('occurredAtDevice: $occurredAtDevice, ')
          ..write('clientSequence: $clientSequence, ')
          ..write('attempts: $attempts, ')
          ..write('status: $status, ')
          ..write('lastError: $lastError, ')
          ..write('createdAt: $createdAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      id,
      eventId,
      command,
      entityType,
      entityId,
      payloadJson,
      baseVersion,
      occurredAtDevice,
      clientSequence,
      attempts,
      status,
      lastError,
      createdAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is PendingOperation &&
          other.id == this.id &&
          other.eventId == this.eventId &&
          other.command == this.command &&
          other.entityType == this.entityType &&
          other.entityId == this.entityId &&
          other.payloadJson == this.payloadJson &&
          other.baseVersion == this.baseVersion &&
          other.occurredAtDevice == this.occurredAtDevice &&
          other.clientSequence == this.clientSequence &&
          other.attempts == this.attempts &&
          other.status == this.status &&
          other.lastError == this.lastError &&
          other.createdAt == this.createdAt);
}

class PendingOperationsCompanion extends UpdateCompanion<PendingOperation> {
  final Value<String> id;
  final Value<String> eventId;
  final Value<String> command;
  final Value<String> entityType;
  final Value<String?> entityId;
  final Value<String> payloadJson;
  final Value<int?> baseVersion;
  final Value<String> occurredAtDevice;
  final Value<int> clientSequence;
  final Value<int> attempts;
  final Value<String> status;
  final Value<String?> lastError;
  final Value<String> createdAt;
  final Value<int> rowid;
  const PendingOperationsCompanion({
    this.id = const Value.absent(),
    this.eventId = const Value.absent(),
    this.command = const Value.absent(),
    this.entityType = const Value.absent(),
    this.entityId = const Value.absent(),
    this.payloadJson = const Value.absent(),
    this.baseVersion = const Value.absent(),
    this.occurredAtDevice = const Value.absent(),
    this.clientSequence = const Value.absent(),
    this.attempts = const Value.absent(),
    this.status = const Value.absent(),
    this.lastError = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  PendingOperationsCompanion.insert({
    required String id,
    required String eventId,
    required String command,
    required String entityType,
    this.entityId = const Value.absent(),
    required String payloadJson,
    this.baseVersion = const Value.absent(),
    required String occurredAtDevice,
    required int clientSequence,
    this.attempts = const Value.absent(),
    this.status = const Value.absent(),
    this.lastError = const Value.absent(),
    required String createdAt,
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        eventId = Value(eventId),
        command = Value(command),
        entityType = Value(entityType),
        payloadJson = Value(payloadJson),
        occurredAtDevice = Value(occurredAtDevice),
        clientSequence = Value(clientSequence),
        createdAt = Value(createdAt);
  static Insertable<PendingOperation> custom({
    Expression<String>? id,
    Expression<String>? eventId,
    Expression<String>? command,
    Expression<String>? entityType,
    Expression<String>? entityId,
    Expression<String>? payloadJson,
    Expression<int>? baseVersion,
    Expression<String>? occurredAtDevice,
    Expression<int>? clientSequence,
    Expression<int>? attempts,
    Expression<String>? status,
    Expression<String>? lastError,
    Expression<String>? createdAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (eventId != null) 'event_id': eventId,
      if (command != null) 'command': command,
      if (entityType != null) 'entity_type': entityType,
      if (entityId != null) 'entity_id': entityId,
      if (payloadJson != null) 'payload_json': payloadJson,
      if (baseVersion != null) 'base_version': baseVersion,
      if (occurredAtDevice != null) 'occurred_at_device': occurredAtDevice,
      if (clientSequence != null) 'client_sequence': clientSequence,
      if (attempts != null) 'attempts': attempts,
      if (status != null) 'status': status,
      if (lastError != null) 'last_error': lastError,
      if (createdAt != null) 'created_at': createdAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  PendingOperationsCompanion copyWith(
      {Value<String>? id,
      Value<String>? eventId,
      Value<String>? command,
      Value<String>? entityType,
      Value<String?>? entityId,
      Value<String>? payloadJson,
      Value<int?>? baseVersion,
      Value<String>? occurredAtDevice,
      Value<int>? clientSequence,
      Value<int>? attempts,
      Value<String>? status,
      Value<String?>? lastError,
      Value<String>? createdAt,
      Value<int>? rowid}) {
    return PendingOperationsCompanion(
      id: id ?? this.id,
      eventId: eventId ?? this.eventId,
      command: command ?? this.command,
      entityType: entityType ?? this.entityType,
      entityId: entityId ?? this.entityId,
      payloadJson: payloadJson ?? this.payloadJson,
      baseVersion: baseVersion ?? this.baseVersion,
      occurredAtDevice: occurredAtDevice ?? this.occurredAtDevice,
      clientSequence: clientSequence ?? this.clientSequence,
      attempts: attempts ?? this.attempts,
      status: status ?? this.status,
      lastError: lastError ?? this.lastError,
      createdAt: createdAt ?? this.createdAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (eventId.present) {
      map['event_id'] = Variable<String>(eventId.value);
    }
    if (command.present) {
      map['command'] = Variable<String>(command.value);
    }
    if (entityType.present) {
      map['entity_type'] = Variable<String>(entityType.value);
    }
    if (entityId.present) {
      map['entity_id'] = Variable<String>(entityId.value);
    }
    if (payloadJson.present) {
      map['payload_json'] = Variable<String>(payloadJson.value);
    }
    if (baseVersion.present) {
      map['base_version'] = Variable<int>(baseVersion.value);
    }
    if (occurredAtDevice.present) {
      map['occurred_at_device'] = Variable<String>(occurredAtDevice.value);
    }
    if (clientSequence.present) {
      map['client_sequence'] = Variable<int>(clientSequence.value);
    }
    if (attempts.present) {
      map['attempts'] = Variable<int>(attempts.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (lastError.present) {
      map['last_error'] = Variable<String>(lastError.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<String>(createdAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('PendingOperationsCompanion(')
          ..write('id: $id, ')
          ..write('eventId: $eventId, ')
          ..write('command: $command, ')
          ..write('entityType: $entityType, ')
          ..write('entityId: $entityId, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('baseVersion: $baseVersion, ')
          ..write('occurredAtDevice: $occurredAtDevice, ')
          ..write('clientSequence: $clientSequence, ')
          ..write('attempts: $attempts, ')
          ..write('status: $status, ')
          ..write('lastError: $lastError, ')
          ..write('createdAt: $createdAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  $AppDatabaseManager get managers => $AppDatabaseManager(this);
  late final $LocalChildrenTable localChildren = $LocalChildrenTable(this);
  late final $LocalAttendanceSessionsTable localAttendanceSessions =
      $LocalAttendanceSessionsTable(this);
  late final $LocalDailyEventsTable localDailyEvents =
      $LocalDailyEventsTable(this);
  late final $PendingOperationsTable pendingOperations =
      $PendingOperationsTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
        localChildren,
        localAttendanceSessions,
        localDailyEvents,
        pendingOperations
      ];
}

typedef $$LocalChildrenTableCreateCompanionBuilder = LocalChildrenCompanion
    Function({
  required String id,
  required String organizationId,
  required String siteId,
  Value<String?> roomId,
  required String firstNameFr,
  Value<String?> firstNameAr,
  required String lastNameFr,
  Value<String?> lastNameAr,
  required String dateOfBirth,
  Value<String?> photoUrl,
  required String status,
  Value<bool> isWalking,
  Value<String?> allergiesSummary,
  Value<String?> emergencyContactName,
  Value<String?> emergencyContactPhone,
  Value<int> serverVersion,
  Value<String?> syncedAt,
  Value<int> rowid,
});
typedef $$LocalChildrenTableUpdateCompanionBuilder = LocalChildrenCompanion
    Function({
  Value<String> id,
  Value<String> organizationId,
  Value<String> siteId,
  Value<String?> roomId,
  Value<String> firstNameFr,
  Value<String?> firstNameAr,
  Value<String> lastNameFr,
  Value<String?> lastNameAr,
  Value<String> dateOfBirth,
  Value<String?> photoUrl,
  Value<String> status,
  Value<bool> isWalking,
  Value<String?> allergiesSummary,
  Value<String?> emergencyContactName,
  Value<String?> emergencyContactPhone,
  Value<int> serverVersion,
  Value<String?> syncedAt,
  Value<int> rowid,
});

class $$LocalChildrenTableFilterComposer
    extends Composer<_$AppDatabase, $LocalChildrenTable> {
  $$LocalChildrenTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get organizationId => $composableBuilder(
      column: $table.organizationId,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get siteId => $composableBuilder(
      column: $table.siteId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get roomId => $composableBuilder(
      column: $table.roomId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get firstNameFr => $composableBuilder(
      column: $table.firstNameFr, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get firstNameAr => $composableBuilder(
      column: $table.firstNameAr, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get lastNameFr => $composableBuilder(
      column: $table.lastNameFr, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get lastNameAr => $composableBuilder(
      column: $table.lastNameAr, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get dateOfBirth => $composableBuilder(
      column: $table.dateOfBirth, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get photoUrl => $composableBuilder(
      column: $table.photoUrl, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get isWalking => $composableBuilder(
      column: $table.isWalking, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get allergiesSummary => $composableBuilder(
      column: $table.allergiesSummary,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get emergencyContactName => $composableBuilder(
      column: $table.emergencyContactName,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get emergencyContactPhone => $composableBuilder(
      column: $table.emergencyContactPhone,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get serverVersion => $composableBuilder(
      column: $table.serverVersion, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get syncedAt => $composableBuilder(
      column: $table.syncedAt, builder: (column) => ColumnFilters(column));
}

class $$LocalChildrenTableOrderingComposer
    extends Composer<_$AppDatabase, $LocalChildrenTable> {
  $$LocalChildrenTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get organizationId => $composableBuilder(
      column: $table.organizationId,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get siteId => $composableBuilder(
      column: $table.siteId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get roomId => $composableBuilder(
      column: $table.roomId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get firstNameFr => $composableBuilder(
      column: $table.firstNameFr, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get firstNameAr => $composableBuilder(
      column: $table.firstNameAr, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get lastNameFr => $composableBuilder(
      column: $table.lastNameFr, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get lastNameAr => $composableBuilder(
      column: $table.lastNameAr, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get dateOfBirth => $composableBuilder(
      column: $table.dateOfBirth, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get photoUrl => $composableBuilder(
      column: $table.photoUrl, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get isWalking => $composableBuilder(
      column: $table.isWalking, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get allergiesSummary => $composableBuilder(
      column: $table.allergiesSummary,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get emergencyContactName => $composableBuilder(
      column: $table.emergencyContactName,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get emergencyContactPhone => $composableBuilder(
      column: $table.emergencyContactPhone,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get serverVersion => $composableBuilder(
      column: $table.serverVersion,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get syncedAt => $composableBuilder(
      column: $table.syncedAt, builder: (column) => ColumnOrderings(column));
}

class $$LocalChildrenTableAnnotationComposer
    extends Composer<_$AppDatabase, $LocalChildrenTable> {
  $$LocalChildrenTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get organizationId => $composableBuilder(
      column: $table.organizationId, builder: (column) => column);

  GeneratedColumn<String> get siteId =>
      $composableBuilder(column: $table.siteId, builder: (column) => column);

  GeneratedColumn<String> get roomId =>
      $composableBuilder(column: $table.roomId, builder: (column) => column);

  GeneratedColumn<String> get firstNameFr => $composableBuilder(
      column: $table.firstNameFr, builder: (column) => column);

  GeneratedColumn<String> get firstNameAr => $composableBuilder(
      column: $table.firstNameAr, builder: (column) => column);

  GeneratedColumn<String> get lastNameFr => $composableBuilder(
      column: $table.lastNameFr, builder: (column) => column);

  GeneratedColumn<String> get lastNameAr => $composableBuilder(
      column: $table.lastNameAr, builder: (column) => column);

  GeneratedColumn<String> get dateOfBirth => $composableBuilder(
      column: $table.dateOfBirth, builder: (column) => column);

  GeneratedColumn<String> get photoUrl =>
      $composableBuilder(column: $table.photoUrl, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<bool> get isWalking =>
      $composableBuilder(column: $table.isWalking, builder: (column) => column);

  GeneratedColumn<String> get allergiesSummary => $composableBuilder(
      column: $table.allergiesSummary, builder: (column) => column);

  GeneratedColumn<String> get emergencyContactName => $composableBuilder(
      column: $table.emergencyContactName, builder: (column) => column);

  GeneratedColumn<String> get emergencyContactPhone => $composableBuilder(
      column: $table.emergencyContactPhone, builder: (column) => column);

  GeneratedColumn<int> get serverVersion => $composableBuilder(
      column: $table.serverVersion, builder: (column) => column);

  GeneratedColumn<String> get syncedAt =>
      $composableBuilder(column: $table.syncedAt, builder: (column) => column);
}

class $$LocalChildrenTableTableManager extends RootTableManager<
    _$AppDatabase,
    $LocalChildrenTable,
    LocalChildrenData,
    $$LocalChildrenTableFilterComposer,
    $$LocalChildrenTableOrderingComposer,
    $$LocalChildrenTableAnnotationComposer,
    $$LocalChildrenTableCreateCompanionBuilder,
    $$LocalChildrenTableUpdateCompanionBuilder,
    (
      LocalChildrenData,
      BaseReferences<_$AppDatabase, $LocalChildrenTable, LocalChildrenData>
    ),
    LocalChildrenData,
    PrefetchHooks Function()> {
  $$LocalChildrenTableTableManager(_$AppDatabase db, $LocalChildrenTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalChildrenTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalChildrenTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalChildrenTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> organizationId = const Value.absent(),
            Value<String> siteId = const Value.absent(),
            Value<String?> roomId = const Value.absent(),
            Value<String> firstNameFr = const Value.absent(),
            Value<String?> firstNameAr = const Value.absent(),
            Value<String> lastNameFr = const Value.absent(),
            Value<String?> lastNameAr = const Value.absent(),
            Value<String> dateOfBirth = const Value.absent(),
            Value<String?> photoUrl = const Value.absent(),
            Value<String> status = const Value.absent(),
            Value<bool> isWalking = const Value.absent(),
            Value<String?> allergiesSummary = const Value.absent(),
            Value<String?> emergencyContactName = const Value.absent(),
            Value<String?> emergencyContactPhone = const Value.absent(),
            Value<int> serverVersion = const Value.absent(),
            Value<String?> syncedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              LocalChildrenCompanion(
            id: id,
            organizationId: organizationId,
            siteId: siteId,
            roomId: roomId,
            firstNameFr: firstNameFr,
            firstNameAr: firstNameAr,
            lastNameFr: lastNameFr,
            lastNameAr: lastNameAr,
            dateOfBirth: dateOfBirth,
            photoUrl: photoUrl,
            status: status,
            isWalking: isWalking,
            allergiesSummary: allergiesSummary,
            emergencyContactName: emergencyContactName,
            emergencyContactPhone: emergencyContactPhone,
            serverVersion: serverVersion,
            syncedAt: syncedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String organizationId,
            required String siteId,
            Value<String?> roomId = const Value.absent(),
            required String firstNameFr,
            Value<String?> firstNameAr = const Value.absent(),
            required String lastNameFr,
            Value<String?> lastNameAr = const Value.absent(),
            required String dateOfBirth,
            Value<String?> photoUrl = const Value.absent(),
            required String status,
            Value<bool> isWalking = const Value.absent(),
            Value<String?> allergiesSummary = const Value.absent(),
            Value<String?> emergencyContactName = const Value.absent(),
            Value<String?> emergencyContactPhone = const Value.absent(),
            Value<int> serverVersion = const Value.absent(),
            Value<String?> syncedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              LocalChildrenCompanion.insert(
            id: id,
            organizationId: organizationId,
            siteId: siteId,
            roomId: roomId,
            firstNameFr: firstNameFr,
            firstNameAr: firstNameAr,
            lastNameFr: lastNameFr,
            lastNameAr: lastNameAr,
            dateOfBirth: dateOfBirth,
            photoUrl: photoUrl,
            status: status,
            isWalking: isWalking,
            allergiesSummary: allergiesSummary,
            emergencyContactName: emergencyContactName,
            emergencyContactPhone: emergencyContactPhone,
            serverVersion: serverVersion,
            syncedAt: syncedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$LocalChildrenTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $LocalChildrenTable,
    LocalChildrenData,
    $$LocalChildrenTableFilterComposer,
    $$LocalChildrenTableOrderingComposer,
    $$LocalChildrenTableAnnotationComposer,
    $$LocalChildrenTableCreateCompanionBuilder,
    $$LocalChildrenTableUpdateCompanionBuilder,
    (
      LocalChildrenData,
      BaseReferences<_$AppDatabase, $LocalChildrenTable, LocalChildrenData>
    ),
    LocalChildrenData,
    PrefetchHooks Function()>;
typedef $$LocalAttendanceSessionsTableCreateCompanionBuilder
    = LocalAttendanceSessionsCompanion Function({
  required String id,
  required String organizationId,
  required String childId,
  required String sessionDate,
  required String status,
  required String updatedAt,
  Value<int> serverVersion,
  Value<int> rowid,
});
typedef $$LocalAttendanceSessionsTableUpdateCompanionBuilder
    = LocalAttendanceSessionsCompanion Function({
  Value<String> id,
  Value<String> organizationId,
  Value<String> childId,
  Value<String> sessionDate,
  Value<String> status,
  Value<String> updatedAt,
  Value<int> serverVersion,
  Value<int> rowid,
});

class $$LocalAttendanceSessionsTableFilterComposer
    extends Composer<_$AppDatabase, $LocalAttendanceSessionsTable> {
  $$LocalAttendanceSessionsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get organizationId => $composableBuilder(
      column: $table.organizationId,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get childId => $composableBuilder(
      column: $table.childId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get sessionDate => $composableBuilder(
      column: $table.sessionDate, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get updatedAt => $composableBuilder(
      column: $table.updatedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get serverVersion => $composableBuilder(
      column: $table.serverVersion, builder: (column) => ColumnFilters(column));
}

class $$LocalAttendanceSessionsTableOrderingComposer
    extends Composer<_$AppDatabase, $LocalAttendanceSessionsTable> {
  $$LocalAttendanceSessionsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get organizationId => $composableBuilder(
      column: $table.organizationId,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get childId => $composableBuilder(
      column: $table.childId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get sessionDate => $composableBuilder(
      column: $table.sessionDate, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get updatedAt => $composableBuilder(
      column: $table.updatedAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get serverVersion => $composableBuilder(
      column: $table.serverVersion,
      builder: (column) => ColumnOrderings(column));
}

class $$LocalAttendanceSessionsTableAnnotationComposer
    extends Composer<_$AppDatabase, $LocalAttendanceSessionsTable> {
  $$LocalAttendanceSessionsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get organizationId => $composableBuilder(
      column: $table.organizationId, builder: (column) => column);

  GeneratedColumn<String> get childId =>
      $composableBuilder(column: $table.childId, builder: (column) => column);

  GeneratedColumn<String> get sessionDate => $composableBuilder(
      column: $table.sessionDate, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<String> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);

  GeneratedColumn<int> get serverVersion => $composableBuilder(
      column: $table.serverVersion, builder: (column) => column);
}

class $$LocalAttendanceSessionsTableTableManager extends RootTableManager<
    _$AppDatabase,
    $LocalAttendanceSessionsTable,
    LocalAttendanceSession,
    $$LocalAttendanceSessionsTableFilterComposer,
    $$LocalAttendanceSessionsTableOrderingComposer,
    $$LocalAttendanceSessionsTableAnnotationComposer,
    $$LocalAttendanceSessionsTableCreateCompanionBuilder,
    $$LocalAttendanceSessionsTableUpdateCompanionBuilder,
    (
      LocalAttendanceSession,
      BaseReferences<_$AppDatabase, $LocalAttendanceSessionsTable,
          LocalAttendanceSession>
    ),
    LocalAttendanceSession,
    PrefetchHooks Function()> {
  $$LocalAttendanceSessionsTableTableManager(
      _$AppDatabase db, $LocalAttendanceSessionsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalAttendanceSessionsTableFilterComposer(
                  $db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalAttendanceSessionsTableOrderingComposer(
                  $db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalAttendanceSessionsTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> organizationId = const Value.absent(),
            Value<String> childId = const Value.absent(),
            Value<String> sessionDate = const Value.absent(),
            Value<String> status = const Value.absent(),
            Value<String> updatedAt = const Value.absent(),
            Value<int> serverVersion = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              LocalAttendanceSessionsCompanion(
            id: id,
            organizationId: organizationId,
            childId: childId,
            sessionDate: sessionDate,
            status: status,
            updatedAt: updatedAt,
            serverVersion: serverVersion,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String organizationId,
            required String childId,
            required String sessionDate,
            required String status,
            required String updatedAt,
            Value<int> serverVersion = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              LocalAttendanceSessionsCompanion.insert(
            id: id,
            organizationId: organizationId,
            childId: childId,
            sessionDate: sessionDate,
            status: status,
            updatedAt: updatedAt,
            serverVersion: serverVersion,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$LocalAttendanceSessionsTableProcessedTableManager
    = ProcessedTableManager<
        _$AppDatabase,
        $LocalAttendanceSessionsTable,
        LocalAttendanceSession,
        $$LocalAttendanceSessionsTableFilterComposer,
        $$LocalAttendanceSessionsTableOrderingComposer,
        $$LocalAttendanceSessionsTableAnnotationComposer,
        $$LocalAttendanceSessionsTableCreateCompanionBuilder,
        $$LocalAttendanceSessionsTableUpdateCompanionBuilder,
        (
          LocalAttendanceSession,
          BaseReferences<_$AppDatabase, $LocalAttendanceSessionsTable,
              LocalAttendanceSession>
        ),
        LocalAttendanceSession,
        PrefetchHooks Function()>;
typedef $$LocalDailyEventsTableCreateCompanionBuilder
    = LocalDailyEventsCompanion Function({
  required String id,
  required String organizationId,
  required String childId,
  required String eventDate,
  required String eventType,
  required String occurredAt,
  required String payloadJson,
  Value<bool> isSynced,
  Value<String?> syncEventId,
  required String createdAt,
  Value<int> rowid,
});
typedef $$LocalDailyEventsTableUpdateCompanionBuilder
    = LocalDailyEventsCompanion Function({
  Value<String> id,
  Value<String> organizationId,
  Value<String> childId,
  Value<String> eventDate,
  Value<String> eventType,
  Value<String> occurredAt,
  Value<String> payloadJson,
  Value<bool> isSynced,
  Value<String?> syncEventId,
  Value<String> createdAt,
  Value<int> rowid,
});

class $$LocalDailyEventsTableFilterComposer
    extends Composer<_$AppDatabase, $LocalDailyEventsTable> {
  $$LocalDailyEventsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get organizationId => $composableBuilder(
      column: $table.organizationId,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get childId => $composableBuilder(
      column: $table.childId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get eventDate => $composableBuilder(
      column: $table.eventDate, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get eventType => $composableBuilder(
      column: $table.eventType, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get occurredAt => $composableBuilder(
      column: $table.occurredAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get payloadJson => $composableBuilder(
      column: $table.payloadJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get isSynced => $composableBuilder(
      column: $table.isSynced, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get syncEventId => $composableBuilder(
      column: $table.syncEventId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnFilters(column));
}

class $$LocalDailyEventsTableOrderingComposer
    extends Composer<_$AppDatabase, $LocalDailyEventsTable> {
  $$LocalDailyEventsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get organizationId => $composableBuilder(
      column: $table.organizationId,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get childId => $composableBuilder(
      column: $table.childId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get eventDate => $composableBuilder(
      column: $table.eventDate, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get eventType => $composableBuilder(
      column: $table.eventType, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get occurredAt => $composableBuilder(
      column: $table.occurredAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get payloadJson => $composableBuilder(
      column: $table.payloadJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get isSynced => $composableBuilder(
      column: $table.isSynced, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get syncEventId => $composableBuilder(
      column: $table.syncEventId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnOrderings(column));
}

class $$LocalDailyEventsTableAnnotationComposer
    extends Composer<_$AppDatabase, $LocalDailyEventsTable> {
  $$LocalDailyEventsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get organizationId => $composableBuilder(
      column: $table.organizationId, builder: (column) => column);

  GeneratedColumn<String> get childId =>
      $composableBuilder(column: $table.childId, builder: (column) => column);

  GeneratedColumn<String> get eventDate =>
      $composableBuilder(column: $table.eventDate, builder: (column) => column);

  GeneratedColumn<String> get eventType =>
      $composableBuilder(column: $table.eventType, builder: (column) => column);

  GeneratedColumn<String> get occurredAt => $composableBuilder(
      column: $table.occurredAt, builder: (column) => column);

  GeneratedColumn<String> get payloadJson => $composableBuilder(
      column: $table.payloadJson, builder: (column) => column);

  GeneratedColumn<bool> get isSynced =>
      $composableBuilder(column: $table.isSynced, builder: (column) => column);

  GeneratedColumn<String> get syncEventId => $composableBuilder(
      column: $table.syncEventId, builder: (column) => column);

  GeneratedColumn<String> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);
}

class $$LocalDailyEventsTableTableManager extends RootTableManager<
    _$AppDatabase,
    $LocalDailyEventsTable,
    LocalDailyEvent,
    $$LocalDailyEventsTableFilterComposer,
    $$LocalDailyEventsTableOrderingComposer,
    $$LocalDailyEventsTableAnnotationComposer,
    $$LocalDailyEventsTableCreateCompanionBuilder,
    $$LocalDailyEventsTableUpdateCompanionBuilder,
    (
      LocalDailyEvent,
      BaseReferences<_$AppDatabase, $LocalDailyEventsTable, LocalDailyEvent>
    ),
    LocalDailyEvent,
    PrefetchHooks Function()> {
  $$LocalDailyEventsTableTableManager(
      _$AppDatabase db, $LocalDailyEventsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalDailyEventsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalDailyEventsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalDailyEventsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> organizationId = const Value.absent(),
            Value<String> childId = const Value.absent(),
            Value<String> eventDate = const Value.absent(),
            Value<String> eventType = const Value.absent(),
            Value<String> occurredAt = const Value.absent(),
            Value<String> payloadJson = const Value.absent(),
            Value<bool> isSynced = const Value.absent(),
            Value<String?> syncEventId = const Value.absent(),
            Value<String> createdAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              LocalDailyEventsCompanion(
            id: id,
            organizationId: organizationId,
            childId: childId,
            eventDate: eventDate,
            eventType: eventType,
            occurredAt: occurredAt,
            payloadJson: payloadJson,
            isSynced: isSynced,
            syncEventId: syncEventId,
            createdAt: createdAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String organizationId,
            required String childId,
            required String eventDate,
            required String eventType,
            required String occurredAt,
            required String payloadJson,
            Value<bool> isSynced = const Value.absent(),
            Value<String?> syncEventId = const Value.absent(),
            required String createdAt,
            Value<int> rowid = const Value.absent(),
          }) =>
              LocalDailyEventsCompanion.insert(
            id: id,
            organizationId: organizationId,
            childId: childId,
            eventDate: eventDate,
            eventType: eventType,
            occurredAt: occurredAt,
            payloadJson: payloadJson,
            isSynced: isSynced,
            syncEventId: syncEventId,
            createdAt: createdAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$LocalDailyEventsTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $LocalDailyEventsTable,
    LocalDailyEvent,
    $$LocalDailyEventsTableFilterComposer,
    $$LocalDailyEventsTableOrderingComposer,
    $$LocalDailyEventsTableAnnotationComposer,
    $$LocalDailyEventsTableCreateCompanionBuilder,
    $$LocalDailyEventsTableUpdateCompanionBuilder,
    (
      LocalDailyEvent,
      BaseReferences<_$AppDatabase, $LocalDailyEventsTable, LocalDailyEvent>
    ),
    LocalDailyEvent,
    PrefetchHooks Function()>;
typedef $$PendingOperationsTableCreateCompanionBuilder
    = PendingOperationsCompanion Function({
  required String id,
  required String eventId,
  required String command,
  required String entityType,
  Value<String?> entityId,
  required String payloadJson,
  Value<int?> baseVersion,
  required String occurredAtDevice,
  required int clientSequence,
  Value<int> attempts,
  Value<String> status,
  Value<String?> lastError,
  required String createdAt,
  Value<int> rowid,
});
typedef $$PendingOperationsTableUpdateCompanionBuilder
    = PendingOperationsCompanion Function({
  Value<String> id,
  Value<String> eventId,
  Value<String> command,
  Value<String> entityType,
  Value<String?> entityId,
  Value<String> payloadJson,
  Value<int?> baseVersion,
  Value<String> occurredAtDevice,
  Value<int> clientSequence,
  Value<int> attempts,
  Value<String> status,
  Value<String?> lastError,
  Value<String> createdAt,
  Value<int> rowid,
});

class $$PendingOperationsTableFilterComposer
    extends Composer<_$AppDatabase, $PendingOperationsTable> {
  $$PendingOperationsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get eventId => $composableBuilder(
      column: $table.eventId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get command => $composableBuilder(
      column: $table.command, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get entityType => $composableBuilder(
      column: $table.entityType, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get entityId => $composableBuilder(
      column: $table.entityId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get payloadJson => $composableBuilder(
      column: $table.payloadJson, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get baseVersion => $composableBuilder(
      column: $table.baseVersion, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get occurredAtDevice => $composableBuilder(
      column: $table.occurredAtDevice,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get clientSequence => $composableBuilder(
      column: $table.clientSequence,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get attempts => $composableBuilder(
      column: $table.attempts, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get lastError => $composableBuilder(
      column: $table.lastError, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnFilters(column));
}

class $$PendingOperationsTableOrderingComposer
    extends Composer<_$AppDatabase, $PendingOperationsTable> {
  $$PendingOperationsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get eventId => $composableBuilder(
      column: $table.eventId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get command => $composableBuilder(
      column: $table.command, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get entityType => $composableBuilder(
      column: $table.entityType, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get entityId => $composableBuilder(
      column: $table.entityId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get payloadJson => $composableBuilder(
      column: $table.payloadJson, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get baseVersion => $composableBuilder(
      column: $table.baseVersion, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get occurredAtDevice => $composableBuilder(
      column: $table.occurredAtDevice,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get clientSequence => $composableBuilder(
      column: $table.clientSequence,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get attempts => $composableBuilder(
      column: $table.attempts, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get lastError => $composableBuilder(
      column: $table.lastError, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnOrderings(column));
}

class $$PendingOperationsTableAnnotationComposer
    extends Composer<_$AppDatabase, $PendingOperationsTable> {
  $$PendingOperationsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get eventId =>
      $composableBuilder(column: $table.eventId, builder: (column) => column);

  GeneratedColumn<String> get command =>
      $composableBuilder(column: $table.command, builder: (column) => column);

  GeneratedColumn<String> get entityType => $composableBuilder(
      column: $table.entityType, builder: (column) => column);

  GeneratedColumn<String> get entityId =>
      $composableBuilder(column: $table.entityId, builder: (column) => column);

  GeneratedColumn<String> get payloadJson => $composableBuilder(
      column: $table.payloadJson, builder: (column) => column);

  GeneratedColumn<int> get baseVersion => $composableBuilder(
      column: $table.baseVersion, builder: (column) => column);

  GeneratedColumn<String> get occurredAtDevice => $composableBuilder(
      column: $table.occurredAtDevice, builder: (column) => column);

  GeneratedColumn<int> get clientSequence => $composableBuilder(
      column: $table.clientSequence, builder: (column) => column);

  GeneratedColumn<int> get attempts =>
      $composableBuilder(column: $table.attempts, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<String> get lastError =>
      $composableBuilder(column: $table.lastError, builder: (column) => column);

  GeneratedColumn<String> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);
}

class $$PendingOperationsTableTableManager extends RootTableManager<
    _$AppDatabase,
    $PendingOperationsTable,
    PendingOperation,
    $$PendingOperationsTableFilterComposer,
    $$PendingOperationsTableOrderingComposer,
    $$PendingOperationsTableAnnotationComposer,
    $$PendingOperationsTableCreateCompanionBuilder,
    $$PendingOperationsTableUpdateCompanionBuilder,
    (
      PendingOperation,
      BaseReferences<_$AppDatabase, $PendingOperationsTable, PendingOperation>
    ),
    PendingOperation,
    PrefetchHooks Function()> {
  $$PendingOperationsTableTableManager(
      _$AppDatabase db, $PendingOperationsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$PendingOperationsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$PendingOperationsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$PendingOperationsTableAnnotationComposer(
                  $db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> eventId = const Value.absent(),
            Value<String> command = const Value.absent(),
            Value<String> entityType = const Value.absent(),
            Value<String?> entityId = const Value.absent(),
            Value<String> payloadJson = const Value.absent(),
            Value<int?> baseVersion = const Value.absent(),
            Value<String> occurredAtDevice = const Value.absent(),
            Value<int> clientSequence = const Value.absent(),
            Value<int> attempts = const Value.absent(),
            Value<String> status = const Value.absent(),
            Value<String?> lastError = const Value.absent(),
            Value<String> createdAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              PendingOperationsCompanion(
            id: id,
            eventId: eventId,
            command: command,
            entityType: entityType,
            entityId: entityId,
            payloadJson: payloadJson,
            baseVersion: baseVersion,
            occurredAtDevice: occurredAtDevice,
            clientSequence: clientSequence,
            attempts: attempts,
            status: status,
            lastError: lastError,
            createdAt: createdAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String eventId,
            required String command,
            required String entityType,
            Value<String?> entityId = const Value.absent(),
            required String payloadJson,
            Value<int?> baseVersion = const Value.absent(),
            required String occurredAtDevice,
            required int clientSequence,
            Value<int> attempts = const Value.absent(),
            Value<String> status = const Value.absent(),
            Value<String?> lastError = const Value.absent(),
            required String createdAt,
            Value<int> rowid = const Value.absent(),
          }) =>
              PendingOperationsCompanion.insert(
            id: id,
            eventId: eventId,
            command: command,
            entityType: entityType,
            entityId: entityId,
            payloadJson: payloadJson,
            baseVersion: baseVersion,
            occurredAtDevice: occurredAtDevice,
            clientSequence: clientSequence,
            attempts: attempts,
            status: status,
            lastError: lastError,
            createdAt: createdAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$PendingOperationsTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $PendingOperationsTable,
    PendingOperation,
    $$PendingOperationsTableFilterComposer,
    $$PendingOperationsTableOrderingComposer,
    $$PendingOperationsTableAnnotationComposer,
    $$PendingOperationsTableCreateCompanionBuilder,
    $$PendingOperationsTableUpdateCompanionBuilder,
    (
      PendingOperation,
      BaseReferences<_$AppDatabase, $PendingOperationsTable, PendingOperation>
    ),
    PendingOperation,
    PrefetchHooks Function()>;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$LocalChildrenTableTableManager get localChildren =>
      $$LocalChildrenTableTableManager(_db, _db.localChildren);
  $$LocalAttendanceSessionsTableTableManager get localAttendanceSessions =>
      $$LocalAttendanceSessionsTableTableManager(
          _db, _db.localAttendanceSessions);
  $$LocalDailyEventsTableTableManager get localDailyEvents =>
      $$LocalDailyEventsTableTableManager(_db, _db.localDailyEvents);
  $$PendingOperationsTableTableManager get pendingOperations =>
      $$PendingOperationsTableTableManager(_db, _db.pendingOperations);
}
