// Rapport 5 analyses — Phase 4 (F2, F6, F7) : upload média.
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:staff_mobile/core/database/app_database.dart';
import 'package:staff_mobile/core/media/media_uploader.dart';
import 'package:staff_mobile/core/network/api_client.dart';
import 'package:staff_mobile/core/sync/sync_scope.dart';

const org = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const child = '33333333-3333-4333-8333-333333333333';

class RecordingApi extends ApiClient {
  final calls = <Map<String, dynamic>>[];
  @override
  Future<T> post<T>(String path, [Object? body]) async {
    calls.add({'path': path, 'body': body});
    if (path == '/media/presign-upload') {
      return <String, dynamic>{'upload_url': 'https://s3.local/signed', 'storage_key': '$org/photo/1-p.jpg'} as T;
    }
    return <String, dynamic>{'id': 'asset-1', ...(body as Map<String, dynamic>)} as T;
  }
}

class RecordingEngine {
  final enqueued = <Map<String, dynamic>>[];
  Future<String> enqueue({required String command, required String entityType, required Map<String, dynamic> payload}) async {
    enqueued.add({'command': command, 'entityType': entityType, 'payload': payload});
    return 'op-1';
  }
}

/// Adaptateur HTTP scripté : chaque appel consomme le prochain scénario.
class ScriptedAdapter implements HttpClientAdapter {
  ScriptedAdapter(this.script);
  final List<Object> script; // int = code HTTP ; DioExceptionType = panne transport
  final requests = <RequestOptions>[];
  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    final step = script.removeAt(0);
    if (step is DioExceptionType) throw DioException(requestOptions: options, type: step);
    return ResponseBody.fromString('', step as int);
  }
  @override
  void close({bool force = false}) {}
}

void main() {
  final bytes = utf8.encode('abc');

  group('F2 — checksum SHA-256 réel', () {
    test('vecteur FIPS 180-2 « abc »', () {
      expect(MediaUploader.sha256Hex(bytes), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });
    test('chaîne vide + longueur 64 hex (plus jamais bytes.length)', () {
      expect(MediaUploader.sha256Hex(const []), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      expect(MediaUploader.sha256Hex(bytes), isNot('3'));
      expect(MediaUploader.sha256Hex(bytes), matches(RegExp(r'^[0-9a-f]{64}$')));
    });
  });

  group('F6 — clé offline dans le périmètre du tenant', () {
    test('offlineStorageKey commence par <org>/', () {
      final key = MediaUploader.offlineStorageKey(org, now: DateTime.fromMillisecondsSinceEpoch(1700000000000));
      expect(key, '$org/photo/offline-1700000000000.jpg');
      expect(key.startsWith('$org/'), isTrue); // garde serveur STORAGE_KEY_TENANT_MISMATCH
    });
    test('enqueueOfflinePhoto utilise l\'organisation de la base locale + SHA-256', () async {
      final db = AppDatabase.testing(SyncScope(org, user), NativeDatabase.memory());
      addTearDown(db.close);
      final engine = RecordingEngine();
      final id = await MediaUploader(RecordingApi()).enqueueOfflinePhoto(db, engine, childId: child, bytes: bytes);
      expect(id, 'op-1');
      final p = engine.enqueued.single['payload'] as Map<String, dynamic>;
      expect(engine.enqueued.single['command'], 'add_photo');
      expect((p['storage_key'] as String).startsWith('$org/'), isTrue);
      expect(p['storage_key'], isNot(startsWith('offline/')));
      expect(p['checksum'], 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
      expect(base64Decode(p['bytes'] as String), bytes);
    });
  });

  group('F7 — PUT signé : délais + 1 retry', () {
    MediaUploader build(ScriptedAdapter adapter, RecordingApi api) {
      final dio = Dio()..httpClientAdapter = adapter;
      return MediaUploader(api, uploadDio: dio);
    }

    test('panne réseau puis succès → 2 tentatives, asset enregistré avec checksum', () async {
      final adapter = ScriptedAdapter([DioExceptionType.connectionError, 200]);
      final api = RecordingApi();
      final asset = await build(adapter, api).uploadPhoto(childId: child, bytes: bytes, mimeType: 'image/jpeg');
      expect(adapter.requests.length, 2);
      expect(adapter.requests.first.sendTimeout, MediaUploader.uploadSendTimeout);
      expect(adapter.requests.first.connectTimeout, MediaUploader.uploadConnectTimeout);
      expect(asset['checksum'], MediaUploader.sha256Hex(bytes));
      expect(api.calls.last['path'], '/media');
    });

    test('deux pannes réseau → échec après exactement 2 tentatives, pas d\'enregistrement', () async {
      final adapter = ScriptedAdapter([DioExceptionType.sendTimeout, DioExceptionType.sendTimeout]);
      final api = RecordingApi();
      await expectLater(
        build(adapter, api).uploadPhoto(childId: child, bytes: bytes, mimeType: 'image/jpeg'),
        throwsA(isA<DioException>()),
      );
      expect(adapter.requests.length, 2);
      expect(api.calls.map((c) => c['path']), isNot(contains('/media')));
    });

    test('réponse 403 (URL signée expirée) → AUCUN retry', () async {
      final adapter = ScriptedAdapter([403, 200]);
      final api = RecordingApi();
      await expectLater(
        build(adapter, api).uploadPhoto(childId: child, bytes: bytes, mimeType: 'image/jpeg'),
        throwsA(isA<DioException>().having((e) => e.response?.statusCode, 'status', 403)),
      );
      expect(adapter.requests.length, 1);
      expect(api.calls.map((c) => c['path']), isNot(contains('/media')));
    });

    test('isRetryable : transport oui, réponse/annulation non', () {
      final ro = RequestOptions(path: '/');
      expect(MediaUploader.isRetryable(DioException(requestOptions: ro, type: DioExceptionType.receiveTimeout)), isTrue);
      expect(MediaUploader.isRetryable(DioException(requestOptions: ro, type: DioExceptionType.badResponse)), isFalse);
      expect(MediaUploader.isRetryable(DioException(requestOptions: ro, type: DioExceptionType.cancel)), isFalse);
    });
  });
}
