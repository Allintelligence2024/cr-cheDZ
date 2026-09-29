import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';

Future<void> showCreateChildSheet(BuildContext context, DirectorApiClient api, {VoidCallback? onCreated}) async {
  final firstNameFrCtrl = TextEditingController();
  final lastNameFrCtrl = TextEditingController();
  final birthDateCtrl = TextEditingController(text: DateTime.now().subtract(const Duration(days: 365 * 2)).toIso8601String().substring(0, 10));
  String? selectedRoomId;
  List<dynamic> rooms = [];
  bool loadingRooms = true;

  try {
    rooms = await api.rooms();
  } catch (_) {
    rooms = [];
  }
  loadingRooms = false;

  if (!context.mounted) return;

  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (context) => StatefulBuilder(
      builder: (context, setState) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom, left: 16, right: 16, top: 16),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Nouvel enfant (rapide)', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 12),
              TextField(controller: firstNameFrCtrl, decoration: const InputDecoration(labelText: 'Prénom FR *', prefixIcon: Icon(Icons.person))),
              const SizedBox(height: 8),
              TextField(controller: lastNameFrCtrl, decoration: const InputDecoration(labelText: 'Nom FR *', prefixIcon: Icon(Icons.badge))),
              const SizedBox(height: 8),
              TextField(controller: birthDateCtrl, decoration: const InputDecoration(labelText: 'Date naissance YYYY-MM-DD *', prefixIcon: Icon(Icons.cake))),
              const SizedBox(height: 8),
              if (loadingRooms)
                const LinearProgressIndicator()
              else
                DropdownButtonFormField<String>(
                  value: selectedRoomId,
                  decoration: const InputDecoration(labelText: 'Salle (optionnel)', prefixIcon: Icon(Icons.meeting_room)),
                  items: rooms.map((r) {
                    final m = r as Map<String, dynamic>;
                    return DropdownMenuItem(value: m['id'].toString(), child: Text(m['name_fr']?.toString() ?? m['id'].toString().substring(0, 8)));
                  }).toList(),
                  onChanged: (v) => setState(() => selectedRoomId = v),
                ),
              const SizedBox(height: 8),
              Text('Champs minimaux V2.3 — détail complet sur admin-web (tuteurs, allergies, etc.)', style: TextStyle(fontSize: 11, color: SereniteStatusColors.of(context).textFaint)),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () async {
                  if (firstNameFrCtrl.text.trim().isEmpty || lastNameFrCtrl.text.trim().isEmpty) {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Prénom et nom requis')));
                    return;
                  }
                  try {
                    // Endpoint existant POST /children
                    await api.createChild({
                      'first_name_fr': firstNameFrCtrl.text.trim(),
                      'last_name_fr': lastNameFrCtrl.text.trim(),
                      'birth_date': birthDateCtrl.text.trim(),
                      if (selectedRoomId != null) 'room_id': selectedRoomId,
                      'status': 'active',
                    });
                    if (context.mounted) Navigator.pop(context, true);
                  } catch (e) {
                    final msg = e is DirectorApiException ? (e.message ?? e.kind) : e.toString();
                    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erreur: $msg'), backgroundColor: SereniteStatusColors.of(context).danger));
                  }
                },
                child: const Text('Créer'),
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    ),
  );

  if (result == true) {
    onCreated?.call();
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: const Text('Enfant créé'), backgroundColor: SereniteStatusColors.of(context).success));
    }
  }
}
