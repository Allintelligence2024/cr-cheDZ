import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:parent_mobile/core/api_client.dart';
import 'package:parent_mobile/core/token_store.dart';

/// Correctif L3 (audit 2026-09-24, item C2).
///
/// Avant : l'access token dure 15 minutes et rien ne le renouvelait — chaque
/// appel rendait 401 et l'application restait inutilisable. Ces tests tiennent
/// la promesse inverse, **sans réseau ni appareil** : un faux adaptateur HTTP et
/// un magasin de jetons en mémoire.
void main() {
  group('ParentApiClient — renouvellement de session', () {
    test('200 : aucun refresh inutile', () async {
      final fake = _FakeApi();
      final store = _MemoryTokenStore('access-1', 'refresh-1');
      final client = _client(fake, store);

      final children = await client.children();

      expect(children, isEmpty);
      expect(fake.refreshCalls, 0);
      expect(store.accessToken, 'access-1');
    });

    test('401 → un refresh, puis la requête est rejouée avec le nouveau jeton',
        () async {
      final fake = _FakeApi(expiredAccessTokens: {'access-1'});
      final store = _MemoryTokenStore('access-1', 'refresh-1');
      final client = _client(fake, store);

      final children = await client.children();

      expect(children, isEmpty, reason: 'la requête doit aboutir après refresh');
      expect(fake.refreshCalls, 1);
      expect(fake.retriedWith, 'Bearer access-2', reason: 'rejeu avec le jeton neuf');
      expect(store.accessToken, 'access-2');
      // Rotation (G1b) : l'ancien refresh token ne vaut plus rien, il FAUT
      // garder le nouveau — sinon le refresh suivant échoue.
      expect(store.refreshToken, 'refresh-2');
    });

    test('appels simultanés en 401 → UN SEUL refresh (single-flight)', () async {
      final gate = Completer<void>();
      final fake = _FakeApi(expiredAccessTokens: {'access-1'}, gate: gate);
      final store = _MemoryTokenStore('access-1', 'refresh-1');
      final client = _client(fake, store);

      // Cinq écrans/ressources qui se chargent ensemble, tous avec le jeton périmé.
      final pending = List<Future<List<dynamic>>>.generate(5, (_) => client.children());
      await Future<void>.delayed(const Duration(milliseconds: 100));

      expect(fake.refreshCalls, 1,
          reason: 'les 401 concurrents partagent le même refresh (pas un drapeau booléen)');

      gate.complete();
      final results = await Future.wait(pending);
      expect(results, hasLength(5));
      expect(results.every((rows) => rows.isEmpty), isTrue,
          reason: 'aucun appel ne doit rester en échec pendant le refresh');
    });

    test('refresh refusé → session purgée, erreur typée, aucun second essai',
        () async {
      final fake = _FakeApi(expiredAccessTokens: {'access-1'}, refreshFails: true);
      final store = _MemoryTokenStore('access-1', 'refresh-1');
      var expiredCallbacks = 0;
      final client = ParentApiClient(
        'http://parent.test/api/v1',
        store: store,
        onSessionExpired: () => expiredCallbacks++,
      )..httpClientAdapter = fake;

      await expectLater(client.children(), throwsA(isA<ParentSessionExpired>()));

      expect(fake.refreshCalls, 1, reason: 'pas de boucle de refresh');
      expect(store.accessToken, isNull);
      expect(store.refreshToken, isNull, reason: 'la session morte ne reste pas sur le téléphone');
      expect(expiredCallbacks, 1, reason: "l'app doit revenir à l'écran de connexion");
    });

    test('pas de refresh token du tout → session expirée sans appel réseau', () async {
      final fake = _FakeApi();
      final store = _MemoryTokenStore(null, null);
      final client = _client(fake, store);

      await expectLater(client.children(), throwsA(isA<ParentSessionExpired>()));
      expect(fake.refreshCalls, 0);
    });

    test('coupure réseau → erreur « hors-ligne » (réessayable), pas « session »',
        () async {
      final fake = _FakeApi(offline: true);
      final client = _client(fake, _MemoryTokenStore('access-1', 'refresh-1'));

      await expectLater(
        client.children(),
        throwsA(
          isA<ParentApiException>()
              .having((e) => e.isOffline, 'isOffline', isTrue),
        ),
      );
    });

    test('500 serveur → erreur « serveur » (distincte du hors-ligne)', () async {
      final fake = _FakeApi(serverError: true);
      final client = _client(fake, _MemoryTokenStore('access-1', 'refresh-1'));

      await expectLater(
        client.children(),
        throwsA(
          isA<ParentApiException>()
              .having((e) => e.isOffline, 'isOffline', isFalse)
              .having((e) => e.statusCode, 'statusCode', 500),
        ),
      );
    });

    test('le contenu photo suit le même chemin (401 → refresh → octets)', () async {
      final fake = _FakeApi(expiredAccessTokens: {'access-1'}, bytes: const [1, 2, 3]);
      final store = _MemoryTokenStore('access-1', 'refresh-1');
      final client = _client(fake, store);

      final bytes = await client.photoContent('child-1', 'media-1');

      expect(bytes, const [1, 2, 3]);
      expect(fake.refreshCalls, 1);
    });
  });
}

