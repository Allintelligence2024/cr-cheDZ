import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../core/widgets/empty_state.dart';
import '../../theme/serenite_theme.dart';

class AttestationsPage extends StatefulWidget {
  const AttestationsPage({super.key, required this.api});

  final DirectorApiClient api;

  @override
  State<AttestationsPage> createState() => _AttestationsPageState();
}

class _AttestationsPageState extends State<AttestationsPage> {
  List<dynamic> _attestations = [];
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
      final list = await widget.api.attestations();
      if (!mounted) return;
      setState(() {
        _attestations = list;
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

    if (_attestations.isEmpty) {
      return EmptyState(icon: Icons.verified, title: 'Aucune attestation', subtitle: 'Les attestations de frais de garde sont générées depuis admin-web ou via API /attestations', action: ElevatedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Actualiser')));
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.all(12),
        itemCount: _attestations.length,
        itemBuilder: (context, i) {
          final a = _attestations[i] as Map<String, dynamic>;
          return Card(
            child: ListTile(
              leading: Icon(Icons.description, color: Theme.of(context).colorScheme.primary),
              title: Text(a['attestation_number']?.toString() ?? 'ATT-${a['id']}'.substring(0, 12)),
              subtitle: Text('${a['first_name_fr'] ?? ''} ${a['last_name_fr'] ?? ''} — ${a['year'] ?? ''}\nTotal payé: ${a['total_paid'] ?? '?'} / ${a['total_invoiced'] ?? '?'} DZD', style: const TextStyle(fontSize: 11)),
              trailing: const Icon(Icons.picture_as_pdf),
              onTap: () => _showDetail(a),
            ),
          );
        },
      ),
    );
  }

  void _showDetail(Map<String, dynamic> att) {
    showModalBottomSheet(context: context, builder: (context) => Padding(padding: const EdgeInsets.all(16), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [Text(att['attestation_number']?.toString() ?? 'Attestation', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)), const SizedBox(height: 8), Text('Enfant: ${att['first_name_fr'] ?? ''} ${att['last_name_fr'] ?? ''}'), Text('Année: ${att['year'] ?? ''}'), Text('Période: ${att['period_start'] ?? ''} → ${att['period_end'] ?? ''}'), Text('Facturé: ${att['total_invoiced'] ?? ''} DZD — Payé: ${att['total_paid'] ?? ''} DZD'), const SizedBox(height: 12), Text('PDF disponible via /attestations/:id/pdf (admin-web pour impression)', style: TextStyle(fontSize: 11, color: SereniteStatusColors.of(context).textMuted))])) );
  }
}
