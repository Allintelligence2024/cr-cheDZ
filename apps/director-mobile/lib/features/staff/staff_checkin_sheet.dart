import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';

Future<void> showStaffCheckInSheet(BuildContext context, DirectorApiClient api, {VoidCallback? onChecked}) async {
  List<dynamic> staff = [];
  String? selectedStaffId;

  try {
    staff = await api.staffProfiles();
  } catch (_) {}

  if (!context.mounted) return;

  final result = await showModalBottomSheet<bool>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, setState) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Pointage personnel', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: selectedStaffId,
              decoration: const InputDecoration(labelText: 'Membre', prefixIcon: Icon(Icons.person)),
              items: staff.map((s) {
                final m = s as Map<String, dynamic>;
                return DropdownMenuItem(value: m['id'].toString(), child: Text('${m['first_name'] ?? ''} ${m['last_name'] ?? ''}'));
              }).toList(),
              onChanged: (v) => setState(() => selectedStaffId = v),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(child: FilledButton.icon(onPressed: () async {
                  if (selectedStaffId == null) return;
                  try {
                    // P0 (phase 1.8) — StaffAttendanceDto exige attendance_date
                    // + check_in/check_out (staff.dto.ts) ; la route est
                    // POST /staff/:id/attendance.
                    await api.staffCheckIn(selectedStaffId!, {
                      'attendance_date': DateTime.now().toUtc().toIso8601String(),
                      'check_in': DateTime.now().toUtc().toIso8601String(),
                    });
                    if (context.mounted) Navigator.pop(context, true);
                  } catch (e) {
                    final msg = e is DirectorApiException ? (e.message ?? e.kind) : e.toString();
                    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erreur: $msg'), backgroundColor: SereniteStatusColors.of(context).danger));
                  }
                  }, icon: const Icon(Icons.login), label: const Text('Arrivée'))),
                  const SizedBox(width: 8),
                  Expanded(child: OutlinedButton.icon(onPressed: () async {
                    if (selectedStaffId == null) return;
                    try {
                      await api.staffCheckOut(selectedStaffId!, {
                        'attendance_date': DateTime.now().toUtc().toIso8601String(),
                        'check_out': DateTime.now().toUtc().toIso8601String(),
                      });
                      if (context.mounted) Navigator.pop(context, true);
                    } catch (e) {
                      final msg = e is DirectorApiException ? (e.message ?? e.kind) : e.toString();
                      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erreur: $msg'), backgroundColor: SereniteStatusColors.of(context).danger));
                    }
                  }, icon: const Icon(Icons.logout), label: const Text('Départ'))),
              ],
            ),
          ],
        ),
      ),
    ),
  );

  if (result == true) {
    onChecked?.call();
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: const Text('Pointage enregistré'), backgroundColor: SereniteStatusColors.of(context).success));
  }
}
