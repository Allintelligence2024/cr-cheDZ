import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../core/widgets/empty_state.dart';
import '../../theme/serenite_theme.dart';

/// Couverture prévisionnelle du personnel — GET /staff/schedule/coverage.
///
/// Par salle et par heure ouvrée (07h–18h) : éducateurs planifiés vs
/// effectif attendu, statut RATIO_EDUC (ok / warning / breach) selon les
/// règles de conformité actives (max enfants/éducateur, minimum de groupe).
class CoveragePage extends StatefulWidget {
  const CoveragePage({super.key, required this.api});

  final DirectorApiClient api;

  @override
  State<CoveragePage> createState() => _CoveragePageState();
}

class _CoveragePageState extends State<CoveragePage> {
  Map<String, dynamic>? _coverage;
  Object? _error;
  bool _loading = true;
  String _date = DateTime.now().toIso8601String().substring(0, 10);

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
      final cov = await widget.api.staffCoverage(date: _date);
      if (!mounted) return;
      setState(() {
        _coverage = cov;
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

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.tryParse(_date) ?? DateTime.now(),
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked != null) {
      setState(() => _date = picked.toIso8601String().substring(0, 10));
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return buildApiError(context, _error, _load);

    final rooms = (_coverage?['rooms'] as List?) ?? [];
    final alerts = (_coverage?['alerts'] as List?) ?? [];
    final maxPer = _coverage?['max_children_per_educator'] ?? '?';
    final minEduc = _coverage?['min_educators'] ?? '?';

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              Icon(Icons.groups, color: Theme.of(context).colorScheme.primary),
              const SizedBox(width: 8),
              Text('Couverture — $_date', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              const Spacer(),
              IconButton(icon: const Icon(Icons.calendar_today), onPressed: _pickDate, tooltip: 'Changer date'),
              IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Règle RATIO_EDUC : 1 éducateur / $maxPer enfants, minimum $minEduc par groupe',
            style: TextStyle(fontSize: 11, color: SereniteStatusColors.of(context).textFaint),
          ),
          const SizedBox(height: 12),
          if (alerts.isNotEmpty) ...[
            Card(
              color: SereniteStatusColors.of(context).danger.withValues(alpha: 0.08),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Icon(Icons.warning_amber, color: SereniteStatusColors.of(context).danger),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '${alerts.length} salle(s) en breach de ratio — renfort requis',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],
          if (rooms.isEmpty)
            const EmptyState(icon: Icons.groups, title: 'Aucune salle active', subtitle: 'Vérifiez les salles de vos sites')
          else
            ...rooms.map((r) => _roomCard(context, r as Map<String, dynamic>)),
          const SizedBox(height: 80),
        ],
      ),
    );
  }

  Widget _roomCard(BuildContext context, Map<String, dynamic> room) {
    final slots = (room['slots'] as List?) ?? [];
    final gaps = (room['gaps'] as List?) ?? [];
    final expected = room['expected_children'] ?? 0;
    final required = room['required_educators'] ?? 0;
    final breach = gaps.isNotEmpty;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(room['room_name']?.toString() ?? 'Salle', style: const TextStyle(fontWeight: FontWeight.bold))),
                _statusChip(context, breach ? 'breach' : 'ok'),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _stat('Attendus', expected, SereniteStatusColors.of(context).info),
                _stat('Requis', required, Theme.of(context).colorScheme.primary),
                _stat('Trous', gaps.length, SereniteStatusColors.of(context).danger),
              ],
            ),
            if (gaps.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                'Breach : ${gaps.join(', ')}',
                style: TextStyle(fontSize: 11, color: SereniteStatusColors.of(context).danger),
              ),
            ],
            const SizedBox(height: 8),
            Wrap(
              spacing: 4,
              runSpacing: 4,
              children: slots.map((s) {
                final m = Map<String, dynamic>.from(s as Map);
                final status = m['status']?.toString() ?? 'ok';
                final c = _slotColor(context, status);
                return Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                  decoration: BoxDecoration(
                    color: c.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    '${m['hour']} · ${m['educators'] ?? 0}',
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: c),
                  ),
                );
              }).toList(),
            ),
          ],
        ),
      ),
    );
  }

  Color _slotColor(BuildContext context, String status) {
    final palette = SereniteStatusColors.of(context);
    switch (status) {
      case 'breach':
        return palette.danger;
      case 'warning':
        return palette.warning;
      case 'ok':
        return palette.success;
      default:
        return Colors.grey;
    }
  }

  Widget _statusChip(BuildContext context, String status) {
    final c = _slotColor(context, status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
      child: Text(status, style: TextStyle(color: c, fontSize: 11, fontWeight: FontWeight.bold)),
    );
  }

  Widget _stat(String label, dynamic value, Color color) {
    final v = value is int ? value : int.tryParse(value.toString()) ?? 0;
    return Column(children: [
      Text('$v', style: TextStyle(fontWeight: FontWeight.bold, color: color, fontSize: 18)),
      Text(label, style: const TextStyle(fontSize: 10)),
    ]);
  }


}
