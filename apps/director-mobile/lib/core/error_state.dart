import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

class DirectorSessionExpired implements Exception {
  const DirectorSessionExpired();
}

class DirectorApiException implements Exception {
  const DirectorApiException(this.kind, {this.statusCode, this.message});

  final String kind; // offline | unauthorized | forbidden | server | validation
  final int? statusCode;
  final String? message;

  bool get isOffline => kind == 'offline';
  bool get isUnauthorized => kind == 'unauthorized';

  @override
  String toString() => 'DirectorApiException($kind, status=$statusCode, msg=$message)';
}

DirectorApiException mapDioError(DioException error) {
  if (error.type == DioExceptionType.connectionTimeout ||
      error.type == DioExceptionType.sendTimeout ||
      error.type == DioExceptionType.receiveTimeout ||
      error.type == DioExceptionType.connectionError) {
    return const DirectorApiException('offline');
  }
  final status = error.response?.statusCode;
  final data = error.response?.data;
  String? msg;
  if (data is Map) {
    msg = (data['message_fr'] ?? data['message'] ?? data['code'])?.toString();
  }
  if (status == 401) return DirectorApiException('unauthorized', statusCode: status, message: msg);
  if (status == 403) return DirectorApiException('forbidden', statusCode: status, message: msg);
  if (status != null && status >= 400 && status < 500) {
    return DirectorApiException('validation', statusCode: status, message: msg);
  }
  return DirectorApiException('server', statusCode: status, message: msg);
}

Widget buildApiError(BuildContext context, Object? error, VoidCallback onRetry) {
  final isOffline = error is DirectorApiException && error.isOffline;
  final isUnauthorized = error is DirectorApiException && error.isUnauthorized;
  String text;
  IconData icon;
  if (isOffline) {
    text = 'Pas de réseau — vérifiez votre connexion puis réessayez.';
    icon = Icons.wifi_off;
  } else if (isUnauthorized) {
    text = 'Session expirée — reconnectez-vous.';
    icon = Icons.lock_outline;
  } else if (error is DirectorApiException) {
    text = error.message ?? 'Erreur serveur (${error.statusCode ?? '?'})';
    icon = Icons.error_outline;
  } else {
    text = 'Erreur inattendue : $error';
    icon = Icons.error_outline;
  }

  return Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 48, color: Theme.of(context).colorScheme.error),
          const SizedBox(height: 16),
          Text(text, textAlign: TextAlign.center),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: Text(isUnauthorized ? 'Se reconnecter' : 'Réessayer'),
          ),
        ],
      ),
    ),
  );
}
