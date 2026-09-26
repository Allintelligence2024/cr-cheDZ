import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';

class FeedPage extends StatefulWidget {
  const FeedPage({
    super.key,
    required this.api,
    required this.childId,
  });

  final ParentApiClient api;
  final String childId;

  @override
  State<FeedPage> createState() => _FeedPageState();
}

class _FeedPageState extends State<FeedPage> {
  late Future<List<dynamic>> _feed;

  @override
  void initState() {
    super.initState();
    _feed = widget.api.feed(widget.childId);
  }

  void _reload() {
    setState(() {
      _feed = widget.api.feed(widget.childId);
    });
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<dynamic>>(
      future: _feed,
      builder: (context, snapshot) {
        // L'erreur AVANT le chargement : sinon une erreur laisse un indicateur
        // infini (défaut mesuré — l'écran restait bloqué, sans message ni issue).
        if (snapshot.hasError) {
          return buildApiError(context, snapshot.error, _reload);
        }
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        final items = snapshot.data ?? const <dynamic>[];
        return RefreshIndicator(
          onRefresh: () {
            _reload();
            return Future<void>.value();
          },
          child: ListView.builder(
            itemCount: items.length,
            itemBuilder: (context, index) {
              final item = items[index] as Map<String, dynamic>;
              return ListTile(
                leading: const Icon(Icons.event_note),
                title: Text(_label(item['event_type']?.toString() ?? '')),
                subtitle: Text(item['occurred_at']?.toString() ?? ''),
              );
            },
          ),
        );
      },
    );
  }

  String _label(String type) {
    return switch (type) {
      'meal' => 'Repas / وجبة',
      'nap_end' => 'Fin de sieste / نهاية القيلولة',
      'incident' => 'Incident / حادث',
      _ => type,
    };
  }
}
