import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:parent_mobile/core/api_client.dart';
import 'package:parent_mobile/features/feed/feed_page.dart';

/// États d'erreur de l'écran « fil du jour » (lot L3, audit 2026-09-24 item C2).
///
/// Avant : une erreur laissait un indicateur de chargement INFINI (le
/// `FutureBuilder` ne testait que `hasData`), et une session expirée affichait le
/// même texte qu'une panne, sans aucune issue. Ces tests tiennent les trois
/// comportements attendus : erreur → message + réessai qui aboutit ; hors-ligne →
/// message réseau ; session expirée → reconnexion, sans bouton trompeur.
void main() {
  testWidgets('erreur → message + « Réessayer » recharge réellement',
      (WidgetTester tester) async {
    final client = _StubClient(<Object>[
      const ParentApiException('server', statusCode: 500),
      <dynamic>[
        <String, dynamic>{'event_type': 'meal', 'occurred_at': '2026-09-25T12:00:00Z'},
      ],
    ]);

    await tester.pumpWidget(_app(client));
    await tester.pumpAndSettle();

    expect(find.textContaining('Indisponible'), findsOneWidget);
    expect(find.textContaining('Réessayer'), findsOneWidget);

    await tester.tap(find.textContaining('Réessayer'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Repas'), findsOneWidget);
    expect(client.calls, 2, reason: 'le réessai doit refaire l\'appel');
  });

  testWidgets('hors-ligne → message réseau (et non « indisponible »)',
      (WidgetTester tester) async {
    final client = _StubClient(<Object>[
      const ParentApiException('offline'),
    ]);

    await tester.pumpWidget(_app(client));
    await tester.pumpAndSettle();

    expect(find.textContaining('Pas de réseau'), findsOneWidget);
    expect(find.textContaining('Réessayer'), findsOneWidget);
  });

  testWidgets('session expirée → reconnexion, sans bouton « Réessayer »',
      (WidgetTester tester) async {
    final client = _StubClient(<Object>[const ParentSessionExpired()]);

    await tester.pumpWidget(_app(client));
    await tester.pumpAndSettle();

    expect(find.textContaining('Session expirée'), findsOneWidget);
    expect(find.textContaining('Réessayer'), findsNothing,
        reason: 'insister ne sert à rien : le refresh a échoué');
  });

  testWidgets('liste vide → aucun indicateur bloqué', (WidgetTester tester) async {
    final client = _StubClient(<Object>[<dynamic>[]]);

    await tester.pumpWidget(_app(client));
    await tester.pumpAndSettle();

    expect(find.byType(CircularProgressIndicator), findsNothing);
  });
}

Widget _app(ParentApiClient client) => MaterialApp(
      home: Scaffold(body: FeedPage(api: client, childId: 'child-1')),
    );

/// Client de test : `feed` rend les réponses programmées, dans l'ordre.
/// (Le reste du client n'est pas sollicité ; l'URL n'est jamais contactée.)
class _StubClient extends ParentApiClient {
  _StubClient(this._responses) : super('http://parent.test/api/v1');

  final List<Object> _responses;
  int calls = 0;

  @override
  Future<List<dynamic>> feed(String childId) async {
    calls++;
    final next = _responses.removeAt(0);
    if (next is Exception) {
      throw next;
    }
    return next as List<dynamic>;
  }
}
