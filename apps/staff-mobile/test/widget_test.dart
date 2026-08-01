import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:staff_mobile/core/auth/auth_service.dart';
import 'package:staff_mobile/core/network/api_client.dart';
import 'package:staff_mobile/features/login/login_page.dart';

void main() {
  testWidgets('L\'écran de connexion affiche le formulaire', (tester) async {
    final auth = AuthService(ApiClient(), const FlutterSecureStorage());
    await tester.pumpWidget(
      MaterialApp(home: LoginPage(auth: auth, onAuthenticated: () {})),
    );
    expect(find.text('Se connecter'), findsOneWidget);
    expect(find.text('Email'), findsOneWidget);
    expect(find.text('Mot de passe'), findsOneWidget);
  });

  testWidgets('Validation : email vide → message requis', (tester) async {
    final auth = AuthService(ApiClient(), const FlutterSecureStorage());
    await tester.pumpWidget(
      MaterialApp(home: LoginPage(auth: auth, onAuthenticated: () {})),
    );
    await tester.tap(find.text('Se connecter'));
    await tester.pump();
    expect(find.text('Email requis'), findsOneWidget);
  });
}
