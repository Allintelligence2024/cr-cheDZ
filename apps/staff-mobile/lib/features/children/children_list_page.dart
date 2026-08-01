import 'package:flutter/material.dart';

import '../../core/database/app_database.dart';
import '../../core/sync/sync_engine.dart';
import '../sync/sync_status_banner.dart';
import 'child.dart';

/// Liste des enfants d'une section (données locales Drift) avec statut de
/// présence du jour et actions Arrivée/Départ (offline-first).
class ChildrenListPage extends StatefulWidget {
  const ChildrenListPage({super.key, required this.syncEngine});

  final SyncEngine syncEngine;

  @override
  State<ChildrenListPage> createState() => _ChildrenListPageState();
}

class _ChildrenListPageState extends State<ChildrenListPage> {
  List<Child> _children = [];
  Map<String, String> _statusByChild = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
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
    setState(() => _statusByChild[child.id] = 'present');
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Arrivée enregistrée ✓'),
          backgroundColor: Color(0xFF16A34A),
          duration: Duration(seconds: 2),
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
    setState(() => _statusByChild[child.id] = 'departed');
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Départ enregistré ✓'),
          backgroundColor: Color(0xFF16A34A),
          duration: Duration(seconds: 2),
        ),
      );
    }
  }

  Widget _trailing(Child child) {
    final status = _statusOf(child);
    switch (status) {
      case 'present':
        return ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF2563EB),
            foregroundColor: Colors.white,
          ),
          onPressed: () => _checkOut(child),
          child: const Text('Départ'),
        );
      case 'departed':
        return const Text(
          'Parti',
          style: TextStyle(color: Color(0xFF9E9E9E), fontWeight: FontWeight.w600),
        );
      default: // expected, absent → bouton Arrivée
        return ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF16A34A),
            foregroundColor: Colors.white,
          ),
          onPressed: () => _checkIn(child),
          child: const Text('Arrivée'),
        );
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'present':
        return const Color(0xFF16A34A);
      case 'departed':
        return const Color(0xFF9E9E9E);
      case 'absent':
        return const Color(0xFFDC2626);
      default:
        return const Color(0xFF2563EB);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Enfants de la section'),
        actions: [
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
                                    style: const TextStyle(color: Color(0xFFD97706), fontSize: 12),
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
