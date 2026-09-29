import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';

class ChildDetailPage extends StatefulWidget {
  const ChildDetailPage({super.key, required this.api, required this.childId});

  final DirectorApiClient api;
  final String childId;

  @override
  State<ChildDetailPage> createState() => _ChildDetailPageState();
}

class _ChildDetailPageState extends State<ChildDetailPage> {
  Map<String, dynamic>? _child;
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
      final data = await widget.api.childDetail(widget.childId);
      if (!mounted) return;
      setState(() {
        _child = data;
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
    return Scaffold(
      appBar: AppBar(title: const Text('Détail enfant')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? buildApiError(context, _error, _load)
              : _buildDetail(),
    );
  }

  Widget _buildDetail() {
    final c = _child!;
    final palette = SereniteStatusColors.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${c['first_name_fr'] ?? ''} ${c['last_name_fr'] ?? ''}', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
                Text('${c['first_name_ar'] ?? ''} ${c['last_name_ar'] ?? ''}', style: TextStyle(color: palette.textMuted)),
                const Divider(),
                _row('Référence', c['reference_number']?.toString() ?? ''),
                _row('Statut', c['status']?.toString() ?? ''),
                _row('Salle', c['room_name']?.toString() ?? c['room_id']?.toString() ?? ''),
                _row('Site', c['site_name']?.toString() ?? ''),
                _row('Date naissance', c['birth_date']?.toString().substring(0, 10) ?? ''),
                if (c['allergies_summary'] != null) _row('Allergies', c['allergies_summary'].toString()),
                if (c['medical_notes'] != null) _row('Notes médicales', c['medical_notes'].toString()),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        if (c['guardians'] is List) ...[
          Text('Tuteurs', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          ...(c['guardians'] as List).map((g) {
            final m = g as Map<String, dynamic>;
            return Card(
              child: ListTile(
                leading: Icon(Icons.person, color: m['is_primary'] == true ? Theme.of(context).colorScheme.primary : palette.textMuted),
                title: Text('${m['first_name'] ?? ''} ${m['last_name'] ?? ''}'),
                subtitle: Text('${m['phone'] ?? ''} — ${m['relationship'] ?? ''}'),
              ),
            );
          }),
        ],
      ],
    );
  }

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(width: 120, child: Text(label, style: TextStyle(fontSize: 12, color: SereniteStatusColors.of(context).textMuted))),
            Expanded(child: Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500))),
          ],
        ),
      );
}
