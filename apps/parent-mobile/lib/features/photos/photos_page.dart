import 'package:flutter/material.dart';
import '../../core/api_client.dart';

/// URLs déjà signées par l'API après contrôle child_guardians + consentement actuel.
class PhotosPage extends StatefulWidget {
  const PhotosPage({
    super.key,
    required this.api,
    required this.childId,
  });

  final ParentApiClient api;
  final String childId;

  @override
  State<PhotosPage> createState() => _PhotosPageState();
}

class _PhotosPageState extends State<PhotosPage> {
  late Future<List<dynamic>> _photos;

  @override
  void initState() {
    super.initState();
    _photos = widget.api.photos(widget.childId);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<dynamic>>(
      future: _photos,
      builder: (context, s) {
        if (!s.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final items = s.data!;
        return GridView.builder(
          padding: const EdgeInsets.all(12),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            crossAxisSpacing: 8,
            mainAxisSpacing: 8,
          ),
          itemCount: items.length,
          itemBuilder: (context, i) {
            final p = items[i] as Map<String, dynamic>;
            return ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.network(
                p['url'] as String,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => const ColoredBox(
                  color: Colors.black12,
                  child: Icon(Icons.broken_image),
                ),
              ),
            );
          },
        );
      },
    );
  }
}
