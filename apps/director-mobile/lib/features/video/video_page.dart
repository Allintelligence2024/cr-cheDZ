import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../core/widgets/empty_state.dart';
import '../../theme/serenite_theme.dart';

class VideoPage extends StatefulWidget {
  const VideoPage({super.key, required this.api});

  final DirectorApiClient api;

  @override
  State<VideoPage> createState() => _VideoPageState();
}

class _VideoPageState extends State<VideoPage> {
  List<dynamic> _cameras = [];
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
      final cams = await widget.api.videoCameras();
      if (!mounted) return;
      setState(() {
        _cameras = cams;
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
    if (_error != null) {
      return EmptyState(
        icon: Icons.videocam_off,
        title: 'Vidéosurveillance non active',
        subtitle: 'Module V1 : flag exigeant DPIA approuvée (046, inactif par défaut). Purge 30j par worker. Voir docs/regulatory. Erreur: $_error',
        action: ElevatedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Réessayer')),
      );
    }

    if (_cameras.isEmpty) {
      return EmptyState(icon: Icons.videocam, title: 'Aucune caméra', subtitle: 'Ajoutez des caméras depuis admin-web /video (zones limitées par DPIA)');
    }

    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: _cameras.length,
      itemBuilder: (context, i) {
        final cam = _cameras[i] as Map<String, dynamic>;
        return Card(
          child: ListTile(
            leading: Icon(Icons.videocam, color: Theme.of(context).colorScheme.primary),
            title: Text(cam['name']?.toString() ?? 'Caméra ${i + 1}'),
            subtitle: Text('Zone: ${cam['zone'] ?? ''} — ${cam['is_active'] == true ? 'Active' : 'Inactive'}'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _showClips(cam),
          ),
        );
      },
    );
  }

  void _showClips(Map<String, dynamic> cam) {
    showModalBottomSheet(context: context, builder: (context) => Padding(padding: const EdgeInsets.all(16), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [Text('Clips ${cam['name']}', style: const TextStyle(fontWeight: FontWeight.bold)), const SizedBox(height: 8), Text('Acquisition absente en V1 — aucun écran n\'envoie de clip (verrou phase21). POST /video/clips/presign-upload fail-closed sans sous-domaine public.', style: TextStyle(fontSize: 11, color: SereniteStatusColors.of(context).textMuted)), const SizedBox(height: 8), const Text('Purge 30j par worker (stockage d\'abord, jamais fausse purge). Visionnage journalisé read.', style: TextStyle(fontSize: 11))])) );
  }
}
