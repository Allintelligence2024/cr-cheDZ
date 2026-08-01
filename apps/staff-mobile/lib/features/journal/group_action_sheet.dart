import 'package:flutter/material.dart';

import '../../core/database/app_database.dart';
import '../../core/sync/sync_engine.dart';

/// Action groupée : applique un événement (ex. repas) à TOUS les enfants
/// présents d'une section — une opération par enfant dans la file de sync.
class GroupActionSheet extends StatefulWidget {
  const GroupActionSheet({super.key, required this.syncEngine});

  final SyncEngine syncEngine;

  @override
  State<GroupActionSheet> createState() => _GroupActionSheetState();
}

class _GroupActionSheetState extends State<GroupActionSheet> {
  String _eventType = 'meal';
  String _mealType = 'lunch';
  String _mealQuantity = 'good';
  String _diaperType = 'wet';
  int _count = 0;
  bool _busy = false;

  Future<void> _apply() async {
    setState(() => _busy = true);
    final db = widget.syncEngine.database;
    // Enfants présents aujourd'hui (miroir local des sessions).
    final today = DateTime.now().toIso8601String().substring(0, 10);
    final statuses = await widget.syncEngine.attendanceStatusByChild(DateTime.now());
    final children = await db.select(db.localChildren).get();
    final present = children.where((c) => statuses[c.id] == 'present').toList();

    for (final child in present) {
      final payload = <String, dynamic>{'child_id': child.id};
      if (_eventType == 'meal') {
        payload.addAll({'meal_type': _mealType, 'meal_quantity': _mealQuantity});
      } else if (_eventType == 'diaper') {
        payload.addAll({'diaper_type': _diaperType});
      } else {
        payload.addAll({'nap_start_at': DateTime.now().toIso8601String()});
      }
      await widget.syncEngine.enqueue(
        command: 'log_$_eventType',
        entityType: 'daily_log',
        payload: payload,
      );
    }
    if (mounted) {
      setState(() => _busy = false);
      Navigator.of(context).pop(present.length);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Action groupée — section', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: _eventType,
            decoration: const InputDecoration(labelText: 'Type'),
            items: ['meal', 'diaper', 'nap_start']
                .map((v) => DropdownMenuItem(value: v, child: Text(v)))
                .toList(),
            onChanged: (v) => setState(() => _eventType = v ?? 'meal'),
          ),
          if (_eventType == 'meal') ...[
            DropdownButtonFormField<String>(
              value: _mealType,
              decoration: const InputDecoration(labelText: 'Type de repas'),
              items: ['breakfast', 'lunch', 'snack', 'bottle']
                  .map((v) => DropdownMenuItem(value: v, child: Text(v)))
                  .toList(),
              onChanged: (v) => setState(() => _mealType = v ?? 'lunch'),
            ),
            DropdownButtonFormField<String>(
              value: _mealQuantity,
              decoration: const InputDecoration(labelText: 'Quantité'),
              items: ['none', 'little', 'half', 'good', 'all']
                  .map((v) => DropdownMenuItem(value: v, child: Text(v)))
                  .toList(),
              onChanged: (v) => setState(() => _mealQuantity = v ?? 'good'),
            ),
          ],
          if (_eventType == 'diaper')
            DropdownButtonFormField<String>(
              value: _diaperType,
              decoration: const InputDecoration(labelText: 'Type'),
              items: ['wet', 'dirty', 'both', 'dry']
                  .map((v) => DropdownMenuItem(value: v, child: Text(v)))
                  .toList(),
              onChanged: (v) => setState(() => _diaperType = v ?? 'wet'),
            ),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: _busy ? null : _apply,
            child: Text(_busy ? 'Application…' : 'Appliquer à la section'),
          ),
        ],
      ),
    );
  }
}
