import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key, required this.api, required this.onLogout});

  final DirectorApiClient api;
  final Future<void> Function() onLogout;

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  Map<String, dynamic>? _me;
  Map<String, dynamic>? _org;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        widget.api.me(),
        widget.api.orgDetails().catchError((_) => <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        _me = results[0];
        _org = results[1];
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return buildApiError(context, _error, _load);

    final palette = SereniteStatusColors.of(context);
    final user = _me?['user'] as Map<String, dynamic>? ?? _me ?? {};
    final org = _org ?? {};

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [Icon(Icons.person, color: Theme.of(context).colorScheme.primary), const SizedBox(width: 8), Text('Mon profil', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold))]),
                const SizedBox(height: 12),
                Text('${user['first_name'] ?? ''} ${user['last_name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                Text(user['email']?.toString() ?? '', style: TextStyle(color: palette.textMuted)),
                const SizedBox(height: 8),
                Text('Rôle: ${user['role'] ?? _me?['role'] ?? ''}'),
                if (_me?['organization_id'] != null) Text('Org ID: ${_me!['organization_id'].toString().substring(0, 8)}...', style: TextStyle(fontSize: 11, color: palette.textFaint)),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [Icon(Icons.business, color: Theme.of(context).colorScheme.primary), const SizedBox(width: 8), Text('Organisation', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold))]),
                const SizedBox(height: 12),
                if (org.isEmpty)
                  Text('Détails org non disponibles (endpoint /organizations/me à vérifier)', style: TextStyle(color: palette.textMuted, fontSize: 12))
                else ...[
                  Text(org['name_fr']?.toString() ?? org['name']?.toString() ?? '', style: const TextStyle(fontWeight: FontWeight.bold)),
                  Text(org['slug']?.toString() ?? '', style: TextStyle(fontSize: 11, color: palette.textFaint)),
                  const SizedBox(height: 8),
                  Text('Capacité: ${org['max_capacity'] ?? org['capacity'] ?? '?'} enfants'),
                  Text('Type: ${org['establishment_type'] ?? ''}'),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Application', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                const Text('Version: 0.1.0+1 (V1 MVP)'),
                const Text('Package: com.creche.director_mobile'),
                const Text('API: https://api.creche.dz/api/v1 (défaut)'),
                const SizedBox(height: 8),
                Text('Thème: Sérénité (clair/sombre auto)', style: TextStyle(fontSize: 11, color: palette.textFaint)),
                Text('Rôles autorisés: director, receptionist, super_admin', style: TextStyle(fontSize: 11, color: palette.textFaint)),
              ],
            ),
          ),
        ),
        const SizedBox(height: 24),
        FilledButton.icon(
          onPressed: () async {
            final confirm = await showDialog<bool>(context: context, builder: (c) => AlertDialog(title: const Text('Déconnexion'), content: const Text('Voulez-vous vous déconnecter ?'), actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Annuler')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Déconnexion'))]));
            if (confirm == true) {
              await widget.onLogout();
            }
          },
          icon: const Icon(Icons.logout),
          label: const Text('Se déconnecter'),
          style: FilledButton.styleFrom(backgroundColor: palette.danger),
        ),
        const SizedBox(height: 12),
        Text('Les éducatrices utilisent l\'app Personnel (offline-first). Les parents utilisent l\'app Parents (OTP).', style: TextStyle(fontSize: 11, color: palette.textFaint, fontStyle: FontStyle.italic), textAlign: TextAlign.center),
      ],
    );
  }
}
