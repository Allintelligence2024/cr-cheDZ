import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../network/api_client.dart';

/// Authentification : tokens dans flutter_secure_storage (clé du trousseau),
/// restauration de session au démarrage.
class AuthService {
  AuthService(this._api, this._storage);

  final ApiClient _api;
  final FlutterSecureStorage _storage;

  static const _accessKey = 'staff_access_token';
  static const _refreshKey = 'staff_refresh_token';

  bool isAuthenticated = false;

  String? get accessToken => _accessToken;
  String? _accessToken;

  Future<bool> restoreSession() async {
    final access = await _storage.read(key: _accessKey);
    final refresh = await _storage.read(key: _refreshKey);
    if (access == null || refresh == null) return false;
    _accessToken = access;
    isAuthenticated = true;
    return true;
  }

  /// Login (email + mot de passe) — retourne l'utilisateur courant.
  Future<Map<String, dynamic>> login(String email, String password) async {
    final res = await _api.post<Map<String, dynamic>>('/auth/login', {
      'email': email,
      'password': password,
    });
    _accessToken = res['access_token'] as String;
    await _storage.write(key: _accessKey, value: _accessToken);
    await _storage.write(key: _refreshKey, value: res['refresh_token'] as String);
    isAuthenticated = true;
    return res['user'] as Map<String, dynamic>;
  }

  /// 3.10.2 : rotation access token via le refresh token.
  ///
  /// L'access token expire (15 min) — sans refresh, l'app se bloquait
  /// DÉFINITIVEMENT en 401 : l'intercepteur du ApiClient voit 401, n'a pas de
  /// `_onRefresh` branché, et laissait l'erreur remonter. La seule issue était
  /// une reconnexion manuelle. Désormais l'intercepteur appelle cette
  /// méthode : on POST /auth/refresh avec le refresh token stocké, on
  /// persiste la nouvelle paire, et on alimente le retry.
  /// Retourne false (session morte) si le refresh est expiré/révoqué —
  /// l'app remonte alors vers le login.
  Future<bool> refresh() async {
    final refresh = await _storage.read(key: _refreshKey);
    if (refresh == null) return false;
    try {
      final res = await _api.post<Map<String, dynamic>>(
        '/auth/refresh',
        {'refresh_token': refresh},
      );
      final access = res['access_token'] as String?;
      final newRefresh = res['refresh_token'] as String?;
      if (access == null || newRefresh == null) return false;
      _accessToken = access;
      _api.accessToken = access;
      await _storage.write(key: _accessKey, value: access);
      await _storage.write(key: _refreshKey, value: newRefresh);
      return true;
    } catch (_) {
      // Refresh invalide/révoqué : la session est morte, on purge.
      await logout();
      return false;
    }
  }

  Future<void> logout() async {
    _accessToken = null;
    _api.accessToken = null;
    isAuthenticated = false;
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
  }
}
