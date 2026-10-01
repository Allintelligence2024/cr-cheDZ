import 'package:flutter/material.dart';

import '../../theme/serenite_theme.dart';

class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key, required this.isOffline});

  final bool isOffline;

  @override
  Widget build(BuildContext context) {
    if (!isOffline) return const SizedBox.shrink();
    final palette = SereniteStatusColors.of(context);
    return Container(
      width: double.infinity,
      color: palette.warningBg,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          Icon(Icons.wifi_off, size: 16, color: palette.warning),
          const SizedBox(width: 8),
          Text('Hors ligne — données en cache (5 min)', style: TextStyle(fontSize: 12, color: palette.warning, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}
