import 'dart:convert';

import 'package:dio/dio.dart';

import '../database/app_database.dart';
import '../network/api_client.dart';

/// Upload de photos (Phase 6) :
/// 1. presign : POST /media/presign-upload → URL signée S3 (le serveur signe)
/// 2. PUT direct vers l'URL signée (jamais via l'API)
/// 3. register : POST /media (storage_key, checksum…) — visibilité parent
///    refusée tant que le consentement n'est pas vérifié côté serveur.
class MediaUploader {
  MediaUploader(this._api);

  final ApiClient _api;

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
    final dio = Dio();
    await dio.put<dynamic>(
      uploadUrl,
      data: Stream.fromIterable([bytes]),
      options: Options(headers: {'content-type': mimeType}),
    );

    // Enregistrement de l'asset.
    final reg = await _api.post<Map<String, dynamic>>('/media', {
      'storage_key': storageKey,
      'mime_type': mimeType,
      'child_id': childId,
      'original_filename': name,
      'file_size_bytes': bytes.length,
      'exif_stripped': true,
    });
    return reg;
  }

  /// Photo prise hors ligne : enregistre via la file de sync (add_photo),
  /// l'upload direct est fait à la reconnexion par l'uploader.
  Future<String> enqueueOfflinePhoto(
    AppDatabase db,
    dynamic syncEngine, {
    required String childId,
    required List<int> bytes,
    String? checksum,
  }) async {
    final payload = {
      'child_id': childId,
      'storage_key': 'offline/${DateTime.now().millisecondsSinceEpoch}.jpg',
      'mime_type': 'image/jpeg',
      'checksum': checksum ?? _sha256(bytes),
      'bytes': base64Encode(bytes), // stocké localement pour l'upload différé
    };
    return syncEngine.enqueue(
      command: 'add_photo',
      entityType: 'media',
      payload: payload,
    );
  }

  String _sha256(List<int> bytes) {
    // TODO Phase 6 : crypto.sha256 (package crypto) — placeholder simple.
    return bytes.length.toString();
  }
}
