import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';

class NotificationsPage extends StatefulWidget {
  const NotificationsPage({super.key, required this.api});

  final DirectorApiClient api;

  @override
  State<NotificationsPage> createState() => _NotificationsPageState();
}

class _NotificationsPageState extends State<NotificationsPage> {
  List<dynamic> _notifs = [];
  Object? _error;
  bool _loading = true;

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
      final list = await widget.api.notifications();
      if (!mounted) return;
      setState(() {
        _notifs = list;
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

    return RefreshIndicator(
      onRefresh: _load,
      child: _notifs.isEmpty
          ? ListView(children: [SizedBox(height: 200, child: Center(child: Text('Aucune notification', style: TextStyle(color: SereniteStatusColors.of(context).textMuted))))])
          : ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: _notifs.length,
              itemBuilder: (context, i) {
                final n = _notifs[i] as Map<String, dynamic>;
                final read = n['read_at'] != null || n['is_read'] == true;
                return Card(
                  color: read ? null : Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.3),
                  child: ListTile(
                    leading: Icon(n['type'] == 'incident' ? Icons.warning : Icons.notifications, color: read ? SereniteStatusColors.of(context).textFaint : Theme.of(context).colorScheme.primary),
                    title: Text(n['title_fr']?.toString() ?? n['title']?.toString() ?? n['type']?.toString() ?? 'Notification', style: TextStyle(fontWeight: read ? FontWeight.normal : FontWeight.bold)),
                    subtitle: Text('${n['body_fr']?.toString() ?? n['body']?.toString() ?? n['message']?.toString() ?? ''}\n${n['created_at']?.toString().substring(0, 16) ?? ''}', style: const TextStyle(fontSize: 12)),
                    isThreeLine: true,
                  ),
                );
              },
            ),
    );
  }
}
