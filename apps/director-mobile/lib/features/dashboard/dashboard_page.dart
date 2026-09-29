import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/cache_service.dart';
import '../../core/connectivity_service.dart';
import '../../core/error_state.dart';
import '../../core/widgets/empty_state.dart';
import '../../core/widgets/offline_banner.dart';
import '../../theme/serenite_theme.dart';
import 'ratio_card.dart';
import 'alert_section.dart';
import 'widgets/attendance_chart.dart';
import 'widgets/billing_chart.dart';

class DashboardPage extends StatefulWidget {
  const DashboardPage({super.key, required this.api, required this.cache});

  final DirectorApiClient api;
  final CacheService cache;

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  Map<String, dynamic>? _data;
  Map<String, dynamic>? _agedForChart;
  Object? _error;
  bool _loading = true;
  bool _isOffline = false;
  final _connectivity = ConnectivityService();

  @override
  void initState() {
    super.initState();
    _load();
    _connectivity.onConnectivityChanged.listen((online) {
      if (mounted) setState(() => _isOffline = !online);
    });
    _checkOnline();
  }

  Future<void> _checkOnline() async {
    final online = await _connectivity.isOnline();
    if (mounted) setState(() => _isOffline = !online);
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        widget.api.dashboard(),
        widget.api.agedBalance().catchError((_) => <String, dynamic>{}),
      ]);
      final data = results[0] as Map<String, dynamic>;
      final aged = results[1] as Map<String, dynamic>;
      await widget.cache.save('dashboard', data);
      if (!mounted) return;
      setState(() {
        _data = data;
        _agedForChart = aged.isNotEmpty ? aged : null;
        _loading = false;
        _isOffline = false;
      });
    } catch (e) {
      // Try cache fallback
      final cached = await widget.cache.read('dashboard');
      if (cached != null && mounted) {
        setState(() {
          _data = cached;
          _loading = false;
          _isOffline = true;
          _error = null;
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
  void dispose() {
    _connectivity.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return buildApiError(context, _error, _load);
    }
    final data = _data!;
    final rooms = (data['rooms'] as List?) ?? [];
    final ratios = (data['ratios'] as List?) ?? [];
    final alerts = (data['alerts'] as Map<String, dynamic>?) ?? {};

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          OfflineBanner(isOffline: _isOffline),
          if (_isOffline) const SizedBox(height: 8),
          _header(context, data['date']?.toString() ?? ''),
          const SizedBox(height: 16),
          if (ratios.isNotEmpty) ...[
            Text('Ratios d\'encadrement', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            ...ratios.map((r) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: RatioCard(ratio: r as Map<String, dynamic>),
                )),
            const SizedBox(height: 16),
          ],
          Text('Salles — ${data['date'] ?? ''}', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          if (rooms.isEmpty)
            const EmptyState(icon: Icons.meeting_room, title: 'Aucune salle', subtitle: 'Vérifiez la configuration sites/salles')
          else
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                childAspectRatio: 1.4,
                crossAxisSpacing: 8,
                mainAxisSpacing: 8,
              ),
              itemCount: rooms.length,
              itemBuilder: (context, i) {
                final room = rooms[i] as Map<String, dynamic>;
                return _RoomCard(room: room);
              },
            ),
          const SizedBox(height: 16),
          if (rooms.isNotEmpty) AttendanceChart(rooms: rooms),
          const SizedBox(height: 12),
          if (data['alerts']?['unpaid_invoices'] != null || _agedForChart != null) BillingChart(aged: _agedForChart ?? {'buckets': {}, 'total': 0}),
          const SizedBox(height: 16),
          AlertSection(alerts: alerts),
          const SizedBox(height: 16),
          Card(
            color: SereniteStatusColors.of(context).surfaceAlt,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Icon(Icons.info_outline, size: 16, color: SereniteStatusColors.of(context).textFaint),
                  const SizedBox(width: 8),
                  Expanded(child: Text('Données en cache 5 min en cas hors ligne. Pull-to-refresh pour actualiser.', style: TextStyle(fontSize: 11, color: SereniteStatusColors.of(context).textFaint))),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _header(BuildContext context, String date) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(Icons.dashboard, color: Theme.of(context).colorScheme.primary, size: 32),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Tableau de bord', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
                  Text(date.isEmpty ? 'Aujourd\'hui' : 'Date : $date', style: TextStyle(color: SereniteStatusColors.of(context).textMuted)),
                ],
              ),
            ),
            IconButton(icon: const Icon(Icons.refresh), onPressed: _load, tooltip: 'Actualiser'),
          ],
        ),
      ),
    );
  }
}

class _RoomCard extends StatelessWidget {
  const _RoomCard({required this.room});

  final Map<String, dynamic> room;

  @override
  Widget build(BuildContext context) {
    final palette = SereniteStatusColors.of(context);
    int fmt(dynamic v) => (v is int) ? v : int.tryParse(v.toString()) ?? 0;

    Widget stat(String label, int value, Color color) => Column(
          children: [
            Text('$value', style: TextStyle(fontWeight: FontWeight.bold, color: color, fontSize: 18)),
            Text(label, style: TextStyle(fontSize: 11, color: palette.textMuted)),
          ],
        );

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(room['room_name']?.toString() ?? 'Salle', style: const TextStyle(fontWeight: FontWeight.bold), maxLines: 1, overflow: TextOverflow.ellipsis),
            Text(room['site_name']?.toString() ?? '', style: TextStyle(fontSize: 11, color: palette.textFaint)),
            const Spacer(),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                stat('Prés', fmt(room['present']), palette.success),
                stat('Att', fmt(room['expected']), palette.info),
                stat('Part', fmt(room['departed']), palette.textFaint),
                stat('Abs', fmt(room['absent']), palette.danger),
              ],
            ),
            const SizedBox(height: 4),
            Text('Total: ${fmt(room['total_children'])}', style: TextStyle(fontSize: 11, color: palette.textMuted)),
          ],
        ),
      ),
    );
  }
}
