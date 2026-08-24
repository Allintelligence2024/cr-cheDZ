# PROMPT_AUDIT — audit statique (trace historique)

> NOTE 2026-08-23 : ce document avait été produit par la session d'audit puis
> PERDU avec son environnement (jamais poussé). Il est RECONSTITITÉ ici comme
> trace historique, fidèle aux conclusions reprises par la session de
> correction (docs/PROMPT_FIX_AUDIT.md). Ne pas modifier.

## Objet

Audit statique du logiciel de gestion de crèche (Algérie) — revue de code
sans exécution, ciblée sécurité/isolation multi-tenant.

## Conclusions (1 défaut majeur + 2 moyens stockage vidéo + 3 faibles)

### Défaut MAJEUR — paiement (P0)

`apps/api/src/modules/billing/payment-provider.service.ts`, chemin SUCCÈS de
l'init paiement : l'UPDATE `payments SET gateway_response=…` passe par la
POOL BRUTE (`this.pool.query`). Or le rôle applicatif est NOBYPASSRLS et la
pool ne pose pas `app.tenant_id` : l'UPDATE touche 0 ligne **silencieusement**
(RLS) — la réponse de la passerelle n'est JAMAIS persistée alors que l'API
répond « succès » avec redirect_url. Faux état + perte de traçabilité
financière. (Le chemin erreur, lui, passe correctement par
withTenantConnection.)

### Défauts MOYENS — stockage vidéo (2)

1. `storage_key` contrôlé par le client : la regex DTO `^[\w\-./]{1,200}$`
   accepte `..` (path traversal) et la clé n'est pas contrainte au préfixe
   du tenant ; aucun CHECK DB ne protège `video_clips.storage_key`
   (ni `media_assets`, `staff_documents`, `report_exports`).
2. `storage_backend` contrôlé par le client (DTO accepté tel quel) : la
   colonne reflète la déclaration du client, pas la réalité du serveur ;
   `local` n'est pas interdit en production.

### Défauts FAIBLES (3)

- `resolve()`/containment absent avant lecture fichier
  (`video.service.streamContent`, `exports.service.download`,
  worker `storeFile`/`deleteFile` — la purge vidéo DPIA pourrait supprimer
  hors racine).
- Commentaire mensonger « anti-énumération » dans `auth.service.login`
  (la réalité = message unifié ; `recordFailedAttempt(null, ·)` est un
  no-op) + statut `pending` au login non documenté comme choix produit.
- 7 `dto: any` dans `health.service` + `(wb as any).xlsx` dans le worker ;
  script `lint` mensonger (eslint non installé) ; workflows CI absents et
  alignement PostgreSQL non garanti.

## Exigences de validation (non négociables)

Toute correction doit être PROUVÉE par exécution : suites existantes
24/24 vertes + nouvelle suite de régression, tests prouvés par MUTATION
(rouge sur code pré-correctif → vert sur code corrigé), typecheck 4 apps,
`npm audit --omit=dev` = 0, `migrate --status` cohérent. PostgreSQL 18
réel (embedded-postgres 18.4.0-beta.17), rôle applicatif NOBYPASSRLS.
