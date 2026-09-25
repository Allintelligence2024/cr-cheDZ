import 'dart:typed_data';

import 'package:dio/dio.dart';

import 'token_store.dart';

/// La session a expiré **et** le refresh a échoué : les jetons sont purgés, le
/// parent doit se reconnecter (OTP). Distinct d'une erreur réseau : l'UI ne doit
/// pas proposer « Réessayer » mais renvoyer vers la connexion.
class ParentSessionExpired implements Exception {
  const ParentSessionExpired();

  @override
  String toString() => 'ParentSessionExpired';
}

/// Erreur d'appel présentable à l'utilisateur.
///
/// `isOffline` distingue « pas de réseau » (le parent peut réessayer) de
/// « le serveur a refusé » — sans cette distinction, l'app affichait le même
/// texte pour une coupure et pour un 500 (audit 2026-09-24, item C2).
class ParentApiException implements Exception {
  const ParentApiException(this.kind, {this.statusCode});

  /// `offline` | `unauthorized` | `server`.
  final String kind;
  final int? statusCode;

  bool get isOffline => kind == 'offline';

  @override
  String toString() => 'ParentApiException($kind, status=$statusCode)';
}

/// Client parent.
///
/// Correctif L3 (audit 2026-09-24, item C2) : l'access token dure 15 minutes et
/// **rien ne le renouvelait** — passé ce délai, chaque appel rendait 401 et
/// l'application restait inutilisable jusqu'à une reconnexion manuelle. Ce
/// client pose donc un intercepteur qui, sur 401, rafraîchit la session **une
/// seule fois** puis rejoue la requête.
///
/// Le rafraîchissement est *single-flight* : plusieurs appels simultanés qui
/// reçoivent 401 partagent **la même** requête de refresh. Un simple drapeau
/// booléen (patron employé côté staff-mobile) laisserait les appels concurrents
/// échouer en 401 pendant que le refresh est en cours — c'est précisément le cas
/// d'un écran qui charge plusieurs ressources à l'ouverture.
class ParentApiClient {
  ParentApiClient(
    String baseUrl, {
    ParentTokenStore? store,
    void Function()? onSessionExpired,
  })  : _store = store ?? SecureTokenStore(),
        _onSessionExpired = onSessionExpired,
        _dio = Dio(
          BaseOptions(
            baseUrl: baseUrl,
            connectTimeout: const Duration(seconds: 10),
            receiveTimeout: const Duration(seconds: 15),
            headers: {'content-type': 'application/json'},
          ),
        ) {
    _dio.interceptors.add(
      InterceptorsWrapper(onError: (error, handler) async {
        await _handleUnauthorized(error, handler);
      }),
    );
  }

  static const _refreshPath = '/auth/refresh';
  static const _retriedKey = 'parent_session_retried';

  final Dio _dio;
  final ParentTokenStore _store;
  final void Function()? _onSessionExpired;

  /// Réservé aux TESTS : branche un adaptateur HTTP simulé (aucune socket).
  /// L'appelant garde `baseUrl`, délais et intercepteurs du client réel.
  set httpClientAdapter(HttpClientAdapter adapter) {
    _dio.httpClientAdapter = adapter;
  }

  /// Refresh en cours — partagé par tous les appels qui reçoivent 401.
  Future<void>? _refreshInFlight;

  Future<void> saveSession(Map<String, dynamic> session) async {
    await _store.saveSession(
      session['access_token'] as String?,
      session['refresh_token'] as String?,
    );
  }

  Future<void> clearSession() => _store.clear();

  Future<Map<String, dynamic>> requestOtp(String phone) async {
    final res = await _guard(
      () => _dio.post<Map<String, dynamic>>(
        '/auth/parent/otp/request',
        data: {'phone': phone},
      ),
    );
    return res.data ?? const <String, dynamic>{};
  }

  Future<Map<String, dynamic>> verifyOtp(String phone, String code) async {
    final res = await _guard(
      () => _dio.post<Map<String, dynamic>>(
        '/auth/parent/otp/verify',
        data: {'phone': phone, 'code': code},
      ),
    );
    return res.data ?? const <String, dynamic>{};
  }

  Future<List<dynamic>> children() async {
    final res = await _guard(() => _authedGet('/parent/children'));
    return res.data as List<dynamic>? ?? const <dynamic>[];
  }

  Future<List<dynamic>> feed(String childId) async {
    final res = await _guard(
      () => _authedGet('/parent/children/$childId/feed'),
    );
    return res.data as List<dynamic>? ?? const <dynamic>[];
  }

  Future<void> absence(String childId, {String? reason}) async {
    await _guard(
      () => _authedPost('/parent/absence', {
        'child_id': childId,
        if (reason != null) 'reason': reason,
      }),
    );
  }

  Future<List<dynamic>> photos(String childId) async {
    final res = await _guard(
      () => _authedGet('/parent/children/$childId/media'),
    );
    return res.data as List<dynamic>? ?? const <dynamic>[];
  }

  Future<List<dynamic>> consents(String childId) async {
    final res = await _guard(
      () => _authedGet('/parent/children/$childId/consents'),
    );
    return res.data as List<dynamic>? ?? const <dynamic>[];
  }

  Future<void> saveConsent(String childId, String type, bool granted) async {
    await _guard(
      () => _authedPost('/parent/consents', {
        'child_id': childId,
        'consent_type': type,
        'granted': granted,
      }),
    );
  }

  Future<List<dynamic>> preferences() async {
    final res = await _guard(
      () => _authedGet('/parent/notification-preferences'),
    );
    return res.data as List<dynamic>? ?? const <dynamic>[];
  }

