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

void main() {
  testWidgets('LoginPage renders', (tester) async {
    final store = InMemoryTokenStore();
    final api = DirectorApiClient('https://api.test/api/v1', store: store);

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
    final store = InMemoryTokenStore();
    final api = DirectorApiClient('https://api.test/api/v1', store: store);
    final cache = CacheService();

    await tester.pumpWidget(
      MaterialApp(
        home: DashboardPage(api: api, cache: cache),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('BillingPage loading state', (tester) async {
    final store = InMemoryTokenStore();
    final api = DirectorApiClient('https://api.test/api/v1', store: store);

    await tester.pumpWidget(
      MaterialApp(
        home: BillingPage(api: api),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('AttendancePage loading state', (tester) async {
    final store = InMemoryTokenStore();
    final api = DirectorApiClient('https://api.test/api/v1', store: store);

    await tester.pumpWidget(
      MaterialApp(
        home: AttendancePage(api: api),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('StaffPage loading state', (tester) async {
    final store = InMemoryTokenStore();
    final api = DirectorApiClient('https://api.test/api/v1', store: store);

    await tester.pumpWidget(
      MaterialApp(
        home: StaffPage(api: api),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('MorePage renders grid', (tester) async {
    final store = InMemoryTokenStore();
    final api = DirectorApiClient('https://api.test/api/v1', store: store);

    await tester.pumpWidget(
      MaterialApp(
        home: MorePage(api: api, onLogout: () async {}),
      ),
    );

    expect(find.text('Enfants'), findsOneWidget);
    expect(find.text('Paramètres'), findsOneWidget);
    expect(find.textContaining('Direction'), findsWidgets);
  });

  testWidgets('AnalyticsPage loading state', (tester) async {
    final store = InMemoryTokenStore();
    final api = DirectorApiClient('https://api.test/api/v1', store: store);

    await tester.pumpWidget(
      MaterialApp(
        home: AnalyticsPage(api: api),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
