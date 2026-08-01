import 'package:dio/dio.dart';

/// Client API — Dio avec interception du refresh token (rotation).
class ApiClient {
  ApiClient({String? baseUrl})
      : _dio = Dio(BaseOptions(
          baseUrl: baseUrl ?? const String.fromEnvironment('API_URL', defaultValue: 'https://api.creche.dz/api/v1'),
          connectTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 15),
          headers: {'content-type': 'application/json'},
        )) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final token = _accessToken;
          if (token != null) {
            options.headers['authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          // 401 → tentative de refresh une seule fois, puis retry.
          if (error.response?.statusCode == 401 && !_refreshing && _onRefresh != null) {
            _refreshing = true;
            try {
              final ok = await _onRefresh!();
              if (ok) {
                final opts = error.requestOptions;
                final response = await _dio.fetch(opts);
                return handler.resolve(response);
              }
            } finally {
              _refreshing = false;
            }
          }
          handler.next(error);
        },
      ),
    );
  }

  final Dio _dio;
  bool _refreshing = false;

  /// Posé par le SyncEngine/le shell après restauration de session.
  Future<bool> Function()? _onRefresh;
  String? _accessToken;

  set accessToken(String? token) => _accessToken = token;
  set onRefresh(Future<bool> Function()? fn) => _onRefresh = fn;

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) async {
    final res = await _dio.get<T>(path, queryParameters: query);
    return res.data!;
  }

  Future<T> post<T>(String path, [Object? body]) async {
    final res = await _dio.post<T>(path, data: body);
    return res.data!;
  }

  Future<T> patch<T>(String path, [Object? body]) async {
    final res = await _dio.patch<T>(path, data: body);
    return res.data!;
  }

  Future<void> delete(String path) async {
    await _dio.delete(path);
  }
}
