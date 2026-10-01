import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';

class PayrollDetailPage extends StatefulWidget {
  const PayrollDetailPage({super.key, required this.api, required this.runId});

  final DirectorApiClient api;
  final String runId;

  @override
  State<PayrollDetailPage> createState() => _PayrollDetailPageState();
}

class _PayrollDetailPageState extends State<PayrollDetailPage> {
  Map<String, dynamic>? _run;
  List<dynamic> _entries = [];
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
        widget.api.payrollRunDetailFull(widget.runId),
        widget.api.payrollEntries(widget.runId).catchError((_) => <dynamic>[]),
      ]);
      if (!mounted) return;
      setState(() {
        _run = results[0] as Map<String, dynamic>;
        _entries = results[1] as List<dynamic>;
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
      appBar: AppBar(title: const Text('Détail paie')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? buildApiError(context, _error, _load)
              : _build(),
    );
  }

  Widget _build() {
    final run = _run!;
    final palette = SereniteStatusColors.of(context);
    final finalized = run['status'] == 'finalized' || run['finalized_at'] != null;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          color: finalized ? palette.successBg : palette.warningBg,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [Icon(finalized ? Icons.lock : Icons.edit, color: finalized ? palette.success : palette.warning), const SizedBox(width: 8), Text('Paie ${run['month'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16))]),
                const SizedBox(height: 8),
                Text('Statut: ${run['status'] ?? ''} ${finalized ? '(Finalisée)' : '(Brouillon)'}'),
                Text('Total: ${run['total_amount'] ?? '?'} DZD', style: const TextStyle(fontWeight: FontWeight.bold)),
                if (run['finalized_at'] != null) Text('Finalisée le: ${run['finalized_at'].toString().substring(0, 10)}', style: TextStyle(fontSize: 11, color: palette.textMuted)),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text('Lignes (${_entries.length})', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        if (_entries.isEmpty)
          Card(child: Padding(padding: const EdgeInsets.all(16), child: Text('Aucune ligne — détail complet sur admin-web', style: TextStyle(color: palette.textMuted))))
        else
          ..._entries.map((e) {
            final m = e as Map<String, dynamic>;
            return Card(
              child: ListTile(
                title: Text('${m['first_name'] ?? ''} ${m['last_name'] ?? ''}'),
                subtitle: Text('${m['role'] ?? m['qualification'] ?? ''} — ${m['base_salary'] ?? m['gross'] ?? ''} DZD'),
                trailing: Text('${m['net_salary'] ?? m['total'] ?? ''} DZD', style: const TextStyle(fontWeight: FontWeight.bold)),
              ),
            );
          }),
        const SizedBox(height: 16),
        Card(
          color: palette.surfaceAlt,
          child: Padding(padding: const EdgeInsets.all(12), child: Text('Lecture seule mobile V1. Édition et finalisation restent sur admin-web pour sécurité (422 si verrouillé).', style: TextStyle(fontSize: 11, color: palette.textMuted))),
        ),
      ],
    );
  }
}
