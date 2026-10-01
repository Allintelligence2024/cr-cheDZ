import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../../../theme/serenite_theme.dart';

class BillingChart extends StatelessWidget {
  const BillingChart({super.key, required this.aged});

  final Map<String, dynamic> aged;

  @override
  Widget build(BuildContext context) {
    final palette = SereniteStatusColors.of(context);
    final buckets = aged['buckets'] as Map<String, dynamic>? ?? aged;
    final v0 = _toDouble(buckets['0-30'] ?? buckets['0_30'] ?? buckets['current'] ?? 0);
    final v31 = _toDouble(buckets['31-60'] ?? buckets['31_60'] ?? 0);
    final v61 = _toDouble(buckets['61-90'] ?? buckets['61_90'] ?? 0);
    final v90 = _toDouble(buckets['90+'] ?? buckets['90_plus'] ?? buckets['over_90'] ?? 0);

    final total = v0 + v31 + v61 + v90;
    if (total == 0) return const SizedBox.shrink();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Balance âgée — répartition', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            SizedBox(
              height: 160,
              child: PieChart(
                PieChartData(
                  sectionsSpace: 2,
                  centerSpaceRadius: 40,
                  sections: [
                    PieChartSectionData(value: v0, color: palette.success, title: '0-30j', radius: 50, titleStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white)),
                    PieChartSectionData(value: v31, color: Colors.orange, title: '31-60j', radius: 50, titleStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white)),
                    PieChartSectionData(value: v61, color: Colors.deepOrange, title: '61-90j', radius: 50, titleStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white)),
                    PieChartSectionData(value: v90, color: palette.danger, title: '90j+', radius: 50, titleStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white)),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Text('Total impayé: ${total.toStringAsFixed(0)} DZD', style: TextStyle(fontWeight: FontWeight.bold, color: palette.danger)),
          ],
        ),
      ),
    );
  }

  double _toDouble(dynamic v) {
    if (v is num) return v.toDouble();
    return double.tryParse(v.toString()) ?? 0;
  }
}
