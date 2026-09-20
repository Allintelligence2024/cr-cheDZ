# Plan d'exécution — corrections du rapport « 5 analyses » (2026-09-19)

_Basé sur `docs/VERIFICATION_RAPPORT_5_ANALYSES.md` (verdicts vérifiés dans le
code). Chaque phase est indépendante, réversible et validée par des tests
existants + tests ajoutés. Ordre : intégrité financière (le cœur de la
base de données) d'abord, puis opérationnel, puis front mobile._

## Phases

### Phase 1 — Intégrité financière SQL (DB1, DB2, DB3) ✅ FAITE (commits à venir)
| Réf | Correction | Preuve |
|---|---|---|
| DB3 | Suppression `invoices` / `payments` / `payment_allocations` interdite (trigger DELETE, 42501) — le cycle de vie est immuable (C04 durci) | test : DELETE → refus |
| DB3 | `guard_invoice_mutation` remplacé : facture `paid`/`cancelled` → **tous** les champs immuables sauf liste de maintenance `updated_at`, `balance` (GENERATED), `pdf_url` (le worker génère le PDF *après* encaissement — contrat phase8) ; diff jsonb, strict pour tous les rôles | tests : due_date, child_id, status, période, notes → refus ; pdf_url, updated_at → OK ; facture brouillon → libre |
| DB3 | `guard_payment_mutation` remplacé : `confirmed`/`refunded` → tous champs immuables sauf `gateway_response`, `external_reference`, `notes` (les 3 colonnes neutralisées par anonymize.sql:220 — métadonnées, pas contenu financier) | tests : amount/method/status/références → refus ; gateway_response/notes/external_reference → OK ; pending → libre |
| DB2 | `guard_payment_allocation` (023) remplacé : **verrou `FOR UPDATE` sur le PAIEMENT** en premier (le trou : deux INSERT concurrents vers deux factures différentes ne se verrouillaient pas mutuellement) + contrôle somme des allocations du paiement + anti-cross-tenant + paiement confirmé obligatoire | test de concurrence déterministe : 2 INSERT concurrents → le second est refusé après commit du premier (avant correction : sur-allocation 280 > 250) |
| DB2 | Nouveau `guard_payment_allocation_mutation` (UPDATE) : mêmes bornes, somme excluant la ligne modifiée ; DELETE d'allocation interdit (déjà ci-dessus) | tests : montant > paiement → refus ; re-ciblage hors plafond facture → refus ; reduction → OK |
| DB1 | `CREATE INDEX idx_invoice_lines_invoice ON invoice_lines(invoice_id)` | `db:check-schema` (catalogue) |
| — | Rétrocompatibilité : l'ordre cash existant (INSERT paiement confirmé → INSERT allocation → UPDATE paid_amount) reste validé par le garde 023 remplacé (fixtures du test rejouent cet ordre exact) | phase44b fixture + Gate D complet |

**Livraison** : migration `064_financial_integrity_hardening.sql` +
suite `phase44b-financial-integrity.pg.test.mjs` dans la Gate D
(`run-isolation-suites.sh`) + relecture `db:check-schema`.

### Phase 2 — Fiabilité des notifications (O4, O1)
| Réf | Correction | Preuve |
|---|---|---|
| O4 | Reclaim des notifications orphelines : `notification_queue` lignes `processing` avec `claimed_at` dépassée retournent à `pending` (nouvelle fonction `notif_queue_reclaim(interval)` + appel dans le cycle worker, même rythme que le reaper jobs) | test PG : ligne processing stale → reclaim → pending → re-claim |
| O4 | `drainNotificationQueue` : la lecture des devices passe dans le try interne (plus de casse du lot) ; chaque notification traitée individuellement | revue + test worker existant |
| O1 | Suppression du job redondant `send_parent_notification` (enfilement au check-in) : la livraison réelle est déjà `notifyGuardiansOfEvent` → notification_queue ; le handler no-op disparaît, la file reste propre | grep : zéro référence ; e2e + phase28 |

