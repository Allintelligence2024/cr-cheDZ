import 'package:flutter/material.dart';

import '../../theme/serenite_theme.dart';

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.subtitle, this.action});

  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final palette = SereniteStatusColors.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: palette.textFaint),
            const SizedBox(height: 16),
            Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(color: palette.textMuted), textAlign: TextAlign.center),
            if (subtitle != null) ...[
              const SizedBox(height: 8),
              Text(subtitle!, style: TextStyle(fontSize: 12, color: palette.textFaint), textAlign: TextAlign.center),
            ],
            if (action != null) ...[
              const SizedBox(height: 16),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}
