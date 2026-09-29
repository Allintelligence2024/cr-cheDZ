import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/error_state.dart';
import '../../theme/serenite_theme.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.api, required this.onAuthenticated});

  final DirectorApiClient api;
  final VoidCallback onAuthenticated;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _totp = TextEditingController();
  bool _loading = false;
  String? _error;
  bool _needTotp = false;

  Future<void> _login() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await widget.api.login(
        _email.text.trim(),
        _password.text,
        totpCode: _needTotp ? _totp.text.trim() : null,
      );
      // Si le serveur demande TOTP (code TOTP_REQUIRED)
      if (res['code'] == 'TOTP_REQUIRED' || res['requires_totp'] == true) {
        setState(() {
          _needTotp = true;
          _loading = false;
        });
        return;
      }
      if (mounted) {
        widget.onAuthenticated();
      }
    } on DirectorApiException catch (e) {
      setState(() {
        if (e.kind == 'offline') {
          _error = 'Pas de réseau — vérifiez votre connexion.';
        } else if (e.statusCode == 401 && e.message?.contains('TOTP') == true) {
          _needTotp = true;
          _error = 'Code TOTP requis.';
        } else {
          _error = e.message ?? 'Identifiants invalides (${e.statusCode ?? '?'})';
        }
      });
    } catch (e) {
      setState(() => _error = 'Erreur : $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _totp.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = SereniteStatusColors.of(context);
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Icon(Icons.admin_panel_settings, size: 64, color: Theme.of(context).colorScheme.primary),
                const SizedBox(height: 16),
                Text('Direction — Crèche DZ',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold),
                    textAlign: TextAlign.center),
                const SizedBox(height: 8),
                Text('Cockpit directrice — pilotage temps réel',
                    style: TextStyle(color: palette.textMuted), textAlign: TextAlign.center),
                const SizedBox(height: 32),
                TextField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.email)),
                  autofillHints: const [AutofillHints.email],
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _password,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'Mot de passe', prefixIcon: Icon(Icons.lock)),
                  onSubmitted: (_) => _login(),
                ),
                if (_needTotp) ...[
                  const SizedBox(height: 16),
                  TextField(
                    controller: _totp,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Code TOTP (6 chiffres)',
                      prefixIcon: Icon(Icons.security),
                    ),
                    maxLength: 6,
                  ),
                ],
                const SizedBox(height: 24),
                if (_error != null)
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: palette.dangerBg,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: palette.danger.withValues(alpha: 0.3)),
                    ),
                    child: Text(_error!, style: TextStyle(color: palette.danger)),
                  ),
                if (_error != null) const SizedBox(height: 16),
                FilledButton(
                  onPressed: _loading ? null : _login,
                  child: _loading
                      ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : Text(_needTotp ? 'Vérifier' : 'Se connecter'),
                ),
                const SizedBox(height: 16),
                Text(
                  'Accès réservé : directrice, adjointe, super_admin.\nLes éducatrices utilisent l\'app Personnel.',
                  style: TextStyle(fontSize: 12, color: palette.textFaint),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
