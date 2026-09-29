import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import 'core/api_client.dart';
import 'core/cache_service.dart';
import 'core/observability.dart';
import 'core/push_service.dart';
import 'core/token_store.dart';
import 'features/attendance/attendance_page.dart';
import 'features/auth/login_page.dart';
import 'features/billing/billing_page.dart';
import 'features/dashboard/dashboard_page.dart';
import 'features/more/more_page.dart';
import 'features/staff/staff_page.dart';
import 'theme/serenite_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // M1 — Firebase FCM : initialisation best effort. Sans google-services.json
  // (ou en test), l'app démarre quand même en mode sans push.
  try {
    await Firebase.initializeApp();
  } catch (e) {
    debugPrint('Firebase non initialisé (config absente) : $e');
  }
  // M7 — Sentry : actif uniquement quand un DSN est fourni au build
  // (`--dart-define SENTRY_DSN=…`). Sans DSN (dev, CI, tests widget), on
  // lance l'app directement : Sentry n'émet aucun appel réseau.
  if (sentryDsn.isEmpty) {
    runApp(const DirectorApp());
    return;
  }
  await SentryFlutter.init(
    applySentryOptions,
    appRunner: () => runApp(const DirectorApp()),
  );
}

class DirectorApp extends StatefulWidget {
  const DirectorApp({super.key});

  @override
  State<DirectorApp> createState() => _DirectorAppState();
}

class _DirectorAppState extends State<DirectorApp> {
  DirectorApiClient? _api;
  final _cache = CacheService();
  final _push = PushService();
  bool _authenticated = false;
  bool _checking = true;
  int _epoch = 0;

  @override
  void initState() {
    super.initState();
    _bootstrap();
    _push.initialize();
  }

  Future<void> _bootstrap() async {
    final store = SecureTokenStore();
    final access = await store.readAccess();
    final refresh = await store.readRefresh();
    if (!mounted) return;
    setState(() {
      _api = DirectorApiClient(
        const String.fromEnvironment('API_URL', defaultValue: 'https://api.creche.dz/api/v1'),
        onSessionExpired: _onSessionExpired,
      );
      _authenticated = access != null && refresh != null;
      _checking = false;
    });
  }

  void _onSessionExpired() {
    if (mounted) {
      setState(() {
        _authenticated = false;
        _epoch++;
        _api?.close();
        _api = DirectorApiClient(
          const String.fromEnvironment('API_URL', defaultValue: 'https://api.creche.dz/api/v1'),
          onSessionExpired: _onSessionExpired,
        );
      });
    }
  }

  @override
  void dispose() {
    _api?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      key: ValueKey(_epoch),
      title: 'Crèche DZ — Direction',
      supportedLocales: const [Locale('fr'), Locale('ar')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      theme: SereniteTheme.light,
      darkTheme: SereniteTheme.dark,
      themeMode: ThemeMode.system,
      home: _checking
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : _authenticated && _api != null
              ? DirectorHome(
                  api: _api!,
                  cache: _cache,
                  push: _push,
                  onLogout: () async {
                    await _api!.logout();
                    await _cache.clearAll();
                    if (mounted) {
                      setState(() {
                        _authenticated = false;
                        _epoch++;
                        _api?.close();
                        _api = DirectorApiClient(
                          const String.fromEnvironment('API_URL', defaultValue: 'https://api.creche.dz/api/v1'),
                          onSessionExpired: _onSessionExpired,
                        );
                      });
                    }
                  },
                )
              : LoginPage(
                  api: _api ??
                      DirectorApiClient(
                        const String.fromEnvironment('API_URL', defaultValue: 'https://api.creche.dz/api/v1'),
                        onSessionExpired: _onSessionExpired,
                      ),
                  onAuthenticated: () => setState(() {
                    _authenticated = true;
                  }),
                ),
    );
  }
}

class DirectorHome extends StatefulWidget {
  const DirectorHome({
    super.key,
    required this.api,
    required this.cache,
    required this.onLogout,
    required this.push,
  });

  final DirectorApiClient api;
  final CacheService cache;
  final Future<void> Function() onLogout;
  final PushService push;

  @override
  State<DirectorHome> createState() => _DirectorHomeState();
}

class _DirectorHomeState extends State<DirectorHome> {
  int _index = 0;
  int _unread = 0;
  StreamSubscription<Map<String, dynamic>>? _pushSub;

  @override
  void initState() {
    super.initState();
    // M1 : push entrant → SnackBar + badge « Plus »
    _pushSub = widget.push.onMessage.listen(_onPushMessage);
    // M1 : enregistrement du FCM token côté API (POST /devices)
    _registerFcmToken();
  }

  @override
  void dispose() {
    _pushSub?.cancel();
    super.dispose();
  }

  void _onPushMessage(Map<String, dynamic> payload) {
    if (!mounted) return;
    setState(() => _unread++);
    final title = (payload['title'] as String?) ?? 'Notification direction';
    final body = (payload['body'] as String?) ?? '';
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(body.isEmpty ? title : '$title — $body')),
    );
  }

  Future<void> _registerFcmToken() async {
    try {
      final token = await widget.push.getToken();
      if (token == null) return; // config Firebase absente → rien à enregistrer
      await widget.api.registerDevice(
        name: 'Appareil Direction',
        deviceFingerprint: await _deviceFingerprint(),
        platform: defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android',
        appVersion: '0.2.0', // pubspec.yaml
        fcmToken: token,
      );
    } catch (e) {
      debugPrint('Enregistrement device/FCM ignoré : $e');
    }
  }

  /// Empreinte stable locale (uuid v4 persisté) — conforme au contrat
  /// `device_fingerprint` (>= 8 car.) de POST /devices.
  Future<String> _deviceFingerprint() async {
    final prefs = await SharedPreferences.getInstance();
    const key = 'director_device_fingerprint';
    var fp = prefs.getString(key);
    if (fp == null || fp.isEmpty) {
      fp = const Uuid().v4();
      await prefs.setString(key, fp);
    }
    return fp;
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      DashboardPage(api: widget.api, cache: widget.cache),
      AttendancePage(api: widget.api),
      BillingPage(api: widget.api),
      StaffPage(api: widget.api),
      MorePage(api: widget.api, onLogout: widget.onLogout),
    ];

    final titles = ['Tableau de bord', 'Présences', 'Facturation', 'Personnel', 'Plus'];

    return Scaffold(
      appBar: AppBar(
        title: Text(titles[_index]),
        actions: [
          if (_index != 4)
            IconButton(
              icon: const Icon(Icons.logout),
              onPressed: () => widget.onLogout(),
              tooltip: 'Déconnexion',
            ),
        ],
      ),
      body: pages[_index],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() {
          _index = i;
          if (i == 4) _unread = 0; // badge remis à zéro à l'ouverture de « Plus »
        }),
        destinations: [
          const NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Dashboard'),
          const NavigationDestination(icon: Icon(Icons.how_to_reg_outlined), selectedIcon: Icon(Icons.how_to_reg), label: 'Présences'),
          const NavigationDestination(icon: Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long), label: 'Factures'),
          const NavigationDestination(icon: Icon(Icons.groups_outlined), selectedIcon: Icon(Icons.groups), label: 'Staff'),
          NavigationDestination(
            icon: Badge(isLabelVisible: _unread > 0, label: Text('$_unread'), child: const Icon(Icons.more_horiz)),
            selectedIcon: Badge(isLabelVisible: _unread > 0, label: Text('$_unread'), child: const Icon(Icons.more_horiz)),
            label: 'Plus',
          ),
        ],
      ),
    );
  }
}
