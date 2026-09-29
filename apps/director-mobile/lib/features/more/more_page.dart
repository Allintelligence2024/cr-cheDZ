import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/biometry_service.dart';
import '../../core/observability.dart';
import '../attestations/attestations_page.dart';
import '../children/children_list_page.dart';
import '../coverage/coverage_page.dart';
import '../exports/exports_page.dart';
import '../journal/journal_page.dart';
import '../notifications/notifications_page.dart';
import '../org_switch/org_switch_page.dart';
import '../payroll/payroll_page.dart';
import '../settings/settings_page.dart';
import '../sites/sites_page.dart';
import '../video/video_page.dart';
import '../../theme/serenite_theme.dart';

class MorePage extends StatefulWidget {
  const MorePage({super.key, required this.api, required this.onLogout});

  final DirectorApiClient api;
  final Future<void> Function() onLogout;

  @override
  State<MorePage> createState() => _MorePageState();
}

class _MorePageState extends State<MorePage> {
  final _bio = BiometryService();
  bool _bioAvailable = false;
  String _bioStatus = 'Vérification...';

  @override
  void initState() {
    super.initState();
    _checkBio();
  }

  Future<void> _checkBio() async {
    final available = await _bio.isAvailable();
    final types = await _bio.availableTypes();
    if (!mounted) return;
    setState(() {
      _bioAvailable = available;
      _bioStatus = available ? 'Disponible: ${types.map((t) => t.name).join(', ')}' : 'Non disponible';
    });
  }

  @override
  Widget build(BuildContext context) {
    final items = [
      {'icon': Icons.child_care, 'label': 'Enfants', 'color': Colors.teal, 'page': ChildrenListPage(api: widget.api)},
      {'icon': Icons.groups, 'label': 'Couverture', 'color': Colors.orange, 'page': CoveragePage(api: widget.api)},
      {'icon': Icons.menu_book, 'label': 'Journal', 'color': Colors.blue, 'page': JournalPage(api: widget.api)},
      {'icon': Icons.payments, 'label': 'Paie', 'color': Colors.green, 'page': PayrollPage(api: widget.api)},
      {'icon': Icons.notifications, 'label': 'Notifications', 'color': Colors.purple, 'page': NotificationsPage(api: widget.api)},
      {'icon': Icons.verified, 'label': 'Attestations', 'color': Colors.indigo, 'page': AttestationsPage(api: widget.api)},
      {'icon': Icons.file_download, 'label': 'Exports', 'color': Colors.brown, 'page': ExportsPage(api: widget.api)},
      {'icon': Icons.business, 'label': 'Sites & Salles', 'color': Colors.deepOrange, 'page': SitesPage(api: widget.api)},
      {'icon': Icons.videocam, 'label': 'Vidéosurveillance', 'color': Colors.red, 'page': VideoPage(api: widget.api)},
      {'icon': Icons.switch_account, 'label': 'Organisations', 'color': Colors.teal, 'page': OrgSwitchPage(api: widget.api)},
      {'icon': Icons.settings, 'label': 'Paramètres', 'color': Colors.grey, 'page': SettingsPage(api: widget.api, onLogout: widget.onLogout)},
    ];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, crossAxisSpacing: 12, mainAxisSpacing: 12, childAspectRatio: 0.85),
          itemCount: items.length,
          itemBuilder: (context, i) {
            final item = items[i];
            return Card(
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => Scaffold(appBar: AppBar(title: Text(item['label'] as String)), body: item['page'] as Widget))),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    CircleAvatar(backgroundColor: (item['color'] as Color).withValues(alpha: 0.15), child: Icon(item['icon'] as IconData, color: item['color'] as Color)),
                    const SizedBox(height: 8),
                    Text(item['label'] as String, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 11), textAlign: TextAlign.center),
                  ],
                ),
              ),
            );
          },
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [Icon(Icons.fingerprint, color: Theme.of(context).colorScheme.primary, size: 18), const SizedBox(width: 6), Text('Biométrie', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold))]),
                const SizedBox(height: 8),
                Text(_bioStatus, style: const TextStyle(fontSize: 11)),
                const SizedBox(height: 8),
                if (_bioAvailable)
                  FilledButton.icon(
                    onPressed: () async {
                      final ok = await _bio.authenticate(reason: 'Déverrouillage rapide direction');
                      if (!context.mounted) return;
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ok ? 'Biométrie OK' : 'Échec biométrie'), backgroundColor: ok ? SereniteStatusColors.of(context).success : SereniteStatusColors.of(context).danger));
                    },
                    icon: const Icon(Icons.fingerprint),
                    label: const Text('Tester biométrie'),
                  ),
              ],
            ),
          ),
        ),
        // M7 — entrée de vérification Sentry, visible UNIQUEMENT au build
        // `--dart-define SENTRY_TEST_CRASH=true` (build de test interne,
        // jamais dans un APK publié) : lève une exception contrôlée que Sentry
        // doit faire remonter au projet `director-mobile` en < 1 min.
        if (sentryTestCrashEnabled) ...[
          const SizedBox(height: 12),
          Card(
            child: ListTile(
              leading: const Icon(Icons.bug_report, color: Colors.red),
              title: const Text('Tester Sentry (crash contrôlé)'),
              subtitle: const Text(
                'Build --dart-define SENTRY_TEST_CRASH=true uniquement',
                style: TextStyle(fontSize: 11),
              ),
              onTap: () => Future<void>.error(
                StateError('Sentry test — director-mobile crash contrôlé'),
              ),
            ),
          ),
        ],
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Application Direction — V2', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                const Text('Cockpit mobile pour directrices : dashboard temps réel + graphiques, ratios, facturation, staff, journal, paie, attestations, vidéo.', style: TextStyle(fontSize: 12)),
                const SizedBox(height: 8),
                Text('V2 livré : graphiques fl_chart, actions écriture (création enfant, changement salle, pointage, incident, encaissement), biométrie, offline cache Drift-ready, export, org switch super_admin, vidéo (DPIA).', style: TextStyle(fontSize: 11, color: SereniteStatusColors.of(context).textFaint)),
                const SizedBox(height: 8),
                Text('V2 restant : FCM push réel (nécessite Firebase config), iOS TestFlight (compte Apple), Play Store listing.', style: TextStyle(fontSize: 10, color: SereniteStatusColors.of(context).textFaint, fontStyle: FontStyle.italic)),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
