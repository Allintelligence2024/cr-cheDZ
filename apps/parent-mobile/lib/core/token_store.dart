import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Jetons de session — abstraction minimale pour que le client soit **testable
/// sans plugin de plateforme** (les tests injectent une implémentation mémoire ;
/// en production c'est le keystore, jamais SharedPreferences).
abstract class ParentTokenStore {
  Future<String?> readAccessToken();
  Future<String?> readRefreshToken();
  Future<void> saveSession(String? accessToken, String? refreshToken);
  Future<void> clear();
}

/// Implémentation réelle : `flutter_secure_storage` (Keystore/Keychain).
class SecureTokenStore implements ParentTokenStore {
  SecureTokenStore({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _accessKey = 'access_token';
  static const _refreshKey = 'refresh_token';

  @override
  Future<String?> readAccessToken() => _storage.read(key: _accessKey);

  @override
  Future<String?> readRefreshToken() => _storage.read(key: _refreshKey);

  @override
  Future<void> saveSession(String? accessToken, String? refreshToken) async {
    if (accessToken != null) {
      await _storage.write(key: _accessKey, value: accessToken);
    }
    if (refreshToken != null) {
      await _storage.write(key: _refreshKey, value: refreshToken);
    }
  }

  @override
  Future<void> clear() => _storage.deleteAll();
}
