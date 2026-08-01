import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'core/auth/auth_service.dart';
import 'core/database/app_database.dart';
import 'core/network/api_client.dart';
import 'core/network/sync_client.dart';
import 'core/sync/sync_engine.dart';
import 'features/children/children_list_page.dart';
import 'features/login/login_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const StaffApp());
}

/// Composition racine : services partagés injectés dans les pages.
class StaffApp extends StatefulWidget {
  const StaffApp({super.key});

  @override
  State<StaffApp> createState() => _StaffAppState();
}

class _StaffAppState extends State<StaffApp> {
  late final AppDatabase _db;
  late final ApiClient _api;
  late final AuthService _auth;
  late final SyncEngine _syncEngine;
  bool _ready = false;
  bool _authenticated = false;

  @override
  void initState() {
    super.initState();
    _db = AppDatabase();
    _api = ApiClient();
    _auth = AuthService(_api, const FlutterSecureStorage());
    _syncEngine = SyncEngine(_db, SyncClient(_api));
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    // Rétablit la session si un token existe, puis lance une sync initiale.
    final restored = await _auth.restoreSession();
    if (restored) {
      _api.accessToken = _auth.accessToken;
      await _syncEngine.sync();
      _syncEngine.startPeriodicSync();
    }
    if (mounted) {
      setState(() {
        _ready = true;
        _authenticated = restored;
      });
    }
  }

  void _onAuthenticated() {
    _api.accessToken = _auth.accessToken;
    _syncEngine.startPeriodicSync();
    setState(() => _authenticated = true);
  }

  @override
  void dispose() {
    _syncEngine.dispose();
    _db.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Crèche — Personnel',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2563EB)),
        useMaterial3: true,
      ),
      home: _ready
          ? (_authenticated
              ? ChildrenListPage(syncEngine: _syncEngine)
              : LoginPage(auth: _auth, onAuthenticated: _onAuthenticated))
          : const Scaffold(body: Center(child: CircularProgressIndicator())),
    );
  }
}
