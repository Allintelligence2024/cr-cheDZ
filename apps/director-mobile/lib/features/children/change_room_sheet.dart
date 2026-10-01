import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';

Future<void> showChangeRoomSheet(BuildContext context, DirectorApiClient api, String childId, String currentRoomId, {VoidCallback? onChanged}) async {
  List<dynamic> rooms = [];
  String? selectedRoomId = currentRoomId;

  try {
    rooms = await api.rooms();
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
            Text('Changer de salle', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: selectedRoomId,
              decoration: const InputDecoration(labelText: 'Nouvelle salle', prefixIcon: Icon(Icons.meeting_room)),
              items: rooms.map((r) {
                final m = r as Map<String, dynamic>;
                return DropdownMenuItem(value: m['id'].toString(), child: Text(m['name_fr']?.toString() ?? m['id'].toString().substring(0, 8)));
              }).toList(),
              onChanged: (v) => setState(() => selectedRoomId = v),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () async {
                if (selectedRoomId == null) return;
                try {
                  await api.updateChildRoom(childId, selectedRoomId!);
                  if (context.mounted) Navigator.pop(context, true);
                } catch (e) {
                  final msg = e is DirectorApiException ? (e.message ?? e.kind) : e.toString();
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erreur: $msg'), backgroundColor: SereniteStatusColors.of(context).danger));
                }
              },
              child: const Text('Confirmer'),
            ),
          ],
        ),
      ),
    ),
  );

  if (result == true) {
    onChanged?.call();
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: const Text('Salle changée (tracé)'), backgroundColor: SereniteStatusColors.of(context).success));
  }
}