### Phase 3 — Caisse (B1, B2) + nettoyages API ✅ FAITE
_Note d'exécution : le code d'erreur est `CASH_OPEN_PREVIOUS_DAY` (le plan
portait la coquille « CAISH »). La clôture cible le registre ouvert le plus
récent du site (chemin de reprise), pas seulement celui du jour — sans cela
B2 bloquerait sans issue de sortie. Le site d'encaissement est figé sur
`payments.site_id` (migration 066, backfill depuis `children.site_id`, NOT
NULL) : espèces (recordCashPayment), init en ligne (payment-provider) et
fallback webhook (052 inchangé + site + sel SHA-256 du reçu) le posent à
l'enregistrement._
| Réf | Correction | Preuve |
|---|---|---|
| B1 | `closeCashRegister` : imputation au **site d'encaissement** (la caisse porte le site ; les paiements du jour du registre), pas au site actuel de l'enfant via JOIN children ; `total_cash_out` documenté (0 tant qu'aucun flux de décaissement) | test API caisse multi-sites (enfant muté → imputation au site du registre) |
| B2 | `openCashRegister` : si un registre non clôturé de la veille existe pour le site → erreur explicite CAISH_OPEN_PREVIOUS_DAY (pas de blocage silencieux) | test API |
| B4 | `period_year` : `@Max(2100)` ; `receipt_number` sans fragment d'UUID (séquence + salage du tenant via hash court) | revue + tests unitaires billing |
| F4 | `BillingPage` : `closed_at` formatée en Africa/Algiers (Intl avec timeZone) | revue UI |

### Phase 4 — Mobile Dart (F6, F2, F7) — avant toute release mobile ✅ FAITE
_Note d'exécution : F6 clé = `<org>/photo/offline-<ms>.jpg` (même forme que
les clés serveur, organisation prise dans le scope de la base locale) ; F2
`package:crypto` (déjà transitif) ; F7 `putSigned` : délais 15/60/30 s + 1
retry sur panne transport uniquement (jamais sur 4xx — URL signée), octets
rejouables (plus de `Stream` à usage unique). Tests Dart
`test/media_uploader_phase4_test.dart` (exécutés par le job CI `flutter`,
pas de SDK Dart dans le bac à sable). F3 : `auth/routeAccess.ts` miroir des
`@Roles` API + `RequireRole` sur chaque route + menu filtré ;
`routeAccess.test.ts` (node --test) branché dans ci.yml._
| Réf | Correction | Preuve |
|---|---|---|
| F6 | `storage_key` offline préfixé tenant (`${organizationId}/offline/…`) — sinon le serveur rejette TOUTE photo offline | test Dart : clé générée vs préfixe tenant ; e2e sync si dispo |
| F2 | Vraie SHA-256 (`package:crypto`) dans `_sha256` (le TODO Phase 6 du code) ; le serveur ne vérifie toujours pas les octets (dette documentée : checksum = métadonnée client) | test Dart : checksum de vecteur RFC |
| F7 | `dio.put` upload : timeout + 1 retry | revue + test |
| F3 | Gardes de rôle sur les routes admin-web (l'UX ne doit pas exposer /payroll à un éducateur) — l'autorisation reste au serveur | revue UI |

### Phase 5 — Conformité 25-11 (C3/DB6) — à chaud par personne ✅ FAITE
_Note d'exécution : migration 067 `anonymize_child(uuid, uuid, text)`
(SECURITY DEFINER fail-closed tenant, refus enfant actif, motif requis,
idempotente, tuteurs exclusifs + comptes parents, sessions révoquées +
token_epoch, audit + tombstone sync, clés S3 retournées) ; endpoint
`POST /privacy/children/:id/anonymize` (director/super_admin) avec purge S3
best-effort remontée honnêtement (`media_purge.failed`). Runbook
`docs/PRIVACY_ERASURE_RUNBOOK.md` (DB6 : RESTRICT = contrôle, anonymisation =
modalité). Suites phase56 (17) + phase56b (10) ajoutées au runner._
| Réf | Correction | Preuve |
|---|---|---|
| C3 | Chemin d'anonymisation **par enfant/famille** (à chaud, transactionnel, motif + DPO requis, audité) — fonction SQL `anonymize_child(uuid)` réutilisant les règles d'`anonymize.sql` + endpoint de conformité protégé | test PG : enfant anonymisé → résidus nuls → audit écrit → rejeu idempotent |
| DB6 | Documenter dans BACKUP-RUNBOOK/PRIVACY-RUNBOOK : anonymisation = modalité d'effacement retenue (RESTRICT = contrôle de la suppression en dur) | revue doc |

### Hors périmètre (décisions, non des bugs)
- DB4 (chk_line_total NUMERIC) : l'app n'insère que quantity=1 ; laisser le CHECK, ajouter une note de conception (pas de migration risquée pour rien).
- DB5 (audit sans RLS) : architecture « tables système » assumée ; le catalogue check-rls-usage est le contrôle. Suivi P2.
- DB7 (paid_amount non dérivé) : l'invariant est maintenant borné par les gardes 023/064 (allocations ≤ paiement ≤ total) ; dériver paid_amount de SUM(allocations) = refactor à part.
- O2, O3, O5, F1, C1, C2 : réfutés — rien à faire (documenté).

## Critères de fin de phase
- Gate D locale : toutes suites vertes (phase44b incluse), y compris anti-bypass RLS.
- CI : checks vertes sur le commit (database en dernier).
- Aucun `gh` merge : le PR #46 reste ouvert en attente d'approbation.
