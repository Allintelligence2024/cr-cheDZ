# ADR-010 — Audit : rétention 5 ans + masquage PII

**Statut** : Accepté
**Date** : 2026-08-01

## Contexte
`audit_logs.old_values`/`new_values` peuvent contenir des données sensibles
(pièces d'identité, téléphones, santé).

## Décision
- **Masquage systématique** côté service : `password_hash`, `totp_secret`,
  `national_id`, `phone`, `email`, données de santé, `fcm_token`,
  `refresh_token_hash` → `"[REDACTED]"` (liste centralisée).
- Rétention : `audit_logs` et `data_access_logs` conservés **5 ans**
  (partitionnement mensuel + archivage S3 glacier au-delà).
- Les journaux applicatifs (logs JSON) ne contiennent jamais de PII
  (middleware de filtrage).

## Conséquences
- L'audit reste exploitable (qui, quoi, quand) sans exposer de données.
- Conformité aux exigences de la loi 25-11 et du décret 19-253.
