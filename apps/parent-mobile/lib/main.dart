import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

void main() => runApp(const ParentApp());

/// Racine RTL : la locale arabe inverse aussi navigation, alignements et icônes.
class ParentApp extends StatelessWidget {
  const ParentApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Crèche DZ',
    supportedLocales: const [Locale('fr'), Locale('ar')],
    localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
    home: const ParentHome(),
  );
}

class ParentHome extends StatelessWidget {
  const ParentHome({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Fil du jour')),
    body: ListView(padding: const EdgeInsets.all(16), children: [
      const Text('Les informations de votre enfant apparaîtront ici.'),
      const SizedBox(height: 16),
      FilledButton.icon(onPressed: () {/* POST /parent/absence — confirmation en 2 taps */}, icon: const Icon(Icons.event_busy), label: const Text('Signaler une absence')),
    ]),
  );
}
