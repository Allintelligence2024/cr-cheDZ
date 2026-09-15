// Executes the GENERATED Dart wire client. No Flutter plugins, no pub packages.
// Captures real serialized requests against a recording transport, not an API.
import 'dart:convert';
import 'dart:io';
import '../../apps/staff-mobile/lib/core/network/generated/sync_wire_client.dart';

Future<void> main() async {
  final root = File.fromUri(Platform.script).parent.parent.parent;
  final cases = jsonDecode(File('${root.path}/packages/sync-contract/conformance.json').readAsStringSync()) as List;
  for (final test in cases) {
    var valid = true;
    try { validateSync(test['definition'] as String, test['value']); }
    on FormatException { valid = false; }
    if (valid != test['valid']) throw StateError('Dart conformance: ${test['name']}');
  }
  const device = '11111111-1111-4111-8111-111111111111';
  const event = '22222222-2222-4222-8222-222222222222';
  final emitted = <Map<String, dynamic>>[];
  final client = SyncWireClient((method, path, data) async {
    // Round-trip through JSON: these are emitted wire values, not source literals
    // parsed/reconstructed by Node. Decoder/DTO validation is performed by Node.
    final decoded = jsonDecode(jsonEncode(data)) as Map<String, dynamic>;
    emitted.add({'method': method, 'path': path, 'data': decoded});
    if (path == '/devices') return {'device_id': device};
    if (path == '/sync/push') {
      return {'accepted': [event], 'rejected': [], 'conflicts': [], 'next_cursor': '9007199254740993'};
    }
    return {'events': [], 'next_cursor': decoded['cursor']};
  });
  await client.registerDevice({'name': 'Tablette contrat', 'device_fingerprint': 'installation-contract-1', 'platform': 'android'});
  final request = <String, dynamic>{
    'device_id': device,
    'operations': [
      {'event_id': event, 'client_sequence': 1, 'schema_version': 1,
       'command': 'check_in', 'entity_type': 'attendance', 'entity_id': null,
       'payload': {'child_id': '33333333-3333-4333-8333-333333333333'},
       'base_version': null, 'occurred_at_device': '2026-09-14T08:00:00Z'}
    ]
  };
  await client.push(request);
  await client.push(request); // Same stable event_id on a transport replay.
  await client.pull({'device_id': device, 'cursor': '0'});
  await client.pull({'device_id': device, 'cursor': '9007199254740993'});
  await client.pull({'device_id': device, 'cursor': '9223372036854775807'});
  var missingRejected = false;
  try { await client.push({'operations': []}); }
  on FormatException { missingRejected = true; }
  if (!missingRejected || emitted.length != 6) throw StateError('Invalid request reached transport');
  var invalidResponseRejected = false;
  final broken = SyncWireClient((method, path, data) async => {'events': [], 'next_cursor': 1});
  try { await broken.pull({'device_id': device, 'cursor': '0'}); }
  on FormatException { invalidResponseRejected = true; }
  if (!invalidResponseRejected) throw StateError('Accepted numeric cursor response');
  // Transport errors must propagate: no implicit retry / pretend success.
  var calls = 0;
  final unauthorized = SyncWireClient((method, path, data) async { calls++; throw StateError('401'); });
  var propagated = false;
  try { await unauthorized.pull({'device_id': device, 'cursor': '0'}); }
  on StateError catch (e) { propagated = e.message == '401'; }
  if (!propagated || calls != 1) throw StateError('Transport error swallowed/retried');
  stdout.writeln(jsonEncode({'dart_version': Platform.version.split(' ').first,
    'conformance_cases': cases.length, 'emitted': emitted,
    'invalid_request_blocked': true, 'invalid_response_blocked': true, 'transport_error_propagated': true}));
}
