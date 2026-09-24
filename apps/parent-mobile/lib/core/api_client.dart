import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Client parent : refresh token/PIN restent dans le keystore, jamais SharedPreferences.
class ParentApiClient {
  ParentApiClient(String baseUrl)
      : _dio = Dio(BaseOptions(baseUrl: baseUrl)),
        _storage = const FlutterSecureStorage();

  final Dio _dio;
  final FlutterSecureStorage _storage;

  Future<void> saveSession(Map<String, dynamic> session) async {
    await _storage.write(
      key: 'access_token',
      value: session['access_token'] as String?,
    );
    await _storage.write(
      key: 'refresh_token',
      value: session['refresh_token'] as String?,
    );
  }

  Future<Map<String, dynamic>> requestOtp(String phone) async {
    final res = await _dio.post(
      '/auth/parent/otp/request',
      data: {'phone': phone},
    );
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> verifyOtp(String phone, String code) async {
    final res = await _dio.post(
      '/auth/parent/otp/verify',
      data: {'phone': phone, 'code': code},
    );
    return res.data as Map<String, dynamic>;
  }

  Future<List<dynamic>> children() async {
    final res = await _authedGet('/parent/children');
    return res.data as List<dynamic>;
  }

  Future<List<dynamic>> feed(String childId) async {
    final res = await _authedGet('/parent/children/$childId/feed');
    return res.data as List<dynamic>;
  }

  Future<void> absence(String childId, {String? reason}) async {
    await _authedPost('/parent/absence', {
      'child_id': childId,
      if (reason != null) 'reason': reason,
    });
  }

  Future<List<dynamic>> photos(String childId) async {
    final res = await _authedGet('/parent/children/$childId/media');
    return res.data as List<dynamic>;
  }

  Future<List<dynamic>> consents(String childId) async {
    final res = await _authedGet('/parent/children/$childId/consents');
    return res.data as List<dynamic>;
  }

  Future<void> saveConsent(String childId, String type, bool granted) async {
    await _authedPost('/parent/consents', {
      'child_id': childId,
      'consent_type': type,
      'granted': granted,
    });
  }

  Future<List<dynamic>> preferences() async {
    final res = await _authedGet('/parent/notification-preferences');
    return res.data as List<dynamic>;
  }

  Future<void> savePreference(
    String eventType,
    bool enabled, {
    String? start,
    String? end,
  }) async {
    await _authedPost('/parent/notification-preferences', {
      'event_type': eventType,
      'is_enabled': enabled,
      if (start != null) 'quiet_hours_start': start,
      if (end != null) 'quiet_hours_end': end,
    });
  }

  /// Contenu binaire d'une photo (LOT 2 — P0 F5).
  ///
  /// L'API ne renvoie plus d'URL signée MinIO (injoignable depuis un
  /// téléphone : MinIO est lié à 127.0.0.1 en production) mais un chemin
  /// same-origin `/parent/children/<child>/media/<id>/content`. Ce chemin
  /// exige l'en-tête Authorization : Flutter ne peut donc pas l'afficher avec
  /// `Image.network(url)` seul — les octets sont récupérés ici, déjà soumis
  /// aux contrôles serveur (filiation + consentement photo courant).
  Future<Uint8List> photoContent(String childId, String mediaId) async {
    final token = await _storage.read(key: 'access_token');
    final res = await _dio.get<List<int>>(
      '/parent/children/$childId/media/$mediaId/content',
      options: Options(
        headers: {'authorization': 'Bearer $token'},
        responseType: ResponseType.bytes,
      ),
    );
    return Uint8List.fromList(res.data ?? const <int>[]);
  }

  Future<Response<dynamic>> _authedGet(String path) async {
    final token = await _storage.read(key: 'access_token');
    return _dio.get(
      path,
      options: Options(headers: {'authorization': 'Bearer $token'}),
    );
  }

  Future<void> _authedPost(String path, Map<String, dynamic> body) async {
    final token = await _storage.read(key: 'access_token');
    await _dio.post(
      path,
      data: body,
      options: Options(headers: {'authorization': 'Bearer $token'}),
    );
  }
}
