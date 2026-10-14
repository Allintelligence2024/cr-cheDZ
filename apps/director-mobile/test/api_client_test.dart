import 'package:director_mobile/core/api_client.dart';
import 'package:director_mobile/core/cache_service.dart';
import 'package:director_mobile/core/error_state.dart';
import 'package:director_mobile/core/token_store.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('TokenStore save and clear', () async {
    final store = InMemoryTokenStore();
    await store.save('access123', 'refresh123');
    expect(await store.readAccess(), 'access123');
    expect(await store.readRefresh(), 'refresh123');
    await store.clear();
    expect(await store.readAccess(), isNull);
    expect(await store.readRefresh(), isNull);
  });

  test('mapDioError offline', () {
    final err = DioException(
      requestOptions: RequestOptions(path: '/test'),
      type: DioExceptionType.connectionError,
    );
    final mapped = mapDioError(err);
    expect(mapped.isOffline, true);
    expect(mapped.kind, 'offline');
  });

  test('mapDioError 401 unauthorized', () {
    final err = DioException(
      requestOptions: RequestOptions(path: '/test'),
      response: Response(requestOptions: RequestOptions(path: '/test'), statusCode: 401, data: {'message_fr': 'Non autorisé'}),
      type: DioExceptionType.badResponse,
    );
    final mapped = mapDioError(err);
    expect(mapped.isUnauthorized, true);
    expect(mapped.statusCode, 401);
  });

  test('DirectorApiClient construction', () {
    final store = InMemoryTokenStore();
    final client = DirectorApiClient('https://api.test/api/v1', store: store);
    expect(client, isNotNull);
    client.close();
  });

  test('CacheService exists', () async {
    expect(CacheService, isNotNull);
  });

  test('DirectorApiClient has all endpoints V1+V2', () {
    final store = InMemoryTokenStore();
    final client = DirectorApiClient('https://api.test/api/v1', store: store);
    expect(client.dashboard, isA<Function>());
    expect(client.attendanceSummary, isA<Function>());
    expect(client.attendanceRatios, isA<Function>());
    expect(client.agedBalance, isA<Function>());
    expect(client.invoices, isA<Function>());
    expect(client.children, isA<Function>());
    expect(client.staffProfiles, isA<Function>());
    expect(client.staffCoverage, isA<Function>());
    expect(client.journalEvents, isA<Function>());
    expect(client.payrollRuns, isA<Function>());
    expect(client.notifications, isA<Function>());
    expect(client.attestations, isA<Function>());
    expect(client.sites, isA<Function>());
    expect(client.rooms, isA<Function>());
    expect(client.exports, isA<Function>());
    expect(client.organizations, isA<Function>());
    expect(client.videoCameras, isA<Function>());
    // V2.3 write
    expect(client.createChild, isA<Function>());
    expect(client.updateChildRoom, isA<Function>());
    expect(client.checkInChild, isA<Function>());
    expect(client.checkOutChild, isA<Function>());
    expect(client.markAbsent, isA<Function>());
    expect(client.createJournalEvent, isA<Function>());
    expect(client.staffCheckIn, isA<Function>());
    expect(client.staffCheckOut, isA<Function>());
    expect(client.payInvoiceCash, isA<Function>());
    expect(client.payInvoiceOnline, isA<Function>());
    expect(client.generateInvoices, isA<Function>());
    // Analytics (MERGE_HEAD)
    expect(client.analyticsOverview, isA<Function>());
    expect(client.analyticsAttendance, isA<Function>());
    expect(client.analyticsBilling, isA<Function>());
    expect(client.analyticsRevenue, isA<Function>());
    expect(client.analyticsOccupancy, isA<Function>());
    expect(client.analyticsRatios, isA<Function>());
    client.close();
  });
}
