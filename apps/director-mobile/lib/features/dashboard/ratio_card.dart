import 'package:flutter/material.dart';

import '../../theme/serenite_theme.dart';

class RatioCard extends StatelessWidget {
  const RatioCard({super.key, required this.ratio});

  final Map<String, dynamic> ratio;

  Color _colorFor(String status, SereniteStatusColors palette) {
    switch (status) {
      case 'breach':
        return palette.danger;
      case 'warning':
        return palette.warning;
      case 'ok':
        return palette.success;
      default:
        return palette.textFaint;
    }
  }

  String _labelFor(String status) {
    switch (status) {
      case 'breach':
        return 'Non conforme';
      case 'warning':
        return 'Limite proche';
      case 'ok':
        return 'Conforme';
      case 'empty':
        return 'Vide';
      default:
        return status;
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = SereniteStatusColors.of(context);
    final status = (ratio['status'] ?? 'empty').toString();
    final color = _colorFor(status, palette);
    final roomName = ratio['room_name']?.toString() ?? ratio['room_id']?.toString() ?? 'Salle';
    final children = ratio['present_children'] ?? ratio['children_count'] ?? 0;
    final educators = ratio['educator_count'] ?? ratio['educators'] ?? 0;
    final required = ratio['required_educators'] ?? '?';
    final headroom = ratio['headroom'];
    final reasons = (ratio['reasons'] as List?)?.map((e) => e.toString()).toList() ?? [];

    return Card(
      color: status == 'breach' ? palette.dangerBg : status == 'warning' ? palette.warningBg : null,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(12)),
                  child: Text(_labelFor(status), style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 11)),
                ),
                const SizedBox(width: 8),
                Expanded(child: Text(roomName, style: const TextStyle(fontWeight: FontWeight.w600))),
                Text('$children enf / $educators éduc', style: TextStyle(fontSize: 12, color: palette.textMuted)),
              ],
            ),
            if (reasons.isNotEmpty) ...[
              const SizedBox(height: 6),
              ...reasons.map((r) => Text('• $r', style: TextStyle(fontSize: 11, color: palette.textMuted))),
            ],
            if (headroom != null) ...[
              const SizedBox(height: 4),
              Text('Places restantes : $headroom', style: TextStyle(fontSize: 11, color: palette.textMuted, fontStyle: FontStyle.italic)),
            ],
            if (required != '?' && status != 'ok') ...[
              const SizedBox(height: 2),
              Text('Requis : $required éducateurs', style: TextStyle(fontSize: 11, color: color)),
            ],
          ],
        ),
      ),
    );
  }
}
