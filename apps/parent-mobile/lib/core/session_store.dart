import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SessionStore {
  const SessionStore(this._storage);
  final FlutterSecureStorage _storage;
  Future<void> save(Map<String, dynamic> session) async {
    await _storage.write(key: 'access_token', value: session['access_token'] as String?);
    await _storage.write(key: 'refresh_token', value: session['refresh_token'] as String?);
  }
  Future<bool> hasSession() async => (await _storage.read(key: 'access_token')) != null;
  Future<void> clear() => _storage.deleteAll();
}
