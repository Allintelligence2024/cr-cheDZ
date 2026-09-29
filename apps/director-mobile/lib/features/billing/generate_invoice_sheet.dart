import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';

Future<void> showGenerateInvoiceSheet(BuildContext context, DirectorApiClient api, {VoidCallback? onGenerated}) async {
  final monthCtrl = TextEditingController(text: DateTime.now().toIso8601String().substring(0, 7));

  final result = await showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    builder: (context) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom, left: 16, right: 16, top: 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Générer factures mensuelles', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          TextField(controller: monthCtrl, decoration: const InputDecoration(labelText: 'Mois (YYYY-MM)', prefixIcon: Icon(Icons.calendar_month))),
          const SizedBox(height: 8),
          Text('Génère les factures pour tous les enfants actifs du mois, depuis contrats + présences. Idempotent.', style: TextStyle(fontSize: 11, color: SereniteStatusColors.of(context).textMuted)),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () => Navigator.pop(context, {'month': monthCtrl.text.trim()}),
            child: const Text('Générer'),
          ),
          const SizedBox(height: 16),
        ],
      ),
    ),
  );

  if (result != null && context.mounted) {
    try {
      final res = await api.generateInvoices({'month': result['month']});
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Factures générées: ${res['created'] ?? res['count'] ?? '?'}'), backgroundColor: SereniteStatusColors.of(context).success));
      onGenerated?.call();
    } catch (e) {
      if (!context.mounted) return;
      final msg = e is DirectorApiException ? (e.message ?? e.kind) : e.toString();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erreur: $msg'), backgroundColor: SereniteStatusColors.of(context).danger));
    }
  }
}
