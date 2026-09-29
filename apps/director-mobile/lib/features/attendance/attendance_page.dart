import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';
import '../../core/widgets/empty_state.dart';

class AttendancePage extends StatefulWidget {
  const AttendancePage({super.key, required this.api});

  final DirectorApiClient api;

  @override
  State<AttendancePage> createState() => _AttendancePageState();
}

class _AttendancePageState extends State<AttendancePage> {
  Map<String, dynamic>? _summary;
  Map<String, dynamic>? _ratios;
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
      final results = await Future.wait([
        widget.api.attendanceSummary(date: _date),
        widget.api.attendanceRatios(),
      ]);
      if (!mounted) return;
      setState(() {
        _summary = results[0] as Map<String, dynamic>;
        _ratios = results[1] as Map<String, dynamic>;
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

  Future<void> _showCheckSheet() async {
    final childIdCtrl = TextEditingController();
    final result = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (context) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom, left: 16, right: 16, top: 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Pointage rapide', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            TextField(controller: childIdCtrl, decoration: const InputDecoration(labelText: 'ID enfant ou recherche', prefixIcon: Icon(Icons.child_care))),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: FilledButton.icon(onPressed: () => Navigator.pop(context, 'in:${childIdCtrl.text}'), icon: const Icon(Icons.login), label: const Text('Arrivée'))),
                const SizedBox(width: 8),
                Expanded(child: OutlinedButton.icon(onPressed: () => Navigator.pop(context, 'out:${childIdCtrl.text}'), icon: const Icon(Icons.logout), label: const Text('Départ'))),
                const SizedBox(width: 8),
                Expanded(child: OutlinedButton.icon(onPressed: () => Navigator.pop(context, 'abs:${childIdCtrl.text}'), icon: const Icon(Icons.event_busy), label: const Text('Absent'))),
              ],
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );

    if (result == null) return;
    try {
      if (result.startsWith('in:')) {
        final id = result.substring(3).trim();
        if (id.isEmpty) return;
        await widget.api.checkInChild({'child_id': id, 'occurred_at': DateTime.now().toUtc().toIso8601String()});
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: const Text('Arrivée enregistrée'), backgroundColor: SereniteStatusColors.of(context).success));
      } else if (result.startsWith('out:')) {
        final id = result.substring(4).trim();
        await widget.api.checkOutChild({'child_id': id, 'occurred_at': DateTime.now().toUtc().toIso8601String()});
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: const Text('Départ enregistré'), backgroundColor: SereniteStatusColors.of(context).success));
      } else if (result.startsWith('abs:')) {
        final id = result.substring(4).trim();
        await widget.api.markAbsent({'child_id': id, 'date': _date});
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: const Text('Absent marqué'), backgroundColor: SereniteStatusColors.of(context).warning));
      }
      _load();
    } catch (e) {
      final msg = e is DirectorApiException ? (e.message ?? e.kind) : e.toString();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erreur: $msg'), backgroundColor: SereniteStatusColors.of(context).danger));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return buildApiError(context, _error, _load);

    final rooms = (_summary?['rooms'] as List?) ?? (_summary?['data'] as List?) ?? [];
    final ratioRooms = (_ratios?['rooms'] as List?) ?? [];

    return Stack(
      children: [
        RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                children: [
                  Icon(Icons.how_to_reg, color: Theme.of(context).colorScheme.primary),
                  const SizedBox(width: 8),
                  Text('Présences — $_date', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                  const Spacer(),
                  IconButton(icon: const Icon(Icons.calendar_today), onPressed: _pickDate, tooltip: 'Changer date'),
                  IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
                ],
              ),
              const SizedBox(height: 12),
              if (ratioRooms.isNotEmpty) ...[
                Text('Ratios', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                ...ratioRooms.map((r) => Card(
                      child: ListTile(
                        title: Text((r as Map)['room_name']?.toString() ?? 'Salle'),
                        subtitle: Text('Statut: ${r['status']} — ${r['present_children'] ?? 0} enfants / ${r['educator_count'] ?? 0} éduc'),
                        trailing: _ratioBadge(r['status']?.toString() ?? 'empty'),
                      ),
                    )),
                const SizedBox(height: 16),
              ],
              Text('Par salle', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              if (rooms.isEmpty)
                EmptyState(icon: Icons.how_to_reg, title: 'Aucune donnée pour $_date', subtitle: 'Vérifiez les pointages')
              else
                ...rooms.map((room) {
                  final m = room as Map<String, dynamic>;
                  return Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(m['room_name']?.toString() ?? 'Salle', style: const TextStyle(fontWeight: FontWeight.bold)),
                          Text(m['site_name']?.toString() ?? '', style: TextStyle(fontSize: 11, color: SereniteStatusColors.of(context).textFaint)),
                          const SizedBox(height: 8),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceAround,
                            children: [
                              _stat('Présents', m['present'], SereniteStatusColors.of(context).success),
                              _stat('Attendus', m['expected'], SereniteStatusColors.of(context).info),
                              _stat('Partis', m['departed'], SereniteStatusColors.of(context).textFaint),
                              _stat('Absents', m['absent'], SereniteStatusColors.of(context).danger),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                }),
              const SizedBox(height: 80),
            ],
          ),
        ),
        Positioned(
          bottom: 16,
          right: 16,
          child: FloatingActionButton.extended(onPressed: _showCheckSheet, icon: const Icon(Icons.edit), label: const Text('Pointer')),
        ),
      ],
    );
  }

  Widget _stat(String label, dynamic value, Color color) {
    final v = value is int ? value : int.tryParse(value.toString()) ?? 0;
    return Column(children: [
      Text('$v', style: TextStyle(fontWeight: FontWeight.bold, color: color, fontSize: 18)),
      Text(label, style: const TextStyle(fontSize: 10)),
    ]);
  }

  Widget _ratioBadge(String status) {
    Color c;
    switch (status) {
      case 'breach':
        c = Colors.red;
        break;
      case 'warning':
        c = Colors.orange;
        break;
      case 'ok':
        c = Colors.green;
        break;
      default:
        c = Colors.grey;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
      child: Text(status, style: TextStyle(color: c, fontSize: 11, fontWeight: FontWeight.bold)),
    );
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.tryParse(_date) ?? now,
      firstDate: now.subtract(const Duration(days: 365)),
      lastDate: now.add(const Duration(days: 1)),
    );
    if (picked != null) {
      setState(() => _date = picked.toIso8601String().substring(0, 10));
      _load();
    }
  }
}
