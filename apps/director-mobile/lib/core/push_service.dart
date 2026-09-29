import 'dart:async';

/// Service push FCM — V2.1 scaffold
/// Production nécessite :
/// - `firebase_core` + `firebase_messaging`
/// - `google-services.json` (Android) + `GoogleService-Info.plist` (iOS)
/// - Configuration APNs + FCM
/// - Enregistrement du FCM token via `POST /devices` (déjà existant pour staff-mobile)
///
/// Ce fichier est un placeholder qui expose l'API attendue par l'app.
/// Le worker `notification_queue` envoie déjà les push (phase16) — il manque juste
/// le client qui les reçoit.

class PushService {
  final _controller = StreamController<Map<String, dynamic>>.broadcast();

  Stream<Map<String, dynamic>> get onMessage => _controller.stream;

  bool _initialized = false;

  Future<void> initialize() async {
    if (_initialized) return;
    _initialized = true;
    // TODO: Firebase.initializeApp() + FirebaseMessaging.instance.requestPermission()
    // TODO: onMessage.listen -> _controller.add
    // TODO: getToken() -> POST /devices {fcm_token}
  }

  Future<String?> getToken() async {
    // TODO: return await FirebaseMessaging.instance.getToken()
    return null;
  }

  Future<void> subscribeToTopic(String topic) async {
    // TODO: await FirebaseMessaging.instance.subscribeToTopic(topic)
  }

  void simulateIncoming(Map<String, dynamic> payload) {
    // Pour tests sans Firebase
    _controller.add(payload);
  }

  void dispose() => _controller.close();
}
