import 'dart:typed_data';

import 'package:flutter/material.dart';
import '../../core/api_client.dart';

/// Photos de l'enfant.
///
/// LOT 2 (P0 F5) — avant : `Image.network(p['url'])` sur une URL signée MinIO
/// (`http://minio:9000/...` en production, service lié à 127.0.0.1) : le parent
/// voyait une image cassée pour chaque photo, alors que l'API avait bien
/// contrôlé la filiation et le consentement. Désormais l'API sert les octets
/// en same-origin et ce chemin exige l'en-tête Authorization : les octets sont
/// donc récupérés par `ParentApiClient.photoContent` (contrôles serveur
/// complets : `child_guardians` vivant + consentement photo courant à chaque
/// lecture) puis affichés depuis la mémoire.
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

  /// Octets par identifiant de média : une photo n'est demandée qu'une fois
  /// par affichage (elle reste journalisée côté API à chaque appel).
  final Map<String, Future<Uint8List>> _bytes = <String, Future<Uint8List>>{};

  @override
  void initState() {
    super.initState();
    _photos = widget.api.photos(widget.childId);
  }

  Future<Uint8List> _content(String mediaId) =>
      _bytes.putIfAbsent(mediaId, () => widget.api.photoContent(widget.childId, mediaId));

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<dynamic>>(
      future: _photos,
      builder: (context, s) {
        if (s.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                'Photos indisponibles',
                textAlign: TextAlign.center,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          );
        }
        if (!s.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final items = s.data!;
        if (items.isEmpty) {
          return const Center(child: Text('Aucune photo partagée'));
        }
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
            final mediaId = p['id'] as String? ?? p['media_id'] as String? ?? '';
            return ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: mediaId.isEmpty
                  ? const _PhotoPlaceholder()
                  : FutureBuilder<Uint8List>(
                      future: _content(mediaId),
                      builder: (context, bytes) {
                        if (bytes.hasData) {
                          return Image.memory(bytes.data!, fit: BoxFit.cover);
                        }
                        if (bytes.hasError) {
                          return const _PhotoPlaceholder();
                        }
                        return const ColoredBox(
                          color: Colors.black12,
                          child: Center(child: CircularProgressIndicator()),
                        );
                      },
                    ),
            );
          },
        );
      },
    );
  }
}

class _PhotoPlaceholder extends StatelessWidget {
  const _PhotoPlaceholder();

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: const Icon(Icons.broken_image),
    );
  }
}
