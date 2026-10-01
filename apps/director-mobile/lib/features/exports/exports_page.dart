import 'package:flutter/material.dart';

import 'package:share_plus/share_plus.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../core/widgets/empty_state.dart';
import '../../theme/serenite_theme.dart';

class ExportsPage extends StatefulWidget {
  const ExportsPage({super.key, required this.api});

  final DirectorApiClient api;

  @override
  State<ExportsPage> createState() => _ExportsPageState();
}

class _ExportsPageState extends State<ExportsPage> {
  List<dynamic> _exports = [];
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
      final list = await widget.api.exports();
      if (!mounted) return;
      setState(() {
        _exports = list;
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

    if (_exports.isEmpty) {
      return EmptyState(icon: Icons.file_download, title: 'Aucun export', subtitle: 'Les exports Excel (présences, facturation) sont générés depuis admin-web', action: ElevatedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Actualiser')));
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.all(12),
        itemCount: _exports.length,
        itemBuilder: (context, i) {
          final e = _exports[i] as Map<String, dynamic>;
          final status = e['status']?.toString() ?? '';
          return Card(
            child: ListTile(
              leading: Icon(status == 'completed' ? Icons.check_circle : Icons.hourglass_top, color: status == 'completed' ? SereniteStatusColors.of(context).success : SereniteStatusColors.of(context).warning),
              title: Text(e['report_type']?.toString() ?? e['type']?.toString() ?? 'Export'),
              subtitle: Text('Statut: $status — ${e['created_at']?.toString().substring(0, 16) ?? ''}\n${e['file_name'] ?? ''}', style: const TextStyle(fontSize: 11)),
              trailing: status == 'completed' ? const Icon(Icons.share) : null,
              onTap: status == 'completed' ? () => Share.share('Export ${e['file_name'] ?? ''} — ${e['download_url'] ?? 'URL à récupérer via API'}') : null,
            ),
          );
        },
      ),
    );
  }
}
