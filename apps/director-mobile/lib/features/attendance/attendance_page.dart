import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';

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

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return buildApiError(context, _error, _load);

    final rooms = (_summary?['rooms'] as List?) ?? (_summary?['data'] as List?) ?? [];
    final ratioRooms = (_ratios?['rooms'] as List?) ?? [];

    return RefreshIndicator(
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
            Card(child: Padding(padding: const EdgeInsets.all(24), child: Text('Aucune donnée pour $_date', style: TextStyle(color: SereniteStatusColors.of(context).textMuted))))
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
        ],
      ),
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
