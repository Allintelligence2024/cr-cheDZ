import 'package:flutter/material.dart';

class StatCard extends StatelessWidget {
  const StatCard({super.key, required this.label, required this.value, required this.color, this.icon});

  final String label;
  final String value;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            if (icon != null) Icon(icon, color: color, size: 20),
            const SizedBox(height: 4),
            Text(value, style: TextStyle(fontWeight: FontWeight.bold, color: color, fontSize: 18)),
            const SizedBox(height: 2),
            Text(label, style: const TextStyle(fontSize: 10), textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}
