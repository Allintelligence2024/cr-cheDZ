import 'dart:convert';

import 'package:crypto/crypto.dart' as crypto;
import 'package:dio/dio.dart';

import '../database/app_database.dart';
import '../network/api_client.dart';

/// Upload de photos (Phase 6) :
/// 1. presign : POST /media/presign-upload → URL signée S3 (le serveur signe)
/// 2. PUT direct vers l'URL signée (jamais via l'API)
/// 3. register : POST /media (storage_key, checksum…) — visibilité parent
///    refusée tant que le consentement n'est pas vérifié côté serveur.
///
/// Rapport 5 analyses, Phase 4 :
/// - F2 : checksum = vraie SHA-256 hex (métadonnée d'intégrité côté client ;
///   le serveur la stocke sans la recalculer — dette documentée).
/// - F6 : la clé offline est préfixée par l'organisation, sinon le serveur
///   rejette l'opération (STORAGE_KEY_TENANT_MISMATCH, garde C3).
/// - F7 : le PUT S3 a un délai maximal et un (1) nouvel essai sur erreur
///   réseau — jamais sur une réponse 4xx (URL signée invalide/expirée).
class MediaUploader {
  MediaUploader(this._api, {Dio? uploadDio}) : _uploadDio = uploadDio ?? Dio();

  final ApiClient _api;
  final Dio _uploadDio;

  /// Délais du PUT direct (photo compressée ≤ quelques Mo sur réseau mobile).
  static const Duration uploadConnectTimeout = Duration(seconds: 15);
  static const Duration uploadSendTimeout = Duration(seconds: 60);
  static const Duration uploadReceiveTimeout = Duration(seconds: 30);

  /// Nombre de tentatives au total (1 essai + 1 retry).
  static const int uploadAttempts = 2;

  /// SHA-256 hexadécimal (64 caractères minuscules) des octets.
  static String sha256Hex(List<int> bytes) => crypto.sha256.convert(bytes).toString();

  /// Clé de stockage d'une photo prise hors ligne : même forme que les clés
  /// serveur (`<org>/<media_type>/<nom>`), le préfixe tenant étant OBLIGATOIRE.
  static String offlineStorageKey(String organizationId, {DateTime? now}) {
    final ms = (now ?? DateTime.now()).millisecondsSinceEpoch;
    return '$organizationId/photo/offline-$ms.jpg';
  }

  /// Une erreur d'upload mérite-t-elle un nouvel essai ? Uniquement les
  /// défaillances réseau/transport ; une réponse du serveur (4xx/5xx) est
  /// définitive pour une URL signée.
  static bool isRetryable(DioException e) {
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.connectionError:
        return true;
      case DioExceptionType.badResponse:
      case DioExceptionType.badCertificate:
      case DioExceptionType.cancel:
        return false;
      default:
        // unknown, transformTimeout (dio ≥ 5.9) et tout futur type : on ne
        // rejoue que si AUCUNE réponse serveur n'a été reçue.
        return e.response == null;
    }
  }

  /// PUT direct vers l'URL signée avec délais + 1 retry (F7). Le flux est
  /// recréé à chaque tentative (un `Stream` consommé n'est pas rejouable).
  Future<void> putSigned(String uploadUrl, List<int> bytes, String mimeType) async {
    for (var attempt = 1; ; attempt++) {
      try {
        await _uploadDio.put<dynamic>(
          uploadUrl,
          data: Stream<List<int>>.fromIterable([bytes]),
          options: Options(
            headers: {'content-type': mimeType, 'content-length': bytes.length},
            connectTimeout: uploadConnectTimeout,
            sendTimeout: uploadSendTimeout,
            receiveTimeout: uploadReceiveTimeout,
          ),
        );
        return;
      } on DioException catch (e) {
        if (!isRetryable(e) || attempt >= uploadAttempts) rethrow;
      }
    }
  }

  /// Télécharge une photo compressée (déjà réduite côté UI) vers MinIO/S3.
  /// Retourne l'asset enregistré en base.
  Future<Map<String, dynamic>> uploadPhoto({
    required String childId,
    required List<int> bytes,
    required String mimeType,
    String? filename,
  }) async {
    final name = filename ?? 'photo-${DateTime.now().millisecondsSinceEpoch}.jpg';
    final presign = await _api.post<Map<String, dynamic>>('/media/presign-upload', {
      'filename': name,
      'mime_type': mimeType,
      'child_id': childId,
    });
    final uploadUrl = presign['upload_url'] as String;
    final storageKey = presign['storage_key'] as String;

    // Upload direct (URL signée, aucun transit par l'API).
    await putSigned(uploadUrl, bytes, mimeType);

    // Enregistrement de l'asset.
    final reg = await _api.post<Map<String, dynamic>>('/media', {
      'storage_key': storageKey,
      'mime_type': mimeType,
      'child_id': childId,
      'original_filename': name,
      'file_size_bytes': bytes.length,
      'checksum': sha256Hex(bytes),
      'exif_stripped': true,
    });
    return reg;
  }

  /// Photo prise hors ligne : enregistre via la file de sync (add_photo),
  /// l'upload direct est fait à la reconnexion par l'uploader. La clé est
  /// dans le périmètre de l'organisation de la base locale (F6).
  Future<String> enqueueOfflinePhoto(
    AppDatabase db,
    dynamic syncEngine, {
    required String childId,
    required List<int> bytes,
    String? checksum,
  }) async {
    final payload = {
      'child_id': childId,
      'storage_key': offlineStorageKey(db.scope.organizationId),
      'mime_type': 'image/jpeg',
      'checksum': checksum ?? sha256Hex(bytes),
      'bytes': base64Encode(bytes), // stocké localement pour l'upload différé
    };
    return syncEngine.enqueue(
      command: 'add_photo',
      entityType: 'media',
      payload: payload,
    );
  }
}
