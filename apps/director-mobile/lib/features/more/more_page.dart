import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../attestations/attestations_page.dart';
import '../children/children_list_page.dart';
import '../coverage/coverage_page.dart';
import '../exports/exports_page.dart';
import '../journal/journal_page.dart';
import '../notifications/notifications_page.dart';
import '../payroll/payroll_page.dart';
import '../settings/settings_page.dart';
import '../sites/sites_page.dart';
import '../../theme/serenite_theme.dart';

class MorePage extends StatelessWidget {
  const MorePage({super.key, required this.api, required this.onLogout});

  final DirectorApiClient api;
  final Future<void> Function() onLogout;

  @override
  Widget build(BuildContext context) {
    final items = [
      {'icon': Icons.child_care, 'label': 'Enfants', 'color': Colors.teal, 'page': ChildrenListPage(api: api)},
      {'icon': Icons.groups, 'label': 'Couverture', 'color': Colors.orange, 'page': CoveragePage(api: api)},
      {'icon': Icons.menu_book, 'label': 'Journal', 'color': Colors.blue, 'page': JournalPage(api: api)},
      {'icon': Icons.payments, 'label': 'Paie', 'color': Colors.green, 'page': PayrollPage(api: api)},
      {'icon': Icons.notifications, 'label': 'Notifications', 'color': Colors.purple, 'page': NotificationsPage(api: api)},
      {'icon': Icons.verified, 'label': 'Attestations', 'color': Colors.indigo, 'page': AttestationsPage(api: api)},
      {'icon': Icons.file_download, 'label': 'Exports', 'color': Colors.brown, 'page': ExportsPage(api: api)},
      {'icon': Icons.business, 'label': 'Sites & Salles', 'color': Colors.deepOrange, 'page': SitesPage(api: api)},
      {'icon': Icons.settings, 'label': 'Paramètres', 'color': Colors.grey, 'page': SettingsPage(api: api, onLogout: onLogout)},
    ];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, crossAxisSpacing: 12, mainAxisSpacing: 12, childAspectRatio: 0.9),
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
                    Text(item['label'] as String, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12), textAlign: TextAlign.center),
                  ],
                ),
              ),
            );
          },
        ),
        const SizedBox(height: 24),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Application Direction — V1', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                const Text('Cockpit mobile pour directrices : dashboard temps réel, ratios, facturation, staff, journal, paie, attestations.', style: TextStyle(fontSize: 12)),
                const SizedBox(height: 8),
                Text('Accès réservé : rôles director / receptionist / super_admin. Éducatrices → app Personnel. Parents → app Parents.', style: TextStyle(fontSize: 11, color: SereniteStatusColors.of(context).textFaint, fontStyle: FontStyle.italic)),
                const SizedBox(height: 12),
                Text('V2 prévu : push FCM, graphiques CA/présences, biométrie, mode offline complet, signature électronique.', style: TextStyle(fontSize: 10, color: SereniteStatusColors.of(context).textFaint)),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
