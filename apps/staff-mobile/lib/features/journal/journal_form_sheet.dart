import 'package:flutter/material.dart';

import '../../core/sync/sync_engine.dart';
import '../children/child.dart';

/// Feuille de saisie d'un événement de journal (repas, sieste, change,
/// activité, température, note, incident). Enregistre via la file de sync
/// (offline-first) — commandes log_*.
class JournalFormSheet extends StatefulWidget {
  const JournalFormSheet({
    super.key,
    required this.syncEngine,
    required this.child,
    required this.eventType,
  });

  final SyncEngine syncEngine;
  final Child child;
  final String eventType;

  @override
  State<JournalFormSheet> createState() => _JournalFormSheetState();
}

class _JournalFormSheetState extends State<JournalFormSheet> {
  String _mealType = 'lunch';
  String _mealQuantity = 'good';
  String _diaperType = 'wet';
  String _napQuality = 'good';
  String _severity = 'minor';
  final _noteController = TextEditingController();
  final _activityController = TextEditingController();
  final _temperatureController = TextEditingController(text: '36.8');

  Future<void> _save() async {
    final payload = <String, dynamic>{'child_id': widget.child.id};
    switch (widget.eventType) {
      case 'meal':
        payload.addAll({'meal_type': _mealType, 'meal_quantity': _mealQuantity});
        break;
      case 'nap_start':
        payload.addAll({'nap_start_at': DateTime.now().toIso8601String()});
        break;
      case 'nap_end':
        payload.addAll({'nap_end_at': DateTime.now().toIso8601String(), 'nap_quality': _napQuality});
        break;
      case 'diaper':
        payload.addAll({'diaper_type': _diaperType});
        break;
      case 'activity':
        payload.addAll({'activity_name': _activityController.text});
        break;
      case 'temperature':
        payload.addAll({'temperature_celsius': double.tryParse(_temperatureController.text) ?? 36.8});
        break;
      case 'note':
        payload.addAll({'note_text': _noteController.text});
        break;
      case 'incident':
        payload.addAll({
          'incident_severity': _severity,
          'incident_description': _noteController.text,
        });
        break;
    }
    await widget.syncEngine.enqueue(
      command: 'log_${widget.eventType}',
      entityType: 'daily_log',
      payload: payload,
    );
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${widget.eventType} — ${widget.child.firstNameFr} ${widget.child.lastNameFr}',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            const SizedBox(height: 16),
            if (widget.eventType == 'meal') ...[
              DropdownButtonFormField<String>(
                value: _mealType,
                decoration: const InputDecoration(labelText: 'Type'),
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
            if (widget.eventType == 'diaper')
              DropdownButtonFormField<String>(
                value: _diaperType,
                decoration: const InputDecoration(labelText: 'Type'),
                items: ['wet', 'dirty', 'both', 'dry']
                    .map((v) => DropdownMenuItem(value: v, child: Text(v)))
                    .toList(),
                onChanged: (v) => setState(() => _diaperType = v ?? 'wet'),
              ),
            if (widget.eventType == 'nap_end')
              DropdownButtonFormField<String>(
                value: _napQuality,
                decoration: const InputDecoration(labelText: 'Qualité'),
                items: ['good', 'agitated', 'refused']
                    .map((v) => DropdownMenuItem(value: v, child: Text(v)))
                    .toList(),
                onChanged: (v) => setState(() => _napQuality = v ?? 'good'),
              ),
            if (widget.eventType == 'temperature')
              TextFormField(
                controller: _temperatureController,
                decoration: const InputDecoration(labelText: 'Température (°C)'),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
              ),
            if (widget.eventType == 'activity')
              TextFormField(
                controller: _activityController,
                decoration: const InputDecoration(labelText: 'Activité'),
              ),
            if (widget.eventType == 'incident')
              DropdownButtonFormField<String>(
                value: _severity,
                decoration: const InputDecoration(labelText: 'Sévérité'),
                items: ['minor', 'moderate', 'serious']
                    .map((v) => DropdownMenuItem(value: v, child: Text(v)))
                    .toList(),
                onChanged: (v) => setState(() => _severity = v ?? 'minor'),
              ),
            if (widget.eventType == 'note' || widget.eventType == 'incident')
              TextFormField(
                controller: _noteController,
                decoration: InputDecoration(
                  labelText: widget.eventType == 'note' ? 'Note' : 'Description',
                ),
                maxLines: 3,
              ),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: _save, child: const Text('Enregistrer')),
          ],
        ),
      ),
    );
  }
}
