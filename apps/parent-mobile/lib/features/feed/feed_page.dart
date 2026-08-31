import 'package:flutter/material.dart';
import '../../core/api_client.dart';

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

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<dynamic>>(
      future: _feed,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return const Center(
            child: Text('Fil indisponible / السجل غير متاح'),
          );
        }
        final items = snapshot.data ?? [];
        return RefreshIndicator(
          onRefresh: () async {
            setState(() {
              _feed = widget.api.feed(widget.childId);
            });
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
