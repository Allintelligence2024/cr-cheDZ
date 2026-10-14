import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';

class OrgSwitchPage extends StatefulWidget {
  const OrgSwitchPage({super.key, required this.api});

  final DirectorApiClient api;

  @override
  State<OrgSwitchPage> createState() => _OrgSwitchPageState();
}

class _OrgSwitchPageState extends State<OrgSwitchPage> {
  List<dynamic> _orgs = [];
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
      final orgs = await widget.api.organizations();
      if (!mounted) return;
      setState(() {
        _orgs = orgs;
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

  // 3.2.11 : switch réel — POST /auth/switch-org retourne une nouvelle
  // paire de tokens (api_client.switchOrg) que l'app persiste. L'ancienne
  // session est révoquée côté serveur (rotation). Après le switch, on
  // remonte l'écran : l'app entière relit le token courant.
  Future<void> _switchTo(String orgId) async {
    if (orgId.isEmpty) return;
    setState(() { _loading = true; _error = null; });
    try {
      final refresh = await widget.api.currentRefreshToken();
      await widget.api.switchOrg(orgId, refresh ?? '');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: const Text('Organisation active mise à jour'), backgroundColor: SereniteStatusColors.of(context).success));
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return buildApiError(context, _error, _load);

    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: _orgs.length,
      itemBuilder: (context, i) {
        final org = _orgs[i] as Map<String, dynamic>;
        return Card(
          child: ListTile(
            leading: CircleAvatar(child: Text((org['name_fr']?.toString().isNotEmpty == true ? org['name_fr'].toString()[0] : '?').toUpperCase())),
            title: Text(org['name_fr']?.toString() ?? org['name']?.toString() ?? 'Org'),
            subtitle: Text('${org['slug'] ?? ''} — ${org['max_capacity'] ?? '?'} places'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _switchTo(org['id']?.toString() ?? ''),
          ),
        );
      },
    );
  }
}
