import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';

Future<void> showCreateIncidentSheet(BuildContext context, DirectorApiClient api, {String? childId, VoidCallback? onCreated}) async {
  final descCtrl = TextEditingController();
  String severity = 'low';
  String? selectedChildId = childId;
  List<dynamic> children = [];

  try {
    children = await api.children();
  } catch (_) {}

  if (!context.mounted) return;

  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (context) => StatefulBuilder(
      builder: (context, setState) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom, left: 16, right: 16, top: 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Signaler incident', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            if (childId == null)
              DropdownButtonFormField<String>(
                value: selectedChildId,
                decoration: const InputDecoration(labelText: 'Enfant', prefixIcon: Icon(Icons.child_care)),
                items: children.map((c) {
                  final m = c as Map<String, dynamic>;
                  return DropdownMenuItem(value: m['id'].toString(), child: Text('${m['first_name_fr'] ?? ''} ${m['last_name_fr'] ?? ''}'));
                }).toList(),
                onChanged: (v) => setState(() => selectedChildId = v),
              ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              value: severity,
              decoration: const InputDecoration(labelText: 'Gravité', prefixIcon: Icon(Icons.warning)),
              items: const [
                DropdownMenuItem(value: 'low', child: Text('Faible')),
                DropdownMenuItem(value: 'medium', child: Text('Moyenne')),
                DropdownMenuItem(value: 'high', child: Text('Élevée')),
                DropdownMenuItem(value: 'critical', child: Text('Critique')),
              ],
              onChanged: (v) => setState(() => severity = v ?? 'low'),
            ),
            const SizedBox(height: 8),
            TextField(controller: descCtrl, decoration: const InputDecoration(labelText: 'Description *', prefixIcon: Icon(Icons.description)), maxLines: 3),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () async {
                if (descCtrl.text.trim().isEmpty) {
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Description requise')));
                  return;
                }
                if (selectedChildId == null) {
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enfant requis')));
                  return;
                }
                try {
                  await api.createJournalEvent({
                    'child_id': selectedChildId,
                    'event_type': 'incident',
                    'incident_severity': severity,
                    'incident_description': descCtrl.text.trim(),
                    'occurred_at': DateTime.now().toUtc().toIso8601String(),
                  });
                  if (context.mounted) Navigator.pop(context, true);
                } catch (e) {
                  final msg = e is DirectorApiException ? (e.message ?? e.kind) : e.toString();
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erreur: $msg'), backgroundColor: SereniteStatusColors.of(context).danger));
                }
              },
              child: const Text('Signaler'),
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    ),
  );

  if (result == true) {
    onCreated?.call();
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: const Text('Incident signalé'), backgroundColor: SereniteStatusColors.of(context).success));
  }
}
