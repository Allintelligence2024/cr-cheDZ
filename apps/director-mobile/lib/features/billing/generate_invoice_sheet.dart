import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';

Future<void> showGenerateInvoiceSheet(BuildContext context, DirectorApiClient api,
    {String? contractId, String? childName, VoidCallback? onGenerated}) async {
  final monthCtrl = TextEditingController(text: DateTime.now().toIso8601String().substring(0, 7));
  final dueCtrl = TextEditingController(text: DateTime.now().add(const Duration(days: 10)).toIso8601String().substring(0, 10));

  // P0 (phase 1.8) — GenerateInvoiceDto exige contract_id + period_year +
  // period_month + due_date. L'ancienne sheet n'envoyait que {month} → 400.
  // La génération est par CONTRAT (billing.service.ts:126) : il faut donc
  // connaître le contrat de l'enfant.
  final contractIdCtrl = TextEditingController(text: contractId ?? '');

  final result = await showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    builder: (context) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom, left: 16, right: 16, top: 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Générer une facture', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          TextField(controller: contractIdCtrl, decoration: InputDecoration(
            labelText: 'ID du contrat *',
            prefixIcon: const Icon(Icons.description),
            helperText: childName != null ? 'Contrat actif de $childName' : 'Contrat actif de l\'enfant (UUID)',
          )),
          const SizedBox(height: 8),
          TextField(controller: monthCtrl, decoration: const InputDecoration(labelText: 'Période (YYYY-MM) *', prefixIcon: Icon(Icons.calendar_month))),
          const SizedBox(height: 8),
          TextField(controller: dueCtrl, decoration: const InputDecoration(labelText: 'Échéance (YYYY-MM-DD) *', prefixIcon: Icon(Icons.event))),
          const SizedBox(height: 8),
          const Text('Une facture par contrat et par période (idempotent).', style: TextStyle(fontSize: 11)),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () => Navigator.pop(context, {
              'contract_id': contractIdCtrl.text.trim(),
              'month': monthCtrl.text.trim(),
              'due_date': dueCtrl.text.trim(),
            }),
            child: const Text('Générer'),
          ),
          const SizedBox(height: 16),
        ],
      ),
    ),
  );

  if (result != null && context.mounted) {
    final parts = (result['month'] as String).split('-');
    if (parts.length != 2 || (result['contract_id'] as String).isEmpty) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Contrat et période requis'), backgroundColor: Colors.red));
      return;
    }
    try {
      final res = await api.generateInvoices({
        'contract_id': result['contract_id'],
        'period_year': int.tryParse(parts[0]) ?? DateTime.now().year,
        'period_month': int.tryParse(parts[1]) ?? DateTime.now().month,
        'due_date': result['due_date'],
      });
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
