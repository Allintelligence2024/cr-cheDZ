import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';

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
            onTap: () {
              ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Switch org ${org['name_fr']} — à implémenter côté API (header X-Org-ID)')));
            },
          ),
        );
      },
    );
  }
}
