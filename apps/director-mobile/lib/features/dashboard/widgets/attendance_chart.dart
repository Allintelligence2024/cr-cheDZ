import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../../../theme/serenite_theme.dart';

class AttendanceChart extends StatelessWidget {
  const AttendanceChart({super.key, required this.rooms});

  final List<dynamic> rooms;

  @override
  Widget build(BuildContext context) {
    final palette = SereniteStatusColors.of(context);
    if (rooms.isEmpty) return const SizedBox.shrink();

    final spotsPresent = <FlSpot>[];
    final spotsExpected = <FlSpot>[];
    for (var i = 0; i < rooms.length; i++) {
      final r = rooms[i] as Map<String, dynamic>;
      final present = (r['present'] is int ? r['present'] as int : int.tryParse(r['present'].toString()) ?? 0).toDouble();
      final expected = (r['expected'] is int ? r['expected'] as int : int.tryParse(r['expected'].toString()) ?? 0).toDouble();
      spotsPresent.add(FlSpot(i.toDouble(), present));
      spotsExpected.add(FlSpot(i.toDouble(), expected));
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Présences par salle', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            SizedBox(
              height: 180,
              child: LineChart(
                LineChartData(
                  gridData: const FlGridData(show: true, drawVerticalLine: false),
                  titlesData: FlTitlesData(
                    leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 32)),
                    bottomTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
                        getTitlesWidget: (value, meta) {
                          final idx = value.toInt();
                          if (idx < 0 || idx >= rooms.length) return const SizedBox.shrink();
                          final name = (rooms[idx] as Map)['room_name']?.toString() ?? 'S${idx + 1}';
                          return Padding(padding: const EdgeInsets.only(top: 4), child: Text(name.length > 6 ? name.substring(0, 6) : name, style: const TextStyle(fontSize: 9)));
                        },
                      ),
                    ),
                    topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                    rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  ),
                  borderData: FlBorderData(show: false),
                  lineBarsData: [
                    LineChartBarData(spots: spotsPresent, isCurved: true, color: palette.success, barWidth: 3, dotData: const FlDotData(show: true)),
                    LineChartBarData(spots: spotsExpected, isCurved: true, color: palette.info, barWidth: 2, dotData: const FlDotData(show: false), dashArray: const [5, 5]),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                _legend(palette.success, 'Présents'),
                const SizedBox(width: 12),
                _legend(palette.info, 'Attendus'),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _legend(Color color, String label) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(width: 12, height: 12, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2))),
          const SizedBox(width: 4),
          Text(label, style: const TextStyle(fontSize: 11)),
        ],
      );
}
