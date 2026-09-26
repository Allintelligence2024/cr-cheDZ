// Rapport 5 analyses — Phase 4 (F2, F7) : upload média.
// F6 (clé de stockage hors ligne) a été retirée le 2026-09-25 avec la décision D6
// (option c) : la photo hors ligne n'existe pas en V1, il n'y a donc plus de clé à
// fabriquer ni de commande à enfiler.
// L2F (2026-09-26) : l'upload en LIGNE passe désormais par l'API
// (`POST /api/v1/media/upload`, multipart) — le presign S3 est mort en
// production (lot 2B), donc le PUT signé et le second appel `POST /media` ont
// disparu. Ce fichier le prouve : un seul appel, un corps multipart complet, et
// une reprise UNIQUEMENT sur panne de transport.
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:staff_mobile/core/media/media_uploader.dart';
import 'package:staff_mobile/core/network/api_client.dart';

const child = '33333333-3333-4333-8333-333333333333';

/// Client d'API instrumenté : n'accepte QUE l'envoi multipart vers
/// `/media/upload`. Tout autre appel (presign, register) fait échouer le test —
/// c'est la garde la plus directe contre un retour au chemin mort.
class RecordingApi extends ApiClient {
  RecordingApi({List<Object>? script}) : script = script ?? const <Object>[];

  /// 'ok' ou un [DioExceptionType] à lever, consommé à chaque envoi.
  final List<Object> script;
  final calls = <Map<String, dynamic>>[];
  int uploads = 0;

  @override
  Future<T> upload<T>(String path, FormData form, {Options? options}) async {
    uploads += 1;
    calls.add({'path': path, 'form': form, 'options': options});
    final step = script.isEmpty ? 'ok' : script[(uploads - 1) % script.length];
    if (step is DioExceptionType) {
      throw DioException(requestOptions: RequestOptions(path: path), type: step);
    }
    return <String, dynamic>{'id': 'asset-1'} as T;
  }

  @override
  Future<T> post<T>(String path, [Object? body]) async => fail(
        'le client média ne doit plus rien envoyer hors /media/upload '
        '(appel interdit observé : $path)',
      );
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

  group('L2F — l’upload passe par l’API (multipart)', () {
    MapEntry<String, MultipartFile> fileOf(FormData form) {
      expect(form.files, hasLength(1), reason: 'une seule partie fichier');
      return form.files.single;
    }

    String fieldOf(FormData form, String key) =>
        form.fields.singleWhere((f) => f.key == key).value;

    test('un seul appel : /media/upload, champ « file » typé, child_id + checksum', () async {
      final api = RecordingApi();
      final asset = await MediaUploader(api).uploadPhoto(
        childId: child,
        bytes: bytes,
        mimeType: 'image/jpeg',
      );

      expect(asset['id'], 'asset-1');
      expect(api.uploads, 1);
      expect(api.calls.single['path'], '/media/upload');
      final form = api.calls.single['form'] as FormData;
      final file = fileOf(form);
      // Le serveur lit `file.mimetype` : sans type explicite, la partie serait
      // application/octet-stream et l'API refuserait (MEDIA_MIME_NOT_ALLOWED).
      expect(file.value.contentType.toString(), 'image/jpeg');
      expect(file.value.length, bytes.length);
      expect(file.value.filename, endsWith('.jpg'));
      expect(fieldOf(form, 'child_id'), child);
      expect(fieldOf(form, 'checksum'), MediaUploader.sha256Hex(bytes));
      // Le client n'affirme pas avoir retiré les métadonnées EXIF : il ne le fait
      // pas (dette documentée) — un champ `exif_stripped: true` serait un mensonge.
      expect(form.fields.map((f) => f.key), isNot(contains('exif_stripped')));
      // Aucune clé de stockage fabriquée côté client : le serveur la compose.
      expect(api.calls.single['form'].toString(), isNot(contains('presign')));
    });

    test('panne de transport puis succès → 2 tentatives, corps RECONSTRUIT', () async {
      final api = RecordingApi(script: [DioExceptionType.connectionError]);
      final asset = await MediaUploader(api).uploadPhoto(
        childId: child,
        bytes: bytes,
        mimeType: 'image/jpeg',
      );

      expect(asset['id'], 'asset-1');
      expect(api.uploads, 2);
      expect(api.calls, hasLength(2));
      // Un FormData finalisé n'est pas rejouable : chaque tentative a le sien.
      expect(identical(api.calls[0]['form'], api.calls[1]['form']), isFalse);
    });

    test('deux pannes de transport → échec après exactement 2 tentatives', () async {
      final api = RecordingApi(
        script: [DioExceptionType.sendTimeout, DioExceptionType.sendTimeout],
      );
      await expectLater(
        MediaUploader(api).uploadPhoto(childId: child, bytes: bytes, mimeType: 'image/jpeg'),
        throwsA(isA<DioException>()),
      );
      expect(api.uploads, 2);
    });

    test('réponse serveur (4xx) → un seul essai, aucune reprise', () async {
      final api = RecordingApi(script: [DioExceptionType.badResponse]);
      await expectLater(
        MediaUploader(api).uploadPhoto(childId: child, bytes: bytes, mimeType: 'image/jpeg'),
        throwsA(isA<DioException>()),
      );
      expect(api.uploads, 1);
    });

    test('les délais de l’envoi sont bornés (jamais d’attente infinie)', () async {
      final api = RecordingApi();
      await MediaUploader(api).uploadPhoto(childId: child, bytes: bytes, mimeType: 'image/jpeg');
      final options = api.calls.single['options'] as Options?;
      expect(options?.sendTimeout, MediaUploader.uploadSendTimeout);
      expect(options?.receiveTimeout, MediaUploader.uploadReceiveTimeout);
    });

    test('isRetryable : transport oui, réponse/annulation non', () {
      final ro = RequestOptions(path: '/');
      expect(MediaUploader.isRetryable(DioException(requestOptions: ro, type: DioExceptionType.receiveTimeout)), isTrue);
      expect(MediaUploader.isRetryable(DioException(requestOptions: ro, type: DioExceptionType.badResponse)), isFalse);
      expect(MediaUploader.isRetryable(DioException(requestOptions: ro, type: DioExceptionType.cancel)), isFalse);
    });
  });
}
