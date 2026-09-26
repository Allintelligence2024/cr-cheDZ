import 'package:flutter/material.dart';

import 'api_client.dart';

/// État d'erreur homogène des écrans parent (audit 2026-09-24, item C2 ; lot L3).
///
/// Avant : trois écrans (`fil du jour`, `consentements`, liste d'enfants)
/// n'affichaient QUE l'état « pas encore de données » — une erreur laissait donc
/// un indicateur de chargement **infini**, et rien ne distinguait une coupure
/// réseau d'une session expirée. Ici :
///   - **session expirée** (le refresh a échoué) → message de reconnexion,
///     *sans* bouton « Réessayer » : insister ne servirait à rien, le parent doit
///     refaire un OTP ;
///   - **hors-ligne** → message réseau + « Réessayer » ;
///   - **autre** (5xx…) → « indisponible » + « Réessayer ».
Widget buildApiError(BuildContext context, Object? error, VoidCallback onRetry) {
  if (error is ParentSessionExpired) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Text(
          'Session expirée — reconnectez-vous / انتهت الجلسة، أعد تسجيل الدخول',
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
  final message = error is ParentApiException && error.isOffline
      ? 'Pas de réseau / لا يوجد اتصال'
      : 'Indisponible pour le moment / غير متاح حالياً';
  return Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: onRetry,
            child: const Text('Réessayer / إعادة المحاولة'),
          ),
        ],
      ),
    ),
  );
}
