import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Cache léger pour mode offline partiel — pas de Drift, juste JSON + TTL 5 min.
/// Utilisé pour dashboard, aged-balance, etc. — jamais pour données sensibles (PII).
class CacheService {
  static const _prefix = 'director_cache_';
  static const _ttlSeconds = 300; // 5 min

  Future<void> save(String key, Map<String, dynamic> data) async {
    final prefs = await SharedPreferences.getInstance();
    final payload = {
      'ts': DateTime.now().millisecondsSinceEpoch,
      'data': data,
    };
    await prefs.setString('$_prefix$key', jsonEncode(payload));
  }

  Future<void> saveList(String key, List<dynamic> data) async {
    final prefs = await SharedPreferences.getInstance();
    final payload = {
      'ts': DateTime.now().millisecondsSinceEpoch,
      'data': data,
    };
    await prefs.setString('$_prefix$key', jsonEncode(payload));
  }

  Future<Map<String, dynamic>?> read(String key) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('$_prefix$key');
    if (raw == null) return null;
    try {
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      final ts = decoded['ts'] as int? ?? 0;
      final age = DateTime.now().millisecondsSinceEpoch - ts;
      if (age > _ttlSeconds * 1000) return null; // expiré
      return decoded['data'] as Map<String, dynamic>?;
    } catch (_) {
      return null;
    }
  }

  Future<List<dynamic>?> readList(String key) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('$_prefix$key');
    if (raw == null) return null;
    try {
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      final ts = decoded['ts'] as int? ?? 0;
      final age = DateTime.now().millisecondsSinceEpoch - ts;
      if (age > _ttlSeconds * 1000) return null;
      final data = decoded['data'];
      if (data is List) return data;
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<void> clearAll() async {
    final prefs = await SharedPreferences.getInstance();
    final keys = prefs.getKeys().where((k) => k.startsWith(_prefix)).toList();
    for (final k in keys) {
      await prefs.remove(k);
    }
  }
}
