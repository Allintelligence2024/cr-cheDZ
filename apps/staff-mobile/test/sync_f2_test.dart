import 'package:flutter_test/flutter_test.dart';
import 'package:staff_mobile/core/network/api_client.dart';
import 'package:staff_mobile/core/network/sync_client.dart';

class RecordingApi extends ApiClient {
  final calls = <String>[];
  @override
  Future<T> post<T>(String path, [Object? body]) async {
    calls.add(path);
    return <String, dynamic>{'accepted': [], 'rejected': [], 'conflicts': [], 'next_cursor': '0'} as T;
  }
  @override
  Future<T> get<T>(String path, {Map<String, dynamic>? query}) async {
    calls.add(path);
    return <String, dynamic>{'events': [], 'next_cursor': '0'} as T;
  }
}

void main() {
  test('push without a registered device must never reach transport', () async {
    final api = RecordingApi();
    try { await SyncClient(api).push([]); } catch (_) { /* blocked locally */ }
    expect(api.calls, isEmpty);
  });
  test('pull without a registered device must never reach transport', () async {
    final api = RecordingApi();
    try { await SyncClient(api).pull(0); } catch (_) { /* blocked locally */ }
    expect(api.calls, isEmpty);
  });
}
