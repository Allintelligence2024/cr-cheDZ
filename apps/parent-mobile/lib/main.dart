import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'core/api_client.dart';
import 'features/absence/absence_sheet.dart';
import 'features/auth/otp_login_page.dart';
import 'features/feed/feed_page.dart';
import 'features/photos/photos_page.dart';
import 'features/consents/consents_page.dart';
import 'features/preferences/preferences_page.dart';

void main() => runApp(const ParentApp());

class ParentApp extends StatefulWidget {
  const ParentApp({super.key});

  @override
  State<ParentApp> createState() => _ParentAppState();
}

class _ParentAppState extends State<ParentApp> {
  final _api = ParentApiClient(
    const String.fromEnvironment(
      'API_URL',
      defaultValue: 'http://10.0.2.2:3000/api/v1',
    ),
  );
  bool _authenticated = false;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Crèche DZ',
      supportedLocales: const [Locale('fr'), Locale('ar')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      theme: ThemeData(
        colorSchemeSeed: Colors.teal,
        useMaterial3: true,
      ),
      home: _authenticated
          ? ParentHome(api: _api)
          : OtpLoginPage(
              api: _api,
              onAuthenticated: () => setState(() => _authenticated = true),
            ),
    );
  }
}

class ParentHome extends StatefulWidget {
  const ParentHome({super.key, required this.api});

  final ParentApiClient api;

  @override
  State<ParentHome> createState() => _ParentHomeState();
}

class _ParentHomeState extends State<ParentHome> {
  late Future<List<dynamic>> _children;
  String? _childId;

  @override
  void initState() {
    super.initState();
    _children = widget.api.children();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<dynamic>>(
      future: _children,
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        final children = snapshot.data!;
        _childId ??= children.isEmpty
            ? null
            : children.first['id'] as String?;
        return Scaffold(
          appBar: AppBar(
            title: const Text('Fil du jour / يوم طفلي'),
            actions: _childId == null
                ? null
                : [
                    IconButton(
                      icon: const Icon(Icons.photo_library),
                      onPressed: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => PhotosPage(
                            api: widget.api,
                            childId: _childId!,
                          ),
                        ),
                      ),
                      tooltip: 'Photos',
                    ),
                    IconButton(
                      icon: const Icon(Icons.verified_user),
                      onPressed: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => ConsentsPage(
                            api: widget.api,
                            childId: _childId!,
                          ),
                        ),
                      ),
                      tooltip: 'Consentements',
                    ),
                    IconButton(
                      icon: const Icon(Icons.notifications),
                      onPressed: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => PreferencesPage(api: widget.api),
                        ),
                      ),
                      tooltip: 'Notifications',
                    ),
                  ],
          ),
          body: children.isEmpty
              ? const Center(
                  child: Text('Aucun enfant lié / لا يوجد طفل مرتبط'),
                )
              : Column(
                  children: [
                    DropdownButton<String>(
                      value: _childId,
                      isExpanded: true,
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      items: children
                          .map(
                            (c) => DropdownMenuItem(
                              value: c['id'] as String,
                              child: Text(
                                '${c['first_name_fr']} ${c['last_name_fr']}',
                              ),
                            ),
                          )
                          .toList(),
                      onChanged: (id) => setState(() => _childId = id),
                    ),
                    Expanded(
                      child: FeedPage(
                        api: widget.api,
                        childId: _childId!,
                      ),
                    ),
                  ],
                ),
          floatingActionButton: _childId == null
              ? null
              : FloatingActionButton.extended(
                  onPressed: () => showAbsenceSheet(
                    context,
                    widget.api,
                    _childId!,
                  ),
                  icon: const Icon(Icons.event_busy),
                  label: const Text('Absence'),
                ),
        );
      },
    );
  }
}
