import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/api_client.dart';
import 'core/cache_service.dart';
import 'core/token_store.dart';
import 'features/attendance/attendance_page.dart';
import 'features/auth/login_page.dart';
import 'features/billing/billing_page.dart';
import 'features/dashboard/dashboard_page.dart';
import 'features/more/more_page.dart';
import 'features/staff/staff_page.dart';
import 'theme/serenite_theme.dart';

void main() => runApp(const DirectorApp());

class DirectorApp extends StatefulWidget {
  const DirectorApp({super.key});

  @override
  State<DirectorApp> createState() => _DirectorAppState();
}

class _DirectorAppState extends State<DirectorApp> {
  DirectorApiClient? _api;
  final _cache = CacheService();
  bool _authenticated = false;
  bool _checking = true;
  int _epoch = 0;

  @override
  void initState() {
    super.initState();
    _bootstrap();
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
  const DirectorHome({super.key, required this.api, required this.cache, required this.onLogout});

  final DirectorApiClient api;
  final CacheService cache;
  final Future<void> Function() onLogout;

  @override
  State<DirectorHome> createState() => _DirectorHomeState();
}

class _DirectorHomeState extends State<DirectorHome> {
  int _index = 0;

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
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Dashboard'),
          NavigationDestination(icon: Icon(Icons.how_to_reg_outlined), selectedIcon: Icon(Icons.how_to_reg), label: 'Présences'),
          NavigationDestination(icon: Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long), label: 'Factures'),
          NavigationDestination(icon: Icon(Icons.groups_outlined), selectedIcon: Icon(Icons.groups), label: 'Staff'),
          NavigationDestination(icon: Icon(Icons.more_horiz), selectedIcon: Icon(Icons.more_horiz), label: 'Plus'),
        ],
      ),
    );
  }
}
