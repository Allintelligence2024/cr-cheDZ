import 'package:flutter/material.dart';

import '../../theme/serenite_theme.dart';

class AlertSection extends StatelessWidget {
  const AlertSection({super.key, required this.alerts});

  final Map<String, dynamic> alerts;

  @override
  Widget build(BuildContext context) {
    final palette = SereniteStatusColors.of(context);

    List<dynamic> listFor(String key) {
      final v = alerts[key];
      if (v is List) return v;
      return [];
    }

    Widget section(String title, IconData icon, Color color, List<dynamic> items, Widget Function(dynamic) itemBuilder) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, size: 18, color: color),
                  const SizedBox(width: 6),
                  Text('$title (${items.length})', style: const TextStyle(fontWeight: FontWeight.bold)),
                ],
              ),
              const SizedBox(height: 8),
              if (items.isEmpty)
                Text('Aucune alerte', style: TextStyle(fontSize: 12, color: palette.textMuted))
              else
                ...items.take(10).map(itemBuilder),
              if (items.length > 10)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text('+ ${items.length - 10} autres', style: TextStyle(fontSize: 11, color: palette.textFaint)),
                ),
            ],
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Alertes opérationnelles', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        section('Ratios non conformes', Icons.warning, palette.danger, listFor('ratio_breaches'), (item) {
          final m = item as Map;
          return Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text('• ${m['room_name'] ?? m['room_id']}: ${m['status'] ?? m['reason'] ?? ''}',
                style: const TextStyle(fontSize: 12)),
          );
        }),
        section('Enfants non pointés', Icons.child_care, palette.info, listFor('children_not_checked_in'), (item) {
          final m = item as Map;
          return Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text('• ${m['first_name_fr'] ?? ''} ${m['last_name_fr'] ?? ''} — ${m['room_name'] ?? ''}',
                style: const TextStyle(fontSize: 12)),
          );
        }),
        section('Documents expirants (30j)', Icons.description, palette.warning, listFor('documents_expiring'), (item) {
          final m = item as Map;
          return Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text('• ${m['first_name'] ?? ''} ${m['last_name'] ?? ''} — ${m['document_type']} (${m['expiry_date']?.toString().substring(0, 10) ?? ''})',
                style: const TextStyle(fontSize: 12)),
          );
        }),
        section('Factures impayées', Icons.receipt_long, palette.danger, listFor('unpaid_invoices'), (item) {
          final m = item as Map;
          return Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text('• ${m['invoice_number']}: ${m['first_name_fr'] ?? ''} — ${m['balance'] ?? m['total_amount'] ?? ''} DZD',
                style: const TextStyle(fontSize: 12)),
          );
        }),
        section('Incidents 24h', Icons.report, palette.danger, listFor('recent_incidents'), (item) {
          final m = item as Map;
          return Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text('• ${m['first_name_fr'] ?? ''} ${m['last_name_fr'] ?? ''} — ${m['incident_severity']}: ${m['incident_description']?.toString().substring(0, 60) ?? ''}',
                style: const TextStyle(fontSize: 12)),
          );
        }),
      ],
    );
  }
}