ParentApiClient _client(_FakeApi fake, _MemoryTokenStore store) =>
    ParentApiClient('http://parent.test/api/v1', store: store)..httpClientAdapter = fake;

/// Adaptateur HTTP de test : aucune socket, réponses déterministes.
class _FakeApi implements HttpClientAdapter {
  _FakeApi({
    this.expiredAccessTokens = const {},
    this.refreshFails = false,
    this.offline = false,
    this.serverError = false,
    this.bytes,
    this.gate,
  });

  final Set<String> expiredAccessTokens;
  final bool refreshFails;
  final bool offline;
  final bool serverError;
  final List<int>? bytes;
  final Completer<void>? gate;

  int refreshCalls = 0;
  String? retriedWith;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (offline) {
      throw DioException.connectionError(
        requestOptions: options,
        reason: 'pas de réseau (test)',
      );
    }
    if (options.path == '/auth/refresh') {
      refreshCalls++;
      if (gate != null) {
        await gate!.future;
      }
      if (refreshFails) {
        return _json(const <String, dynamic>{}, status: 401);
      }
      return _json(const {
        'access_token': 'access-2',
        'refresh_token': 'refresh-2',
        'expires_in': 900,
      });
    }
    if (serverError) {
      return _json(const <String, dynamic>{'code': 'INTERNAL_ERROR'}, status: 500);
    }
    final token = options.headers['authorization']?.toString();
    if (token != null && expiredAccessTokens.contains(token.replaceFirst('Bearer ', ''))) {
      return _json(const <String, dynamic>{'code': 'UNAUTHORIZED'}, status: 401);
    }
    if (token != null) {
      retriedWith = token;
    }
    if (bytes != null) {
      return ResponseBody.fromBytes(bytes!, 200, headers: {
        Headers.contentTypeHeader: ['application/octet-stream'],
      });
    }
    return _json(const <dynamic>[]);
  }

  ResponseBody _json(Object payload, {int status = 200}) => ResponseBody.fromString(
        jsonEncode(payload),
        status,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );

  @override
  void close({bool force = false}) {}
}

class _MemoryTokenStore implements ParentTokenStore {
  _MemoryTokenStore(this.accessToken, this.refreshToken);

  String? accessToken;
  String? refreshToken;

  @override
  Future<String?> readAccessToken() async => accessToken;

  @override
  Future<String?> readRefreshToken() async => refreshToken;

  @override
  Future<void> saveSession(String? access, String? refresh) async {
    if (access != null) {
      accessToken = access;
    }
    if (refresh != null) {
      refreshToken = refresh;
    }
  }

  @override
  Future<void> clear() async {
    accessToken = null;
    refreshToken = null;
  }
}
