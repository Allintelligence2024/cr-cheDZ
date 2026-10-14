import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';

class SitesPage extends StatefulWidget {
  const SitesPage({super.key, required this.api});

  final DirectorApiClient api;

  @override
  State<SitesPage> createState() => _SitesPageState();
}

class _SitesPageState extends State<SitesPage> {
  List<dynamic> _sites = [];
  List<dynamic> _rooms = [];
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
      final results = await Future.wait([widget.api.sites(), widget.api.rooms()]);
      if (!mounted) return;
      setState(() {
        _sites = results[0];
        _rooms = results[1];
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

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Sites (${_sites.length})', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          ..._sites.map((s) {
            final m = s as Map<String, dynamic>;
            final siteRooms = _rooms.where((r) => (r as Map)['site_id'] == m['id']).toList();
            return Card(
              child: ExpansionTile(
                title: Text(m['name_fr']?.toString() ?? m['name']?.toString() ?? 'Site'),
                subtitle: Text('${m['address'] ?? ''} — ${siteRooms.length} salles', style: const TextStyle(fontSize: 11)),
                children: siteRooms.map((r) {
                  final rm = r as Map<String, dynamic>;
                  return ListTile(
                    dense: true,
                    title: Text(rm['name_fr']?.toString() ?? rm['name']?.toString() ?? 'Salle'),
                    subtitle: Text('Capacité: ${rm['max_capacity'] ?? '?'} — ${rm['is_active'] == true ? 'Active' : 'Inactive'}', style: const TextStyle(fontSize: 11)),
                  );
                }).toList(),
              ),
            );
          }),
          if (_sites.isEmpty)
            Card(child: Padding(padding: const EdgeInsets.all(24), child: Text('Aucun site', style: TextStyle(color: SereniteStatusColors.of(context).textMuted)))),
          const SizedBox(height: 16),
          Text('Toutes les salles (${_rooms.length})', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          ..._rooms.map((r) {
            final m = r as Map<String, dynamic>;
            return Card(
              child: ListTile(
                title: Text(m['name_fr']?.toString() ?? 'Salle'),
                subtitle: Text('Site: ${m['site_name'] ?? m['site_id']?.toString().substring(0, 8) ?? ''} — Cap: ${m['max_capacity'] ?? '?'}'),
              ),
            );
          }),
        ],
      ),
    );
  }
}
