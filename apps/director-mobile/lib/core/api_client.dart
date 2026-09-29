import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import 'error_state.dart';
import 'token_store.dart';

/// Client API direction — online-first, refresh single-flight (comme parent-mobile).
///
/// - BaseUrl depuis --dart-define API_URL, défaut prod HTTPS
/// - Intercepteur 401 → refresh une fois puis rejoue
/// - Single-flight : plusieurs 401 concurrents partagent le même refresh
/// - Si refresh échoue → purge + callback onSessionExpired → retour login
class DirectorApiClient {
  DirectorApiClient(
    String baseUrl, {
    DirectorTokenStore? store,
    void Function()? onSessionExpired,
  })  : _store = store ?? SecureTokenStore(),
        _onSessionExpired = onSessionExpired,
        _dio = Dio(
          BaseOptions(
            baseUrl: baseUrl,
            connectTimeout: const Duration(seconds: 10),
            receiveTimeout: const Duration(seconds: 20),
            headers: {'content-type': 'application/json'},
          ),
        ) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await _store.readAccess();
          if (token != null && token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          await _handleUnauthorized(error, handler);
        },
      ),
    );
  }

  static const _refreshPath = '/auth/refresh';
  static const _retriedKey = 'director_retried';

  final Dio _dio;

  @visibleForTesting
  Dio get dio => _dio;
  final DirectorTokenStore _store;
  final void Function()? _onSessionExpired;

  Future<void>? _refreshInFlight;

  set httpClientAdapter(HttpClientAdapter adapter) {
    _dio.httpClientAdapter = adapter;
  }

  Future<void> saveSession(Map<String, dynamic> session) async {
    final access = session['access_token'] as String?;
    final refresh = session['refresh_token'] as String?;
    if (access == null || refresh == null) throw const FormatException('Session invalide');
    await _store.save(access, refresh);
  }

  Future<void> clearSession() => _store.clear();

  Future<T> _withErrorMapping<T>(Future<T> Function() fn) async {
    try {
      return await fn();
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  // Auth
  Future<Map<String, dynamic>> login(String email, String password, {String? totpCode}) async {
    return _withErrorMapping(() async {
      final res = await _dio.post<Map<String, dynamic>>('/auth/login', data: {
        'email': email,
        'password': password,
        if (totpCode != null && totpCode.isNotEmpty) 'totp_code': totpCode,
      });
      final data = res.data!;
      // Le serveur peut répondre 200 avec access/refresh OU demander TOTP
      if (data['access_token'] != null) {
        await saveSession(data);
      }
      return data;
    });
  }

  Future<void> logout() async {
    try {
      await _dio.post('/auth/logout');
    } catch (_) {
      // best effort
    }
    await clearSession();
  }

  // Core API
  Future<Map<String, dynamic>> me() => _getMap('/auth/me');
  Future<Map<String, dynamic>> dashboard() => _getMap('/dashboard/summary');
  Future<Map<String, dynamic>> attendanceSummary({String? date}) => _getMap('/attendance/summary', query: {if (date != null) 'date': date});
  Future<Map<String, dynamic>> attendanceRatios() => _getMap('/attendance/ratios');
  Future<Map<String, dynamic>> agedBalance() => _getMap('/billing/invoices/aged-balance');
  Future<List<dynamic>> invoices({String? status, int page = 1, int limit = 20}) => _getList('/billing/invoices', query: {
        if (status != null) 'status': status,
        'page': page,
        'limit': limit,
      });
  Future<Map<String, dynamic>> invoiceDetail(String id) => _getMap('/billing/invoices/$id');
  Future<Map<String, dynamic>> sendInvoice(String id) => _postMap('/billing/invoices/$id/send', {});
  Future<Map<String, dynamic>> markOverdue(String id) => _postMap('/billing/invoices/$id/mark-overdue', {});
  Future<Map<String, dynamic>> addReminder(String id, Map<String, dynamic> body) => _postMap('/billing/invoices/$id/reminders', body);
  Future<List<dynamic>> children({String? search, String? roomId}) => _getList('/children', query: {
        if (search != null && search.isNotEmpty) 'search': search,
        if (roomId != null) 'room_id': roomId,
      });
  Future<Map<String, dynamic>> childDetail(String id) => _getMap('/children/$id');
  Future<List<dynamic>> staffProfiles() => _getList('/staff/profiles');
  Future<List<dynamic>> staffDocumentsExpiring() => _getList('/staff/documents/expiring', query: {'days': 30});
  Future<Map<String, dynamic>> staffCoverage({required String date}) => _getMap('/staff/schedule/coverage', query: {'date': date});
  Future<List<dynamic>> staffSchedule({required String from, required String to, String? siteId}) => _getList('/staff/schedule', query: {
        'from': from,
        'to': to,
        if (siteId != null) 'site_id': siteId,
      });
  Future<List<dynamic>> journalEvents({String? date, String? childId, String? type}) => _getList('/journal/events', query: {
        if (date != null) 'date': date,
        if (childId != null) 'child_id': childId,
        if (type != null) 'event_type': type,
      });
  Future<List<dynamic>> payrollRuns({String? month}) => _getList('/payroll/runs', query: {if (month != null) 'month': month});
  Future<Map<String, dynamic>> payrollRunDetail(String id) => _getMap('/payroll/runs/$id');
  Future<List<dynamic>> notifications() => _getList('/notifications/inbox');
  Future<List<dynamic>> attestations() => _getList('/attestations');
  Future<List<dynamic>> sites() => _getList('/sites');
  Future<List<dynamic>> rooms() => _getList('/rooms');
  Future<Map<String, dynamic>> orgSettings() => _getMap('/organizations/me/settings');
  Future<Map<String, dynamic>> orgDetails() => _getMap('/organizations/me');
  Future<List<dynamic>> exports() => _getList('/exports');
  Future<Map<String, dynamic>> exportDetail(String id) => _getMap('/exports/$id');
  Future<Map<String, dynamic>> payrollRunDetailFull(String id) => _getMap('/payroll/runs/$id');
  Future<List<dynamic>> payrollEntries(String runId) => _getList('/payroll/runs/$runId/entries');
  Future<List<dynamic>> complianceChecks() => _getList('/compliance/checks');
  Future<Map<String, dynamic>> generateInvoices(Map<String, dynamic> body) => _postMap('/billing/invoices/generate', body);
  Future<Map<String, dynamic>> attestationDetail(String id) => _getMap('/attestations/$id');
  Future<List<dynamic>> childrenAttendance(String childId, {String? from, String? to}) => _getList('/children/$childId/attendance', query: {
        if (from != null) 'from': from,
        if (to != null) 'to': to,
      });
  Future<Map<String, dynamic>> dashboardSummaryWithCache({String? siteId}) => _getMap('/dashboard/summary', query: {if (siteId != null) 'site_id': siteId});
  Future<List<dynamic>> organizations() => _getList('/organizations');
  Future<List<dynamic>> videoCameras() => _getList('/video/cameras');
  Future<List<dynamic>> videoClips({String? cameraId}) => _getList('/video/clips', query: {if (cameraId != null) 'camera_id': cameraId});

  // V2.3 — écritures
  Future<Map<String, dynamic>> createChild(Map<String, dynamic> body) => _postMap('/children', body);
  Future<Map<String, dynamic>> updateChildRoom(String childId, String roomId) => _postMap('/children/$childId/room-moves', {'room_id': roomId});
  Future<Map<String, dynamic>> checkInChild(Map<String, dynamic> body) => _postMap('/attendance/check-in', body);
  Future<Map<String, dynamic>> checkOutChild(Map<String, dynamic> body) => _postMap('/attendance/check-out', body);
  Future<Map<String, dynamic>> markAbsent(Map<String, dynamic> body) => _postMap('/attendance/mark-absent', body);
  Future<Map<String, dynamic>> createJournalEvent(Map<String, dynamic> body) => _postMap('/journal/events', body);
  Future<Map<String, dynamic>> staffCheckIn(Map<String, dynamic> body) => _postMap('/staff/attendance/check-in', body);
  Future<Map<String, dynamic>> staffCheckOut(Map<String, dynamic> body) => _postMap('/staff/attendance/check-out', body);
  Future<Map<String, dynamic>> payInvoice(String id, Map<String, dynamic> body) => _postMap('/billing/invoices/$id/payments', body);

  // Helpers
  Future<Map<String, dynamic>> _getMap(String path, {Map<String, dynamic>? query}) => _withErrorMapping(() async {
        final res = await _dio.get<Map<String, dynamic>>(path, queryParameters: query);
        return res.data ?? {};
      });

  Future<List<dynamic>> _getList(String path, {Map<String, dynamic>? query}) => _withErrorMapping(() async {
        final res = await _dio.get(path, queryParameters: query);
        final data = res.data;
        if (data is List) return data;
        if (data is Map && data['data'] is List) return data['data'] as List;
        if (data is Map && data['items'] is List) return data['items'] as List;
        return [];
      });

  Future<Map<String, dynamic>> _postMap(String path, Map<String, dynamic> body) => _withErrorMapping(() async {
        final res = await _dio.post<Map<String, dynamic>>(path, data: body);
        return res.data ?? {};
      });

  Future<void> _handleUnauthorized(DioException error, ErrorInterceptorHandler handler) async {
    final status = error.response?.statusCode;
    if (status != 401) {
      handler.next(error);
      return;
    }
    final request = error.requestOptions;
    if (request.extra[_retriedKey] == true) {
      // Déjà retenté → session expirée
      await _store.clear();
      _onSessionExpired?.call();
      handler.next(error);
      return;
    }
    if (request.path.contains(_refreshPath)) {
      // Refresh lui-même en 401 → purge
      await _store.clear();
      _onSessionExpired?.call();
      handler.next(error);
      return;
    }

    try {
      await (_refreshInFlight ??= _performRefresh());
      // Refresh OK → rejoue la requête originale
      final newToken = await _store.readAccess();
      if (newToken == null) {
        await _store.clear();
        _onSessionExpired?.call();
        handler.next(error);
        return;
      }
      final opts = Options(
        method: request.method,
        headers: Map<String, dynamic>.from(request.headers)..['Authorization'] = 'Bearer $newToken',
        extra: Map<String, dynamic>.from(request.extra)..[_retriedKey] = true,
      );
      final clone = await _dio.request<dynamic>(
        request.path,
        data: request.data,
        queryParameters: request.queryParameters,
        options: opts,
      );
      handler.resolve(clone);
    } catch (e) {
      if (e is DioException) {
        await _store.clear();
        _onSessionExpired?.call();
        handler.next(e);
      } else {
        handler.next(error);
      }
    } finally {
      _refreshInFlight = null;
    }
  }

  Future<void> _performRefresh() async {
    final refresh = await _store.readRefresh();
    if (refresh == null || refresh.isEmpty) {
      throw DioException(requestOptions: RequestOptions(path: _refreshPath), response: Response(requestOptions: RequestOptions(path: _refreshPath), statusCode: 401));
    }
    final res = await _dio.post<Map<String, dynamic>>(_refreshPath, data: {'refresh_token': refresh});
    final data = res.data;
    if (data == null || data['access_token'] == null || data['refresh_token'] == null) {
      throw const FormatException('Refresh invalide');
    }
    await _store.save(data['access_token'] as String, data['refresh_token'] as String);
  }

  void close() => _dio.close();
}
