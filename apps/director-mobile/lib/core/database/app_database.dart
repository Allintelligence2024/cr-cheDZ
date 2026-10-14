import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Cache offline léger pour director-mobile (SharedPreferences).
///
/// 3.2.12 (remédiation 2026-10-04) : la variante Drift/SQLite
/// (`app_database_drift.dart`, `DirectorCacheDb`) a été supprimée — elle
/// n'était jamais instanciée (aucun call site, 861 lignes de code généré
/// mort). Ce wrapper SharedPreferences est l'unique cache offline.

class DirectorDatabase {
  static const _prefix = 'director_db_';

  Future<void> saveDashboard(String date, Map<String, dynamic> json) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('$_prefix dashboard_$date', jsonEncode({'ts': DateTime.now().millisecondsSinceEpoch, 'data': json}));
  }

  Future<Map<String, dynamic>?> getDashboard(String date) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('$_prefix dashboard_$date');
    if (raw == null) return null;
    try {
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      return decoded['data'] as Map<String, dynamic>?;
    } catch (_) {
      return null;
    }
  }

  Future<void> saveChildren(List<Map<String, dynamic>> children) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('${_prefix}children', jsonEncode({'ts': DateTime.now().millisecondsSinceEpoch, 'data': children}));
  }

  Future<List<dynamic>> getAllChildren() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('${_prefix}children');
    if (raw == null) return [];
    try {
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      return decoded['data'] as List<dynamic>? ?? [];
    } catch (_) {
      return [];
    }
  }

  Future<void> saveInvoices(List<Map<String, dynamic>> invoices) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('${_prefix}invoices', jsonEncode({'ts': DateTime.now().millisecondsSinceEpoch, 'data': invoices}));
  }

  Future<List<dynamic>> getAllInvoices() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('${_prefix}invoices');
    if (raw == null) return [];
    try {
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      return decoded['data'] as List<dynamic>? ?? [];
    } catch (_) {
      return [];
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
