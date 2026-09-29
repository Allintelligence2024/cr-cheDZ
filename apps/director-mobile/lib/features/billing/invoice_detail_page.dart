import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';

class InvoiceDetailPage extends StatefulWidget {
  const InvoiceDetailPage({super.key, required this.api, required this.invoiceId});

  final DirectorApiClient api;
  final String invoiceId;

  @override
  State<InvoiceDetailPage> createState() => _InvoiceDetailPageState();
}

class _InvoiceDetailPageState extends State<InvoiceDetailPage> {
  Map<String, dynamic>? _invoice;
  Object? _error;
  bool _loading = true;
  bool _actionLoading = false;

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
      final inv = await widget.api.invoiceDetail(widget.invoiceId);
      if (!mounted) return;
      setState(() {
        _invoice = inv;
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

  Future<void> _action(Future<Map<String, dynamic>> Function() fn, String successMsg) async {
    setState(() => _actionLoading = true);
    try {
      await fn();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(successMsg), backgroundColor: SereniteStatusColors.of(context).success));
      _load();
    } catch (e) {
      if (!mounted) return;
      final msg = e is DirectorApiException ? (e.message ?? e.kind) : e.toString();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erreur: $msg'), backgroundColor: SereniteStatusColors.of(context).danger));
    } finally {
      if (mounted) setState(() => _actionLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Facture')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? buildApiError(context, _error, _load)
              : _buildDetail(),
    );
  }

  Widget _buildDetail() {
    final inv = _invoice!;
    final lines = (inv['lines'] as List?) ?? [];
    final status = inv['status']?.toString() ?? '';
    final palette = SereniteStatusColors.of(context);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(inv['invoice_number']?.toString() ?? 'Facture', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Text('Enfant: ${inv['first_name_fr'] ?? ''} ${inv['last_name_fr'] ?? ''}'),
                Text('Statut: $status', style: TextStyle(fontWeight: FontWeight.bold, color: _statusColor(status, palette))),
                Text('Total: ${inv['total_amount'] ?? 0} DZD'),
                Text('Payé: ${inv['paid_amount'] ?? 0} DZD'),
                Text('Balance: ${inv['balance'] ?? 0} DZD', style: TextStyle(fontWeight: FontWeight.bold, color: palette.danger)),
                Text('Échéance: ${inv['due_date']?.toString().substring(0, 10) ?? ''}'),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text('Lignes', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        ...lines.map((l) {
          final m = l as Map<String, dynamic>;
          return Card(
            child: ListTile(
              title: Text(m['description']?.toString() ?? m['label']?.toString() ?? 'Ligne'),
              subtitle: Text('Qté: ${m['quantity'] ?? 1} × ${m['unit_price'] ?? m['amount'] ?? 0} DZD'),
              trailing: Text('${m['total'] ?? m['amount'] ?? 0} DZD', style: const TextStyle(fontWeight: FontWeight.bold)),
            ),
          );
        }),
        const SizedBox(height: 24),
        if (_actionLoading)
          const Center(child: CircularProgressIndicator())
        else
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (status == 'draft')
                ElevatedButton.icon(
                  onPressed: () => _action(() => widget.api.sendInvoice(widget.invoiceId), 'Facture envoyée'),
                  icon: const Icon(Icons.send),
                  label: const Text('Envoyer'),
                ),
              if (status == 'sent' || status == 'partially_paid')
                ElevatedButton.icon(
                  onPressed: () => _action(() => widget.api.markOverdue(widget.invoiceId), 'Marquée en retard'),
                  icon: const Icon(Icons.warning),
                  label: const Text('Marquer en retard'),
                  style: ElevatedButton.styleFrom(backgroundColor: palette.warning, foregroundColor: palette.onWarning),
                ),
              ElevatedButton.icon(
                onPressed: () => _showReminderDialog(),
                icon: const Icon(Icons.email),
                label: const Text('Relance'),
              ),
            ],
          ),
      ],
    );
  }

  Color _statusColor(String status, SereniteStatusColors palette) {
    switch (status) {
      case 'paid':
        return palette.success;
      case 'overdue':
        return palette.danger;
      case 'partially_paid':
        return palette.warning;
      default:
        return palette.textMuted;
    }
  }

  Future<void> _showReminderDialog() async {
    final noteCtrl = TextEditingController();
    int level = 1;
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Envoyer relance'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButton<int>(
                value: level,
                items: const [
                  DropdownMenuItem(value: 1, child: Text('Niveau 1 — Rappel amical')),
                  DropdownMenuItem(value: 2, child: Text('Niveau 2 — Rappel ferme')),
                  DropdownMenuItem(value: 3, child: Text('Niveau 3 — Mise en demeure')),
                ],
                onChanged: (v) => setState(() => level = v ?? 1),
              ),
              const SizedBox(height: 12),
              TextField(controller: noteCtrl, decoration: const InputDecoration(labelText: 'Note (optionnel)'), maxLines: 3),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
            FilledButton(onPressed: () => Navigator.pop(context, {'level': level, 'notes': noteCtrl.text}), child: const Text('Envoyer')),
          ],
        ),
      ),
    );
    if (result != null) {
      _action(() => widget.api.addReminder(widget.invoiceId, {'level': result['level'], 'notes': result['notes'], 'channel': 'email'}), 'Relance envoyée');
    }
  }
}
