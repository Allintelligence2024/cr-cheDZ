import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../core/widgets/empty_state.dart';
import '../../theme/serenite_theme.dart';

class AnalyticsPage extends StatefulWidget {
  const AnalyticsPage({super.key, required this.api});

  final DirectorApiClient api;

  @override
  State<AnalyticsPage> createState() => _AnalyticsPageState();
}

class _AnalyticsPageState extends State<AnalyticsPage> {
  Map<String, dynamic>? _overview;
  List<dynamic> _attendanceTrend = [];
  List<dynamic> _billingTrend = [];
  List<dynamic> _revenueTrend = [];
  Map<String, dynamic>? _occupancy;
  Object? _error;
  bool _loading = true;

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
      final results = await Future.wait([
        widget.api.analyticsOverview(),
        widget.api.analyticsAttendance(),
        widget.api.analyticsBilling(),
        widget.api.analyticsRevenue(),
        widget.api.analyticsOccupancy(),
      ]);
      if (!mounted) return;
      setState(() {
        _overview = results[0];
        _attendanceTrend = results[1]['data'] as List<dynamic>? ?? [];
        _billingTrend = results[2]['data'] as List<dynamic>? ?? [];
        _revenueTrend = results[3]['data'] as List<dynamic>? ?? [];
        _occupancy = results[4];
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

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return buildApiError(context, _error, _load);
    if (_overview == null) return const EmptyState(icon: Icons.analytics, title: 'Aucune donnée analytics');

    final kpis = _overview!['kpis'] as Map<String, dynamic>? ?? {};
    final attendanceToday = kpis['attendance_today'] as Map<String, dynamic>? ?? {};
    final billingMonth = kpis['billing_month'] as Map<String, dynamic>? ?? {};
    final aged = kpis['aged_balance'] as Map<String, dynamic>? ?? {};
    final staff = kpis['staff'] as Map<String, dynamic>? ?? {};
    final incidents = kpis['incidents_7d'] as Map<String, dynamic>? ?? {};

    final palette = SereniteStatusColors.of(context);

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Header
          Card(
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                gradient: LinearGradient(colors: [Theme.of(context).colorScheme.primary, Theme.of(context).colorScheme.primary.withValues(alpha: 0.7)], begin: Alignment.topLeft, end: Alignment.bottomRight),
              ),
              padding: const EdgeInsets.all(20),
              child: Row(
                children: [
                  const Text('📊', style: TextStyle(fontSize: 36)),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Analytics Direction', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.white)),
                        Text('${_overview!['date'] ?? ''} — Cockpit premium directrice', style: const TextStyle(fontSize: 12, color: Colors.white70)),
                      ],
                    ),
                  ),
                  IconButton(icon: const Icon(Icons.refresh, color: Colors.white), onPressed: _load),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // KPI Grid
          GridView.count(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisCount: 2,
            childAspectRatio: 1.6,
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
            children: [
              _KpiCard(icon: '👶', label: 'Enfants actifs', value: '${kpis['children_active'] ?? 0}', sub: '${kpis['capacity_total'] ?? 0} places • ${kpis['occupancy_rate'] ?? 0}%', color: Theme.of(context).colorScheme.primary, gradient: [Theme.of(context).colorScheme.primary, const Color(0xFF0F766E)]),
              _KpiCard(icon: '📍', label: 'Présents aujourd\'hui', value: '${attendanceToday['present'] ?? 0}', sub: '${attendanceToday['expected'] ?? 0} attendus • ${attendanceToday['absent'] ?? 0} absents', color: palette.success, gradient: [palette.success, const Color(0xFF136A32)]),
              _KpiCard(icon: '💰', label: 'CA mois', value: '${_fmt(billingMonth['invoiced'])} DZD', sub: '${billingMonth['count'] ?? 0} factures • ${billingMonth['paid_count'] ?? 0} payées', color: const Color(0xFF0F766E), gradient: const [Color(0xFF0F766E), Color(0xFF115E59)]),
              _KpiCard(icon: '⚠️', label: 'Impayés', value: '${_fmt(aged['total'])} DZD', sub: '${billingMonth['overdue'] ?? 0} en retard', color: palette.danger, gradient: [palette.danger, const Color(0xFFBE123C)]),
              _KpiCard(icon: '👥', label: 'Staff actif', value: '${staff['active'] ?? 0}', sub: '${staff['total'] ?? 0} total', color: const Color(0xFF6366f1), gradient: const [Color(0xFF6366f1), Color(0xFF4f46e5)]),
              _KpiCard(icon: '🚨', label: 'Incidents 7j', value: '${incidents['total'] ?? 0}', sub: '${incidents['critical'] ?? 0} critiques', color: (incidents['critical'] ?? 0) > 0 ? palette.danger : palette.textMuted, gradient: (incidents['critical'] ?? 0) > 0 ? [palette.danger, Colors.red] : [palette.textMuted, palette.textFaint]),
            ],
          ),
          const SizedBox(height: 20),

          // Attendance Trend
          _SectionCard(
            title: '📈 Présences — 30 derniers jours',
            child: _attendanceTrend.isEmpty
                ? const EmptyState(icon: Icons.bar_chart, title: 'Pas de données présences', subtitle: 'Les présences alimentent ce graphique')
                : SizedBox(
                    height: 200,
                    child: BarChart(
                      BarChartData(
                        gridData: const FlGridData(show: true, drawVerticalLine: false),
                        borderData: FlBorderData(show: false),
                        titlesData: FlTitlesData(
                          leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 36)),
                          bottomTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, getTitlesWidget: (v, meta) {
                            final idx = v.toInt();
                            if (idx < 0 || idx >= _attendanceTrend.length) return const SizedBox.shrink();
                            final period = (_attendanceTrend[idx] as Map)['period']?.toString() ?? '';
                            return Padding(padding: const EdgeInsets.only(top: 4), child: Text(period.length > 5 ? period.substring(5, 10) : period, style: const TextStyle(fontSize: 8)));
                          })),
                          topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                          rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                        ),
                        barGroups: _attendanceTrend.asMap().entries.map((e) {
                          final m = e.value as Map<String, dynamic>;
                          return BarChartGroupData(x: e.key, barRods: [
                            BarChartRodData(toY: _toDouble(m['present']), color: palette.success, width: 8, borderRadius: BorderRadius.circular(4)),
                            BarChartRodData(toY: _toDouble(m['absent']), color: palette.danger, width: 6, borderRadius: BorderRadius.circular(4)),
                          ]);
                        }).toList(),
                      ),
                    ),
                  ),
          ),
          const SizedBox(height: 16),

          // Billing Trend
          _SectionCard(
            title: '💳 Facturation — tendance mensuelle',
            child: _billingTrend.isEmpty
                ? const EmptyState(icon: Icons.show_chart, title: 'Pas de données facturation')
                : SizedBox(
                    height: 200,
                    child: LineChart(
                      LineChartData(
                        gridData: const FlGridData(show: true),
                        borderData: FlBorderData(show: false),
                        titlesData: FlTitlesData(
                          leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 48)),
                          bottomTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, getTitlesWidget: (v, meta) {
                            final idx = v.toInt();
                            if (idx < 0 || idx >= _billingTrend.length) return const SizedBox.shrink();
                            final period = (_billingTrend[idx] as Map)['period']?.toString() ?? '';
                            return Text(period.substring(0, 7), style: const TextStyle(fontSize: 8));
                          })),
                          topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                          rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                        ),
                        lineBarsData: [
                          LineChartBarData(spots: _billingTrend.asMap().entries.map((e) => FlSpot(e.key.toDouble(), _toDouble((e.value as Map)['invoiced']))).toList(), isCurved: true, color: Theme.of(context).colorScheme.primary, barWidth: 3, dotData: const FlDotData(show: false)),
                          LineChartBarData(spots: _billingTrend.asMap().entries.map((e) => FlSpot(e.key.toDouble(), _toDouble((e.value as Map)['paid']))).toList(), isCurved: true, color: palette.success, barWidth: 3, dotData: const FlDotData(show: false)),
                          LineChartBarData(spots: _billingTrend.asMap().entries.map((e) => FlSpot(e.key.toDouble(), _toDouble((e.value as Map)['balance']))).toList(), isCurved: true, color: palette.danger, barWidth: 2, dotData: const FlDotData(show: false), dashArray: [5, 5]),
                        ],
                      ),
                    ),
                  ),
          ),
          const SizedBox(height: 8),
          Row(children: [_legend(palette.success, 'Payé'), const SizedBox(width: 12), _legend(Theme.of(context).colorScheme.primary, 'Facturé'), const SizedBox(width: 12), _legend(palette.danger, 'Balance')]),
          const SizedBox(height: 16),

          // Revenue + Aged
          Row(
            children: [
              Expanded(
                child: _SectionCard(
                  title: '💵 Revenus 90j',
                  child: _revenueTrend.isEmpty
                      ? const EmptyState(icon: Icons.payments, title: 'Pas de revenus')
                      : SizedBox(
                          height: 160,
                          child: BarChart(
                            BarChartData(
                              gridData: const FlGridData(show: false),
                              borderData: FlBorderData(show: false),
                              titlesData: const FlTitlesData(show: false),
                              barGroups: _revenueTrend.asMap().entries.map((e) {
                                final m = e.value as Map<String, dynamic>;
                                return BarChartGroupData(x: e.key, barRods: [BarChartRodData(toY: _toDouble(m['revenue']), color: const Color(0xFF0F766E), width: 10, borderRadius: BorderRadius.circular(4))]);
                              }).toList(),
                            ),
                          ),
                        ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _SectionCard(
                  title: '⏳ Balance âgée',
                  child: _buildAgedPie(aged, palette, context),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Occupancy
          _SectionCard(
            title: '🏢 Occupation — Sites & Salles (19-253)',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_occupancy != null) ...[
                  ...((_occupancy!['sites'] as List?) ?? []).map((s) {
                    final m = s as Map<String, dynamic>;
                    final enrolled = (m['enrolled'] as num?)?.toInt() ?? 0;
                    final cap = (m['capacity'] as num?)?.toInt() ?? 0;
                    final pct = cap > 0 ? (enrolled / cap) * 100.0 : 0.0;
                    return _OccupancyBar(label: m['name_fr']?.toString() ?? 'Site', enrolled: enrolled, capacity: cap, pct: pct);
                  }),
                  const SizedBox(height: 12),
                  ...((_occupancy!['rooms'] as List?)?.take(5) ?? []).map((r) {
                    final m = r as Map<String, dynamic>;
                    final enrolled = (m['enrolled'] as num?)?.toInt() ?? 0;
                    final cap = (m['max_capacity'] as num?)?.toInt() ?? 0;
                    final pct = cap > 0 ? (enrolled / cap) * 100.0 : 0.0;
                    return _OccupancyBar(label: '${m['name_fr']} · ${m['site_name']}', enrolled: enrolled, capacity: cap, pct: pct);
                  }),
                ],
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: palette.surfaceAlt, borderRadius: BorderRadius.circular(8)),
                  child: Text('Capacité max 150 enfants/établissement (décret 19-253). Taux ${kpis['occupancy_rate'] ?? 0}% — ${(kpis['occupancy_rate'] ?? 0) > 90 ? '⚠️ Proche limite, 151e refusé auto' : '✅ OK'}.', style: TextStyle(fontSize: 11, color: palette.textMuted)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Footer
          Card(
            color: palette.surfaceAlt,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Text('🔐 Réservé director/accountant/super_admin — RLS tenant forcée, fuseau Alger, audit data_access_logs. Prochaine : export Excel analytics, alertes push ratio/impayé critique, courbe mois glissant.', style: TextStyle(fontSize: 11, color: palette.textMuted)),
            ),
          ),
          const SizedBox(height: 80),
        ],
      ),
    );
  }

  Widget _buildAgedPie(Map<String, dynamic> aged, SereniteStatusColors palette, BuildContext context) {
    final v0 = _toDouble(aged['d0_30'] ?? aged['0-30'] ?? 0);
    final v31 = _toDouble(aged['d31_60'] ?? aged['31-60'] ?? 0);
    final v61 = _toDouble(aged['d61_90'] ?? aged['61-90'] ?? 0);
    final v90 = _toDouble(aged['d90'] ?? aged['90+'] ?? 0);
    final total = v0 + v31 + v61 + v90;
    if (total == 0) return const EmptyState(icon: Icons.pie_chart, title: 'Pas d\'impayés');

    return Column(
      children: [
        SizedBox(
          height: 120,
          child: PieChart(
            PieChartData(
              sectionsSpace: 2,
              centerSpaceRadius: 30,
              sections: [
                PieChartSectionData(value: v0, color: palette.success, title: '0-30', radius: 40, titleStyle: const TextStyle(fontSize: 10, color: Colors.white, fontWeight: FontWeight.bold)),
                PieChartSectionData(value: v31, color: Colors.orange, title: '31-60', radius: 40, titleStyle: const TextStyle(fontSize: 10, color: Colors.white, fontWeight: FontWeight.bold)),
                PieChartSectionData(value: v61, color: Colors.deepOrange, title: '61-90', radius: 40, titleStyle: const TextStyle(fontSize: 10, color: Colors.white, fontWeight: FontWeight.bold)),
                PieChartSectionData(value: v90, color: palette.danger, title: '90+', radius: 40, titleStyle: const TextStyle(fontSize: 10, color: Colors.white, fontWeight: FontWeight.bold)),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text('Total: ${total.toStringAsFixed(0)} DZD', style: TextStyle(fontWeight: FontWeight.bold, color: palette.danger, fontSize: 12)),
      ],
    );
  }

  double _toDouble(dynamic v) {
    if (v is num) return v.toDouble();
    return double.tryParse(v.toString()) ?? 0;
  }

  String _fmt(dynamic v) {
    if (v == null) return '0';
    if (v is num) return v.toStringAsFixed(0);
    return v.toString();
  }

  Widget _legend(Color color, String label) => Row(mainAxisSize: MainAxisSize.min, children: [Container(width: 10, height: 10, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2))), const SizedBox(width: 4), Text(label, style: const TextStyle(fontSize: 10))]);
}

class _KpiCard extends StatelessWidget {
  const _KpiCard({required this.icon, required this.label, required this.value, required this.sub, required this.color, required this.gradient});

  final String icon;
  final String label;
  final String value;
  final String sub;
  final Color color;
  final List<Color> gradient;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Container(
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), gradient: LinearGradient(colors: [gradient[0].withValues(alpha: 0.08), gradient[1].withValues(alpha: 0.15)], begin: Alignment.topLeft, end: Alignment.bottomRight)),
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [Text(icon, style: const TextStyle(fontSize: 20)), const Spacer(), Container(padding: const EdgeInsets.all(6), decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)), child: Icon(Icons.trending_up, size: 14, color: color))]),
            const SizedBox(height: 8),
            Text(label, style: TextStyle(fontSize: 10, color: SereniteStatusColors.of(context).textMuted, fontWeight: FontWeight.w600, letterSpacing: 0.3)),
            const SizedBox(height: 4),
            Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: color)),
            const SizedBox(height: 2),
            Text(sub, style: TextStyle(fontSize: 10, color: SereniteStatusColors.of(context).textFaint)),
          ],
        ),
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)), const SizedBox(height: 16), child]),
      ),
    );
  }
}

class _OccupancyBar extends StatelessWidget {
  const _OccupancyBar({required this.label, required this.enrolled, required this.capacity, required this.pct});

  final String label;
  final int enrolled;
  final int capacity;
  final double pct;

  @override
  Widget build(BuildContext context) {
    final palette = SereniteStatusColors.of(context);
    final color = pct > 90 ? palette.danger : pct > 75 ? palette.warning : palette.success;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Expanded(child: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis)), Text('$enrolled/$capacity (${pct.toStringAsFixed(0)}%)', style: TextStyle(fontSize: 11, color: palette.textMuted))]),
          const SizedBox(height: 4),
          ClipRRect(borderRadius: BorderRadius.circular(8), child: LinearProgressIndicator(value: (pct / 100).clamp(0, 1), minHeight: 8, backgroundColor: palette.border, valueColor: AlwaysStoppedAnimation<Color>(color))),
        ],
      ),
    );
  }
}
