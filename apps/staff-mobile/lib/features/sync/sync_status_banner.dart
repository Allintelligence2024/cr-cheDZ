import 'package:flutter/material.dart';

import '../../core/sync/sync_engine.dart';
import '../../theme/serenite_theme.dart';

/// Bannière d'état de synchronisation (C09 : renommée SyncBanner pour
/// éviter le conflit avec le widget Material.Banner).
///
/// Les couleurs viennent du thème Sérénité : en mode sombre l'alerte devient
/// un jaune clair, sur lequel du texte blanc serait illisible — d'où le couple
/// fond / premier plan ([SyncBanner.color] + [SyncBanner.foregroundColor])
/// fourni par la palette plutôt qu'un `Colors.white` en dur.
class SyncStatusBanner extends StatelessWidget {
  const SyncStatusBanner({super.key, required this.syncEngine});

  final SyncEngine syncEngine;

  @override
  Widget build(BuildContext context) {
    final palette = SereniteStatusColors.of(context);
    return StreamBuilder<SyncStatus>(
      stream: syncEngine.statusStream,
      builder: (context, snapshot) {
        final status = snapshot.data ?? syncEngine.currentStatus;
        switch (status) {
          case SyncStatus.syncing:
            return SyncBanner(
              color: palette.info,
              foregroundColor: palette.onInfo,
              icon: Icons.sync,
              messageAr: 'جارٍ المزامنة...',
              messageFr: 'Synchronisation...',
              showSpinner: true,
            );
          case SyncStatus.error:
            return SyncBanner(
              color: palette.danger,
              foregroundColor: palette.onDanger,
              icon: Icons.sync_problem,
              messageAr: 'خطأ في المزامنة — البيانات محفوظة محلياً',
              messageFr: 'Erreur sync — données sauvegardées localement',
            );
          case SyncStatus.offline:
            return SyncBanner(
              color: palette.warning,
              foregroundColor: palette.onWarning,
              icon: Icons.wifi_off,
              messageAr: 'غير متصل — ستتم المزامنة عند الاتصال',
              messageFr: 'Hors ligne — synchronisation dès la connexion',
            );
          case SyncStatus.authenticationRequired:
            return SyncBanner(
              color: palette.danger,
              foregroundColor: palette.onDanger,
              icon: Icons.lock,
              messageAr: 'انتهت الجلسة — أعد تسجيل الدخول، البيانات محفوظة',
              messageFr: 'Session expirée — reconnectez-vous, données conservées',
            );
          case SyncStatus.contractError:
            return SyncBanner(
              color: palette.danger,
              foregroundColor: palette.onDanger,
              icon: Icons.system_update,
              messageAr: 'المزامنة متوقفة — تحقق من إصدار التطبيق',
              messageFr: 'Sync bloquée — vérifier le contrat ou mettre à jour',
            );
          case SyncStatus.deviceRevoked:
            return SyncBanner(
              color: palette.danger,
              foregroundColor: palette.onDanger,
              icon: Icons.block,
              messageAr: 'الجهاز ملغى أو الوصول مرفوض — اتصل بالإدارة',
              messageFr: 'Appareil révoqué ou accès refusé — contacter la direction',
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
    this.foregroundColor = Colors.white,
    this.showSpinner = false,
  });

  final Color color;
  final Color foregroundColor;
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
            SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                color: foregroundColor,
                strokeWidth: 2,
              ),
            )
          else
            Icon(icon, color: foregroundColor, size: 18),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              message,
              style: TextStyle(
                color: foregroundColor,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
