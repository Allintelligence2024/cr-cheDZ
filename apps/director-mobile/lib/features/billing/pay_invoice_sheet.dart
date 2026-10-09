import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';

Future<void> showPayInvoiceSheet(BuildContext context, DirectorApiClient api, String invoiceId, {VoidCallback? onPaid}) async {
  final amountCtrl = TextEditingController();
  String method = 'cash';

  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (context) => StatefulBuilder(
      builder: (context, setState) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom, left: 16, right: 16, top: 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Encaisser paiement', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            TextField(controller: amountCtrl, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Montant DZD *', prefixIcon: Icon(Icons.payments))),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: method,
              decoration: const InputDecoration(labelText: 'Méthode', prefixIcon: Icon(Icons.account_balance_wallet)),
              items: const [
                DropdownMenuItem(value: 'cash', child: Text('Espèces')),
                DropdownMenuItem(value: 'bank_transfer', child: Text('Virement')),
                DropdownMenuItem(value: 'check', child: Text('Chèque')),
                DropdownMenuItem(value: 'online', child: Text('En ligne')),
              ],
              onChanged: (v) => setState(() => method = v ?? 'cash'),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () async {
                if (amountCtrl.text.trim().isEmpty) {
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Montant requis')));
                  return;
                }
                try {
                  // P0 (phase 1.8) — POST /billing/invoices/:id/payments
                  // n'existe pas. Routes réelles : POST /billing/payments/cash
                  // (RecordCashPaymentDto) et /billing/payments/online.
                  // L'ancien payment_method 'cash|bank_transfer|check' est
                  // devenu cash (route dédiée) ; 'online' via la route online.
                  if (method == 'online') {
                    await api.payInvoiceOnline({
                      'invoice_id': invoiceId,
                      'amount': double.tryParse(amountCtrl.text.trim()) ?? 0,
                    });
                  } else {
                    await api.payInvoiceCash({
                      'invoice_id': invoiceId,
                      'amount': double.tryParse(amountCtrl.text.trim()) ?? 0,
                    });
                  }
                  if (context.mounted) Navigator.pop(context, true);
                } catch (e) {
                  final msg = e is DirectorApiException ? (e.message ?? e.kind) : e.toString();
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erreur: $msg'), backgroundColor: SereniteStatusColors.of(context).danger));
                }
              },
              child: const Text('Encaisser'),
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    ),
  );

  if (result == true) {
    onPaid?.call();
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: const Text('Paiement enregistré'), backgroundColor: SereniteStatusColors.of(context).success));
  }
}
