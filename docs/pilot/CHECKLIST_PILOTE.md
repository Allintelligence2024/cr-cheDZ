# CHECKLIST PILOTE — 2 semaines (Phase 12)

> À remplir chaque jour par la directrice (ou l'équipe support). Objectif :
> 5 crèches × 2 semaines d'utilisation quotidienne, métriques vérifiées,
> 0 incident bloquant non résolu en 24 h.

## Journal quotidien (par crèche)

| Jour | Pointage fait ? | Journal (repas/sieste) ? | Photos validées ? | Factures générées ? | Incidents signalés ? | Irritants notés ? | Signature |
|---|---|---|---|---|---|---|---|
| J1 | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| J2 | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| … | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| J14 | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |

## Critères mesurés (semaine 1, puis semaine 2)

| Critère MVP | Cible | Mesure semaine 1 | Mesure semaine 2 | Verdict |
|---|---|---|---|---|
| Pointage d'une section (12 enfants) | < 3 min | | | ☐ |
| Repas groupé 12 enfants | < 30 s | | | ☐ |
| Aucun événement perdu après 8 h hors ligne | 0 perdu | | | ☐ |
| Notification arrivée parent (quand en ligne) | < 30 s | | | ☐ |
| Parent ne voit que ses enfants | 0 fuite | | | ☐ |
| App fluide sur Android 2 Go RAM | utilisable | | | ☐ |
| Factures du mois générées | < 5 min | | | ☐ |
| Import 50 enfants depuis Excel | sans erreur | | | ☐ |
| Staging sans données réelles | vérifié | | | ☐ |

## Métriques de suivi (via GET /api/v1/metrics)

À relever chaque fin de journée (grappes par organisation non exposées —
agrégats globaux) :

- `creche_checkins_today` : pointages du jour (toutes crèches) ;
- `creche_sync_ops_24h` : synchronisations reçues sur 24 h ;
- `creche_jobs_failed_24h` : jobs en échec sur 24 h (doit rester 0) ;
- `creche_http_5xx_24h` : erreurs serveur sur 24 h (doit rester 0) ;
- `creche_children_active` : enfants actifs (75 attendus en pilote).

## Critères de go/no-go (fin semaine 2)

- [ ] 5 crèches × 14 jours d'utilisation quotidienne (journal signé) ;
- [ ] 100 % des critères MVP « terrain » dans les cibles ci-dessus ;
- [ ] 0 incident bloquant non résolu en 24 h ;
- [ ] Retours FR/AR collectés et triés (acceptés / backlog v2) ;
- [ ] Exercice de restauration en staging < 30 min réalisé ;
- [ ] Rollback testé (procédure RUNBOOK §2) ;
- [ ] Bilan pilote rédigé (docs/pilot/BILAN-PILOTE.md) + décision go/no-go.

## Journal des irritants (modèle)

| Date | Crèche | Rôle | Description | Impact | Gravité (1-5) | Statut |
|---|---|---|---|---|---|---|
| | | | | | | |
