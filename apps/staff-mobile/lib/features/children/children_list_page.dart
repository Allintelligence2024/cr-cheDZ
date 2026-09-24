import 'dart:async';
import 'package:flutter/material.dart';

import '../../core/database/app_database.dart';
import '../../core/sync/sync_engine.dart';
import '../../theme/serenite_theme.dart';
import '../sync/sync_status_banner.dart';
import 'child.dart';

/// Liste des enfants d'une section (données locales Drift) avec statut de
/// présence du jour et actions Arrivée/Départ (offline-first).
class ChildrenListPage extends StatefulWidget {
  const ChildrenListPage({super.key, required this.syncEngine, this.onLogout});

  final SyncEngine syncEngine;
  final VoidCallback? onLogout;

  @override
  State<ChildrenListPage> createState() => _ChildrenListPageState();
}

class _ChildrenListPageState extends State<ChildrenListPage> {
  List<Child> _children = [];
  Map<String, String> _statusByChild = {};
  bool _loading = true;
  StreamSubscription<SyncStatus>? _syncSubscription;

  @override
  void initState() {
    super.initState();
    _load();
    _syncSubscription = widget.syncEngine.statusStream.listen((status) {
      if (mounted && status == SyncStatus.idle) unawaited(_load());
    });
  }

  @override
  void dispose() {
    final subscription = _syncSubscription;
    if (subscription != null) unawaited(subscription.cancel());
    super.dispose();
  }

  Future<void> _load() async {
    final rows = await (widget.syncEngine.database.select(
      widget.syncEngine.database.localChildren,
    )..orderBy([(t) => OrderingTerm.asc(t.lastNameFr)])).get();
    final statuses = await widget.syncEngine.attendanceStatusByChild(DateTime.now());
    if (!mounted) return;
    setState(() {
      _children = rows.map(Child.fromLocal).toList();
      _statusByChild = statuses;
      _loading = false;
    });
  }

  String _statusOf(Child child) => _statusByChild[child.id] ?? 'expected';

  Future<void> _checkIn(Child child) async {
    await widget.syncEngine.enqueue(
      command: 'check_in',
      entityType: 'attendance_session',
      payload: {'child_id': child.id, 'site_id': child.siteId},
    );
    if (!mounted) return;
    setState(() => _statusByChild[child.id] = 'present');
    if (mounted) {
      final palette = SereniteStatusColors.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Arrivée enregistrée ✓',
            style: TextStyle(color: palette.onSuccess),
          ),
          backgroundColor: palette.success,
          duration: const Duration(seconds: 2),
        ),
      );
    }
  }

  Future<void> _checkOut(Child child) async {
    await widget.syncEngine.enqueue(
      command: 'check_out',
      entityType: 'attendance_session',
      payload: {'child_id': child.id, 'site_id': child.siteId},
    );
    if (!mounted) return;
    setState(() => _statusByChild[child.id] = 'departed');
    if (mounted) {
      final palette = SereniteStatusColors.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Départ enregistré ✓',
            style: TextStyle(color: palette.onSuccess),
          ),
          backgroundColor: palette.success,
          duration: const Duration(seconds: 2),
        ),
      );
    }
  }

  Widget _trailing(Child child) {
    final palette = SereniteStatusColors.of(context);
    final status = _statusOf(child);
    switch (status) {
      case 'present':
        return ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: palette.info,
            foregroundColor: palette.onInfo,
          ),
          onPressed: () => _checkOut(child),
          child: const Text('Départ'),
        );
      case 'departed':
        return Text(
          'Parti',
          style: TextStyle(
            color: palette.textFaint,
            fontWeight: FontWeight.w600,
          ),
        );
      default: // expected, absent → bouton Arrivée
        return ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: palette.success,
            foregroundColor: palette.onSuccess,
          ),
          onPressed: () => _checkIn(child),
          child: const Text('Arrivée'),
        );
    }
  }

  Color _statusColor(String status) {
    final palette = SereniteStatusColors.of(context);
    switch (status) {
      case 'present':
        return palette.success;
      case 'departed':
        return palette.textFaint;
      case 'absent':
        return palette.danger;
      default:
        return palette.info;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Enfants de la section'),
        actions: [
          if (widget.onLogout != null) IconButton(onPressed: widget.onLogout, icon: const Icon(Icons.logout), tooltip: 'Se déconnecter'),
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Synchroniser',
            onPressed: () => widget.syncEngine.sync(),
          ),
        ],
      ),
      body: Column(
        children: [
          SyncStatusBanner(syncEngine: widget.syncEngine),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : RefreshIndicator(
                    onRefresh: () async {
                      await widget.syncEngine.sync();
                      await _load();
                    },
                    child: ListView.builder(
                      itemCount: _children.length,
                      itemBuilder: (context, i) {
                        final child = _children[i];
                        final status = _statusOf(child);
                        return Card(
                          margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                          child: ListTile(
                            leading: CircleAvatar(
                              backgroundColor: _statusColor(status).withValues(alpha: 0.15),
                              child: Text(
                                child.firstNameFr.isNotEmpty
                                    ? child.firstNameFr[0].toUpperCase()
                                    : '?',
                                style: TextStyle(color: _statusColor(status)),
                              ),
                            ),
                            title: Text('${child.firstNameFr} ${child.lastNameFr}'),
                            subtitle: child.allergiesSummary != null
                                ? Text(
                                    child.allergiesSummary!,
                                    style: TextStyle(
                                      color: SereniteStatusColors.of(context)
                                          .warning,
                                      fontSize: 12,
                                    ),
                                  )
                                : null,
                            trailing: _trailing(child),
                          ),
                        );
                      },
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}
