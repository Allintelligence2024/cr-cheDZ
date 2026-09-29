import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';
import 'staff_checkin_sheet.dart';

class StaffPage extends StatefulWidget {
  const StaffPage({super.key, required this.api});

  final DirectorApiClient api;

  @override
  State<StaffPage> createState() => _StaffPageState();
}

class _StaffPageState extends State<StaffPage> {
  List<dynamic> _staff = [];
  List<dynamic> _expiring = [];
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
      final results = await Future.wait([
        widget.api.staffProfiles(),
        widget.api.staffDocumentsExpiring(),
        widget.api.staffCoverage(date: _date),
      ]);
      if (!mounted) return;
      setState(() {
        _staff = results[0] as List;
        _expiring = results[1] as List;
        _coverage = results[2] as Map<String, dynamic>;
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

    final palette = SereniteStatusColors.of(context);
    final coverageRooms = (_coverage?['rooms'] as List?) ?? (_coverage?['coverage'] as List?) ?? [];
    final gaps = (_coverage?['gaps'] as List?) ?? (_coverage?['alerts'] as List?) ?? [];

    return Stack(
      children: [
        RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                children: [
                  Text('Personnel — $_date', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                  const Spacer(),
                  IconButton(icon: const Icon(Icons.calendar_today), onPressed: _pickDate),
                  IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
                ],
              ),
              if (_expiring.isNotEmpty) ...[
                Card(
                  color: palette.warningBg,
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(children: [Icon(Icons.warning, color: palette.warning, size: 18), const SizedBox(width: 6), const Text('Documents expirants (30j)', style: TextStyle(fontWeight: FontWeight.bold))]),
                        const SizedBox(height: 8),
                        ..._expiring.take(5).map((d) {
                          final m = d as Map<String, dynamic>;
                          return Text('• ${m['first_name'] ?? ''} ${m['last_name'] ?? ''} — ${m['document_type']} (${m['expiry_date']?.toString().substring(0, 10) ?? ''})', style: const TextStyle(fontSize: 12));
                        }),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              if (gaps.isNotEmpty) ...[
                Card(
                  color: palette.dangerBg,
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(children: [Icon(Icons.error, color: palette.danger, size: 18), const SizedBox(width: 6), const Text('Manques couverture', style: TextStyle(fontWeight: FontWeight.bold))]),
                        const SizedBox(height: 8),
                        ...gaps.take(5).map((g) => Text('• ${g.toString()}', style: const TextStyle(fontSize: 12))),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              Text('Couverture par salle', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              if (coverageRooms.isEmpty)
                Card(child: Padding(padding: const EdgeInsets.all(16), child: Text('Aucune donnée couverture', style: TextStyle(color: palette.textMuted))))
              else
                ...coverageRooms.map((r) {
                  final m = r as Map<String, dynamic>;
                  return Card(
                    child: ListTile(
                      title: Text(m['room_name']?.toString() ?? m['room_id']?.toString() ?? 'Salle'),
                      subtitle: Text('Planifiés: ${m['planned'] ?? m['educators_planned'] ?? '?'} — Présents: ${m['present'] ?? m['educators_present'] ?? '?'} — Requis: ${m['required'] ?? m['required_educators'] ?? '?'}'),
                    ),
                  );
                }),
              const SizedBox(height: 16),
              Text('Équipe (${_staff.length})', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              ..._staff.map((s) {
                final m = s as Map<String, dynamic>;
                return Card(
                  child: ListTile(
                    leading: CircleAvatar(child: Text((m['first_name']?.toString().isNotEmpty == true ? m['first_name'].toString()[0] : '?').toUpperCase())),
                    title: Text('${m['first_name'] ?? ''} ${m['last_name'] ?? ''}'),
                    subtitle: Text('${m['qualification'] ?? m['role'] ?? ''} — ${m['site_name'] ?? ''}'),
                  ),
                );
              }),
              const SizedBox(height: 80),
            ],
          ),
        ),
        Positioned(bottom: 16, right: 16, child: FloatingActionButton.extended(onPressed: () => showStaffCheckInSheet(context, widget.api, onChecked: _load), icon: const Icon(Icons.how_to_reg), label: const Text('Pointer staff'))),
      ],
    );
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(context: context, initialDate: DateTime.tryParse(_date) ?? now, firstDate: now.subtract(const Duration(days: 30)), lastDate: now.add(const Duration(days: 30)));
    if (picked != null) {
      setState(() => _date = picked.toIso8601String().substring(0, 10));
      _load();
    }
  }
}