  Future<void> savePreference(
    String eventType,
    bool enabled, {
    String? start,
    String? end,
  }) async {
    await _guard(
      () => _authedPost('/parent/notification-preferences', {
        'event_type': eventType,
        'is_enabled': enabled,
        if (start != null) 'quiet_hours_start': start,
        if (end != null) 'quiet_hours_end': end,
      }),
    );
  }

  /// Contenu binaire d'une photo (LOT 2 — P0 F5).
  ///
  /// L'API ne renvoie plus d'URL signée MinIO (injoignable depuis un
  /// téléphone : MinIO est lié à 127.0.0.1 en production) mais un chemin
  /// same-origin `/parent/children/<child>/media/<id>/content`. Ce chemin
  /// exige l'en-tête Authorization : Flutter ne peut donc pas l'afficher avec
  /// `Image.network(url)` seul — les octets sont récupérés ici, déjà soumis
  /// aux contrôles serveur (filiation + consentement photo courant).
  Future<Uint8List> photoContent(String childId, String mediaId) async {
    // Jeton lu AVANT la fermeture : un `await` dans une lambda non-async ne
    // compile pas (erreur attrapée par la CI : `parent-mobile — tests`).
    final headers = await _authHeaders();
    final res = await _guard(
      () => _dio.get<List<int>>(
        '/parent/children/$childId/media/$mediaId/content',
        options: Options(headers: headers, responseType: ResponseType.bytes),
      ),
    );
    return Uint8List.fromList(res.data ?? const <int>[]);
  }

  /// 401 → un seul refresh partagé → rejeu de la requête initiale.
  ///
  /// Aucune boucle possible : un rejeu est marqué (`_retriedKey`) et la route de
  /// refresh elle-même ne déclenche jamais de refresh (sinon, un refresh refusé
  /// relancerait un refresh à l'infini).
  Future<void> _handleUnauthorized(
    DioException error,
    ErrorInterceptorHandler handler,
  ) async {
    final request = error.requestOptions;
    final isUnauthorized = error.response?.statusCode == 401;
    final alreadyRetried = request.extra[_retriedKey] == true;
    final isRefreshCall = request.path == _refreshPath;

    if (!isUnauthorized || alreadyRetried || isRefreshCall) {
      handler.next(error);
      return;
    }

    try {
      await _refreshSession();
    } on ParentSessionExpired {
      // Session morte : on remonte une erreur TYPÉE (l'UI renvoie vers la
      // connexion au lieu de proposer « Réessayer » indéfiniment).
      handler.reject(
        DioException(
          requestOptions: request,
          error: const ParentSessionExpired(),
        ),
      );
      return;
    }

    try {
      final options = request
        ..headers['authorization'] = 'Bearer ${await _store.readAccessToken()}'
        ..extra[_retriedKey] = true;
      final response = await _dio.fetch<dynamic>(options);
      handler.resolve(response);
    } on DioException catch (retryError) {
      handler.next(retryError);
    }
  }

  /// Single-flight : le premier appel lance le refresh, les suivants attendent
  /// **le même** futur (aucun n'échoue en 401 « le temps que ça se termine »).
  Future<void> _refreshSession() {
    final inFlight = _refreshInFlight;
    if (inFlight != null) {
      return inFlight;
    }
    final future = _performRefresh();
    _refreshInFlight = future;
    return future.whenComplete(() {
      _refreshInFlight = null;
    });
  }

  Future<void> _performRefresh() async {
    final refreshToken = await _store.readRefreshToken();
    if (refreshToken == null || refreshToken.isEmpty) {
      await _expireSession();
      throw const ParentSessionExpired();
    }
    try {
      final res = await _dio.post<Map<String, dynamic>>(
        _refreshPath,
        data: {'refresh_token': refreshToken},
      );
      final data = res.data ?? const <String, dynamic>{};
      // Rotation : le serveur émet un NOUVEAU refresh token (G1b) — le garder
      // est obligatoire, sinon le prochain refresh échoue avec l'ancien.
      await _store.saveSession(
        data['access_token'] as String?,
        data['refresh_token'] as String?,
      );
    } on DioException {
      await _expireSession();
      throw const ParentSessionExpired();
    }
  }

  Future<void> _expireSession() async {
    await _store.clear();
    _onSessionExpired?.call();
  }

  Future<Map<String, String>> _authHeaders() async => {
        'authorization': 'Bearer ${await _store.readAccessToken()}',
      };

  Future<Response<dynamic>> _authedGet(String path) async {
    return _dio.get<dynamic>(path, options: Options(headers: await _authHeaders()));
  }

  Future<Response<dynamic>> _authedPost(
    String path,
    Map<String, dynamic> body,
  ) async {
    return _dio.post<dynamic>(
      path,
      data: body,
      options: Options(headers: await _authHeaders()),
    );
  }

  /// Convertit l'erreur de transport en erreur d'UI, en laissant passer
  /// `ParentSessionExpired` (qui n'est pas un « réessayez »).
  Future<Response<T>> _guard<T>(Future<Response<T>> Function() body) async {
    try {
      return await body();
    } on ParentSessionExpired {
      rethrow;
    } on DioException catch (error) {
      if (error.error is ParentSessionExpired) {
        throw const ParentSessionExpired();
      }
      final status = error.response?.statusCode;
      if (status == 401) {
        // 401 sans refresh possible : la session est morte, pas le réseau.
        throw const ParentApiException('unauthorized', statusCode: 401);
      }
      final offline = error.type == DioExceptionType.connectionError ||
          error.type == DioExceptionType.connectionTimeout ||
          error.type == DioExceptionType.receiveTimeout ||
          error.type == DioExceptionType.sendTimeout;
      throw ParentApiException(
        offline ? 'offline' : 'server',
        statusCode: status,
      );
    }
  }
}
