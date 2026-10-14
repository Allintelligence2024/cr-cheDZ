import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

/// Service push FCM — V2.1 (ITEM M1)
///
/// Pré-requis externes (JAMAIS commités — voir .gitignore) :
/// - `google-services.json` dans `android/app/`
/// - `GoogleService-Info.plist` dans `ios/Runner/`
/// - Le plugin Gradle `com.google.gms.google-services` s'applique
///   automatiquement SI le fichier est présent (app/build.gradle.kts).
///
/// Mode dégradé : sans config Firebase, `initialize()` n'échoue pas —
/// l'app démarre sans push (tests, CI, dev sans secret).
/// Le worker `notification_queue` envoie déjà les push (phase16) vers le
/// `devices.fcm_token` enregistré via `POST /devices`.

class PushService {
  final _controller = StreamController<Map<String, dynamic>>.broadcast();

  Stream<Map<String, dynamic>> get onMessage => _controller.stream;

  bool _initialized = false;
  FirebaseMessaging? _messaging;

  void _emit(Map<String, dynamic> payload) {
    if (!_controller.isClosed) _controller.add(payload);
  }

  Future<void> initialize() async {
    if (_initialized) return;
    _initialized = true;
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp();
      }
      final messaging = FirebaseMessaging.instance;
      _messaging = messaging;
      // iOS : bannière + sons (best effort, sans permission rien n'arrive).
      await messaging.requestPermission();
      FirebaseMessaging.onMessage.listen((RemoteMessage message) {
        _emit(<String, dynamic>{
          'title': message.notification?.title ?? '',
          'body': message.notification?.body ?? '',
          'data': Map<String, dynamic>.from(message.data),
        });
      });
      final token = await messaging.getToken();
      debugPrint('FCM token director: $token');
    } catch (e) {
      // Config absente (google-services.json / GoogleService-Info.plist) :
      // l'app continue sans push — jamais de crash bloquant au démarrage.
      debugPrint('FCM indisponible (config absente ?) : $e');
    }
  }

  Future<String?> getToken() async {
    try {
      return await _messaging?.getToken();
    } catch (e) {
      debugPrint('FCM getToken échoué : $e');
      return null;
    }
  }

  Future<void> subscribeToTopic(String topic) async {
    try {
      await _messaging?.subscribeToTopic(topic);
    } catch (e) {
      debugPrint('FCM subscribe échoué : $e');
    }
  }

  void simulateIncoming(Map<String, dynamic> payload) {
    // Pour tests sans Firebase
    _emit(payload);
  }

  void dispose() => _controller.close();
}
