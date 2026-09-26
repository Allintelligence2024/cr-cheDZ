import 'package:crypto/crypto.dart' as crypto;
import 'package:dio/dio.dart';

import '../network/api_client.dart';

/// Upload de photos/documents — **par l'API** (lot L2F, 2026-09-26).
///
/// Le chemin historique (presign d'écriture → URL signée → PUT direct vers
/// MinIO) est **mort en production** depuis le lot 2B : le
/// stockage est lié à `127.0.0.1:9000` sans sous-domaine public (décision D1 = A)
/// et la route répond `UPLOAD_VIA_API_REQUIRED`. Le client envoie donc les
/// octets au serveur, qui les écrit : `POST /api/v1/media/upload` (multipart).
///
/// Ce que ce fichier ne fait plus, et pourquoi :
/// - il ne signe plus rien et ne parle plus à MinIO (`putSigned` retiré) — la route
///   de signature d'écriture n'est plus appelée par aucun fichier client ;
/// - il ne fabrique plus de clé de stockage : le serveur la compose
///   (`storage.storageKey(tenantId, mediaType, file.originalname)`), donc plus
///   de préfixe tenant à deviner côté client (`STORAGE_KEY_TENANT_MISMATCH`) ;
/// - il n'envoie plus d'octets par la file de synchronisation (décision D6,
///   option c : la voie hors ligne est refusée par `POST /sync/push`).
///
/// Rapport 5 analyses, Phase 4 (inchangé) :
/// - F2 : `checksum` = vraie SHA-256 hexadécimale des octets, **vérifiée par le
///   serveur** (`MEDIA_CHECKSUM_MISMATCH` avant toute écriture) ;
/// - F7 : une panne de transport est rejouée **une** fois, une réponse serveur
///   (4xx/5xx) jamais, et les délais de l'envoi sont bornés.
class MediaUploader {
  MediaUploader(this._api);

  final ApiClient _api;

  /// Nombre de tentatives au total (1 essai + 1 retry) sur panne de transport.
  static const int uploadAttempts = 2;

  /// Délais de l'envoi — une photo compressée peut peser plusieurs Mo sur un
  /// réseau mobile lent ; sans borne, l'écran attend indéfiniment.
  static const Duration uploadSendTimeout = Duration(seconds: 60);
  static const Duration uploadReceiveTimeout = Duration(seconds: 60);

  /// SHA-256 hexadécimal (64 caractères minuscules) des octets.
  static String sha256Hex(List<int> bytes) => crypto.sha256.convert(bytes).toString();

  /// Une erreur mérite-t-elle un nouvel essai ? Uniquement les défaillances de
  /// transport ; une réponse du serveur (4xx/5xx) est définitive.
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

  /// Envoie une photo (ou un PDF) : les octets passent par l'API, qui les écrit
  /// dans le stockage et enregistre l'asset. Retourne l'asset créé.
  Future<Map<String, dynamic>> uploadPhoto({
    required String childId,
    required List<int> bytes,
    required String mimeType,
    String? filename,
  }) async {
    final name = filename ?? 'photo-${DateTime.now().millisecondsSinceEpoch}.jpg';
    for (var attempt = 1; ; attempt++) {
      try {
        // Le `FormData` est reconstruit à CHAQUE tentative : un corps déjà
        // finalisé par l'adaptateur ne se rejoue pas (même leçon que l'ancien
        // PUT signé, dont le flux était recréé par essai).
        return await _api.upload<Map<String, dynamic>>(
          '/media/upload',
          buildForm(
            bytes: bytes,
            mimeType: mimeType,
            filename: name,
            childId: childId,
            checksum: sha256Hex(bytes),
          ),
          options: Options(
            sendTimeout: uploadSendTimeout,
            receiveTimeout: uploadReceiveTimeout,
          ),
        );
      } on DioException catch (e) {
        if (!isRetryable(e) || attempt >= uploadAttempts) rethrow;
      }
    }
  }

  /// Corps multipart attendu par `POST /api/v1/media/upload` (lot 2B) :
  /// le fichier sous le champ `file` (Lu par `FileInterceptor('file')`), plus
  /// les champs du DTO (`child_id`, `checksum`).
  ///
  /// Le type MIME est posé explicitement sur la partie : le serveur lit
  /// `file.mimetype` — sans lui, la partie serait `application/octet-stream` et
  /// l'API refuserait (`MEDIA_MIME_NOT_ALLOWED`, vérifié par signature binaire).
  ///
  /// `exif_stripped` n'est **pas** envoyé : le client ne supprime pas les
  /// métadonnées EXIF, il ne doit donc pas l'affirmer (dette documentée : le
  /// retrait EXIF côté client reste à faire, et le serveur garde sa valeur par
  /// défaut).
  static FormData buildForm({
    required List<int> bytes,
    required String mimeType,
    required String filename,
    required String childId,
    required String checksum,
  }) =>
      FormData.fromMap({
        'file': MultipartFile.fromBytes(
          bytes,
          filename: filename,
          contentType: DioMediaType.parse(mimeType),
        ),
        'child_id': childId,
        'checksum': checksum,
      });
}
