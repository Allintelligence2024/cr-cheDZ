import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';

class JournalPage extends StatefulWidget {
  const JournalPage({super.key, required this.api});

  final DirectorApiClient api;

  @override
  State<JournalPage> createState() => _JournalPageState();
}

class _JournalPageState extends State<JournalPage> {
  List<dynamic> _events = [];
  Object? _error;
  bool _loading = true;
  String _date = DateTime.now().toIso8601String().substring(0, 10);
  String _typeFilter = 'all';

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
      final events = await widget.api.journalEvents(date: _date, type: _typeFilter == 'all' ? null : _typeFilter);
      if (!mounted) return;
      setState(() {
        _events = events;
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

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Expanded(
                child: DropdownButton<String>(
                  value: _typeFilter,
                  isExpanded: true,
                  items: const [
                    DropdownMenuItem(value: 'all', child: Text('Tous')),
                    DropdownMenuItem(value: 'meal', child: Text('Repas')),
                    DropdownMenuItem(value: 'nap', child: Text('Sieste')),
                    DropdownMenuItem(value: 'diaper', child: Text('Change')),
                    DropdownMenuItem(value: 'activity', child: Text('Activité')),
                    DropdownMenuItem(value: 'incident', child: Text('Incident')),
                    DropdownMenuItem(value: 'note', child: Text('Note')),
                  ],
                  onChanged: (v) {
                    if (v != null) {
                      setState(() => _typeFilter = v);
                      _load();
                    }
                  },
                ),
              ),
              const SizedBox(width: 8),
              IconButton(icon: const Icon(Icons.calendar_today), onPressed: _pickDate),
              IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(children: [Text('Journal — $_date', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold))]),
        ),
        const SizedBox(height: 8),
        Expanded(
          child: _events.isEmpty
              ? Center(child: Text('Aucun événement', style: TextStyle(color: SereniteStatusColors.of(context).textMuted)))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.builder(
                    itemCount: _events.length,
                    itemBuilder: (context, i) {
                      final e = _events[i] as Map<String, dynamic>;
                      final isIncident = e['event_type'] == 'incident';
                      return Card(
                        color: isIncident ? SereniteStatusColors.of(context).dangerBg : null,
                        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                        child: ListTile(
                          leading: Icon(_iconFor(e['event_type']?.toString() ?? ''), color: isIncident ? SereniteStatusColors.of(context).danger : Theme.of(context).colorScheme.primary),
                          title: Text('${e['event_type'] ?? ''} — ${e['first_name_fr'] ?? ''} ${e['last_name_fr'] ?? ''}'.trim()),
                          subtitle: Text(
                            '${e['occurred_at']?.toString().substring(11, 16) ?? ''} — ${e['meal_type'] ?? e['activity_type'] ?? e['incident_severity'] ?? e['note_text'] ?? e['description'] ?? ''}',
                            style: const TextStyle(fontSize: 12),
                          ),
                        ),
                      );
                    },
                  ),
                ),
        ),
      ],
    );
  }

  IconData _iconFor(String type) {
    switch (type) {
      case 'meal':
        return Icons.restaurant;
      case 'nap':
        return Icons.bedtime;
      case 'diaper':
        return Icons.child_care;
      case 'activity':
        return Icons.sports_esports;
      case 'incident':
        return Icons.warning;
      case 'temperature':
        return Icons.thermostat;
      default:
        return Icons.note;
    }
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(context: context, initialDate: DateTime.tryParse(_date) ?? now, firstDate: now.subtract(const Duration(days: 90)), lastDate: now);
    if (picked != null) {
      setState(() => _date = picked.toIso8601String().substring(0, 10));
      _load();
    }
  }
}
