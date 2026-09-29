import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/cache_service.dart';
import '../../core/error_state.dart';
import '../../core/widgets/empty_state.dart';
import '../../core/widgets/offline_banner.dart';
import '../../theme/serenite_theme.dart';
import 'generate_invoice_sheet.dart';
import 'invoice_detail_page.dart';

class BillingPage extends StatefulWidget {
  const BillingPage({super.key, required this.api});

  final DirectorApiClient api;

  @override
  State<BillingPage> createState() => _BillingPageState();
}

class _BillingPageState extends State<BillingPage> {
  Map<String, dynamic>? _aged;
  List<dynamic> _invoices = [];
  Object? _error;
  bool _loading = true;
  bool _isOffline = false;
  String _statusFilter = 'all';
  final _cache = CacheService();

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
      final aged = await widget.api.agedBalance();
      final invoices = await widget.api.invoices(status: _statusFilter == 'all' ? null : _statusFilter);
      await _cache.save('aged_balance', aged);
      if (!mounted) return;
      setState(() {
        _aged = aged;
        _invoices = invoices;
        _loading = false;
        _isOffline = false;
      });
    } catch (e) {
      final cached = await _cache.read('aged_balance');
      if (cached != null && mounted && _aged == null) {
        setState(() {
          _aged = cached;
          _loading = false;
          _isOffline = true;
        });
        return;
      }
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return buildApiError(context, _error, _load);

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          OfflineBanner(isOffline: _isOffline),
          if (_isOffline) const SizedBox(height: 8),
          if (_aged != null) _AgedBalanceCard(aged: _aged!),
          const SizedBox(height: 16),
          Row(
            children: [
              Text('Factures', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              const Spacer(),
              IconButton(icon: const Icon(Icons.add), tooltip: 'Générer factures', onPressed: () => showGenerateInvoiceSheet(context, widget.api, onGenerated: _load)),
              DropdownButton<String>(
                value: _statusFilter,
                items: const [
                  DropdownMenuItem(value: 'all', child: Text('Tous')),
                  DropdownMenuItem(value: 'sent', child: Text('Envoyées')),
                  DropdownMenuItem(value: 'partially_paid', child: Text('Partielles')),
                  DropdownMenuItem(value: 'overdue', child: Text('En retard')),
                  DropdownMenuItem(value: 'paid', child: Text('Payées')),
                  DropdownMenuItem(value: 'draft', child: Text('Brouillons')),
                ],
                onChanged: (v) {
                  if (v != null) {
                    setState(() => _statusFilter = v);
                    _load();
                  }
                },
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (_invoices.isEmpty)
            EmptyState(icon: Icons.receipt_long, title: 'Aucune facture', subtitle: 'Filtre: $_statusFilter — essayez Tous ou générez les factures du mois', action: ElevatedButton.icon(onPressed: () => showGenerateInvoiceSheet(context, widget.api, onGenerated: _load), icon: const Icon(Icons.add), label: const Text('Générer')))
          else
            ..._invoices.map((inv) {
              final m = inv as Map<String, dynamic>;
              return Card(
                child: ListTile(
                  title: Text(m['invoice_number']?.toString() ?? 'Facture', style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text(
                      '${m['first_name_fr'] ?? ''} ${m['last_name_fr'] ?? ''} — ${m['total_amount'] ?? ''} DZD — ${m['status'] ?? ''}\nÉchéance: ${m['due_date']?.toString().substring(0, 10) ?? ''}',
                      style: const TextStyle(fontSize: 12)),
                  trailing: _statusBadge(m['status']?.toString() ?? ''),
                  onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => InvoiceDetailPage(api: widget.api, invoiceId: m['id'].toString()))),
                ),
              );
            }),
        ],
      ),
    );
  }

  Widget _statusBadge(String status) {
    Color c;
    switch (status) {
      case 'paid':
        c = Colors.green;
        break;
      case 'overdue':
        c = Colors.red;
        break;
      case 'partially_paid':
        c = Colors.orange;
        break;
      case 'sent':
        c = Colors.blue;
        break;
      default:
        c = Colors.grey;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
      child: Text(status, style: TextStyle(color: c, fontSize: 10, fontWeight: FontWeight.bold)),
    );
  }
}

class _AgedBalanceCard extends StatelessWidget {
  const _AgedBalanceCard({required this.aged});

  final Map<String, dynamic> aged;

  @override
  Widget build(BuildContext context) {
    final palette = SereniteStatusColors.of(context);
    final buckets = aged['buckets'] as Map<String, dynamic>? ?? aged;
    final total = aged['total'] ?? aged['total_balance'] ?? buckets['total'] ?? 0;

    Widget bucket(String label, dynamic value, Color color) => Expanded(
          child: Column(
            children: [
              Text(label, style: TextStyle(fontSize: 10, color: palette.textMuted)),
              const SizedBox(height: 4),
              Text('${value ?? 0}', style: TextStyle(fontWeight: FontWeight.bold, color: color, fontSize: 13)),
            ],
          ),
        );

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.account_balance_wallet, size: 18, color: Theme.of(context).colorScheme.primary),
                const SizedBox(width: 6),
                Text('Balance âgée', style: const TextStyle(fontWeight: FontWeight.bold)),
                const Spacer(),
                Text('Total: $total DZD', style: TextStyle(fontWeight: FontWeight.bold, color: palette.danger)),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                bucket('0-30j', buckets['0-30'] ?? buckets['current'] ?? buckets['0_30'], palette.success),
                bucket('31-60j', buckets['31-60'] ?? buckets['31_60'], Colors.orange),
                bucket('61-90j', buckets['61-90'] ?? buckets['61_90'], Colors.deepOrange),
                bucket('90j+', buckets['90+'] ?? buckets['90_plus'] ?? buckets['over_90'], palette.danger),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
