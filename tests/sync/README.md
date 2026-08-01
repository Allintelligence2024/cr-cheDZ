# Tests — synchronisation offline

À implémenter (Phase 5) :
- Idempotence : même opération envoyée 10 fois = 1 résultat en base.
- Appareil avec heure incorrecte : rejet ou horodatage serveur.
- 8 heures offline : aucun événement perdu (simulation file d'opérations).
- 200 événements offline puis sync ; photos en attente 6 h.
- Conflit sur état final (check_in sur enfant déjà present) → `INVALID_STATE_TRANSITION`.
- Opération sync cross-tenant → `PERMISSION_DENIED`.
