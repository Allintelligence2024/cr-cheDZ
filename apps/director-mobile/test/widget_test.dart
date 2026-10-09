import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:director_mobile/core/api_client.dart';
import 'package:director_mobile/core/cache_service.dart';
import 'package:director_mobile/core/token_store.dart';
import 'package:director_mobile/features/analytics/analytics_page.dart';
import 'package:director_mobile/features/auth/login_page.dart';
import 'package:director_mobile/features/dashboard/dashboard_page.dart';
import 'package:director_mobile/features/billing/billing_page.dart';
import 'package:director_mobile/features/attendance/attendance_page.dart';
import 'package:director_mobile/features/staff/staff_page.dart';
import 'package:director_mobile/features/more/more_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Garde-fou : si une requête échappait à l'intercepteur de test, elle
/// jetterait ici au lieu d'ouvrir une socket réelle.
class _NoRequestAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) {
    throw StateError('no request expected');
  }

  @override
  void close({bool force = false}) {}
}

/// Intercepteur de test : la requête reste EN ATTENTE (le handler n'est
/// jamais résolu). Deux raisons :
/// 1. `Dio.fetch` démarre par `Future(() => …)` — un timer de durée nulle
///    dans la zone de test (`FakeTimer`) ; le seul `pump(Duration.zero)` des
///    tests le consomme, et plus aucun timer n'apparaît tant que la requête
///    n'est pas envoyée (aucune socket, aucun timeout Dio planifié).
/// 2. Les pages restent dans leur état `_loading`, ce que les tests vérifient.
class _HangingInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    // volontairement aucune réponse : requête en attente
  }
}

/// Client direction hors-ligne pour les tests widget : toute requête HTTP
/// échoue immédiatement via l'adaptateur (aucune socket, aucun timer réseau
/// planifié dans la zone de test), exactement comme le `_FakeApi` de
/// parent-mobile — mais sans jamais répondre 200, pour que les pages
/// restent sur leur état de chargement / d'erreur.
class _StubDirectorApi extends DirectorApiClient {
  _StubDirectorApi() : super('https://api.test/api/v1', store: InMemoryTokenStore()) {
    dio.interceptors.add(_HangingInterceptor());
    httpClientAdapter = _NoRequestAdapter();
  }
}

DirectorApiClient _offlineApi() => _StubDirectorApi();

/// Monte une page et laisse filer le timer de durée nulle de `Dio.fetch`
/// (aucun envoi réseau : la requête reste en attente chez l'intercepteur).
Future<void> _pumpPage(WidgetTester tester, Widget page) async {
  await tester.pumpWidget(MaterialApp(home: page));
  await tester.pump(Duration.zero);
}

void main() {
  testWidgets('LoginPage renders', (tester) async {
    final api = _offlineApi();
    addTearDown(api.close);

    await tester.pumpWidget(
      MaterialApp(
        home: LoginPage(api: api, onAuthenticated: () {}),
      ),
    );

    expect(find.textContaining('Direction'), findsOneWidget);
    expect(find.byType(TextField), findsWidgets);
    expect(find.text('Se connecter'), findsOneWidget);
  });

  testWidgets('DashboardPage loading state', (tester) async {
    final api = _offlineApi();
    addTearDown(api.close);
    final cache = CacheService();

    await _pumpPage(tester, DashboardPage(api: api, cache: cache));

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('BillingPage loading state', (tester) async {
    final api = _offlineApi();
    addTearDown(api.close);

    await _pumpPage(tester, BillingPage(api: api));

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('AttendancePage loading state', (tester) async {
    final api = _offlineApi();
    addTearDown(api.close);

    await _pumpPage(tester, AttendancePage(api: api));

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('StaffPage loading state', (tester) async {
    final api = _offlineApi();
    addTearDown(api.close);

    await _pumpPage(tester, StaffPage(api: api));

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('MorePage renders grid', (tester) async {
    final api = _offlineApi();
    addTearDown(api.close);
    // La grille 3 colonnes fait 4 rangées (12 entrées) : la fenêtre de test
    // par défaut (800x600) ne construit pas les derniers items.
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        home: MorePage(api: api, onLogout: () async {}),
      ),
    );
    await tester.pump(Duration.zero);

    expect(find.text('Enfants'), findsOneWidget);
    expect(find.text('Couverture'), findsOneWidget);
    expect(find.text('Personnel'), findsOneWidget);
    expect(find.text('Paramètres'), findsOneWidget);
    expect(find.textContaining('Direction'), findsWidgets);
  });

  testWidgets('AnalyticsPage loading state', (tester) async {
    final api = _offlineApi();
    addTearDown(api.close);

    await _pumpPage(tester, AnalyticsPage(api: api));

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
