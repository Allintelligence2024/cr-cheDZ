import 'package:flutter/material.dart';
import '../../core/api_client.dart';

/// Deux gestes : ouvrir puis confirmer. Aucune absence n'est envoyée au premier tap.
Future<void> showAbsenceSheet(
  BuildContext context,
  ParentApiClient api,
  String childId,
) {
  return showModalBottomSheet<void>(
    context: context,
    builder: (sheetContext) => Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('Signaler une absence / الإبلاغ عن غياب'),
          const SizedBox(height: 12),
          const Text('Confirmez-vous l’absence de votre enfant aujourd’hui ?'),
          const SizedBox(height: 20),
          FilledButton.icon(
            icon: const Icon(Icons.check),
            label: const Text('Confirmer l’absence / تأكيد الغياب'),
            onPressed: () async {
              await api.absence(childId);
              if (sheetContext.mounted) {
                Navigator.pop(sheetContext);
              }
            },
          ),
        ],
      ),
    ),
  );
}
