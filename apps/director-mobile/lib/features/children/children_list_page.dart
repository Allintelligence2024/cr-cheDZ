import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';
import 'child_detail_page.dart';

class ChildrenListPage extends StatefulWidget {
  const ChildrenListPage({super.key, required this.api});

  final DirectorApiClient api;

  @override
  State<ChildrenListPage> createState() => _ChildrenListPageState();
}

class _ChildrenListPageState extends State<ChildrenListPage> {
  List<dynamic> _children = [];
  Object? _error;
  bool _loading = true;
  final _searchCtrl = TextEditingController();

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
      final list = await widget.api.children(search: _searchCtrl.text.trim());
      if (!mounted) return;
      setState(() {
        _children = list;
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
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return buildApiError(context, _error, _load);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: TextField(
            controller: _searchCtrl,
            decoration: InputDecoration(
              hintText: 'Rechercher enfant...',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: IconButton(icon: const Icon(Icons.clear), onPressed: () { _searchCtrl.clear(); _load(); }),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
            ),
            onSubmitted: (_) => _load(),
          ),
        ),
        Expanded(
          child: _children.isEmpty
              ? Center(child: Text('Aucun enfant', style: TextStyle(color: SereniteStatusColors.of(context).textMuted)))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.builder(
                    itemCount: _children.length,
                    itemBuilder: (context, i) {
                      final c = _children[i] as Map<String, dynamic>;
                      return Card(
                        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: Theme.of(context).colorScheme.primaryContainer,
                            child: Text((c['first_name_fr']?.toString().isNotEmpty == true ? c['first_name_fr'].toString()[0] : '?').toUpperCase()),
                          ),
                          title: Text('${c['first_name_fr'] ?? ''} ${c['last_name_fr'] ?? ''}'),
                          subtitle: Text('${c['room_name'] ?? c['room_id'] ?? ''} — ${c['status'] ?? ''}\n${c['reference_number'] ?? ''}', style: const TextStyle(fontSize: 11)),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ChildDetailPage(api: widget.api, childId: c['id'].toString()))),
                        ),
                      );
                    },
                  ),
                ),
        ),
      ],
    );
  }
}
