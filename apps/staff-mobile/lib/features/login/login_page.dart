import 'package:flutter/material.dart';

import '../../core/auth/auth_service.dart';

/// Écran de connexion (email + mot de passe) — Phase 4.
/// La navigation après succès est déléguée au shell via [onAuthenticated].
class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.auth, required this.onAuthenticated});

  final AuthService auth;
  final VoidCallback onAuthenticated;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.auth.login(_email.text.trim(), _password.text);
      if (!mounted) return;
      widget.onAuthenticated();
    } catch (_) {
      setState(() => _error = 'Email ou mot de passe incorrect');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.child_care, size: 64, color: Color(0xFF2563EB)),
                const SizedBox(height: 8),
                Text('Crèche — Personnel', style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 24),
                TextFormField(
                  controller: _email,
                  decoration: const InputDecoration(labelText: 'Email', border: OutlineInputBorder()),
                  keyboardType: TextInputType.emailAddress,
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Email requis' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _password,
                  decoration: const InputDecoration(labelText: 'Mot de passe', border: OutlineInputBorder()),
                  obscureText: true,
                  validator: (v) => (v == null || v.length < 8) ? '8 caractères minimum' : null,
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: Color(0xFFDC2626))),
                ],
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: _busy ? null : _submit,
                    child: _busy
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Se connecter'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
