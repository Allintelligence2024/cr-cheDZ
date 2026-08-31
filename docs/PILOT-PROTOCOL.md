# PILOT PROTOCOL — 5 crèches x 2 semaines (terrain)

> Rien de codable ne manque. Le risque suivant est terrain + humain. Ce protocole est la checklist la plus utile avant données d'enfants.

## Préparation (J-3)

- [ ] 5 crèches pilotes seedées : `node scripts/pilot/seed-pilot.mjs` (3 salles, 15 enfants, directrice + 2 éducatrices + comptable, contrats, parents)
- [ ] `node scripts/pilot/pilot-report.mjs --bench` → `docs/pilot/RAPPORT-PREPARATION.md` (19/19 vérifications)
- [ ] Benchmark MVP : pointage section 12 enfants <3min (mesuré 0,09s API), repas groupé <30s (0,037s), factures <5min (0,008s/facture)
- [ ] QR apps parents/staff imprimés (`docs/pilot/qr-app-*.png`)
- [ ] Onboarding : `docs/pilot/ONBOARDING.md` lu par chaque directrice
- [ ] RUNBOOK + BACKUP-RUNBOOK + OPERATIONS-SECRETS lus par support
- [ ] Métriques `/api/v1/metrics` exposées (Grafana ou curl quotidien)

## Checklist quotidienne (par crèche, par directrice)

Copier `docs/pilot/CHECKLIST_PILOTE.md` — modèle :

| Jour | Pointage | Journal | Photos | Factures | Incidents | Irritants | Signature |
|---|---|---|---|---|---|---|---|
| J1 | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | |
| ... | | | | | | | |
| J14 | | | | | | | |

**Mesures terrain quotidiennes (fin de journée)** :
```bash
curl https://api.creche.dz/api/v1/metrics | grep creche_
# creche_checkins_today, creche_sync_ops_24h, creche_jobs_failed_24h (doit 0), creche_http_5xx_24h (0), creche_children_active (75 attendu)
```

## Incidents à consigner (modèle)

| Date | Crèche | Rôle | Description | Impact | Gravité 1-5 | Résolution | Temps résolution | Statut |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

Types d'incidents attendus :
- Réseau coupé 8h → sync offline (phase5) doit 0 perte
- DVR injoignable → job `video_clips_purge` → `VIDEO_PURGE_PARTIAL`, retry
- SATIM webhook tardif 73h → doit confirmer honnêtement (phase24)
- FCM/APNs non configuré → `PUSH_NOT_CONFIGURED_OR_NO_DEVICE`, inbox OK
- Capacité 19-253 atteinte → 409 `CAPACITY_EXCEEDED`

## Critères MVP terrain (mesurés semaine 1 et 2)

| Critère | Cible | S1 | S2 | Verdict |
|---|---|---|---|---|
| Pointage section 12 enfants | <3min | | | |
| Repas groupé 12 | <30s | | | |
| 8h offline sans perte | 0 perdu | | | |
| Notif arrivée parent <30s (en ligne) | <30s | | | |
| Parent voit ses enfants uniquement | 0 fuite | | | |
| App fluide Android 2Go | utilisable | | | |
| Factures mois <5min | <5min | | | |
| Import 50 enfants Excel | sans erreur | | | |
| Staging sans données réelles | vérifié | | | |

## Go / No-Go (fin J14)

- [ ] 5 crèches x 14j journal signé
- [ ] 100% critères MVP dans cibles
- [ ] 0 incident bloquant non résolu en 24h
- [ ] Retours FR/AR collectés et triés (accepté / backlog v2)
- [ ] Exercice restauration staging <30min réalisé (BACKUP-RUNBOOK)
- [ ] Rollback testé (RUNBOOK §2)
- [ ] Bilan rédigé `docs/pilot/BILAN-PILOTE.md` + décision

**Décision** :
- [ ] GO — prod
- [ ] NO-GO — conditions : ...

Signature responsable : __________ Date : __/__/____

## Rôles

- **Directrice** : pointage, journal, photos, factures, checklist quotidienne
- **Support** : métriques, jobs (`/support/jobs`), impersonation, incidents <24h
- **DPO** : violations 25-11, DPIA vidéo, demandes droits
- **Tech** : backup restore, secrets rotation, déploiement GHCR `latest+SHA`

## Anti-patterns à éviter

- Ne jamais inventer de valeur terrain — case vide = ⏳ terrain
- Ne jamais dire "ça devrait marcher" sans exécution — tout est mesuré
- Ne jamais bypass RLS — garde `check-rls-usage.mjs` verte
