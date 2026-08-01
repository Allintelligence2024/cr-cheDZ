import 'package:flutter/material.dart';

import '../../core/sync/sync_engine.dart';

/// Bannière d'état de synchronisation (C09 : renommée SyncBanner pour
/// éviter le conflit avec le widget Material.Banner).
class SyncStatusBanner extends StatelessWidget {
  const SyncStatusBanner({super.key, required this.syncEngine});

  final SyncEngine syncEngine;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<SyncStatus>(
      stream: syncEngine.statusStream,
      builder: (context, snapshot) {
        final status = snapshot.data ?? SyncStatus.idle;
        switch (status) {
          case SyncStatus.syncing:
            return const SyncBanner(
              color: Color(0xFF2196F3),
              icon: Icons.sync,
              messageAr: 'جارٍ المزامنة...',
              messageFr: 'Synchronisation...',
              showSpinner: true,
            );
          case SyncStatus.error:
            return const SyncBanner(
              color: Color(0xFFF44336),
              icon: Icons.sync_problem,
              messageAr: 'خطأ في المزامنة — البيانات محفوظة محلياً',
              messageFr: 'Erreur sync — données sauvegardées localement',
            );
          case SyncStatus.offline:
            return const SyncBanner(
              color: Color(0xFFFF9800),
              icon: Icons.wifi_off,
              messageAr: 'غير متصل — ستتم المزامنة عند الاتصال',
              messageFr: 'Hors ligne — synchronisation dès la connexion',
            );
          case SyncStatus.idle:
            return const SizedBox.shrink();
        }
      },
    );
  }
}

class SyncBanner extends StatelessWidget {
  const SyncBanner({
    super.key,
    required this.color,
    required this.icon,
    required this.messageAr,
    required this.messageFr,
    this.showSpinner = false,
  });

  final Color color;
  final IconData icon;
  final String messageAr;
  final String messageFr;
  final bool showSpinner;

  @override
  Widget build(BuildContext context) {
    final isRtl = Directionality.of(context) == TextDirection.rtl;
    final message = isRtl ? messageAr : messageFr;
    return Container(
      width: double.infinity,
      color: color,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (showSpinner)
            const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
            )
          else
            Icon(icon, color: Colors.white, size: 18),
          const SizedBox(width: 8),
          Text(
            message,
            style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }
}
