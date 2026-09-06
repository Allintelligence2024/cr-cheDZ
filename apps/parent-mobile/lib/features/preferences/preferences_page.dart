import 'package:flutter/material.dart';
import '../../core/api_client.dart';

class PreferencesPage extends StatefulWidget {
  const PreferencesPage({super.key, required this.api});
  final ParentApiClient api;
  @override State<PreferencesPage> createState() => _PreferencesPageState();
}

class _PreferencesPageState extends State<PreferencesPage> {
  bool _meal = true, _incident = true;
  final _start = TextEditingController(text: '21:00');
  final _end = TextEditingController(text: '07:00');

  @override
  void initState() {
    super.initState();
    widget.api.preferences().then((items) {
      for (final raw in items) {
        final p = raw as Map<String, dynamic>;
        if (p['event_type'] == 'meal') _meal = p['is_enabled'] == true;
        if (p['event_type'] == 'incident') _incident = p['is_enabled'] == true;
      }
      if (mounted) setState(() {});
    });
  }

  Future<void> _save() async {
    await widget.api.savePreference('meal', _meal, start: _start.text, end: _end.text);
    await widget.api.savePreference('incident', _incident, start: _start.text, end: _end.text);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Préférences enregistrées / تم الحفظ')),
      );
    }
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(16),
    children: [
      SwitchListTile(
        title: const Text('Repas / الوجبات'),
        value: _meal,
        onChanged: (v) => setState(() => _meal = v),
      ),
      SwitchListTile(
        title: const Text('Incidents / الحوادث'),
        value: _incident,
        onChanged: (v) => setState(() => _incident = v),
      ),
      TextField(
        controller: _start,
        decoration: const InputDecoration(labelText: 'Début silence (HH:mm)'),
      ),
      TextField(
        controller: _end,
        decoration: const InputDecoration(labelText: 'Fin silence (HH:mm)'),
      ),
      const SizedBox(height: 12),
      FilledButton(
        onPressed: _save,
        child: const Text('Enregistrer / حفظ'),
      ),
    ],
  );
}