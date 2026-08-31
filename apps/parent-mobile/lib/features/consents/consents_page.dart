import 'package:flutter/material.dart';
import '../../core/api_client.dart';

class ConsentsPage extends StatefulWidget {
  const ConsentsPage({super.key, required this.api, required this.childId});
  final ParentApiClient api;
  final String childId;
  @override State<ConsentsPage> createState() => _ConsentsPageState();
}

class _ConsentsPageState extends State<ConsentsPage> {
  late Future<List<dynamic>> _items;

  @override
  void initState() {
    super.initState();
    _items = widget.api.consents(widget.childId);
  }

  Future<void> _toggle(String type, bool value) async {
    await widget.api.saveConsent(widget.childId, type, value);
    setState(() => _items = widget.api.consents(widget.childId));
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<List<dynamic>>(
    future: _items,
    builder: (context, s) {
      if (!s.hasData) return const Center(child: CircularProgressIndicator());
      final photo = s.data!
          .whereType<Map>()
          .where((x) => x['consent_type'] == 'photo_individual')
          .cast<Map<String, dynamic>>()
          .firstOrNull;
      final granted = photo?['granted'] == true && photo?['revoked_at'] == null;
      return ListView(
        children: [
          SwitchListTile(
            title: const Text('Photos individuelles / الصور الفردية'),
            subtitle: const Text('Le retrait coupe immédiatement l\'accès aux nouvelles URLs.'),
            value: granted,
            onChanged: (v) => _toggle('photo_individual', v),
          ),
        ],
      );
    },
  );
}

extension _FirstOrNull<E> on Iterable<E> {
  E? get firstOrNull => isEmpty ? null : first;
}