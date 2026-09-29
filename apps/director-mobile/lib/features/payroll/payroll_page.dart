import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../core/widgets/empty_state.dart';
import '../../theme/serenite_theme.dart';
import 'payroll_detail_page.dart';

class PayrollPage extends StatefulWidget {
  const PayrollPage({super.key, required this.api});

  final DirectorApiClient api;

  @override
  State<PayrollPage> createState() => _PayrollPageState();
}

class _PayrollPageState extends State<PayrollPage> {
  List<dynamic> _runs = [];
  Object? _error;
  bool _loading = true;
  String _month = DateTime.now().toIso8601String().substring(0, 7);

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
      final runs = await widget.api.payrollRuns(month: _month);
      if (!mounted) return;
      setState(() {
        _runs = runs;
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
          Row(
            children: [
              Text('Paie — $_month', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              const Spacer(),
              IconButton(icon: const Icon(Icons.calendar_today), onPressed: _pickMonth),
              IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
            ],
          ),
          const SizedBox(height: 12),
          if (_runs.isEmpty)
            EmptyState(icon: Icons.payments, title: 'Aucune paie pour $_month', subtitle: 'Générez la paie depuis admin-web', action: ElevatedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Actualiser')))
          else
            ..._runs.map((r) {
              final m = r as Map<String, dynamic>;
              final finalized = m['status'] == 'finalized' || m['finalized_at'] != null;
              return Card(
                child: ListTile(
                  leading: Icon(finalized ? Icons.lock : Icons.edit, color: finalized ? SereniteStatusColors.of(context).success : SereniteStatusColors.of(context).warning),
                  title: Text('Paie ${m['month'] ?? _month} — ${finalized ? 'Finalisée' : 'Brouillon'}'),
                  subtitle: Text('Total: ${m['total_amount'] ?? '?'} DZD — ${m['entries_count'] ?? m['entries']?.length ?? ''} lignes'),
                  trailing: Text(m['status']?.toString() ?? '', style: TextStyle(fontSize: 11, color: SereniteStatusColors.of(context).textMuted)),
                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => PayrollDetailPage(api: widget.api, runId: m['id'].toString()))),
                ),
              );
            }),
          const SizedBox(height: 16),
          Card(
            color: SereniteStatusColors.of(context).surfaceAlt,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Text('Lecture seule en mobile V1. Finalisation et édition restent sur admin-web (sécurité). Appuyez sur une paie pour voir le détail.', style: TextStyle(fontSize: 11, color: SereniteStatusColors.of(context).textMuted)),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _pickMonth() async {
    final now = DateTime.now();
    final picked = await showDatePicker(context: context, initialDate: DateTime.tryParse('$_month-01') ?? now, firstDate: DateTime(now.year - 1), lastDate: now);
    if (picked != null) {
      setState(() => _month = picked.toIso8601String().substring(0, 7));
      _load();
    }
  }
}
