import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'core/auth/auth_service.dart';
import 'core/database/app_database.dart';
import 'core/network/api_client.dart';
import 'core/network/sync_client.dart';
import 'core/sync/sync_engine.dart';
import 'core/sync/sync_scope.dart';
import 'features/children/children_list_page.dart';
import 'features/login/login_page.dart';

void main() { WidgetsFlutterBinding.ensureInitialized(); runApp(const StaffApp()); }

class StaffApp extends StatefulWidget {
  const StaffApp({super.key, this.authApi, this.databaseFactory, this.syncApiFactory, this.engineFactory});
  final ApiClient? authApi;
  final AppDatabase Function(SyncScope)? databaseFactory;
  final ApiClient Function()? syncApiFactory;
  final SyncEngine Function(AppDatabase, SyncClient)? engineFactory;
  @override
  State<StaffApp> createState() => _StaffAppState();
}

class _StaffAppState extends State<StaffApp> {
  late final ApiClient _authApi;
  late final AuthService _auth;
  AppDatabase? _db;
  SyncEngine? _engine;
  bool _ready = false;
  String? _sessionError;
  int _epoch = 0;

  @override
  void initState() {
    super.initState();
    _authApi = widget.authApi ?? ApiClient();
    _auth = AuthService(_authApi, const FlutterSecureStorage());
    unawaited(_bootstrap());
  }

  Future<void> _bootstrap() async {
    try {
      if (await _auth.restoreSession()) { await _activate(); }
      else if (mounted) { setState(() => _ready = true); }
    } catch (_) {
      if (mounted) setState(() { _ready = true; _sessionError = 'Session locale indisponible — reconnectez-vous'; });
    }
  }

  Future<void> _release() async {
    final engine = _engine; final db = _db;
    _engine = null; _db = null;
    await engine?.close();
    await db?.close();
  }

  Future<void> _activate() async {
    final epoch = ++_epoch;
    if (mounted) setState(() { _ready = false; _sessionError = null; });
    await _release();
    if (!mounted || epoch != _epoch) return;
    AppDatabase? opening;
    ApiClient? api;
    try {
      final token = _auth.accessToken!;
      final scope = SyncScope.fromAccessToken(token);
      opening = widget.databaseFactory?.call(scope) ?? AppDatabase.forScope(scope);
      await opening.syncState(); // Validate owner BEFORE rendering any mirror.
      if (!mounted || epoch != _epoch) { await opening.close(); return; }
      // Token is pinned to this engine. Login/other scopes never mutate this API.
      api = (widget.syncApiFactory?.call() ?? ApiClient())..accessToken = token;
      _db = opening;
      _engine = widget.engineFactory?.call(opening, SyncClient(api)) ?? SyncEngine(opening, SyncClient(api));
      _engine!.startPeriodicSync();
      unawaited(_engine!.sync());
      setState(() => _ready = true);
    } catch (_) {
      api?.close(); await opening?.close();
      if (mounted && epoch == _epoch) setState(() {
        _ready = true;
        _sessionError = 'Session sans organisation ou base locale incompatible — aucune donnée réaffectée';
      });
    }
  }

  Future<void> _logout() async {
    ++_epoch;
    setState(() => _ready = false);
    await _release(); // Cancel requests / fence late replies before touching auth.
    await _auth.logout();
    if (mounted) setState(() { _ready = true; _sessionError = null; });
  }

  @override
  void dispose() {
    ++_epoch;
    unawaited(_release());
    _authApi.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    // Reset Navigator/overlays too: replacing home alone leaves private dialogs.
    key: ValueKey(_epoch),
    title: 'Crèche — Personnel',
    theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2563EB)), useMaterial3: true),
    home: !_ready ? const Scaffold(body: Center(child: CircularProgressIndicator()))
      : _sessionError != null ? Scaffold(body: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(_sessionError!), TextButton(onPressed: _logout, child: const Text('Se reconnecter')),
        ])))
      : _engine != null ? ChildrenListPage(key: ValueKey(_db!.scope.key), syncEngine: _engine!, onLogout: () => unawaited(_logout()))
      : LoginPage(auth: _auth, onAuthenticated: _activate),
  );
}
