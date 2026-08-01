import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Client parent : refresh token/PIN restent dans le keystore, jamais SharedPreferences.
class ParentApiClient {
  ParentApiClient(String baseUrl) : _dio = Dio(BaseOptions(baseUrl: baseUrl)), _storage = const FlutterSecureStorage();
  final Dio _dio;
  final FlutterSecureStorage _storage;

  Future<void> saveSession(Map<String, dynamic> session) async {
    await _storage.write(key: 'access_token', value: session['access_token'] as String?);
    await _storage.write(key: 'refresh_token', value: session['refresh_token'] as String?);
  }
  Future<Map<String, dynamic>> requestOtp(String phone) async => (await _dio.post('/auth/parent/otp/request', data: {'phone': phone})).data;
  Future<Map<String, dynamic>> verifyOtp(String phone, String code) async => (await _dio.post('/auth/parent/otp/verify', data: {'phone': phone, 'code': code})).data;
  Future<List<dynamic>> children() async => (await _authedGet('/parent/children')).data as List<dynamic>;
  Future<List<dynamic>> feed(String childId) async => (await _authedGet('/parent/children/$childId/feed')).data as List<dynamic>;
  Future<void> absence(String childId, {String? reason}) async => _authedPost('/parent/absence', {'child_id': childId, if (reason != null) 'reason': reason});
  Future<List<dynamic>> photos(String childId) async => (await _authedGet('/parent/children/$childId/media')).data as List<dynamic>;
  Future<List<dynamic>> consents(String childId) async => (await _authedGet('/parent/children/$childId/consents')).data as List<dynamic>;
  Future<void> saveConsent(String childId, String type, bool granted) async => _authedPost('/parent/consents', {'child_id': childId, 'consent_type': type, 'granted': granted});
  Future<List<dynamic>> preferences() async => (await _authedGet('/parent/notification-preferences')).data as List<dynamic>;
  Future<void> savePreference(String eventType, bool enabled, {String? start, String? end}) async => _authedPost('/parent/notification-preferences', {'event_type':eventType,'is_enabled':enabled,if(start!=null)'quiet_hours_start':start,if(end!=null)'quiet_hours_end':end});
  Future<Response<dynamic>> _authedGet(String path) async => _dio.get(path, options: Options(headers: {'authorization': 'Bearer ${await _storage.read(key: 'access_token')}'}));
  Future<void> _authedPost(String path, Map<String, dynamic> body) async { await _dio.post(path, data: body, options: Options(headers: {'authorization': 'Bearer ${await _storage.read(key: 'access_token')}'})); }
}
