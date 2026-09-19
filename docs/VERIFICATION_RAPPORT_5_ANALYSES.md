# Vérification indépendante — « Les 5 analyses » (DATABASE / BILLING / FRONTENDS / COMPLIANCE / OPS)

_Date : 2026-09-19. Méthode : relecture directe de chaque fichier cité, sans
confiance a priori dans le rapport (contrainte permanente de la mission).
Verdict global : **signal réel important, mais les deux CRITICAL sont faux ou
massivement exagérés, et plusieurs « lignes exactes » citées n'existent pas.**
21 claims : 12 confirmés (dont 0 critique), 3 partiels, 6 réfutés._

## Légende
- ✅ **CONFIRMÉ** — le défaut existe, vérifié dans le code cité.
- 🟡 **PARTIEL** — une partie du claim est vraie, l'autre est fausse ou atténuée par un mécanisme existant.
- ❌ **RÉFUTÉ** — contredit par le code.

---

## Analyse 1 — DATABASE

| # | Verdict | Détail vérifié |
|---|---|---|
| DB1 (index `invoice_lines`) | ✅ CONFIRMÉ (sévérité revue MEDIUM) | `010_billing.sql:69` : aucun index sur `invoice_id`. Seq-scan réel mais volumes par tenant modestes (facturation mensuelle) — MEDIUM plutôt que HIGH. |
| DB2 (trigger 023 INSERT-only) | ✅ CONFIRMÉ | `023_payment_integrity.sql` : `BEFORE INSERT` uniquement ; UPDATE/DELETE d'allocations non gardés. Concurrence : le garde verrouille la ligne **facture** (`FOR UPDATE`), pas la ligne **paiement** → deux allocations concurrentes du même paiement vers deux factures différentes peuvent dépasser le montant du paiement. Exposition réelle limitée (l'app n'alloue qu'une fois par paiement), mais le trou SQL direct existe. |
| DB3 (C04 troué) | ✅ CONFIRMÉ | `guard_invoice_mutation` (010_billing.sql:137) ne bloque que `total_amount`/`paid_amount` sur facture payée/annulée ; `status`, `child_id`, `contract_id`, période, `due_date`, `pdf_url` restent modifiables. `guard_payment_mutation` idem partiel. Grep global : **aucun trigger DELETE** sur invoices/payments — suppression SQL possible (le rôle app a DELETE). |
| DB4 (chk_line_total) | 🟡 PARTIEL | Le CHECK `total_price = quantity * unit_price` avec `quantity NUMERIC(10,3)` est bien piégeux (0.335×3.00=1.005 impossible à représenter en NUMERIC(10,2)). Mais l'app n'insère que `quantity=1` (billing.service.ts:98-111) → jamais déclenché par les flux livrés. Défaut de schéma latent, LOW-MEDIUM. |
| DB5 (audit_logs sans RLS) | ✅ CONFIRMÉ (par conception) | Exact : pas de RLS sur audit_logs/data_access_logs (004 n'active RLS que sur processing_registry/consent_records/privacy_requests). C'est l'architecture documentée « tables système » ; la frontière est dans les gardes API + le catalogue check-rls-usage. Risque résiduel réel si un futur accès SQL brut échappe au catalogue. |
| DB6 (aucun ON DELETE) | ✅ CONFIRMÉ | Grep migrations : 2× RESTRICT, 1× SET NULL, zéro CASCADE. Aucune suppression en dur possible sans chirurgie. Nuance loi 25-11 : l'anonymisation est une alternative reconnue à l'effacement, et `anonymize.sql` existe — mais il n'existe **aucun** chemin d'anonymisation/effacement **par enfant/famille à chaud** (le script est global staging). |
| DB7 (paid_amount non réconcilié) | ✅ CONFIRMÉ (LOW) | `paid_amount` écrit par l'app (recordCashPayment, webhook DEFINER) ; le trigger 023 borne les allocations par rapport à `paid_amount` mais ne le dérive pas de `SUM(payment_allocations)`. Dérive possible uniquement sur bug applicatif ou SQL direct. |

## Analyse 2 — BILLING

| # | Verdict | Détail vérifié |
|---|---|---|
| B1 (caisse : site courant de l'enfant) | ✅ CONFIRMÉ (MEDIUM-HIGH) | `closeCashRegister` : `JOIN children ch ON ch.id=p.child_id ... AND ch.site_id=$2` attribue l'espèce au site **actuel** de l'enfant, pas au site d'encaissement. Enfant muté dans la journée → mauvaise imputation. `total_cash_out` effectivement jamais alimenté (aucun flux de décaissement). |
| B2 (chevauchement de registres) | ✅ CONFIRMÉ (MEDIUM) | `openCashRegister` : `ON CONFLICT(site_id, register_date) DO NOTHING` protège seulement le **même jour** ; rien n'exige la clôture de la veille. |
| B3 (flottants sur NUMERIC) | 🟡 PARTIEL | Le pattern `Number(...)` existe (billing.service.ts, worker). MAIS : le rapport affirme « balances à 3 décimales possibles » → faux : colonnes NUMERIC(10,2), PostgreSQL arrondit à l'insertion ; impossible de stocker 3 décimales. Le worker calcule en cents entiers (`Math.round`). Risque réel : arrondi flottant JS au centime près sur des cas limites — LOW. |
| B4 (receipt_number / period_year) | ✅ CONFIRMÉ (LOW) | `REC-${seq}-${org.slice(0,8)}` divulgue 8 hexa de l'UUID org (faible). DTO : `@IsInt() @Min(2020)` sans `@Max` — exact. |

## Analyse 3 — FRONTENDS

| # | Verdict | Détail vérifié |
|---|---|---|
| F1 (« sync morte ligne 167 ») | ❌ **RÉFUTÉ** | La ligne citée `result['next_cursor'] as int?` **n'existe pas**. `sync_engine.dart:181` : `syncCursor(page['next_cursor'])` et `BigInt.parse(syncCursor(event['sync_seq']))` ; le helper `syncCursor()` (sync_wire_client.dart:17) **exige une string** int64 et rejette tout le reste — exactement le format émis par node-postgres pour les bigints. Le client est conçu pour le curseur string ; le contrat est validé par le générateur + suite phase29. |
| F2 (checksum factice) | ✅ CONFIRMÉ (LOW-MEDIUM) | `media_uploader.dart:78-81` : `_sha256` retourne `bytes.length.toString()` avec TODO explicite « Phase 6 : crypto.sha256 ». Côté serveur le checksum est stocké tel quel, **jamais vérifié** contre les octets → pas de rejet, mais métadonnée d'intégrité inutilisable. |
| F3 (zéro garde de route) | 🟡 PARTIEL (cadrage sécurité exagéré) | Exact : `App.tsx` n'a aucune garde par rôle côté front. MAIS la frontière d'autorisation est **serveur** (`@Roles` + gardes sur chaque endpoint) : un éducateur qui ouvre `/payroll` par URL reçoit des 403 sur toutes les données. C'est une lacune UX/hygiène (défense en profondeur), pas une fuite. |
| F4 (dates caisse fr-FR) | ✅ CONFIRMÉ (MEDIUM, affichage) | `BillingPage.tsx:332` : `new Date(r.closed_at).toLocaleString('fr-FR')` → fuseau navigateur, pas Africa/Algiers. Donnée stockée correcte (le serveur calcule en Alger) ; seule la visualisation peut décaler d'un jour autour de minuit. |
| F5 (localStorage) | ✅ CONFIRMÉ (connu/assumé) | Tokens en localStorage, commentaire « MVP » existant. Vrai, déjà documenté comme dette ; le rapport ajoute simplement qu'il manque un ticket — exact. |
| F6 (photo offline) | ✅ CONFIRMÉ (MEDIUM-HIGH, client) | Le client envoie `storage_key: 'offline/<ms>.jpg'` (media_uploader.dart) **sans préfixe tenant** ; le serveur rejette par opération `STORAGE_KEY_TENANT_MISMATCH` (sync.service.ts, garde C3). Toute photo offline posée par l'app Dart actuelle serait rejetée. À corriger côté client (`${organizationId}/offline/...`). Nuance : les bytes en base64 dans le payload local sont le mécanisme d'upload différé (commentaire explicite) — lourd mais fonctionnel par design. |
| F7 (vrac mobile) | 🟡 MIXTE | `_localSequence` remis à 0 au redémarrage → **FAUX** : la séquence client est persistée dans SQLite (`sync_state.client_sequence`, app_database.dart:113/166). Listener connectivité « jamais annulé » → **FAUX** : garde d'époque `_listenerEpoch` + `_stopped`. `dio.put` sans timeout ni retry → **VRAI** (media_uploader.dart:37). Bilan LOW. |

## Analyse 4 — COMPLIANCE

| # | Verdict | Détail vérifié |
|---|---|---|
| C1 (anonymize.sql CRITICAL) | ❌ **RÉFUTÉ dans ses termes** | Le script actuel (319 lignes, en-tête « audit anonymisation 2026-09 ») couvre **exactement** ce que le rapport dit absent : `guardians` (noms FR/AR, téléphones, email, **national_id → STAG-…**, adresse, employer NULL, photo NULL) ; `authorized_pickups` (incl. national_id, photo) ; `emergency_contacts` ; `messages.body` ; `devices.fcm_token/apns_token → staging-…` (donc **non**, le staging ne peut pas pusher de vrais téléphones) ; `sessions.refresh_token_hash → staging-…` (sessions prod non rejouables) ; `totp_secret NULL` ; `signature_data` neutralisé. La vérification finale contrôle **19 classes de résidus**, pas « seulement les emails ». Le rapport décrit l'ancienne version du script — le commentaire « le script historique les laissait INTACTS — finding H2l » montre que ces trous ont déjà été trouvés et corrigés. Restes réels mais **documentés dans LIMITES** : `children.date_of_birth` conservée (décision DPO exigée avant import), montants financiers conservés (choix), stockage objet hors périmètre SQL (consigne : staging sans bucket prod). |
| C2 (NIN intact en staging) | ❌ RÉFUTÉ | `guardians.national_id`, `staff_profiles.national_id`, `authorized_pickups.national_id` → `STAG-…` + assertion finale. |
| C3 (effacement 25-11 impraticable) | 🟡 PARTIEL | Vrai que les FK RESTRICT bloquent une suppression en dur (cf. DB6). Mais la loi admet l'anonymisation comme modalité d'effacement, et l'outillage existe au niveau global. Ce qui manque vraiment : un chemin d'anonymisation **à chaud par personne** (enfant/famille sortante) — à construire, MEDIUM. |

## Analyse 5 — OPS

| # | Verdict | Détail vérifié |
|---|---|---|
| O1 (job « mensonge » CRITICAL) | 🟡 PARTIEL (LOW-MEDIUM, pas CRITICAL) | Le handler `send_parent_notification` est bien un no-op qui rend succès, MAIS il est **explicitement documenté** juste au-dessus : « La livraison des notifications passe par notification_queue (drain ci-dessous) : ce job marque la prise en charge ». La vraie livraison (`notifyGuardiansOfEvent` → notification_queue → drain FCM/APNs/WhatsApp) est appelée **dans la même transaction de check-in** — rien n'est perdu. Le défaut réel : un job redondant qui salit la file et prête à confusion ; nettoyage recommandé (supprimer l'enfilement ou donner le travail au handler). |
| O2 (start_date jamais filtré) | ❌ **RÉFUTÉ** | `main.ts:126-128` : `WHERE is_active=true AND start_date <= $1::date AND (end_date IS NULL OR end_date >= $2::date)` avec $1 = premier jour du mois. Un contrat qui démarre en juin n'est **pas** facturé janvier-mai. Le commentaire précise « Facturation MANUELLE uniquement (scheduler désactivé par décision client) » et « Un contrat doit couvrir le mois complet » — comportement voulu. |
| O3 (pas de SIGTERM, pas de reaper) | ❌ **RÉFUTÉ** | `job-runtime.ts` : `process.on('SIGTERM', stop)` + `process.on('SIGINT', stop)` (l.77-78), drain avec `WORKER_SHUTDOWN_TIMEOUT_MS` (défaut 45 s), et `reap()` appelant `jobs_reap_stale()` toutes les `WORKER_REAPER_INTERVAL_MS` (défaut 5 min) (l.86-89). |
| O4 (drain : devices hors try) | ✅ CONFIRMÉ (MEDIUM) | `main.ts:430` : la lecture des devices (`withTenant(...)`) est hors du try interne ; une exception là casse la boucle du lot. Plus important : `notif_queue_claim` (042) ne reclame que `status='pending'` — des lignes abandonnées en `processing` (crash du worker) ne sont **jamais** reprises : pas d'équivalent reaper pour notification_queue. |
| O5 (PDF UTC, trous de séquence) | ✅ CONFIRMÉ (LOW) | `generatedAt` en UTC (toISOString) — cosmétique. « Trous de séquence sur runs concurrents » : `next_org_sequence` est appelé dans la transaction de chaque facture ; les échecs de transaction laissent des trous, comportement normal d'une séquence — pas un bug. |

### Claim de synthèse « rien n'enfile les 4 jobs récurrents »
❌ Exagéré. `job-runtime.ts:107` appelle `scheduler_enqueue_due()` à chaque cycle de poll ; le mécanisme d'enfilement existe et tourne. Le seul cas documenté comme volontairement inactif est la facturation mensuelle (« scheduler désactivé par décision client » — facturation manuelle).

---

## Bilan

| Claim | Verdict | Sévérité retenue |
|---|---|---|
| DB1 index invoice_lines | ✅ | MEDIUM |
| DB2 trigger 023 INSERT-only + concours | ✅ | HIGH |
| DB3 C04 partiel + pas de DELETE | ✅ | HIGH |
| DB4 chk_line_total | 🟡 | LOW-MEDIUM |
| DB5 audit sans RLS | ✅ (par conception) | MEDIUM |
| DB6 aucun ON DELETE | ✅ | MEDIUM |
| DB7 paid_amount non dérivé | ✅ | LOW |
| B1 caisse/site courant + cash_out | ✅ | MEDIUM-HIGH |
| B2 chevauchement registres | ✅ | MEDIUM |
| B3 flottants | 🟡 | LOW |
| B4 receipt/period_year | ✅ | LOW |
| F1 « ligne de la mort du sync » | ❌ | — |
| F2 checksum factice | ✅ | LOW-MEDIUM |
| F3 gardes de route front | 🟡 | MEDIUM (UX) |
| F4 dates caisse navigateur | ✅ | MEDIUM (affichage) |
| F5 localStorage | ✅ (dette connue) | MEDIUM |
| F6 storage_key offline non tenant | ✅ | MEDIUM-HIGH (client Dart) |
| F7 vrac mobile | 🟡 (2 faux, 1 vrai) | LOW |
| C1 anonymize.sql CRITICAL | ❌ | — (restes documentés) |
| C2 NIN staging | ❌ | — |
| C3 effacement à chaud | 🟡 | MEDIUM |
| O1 job no-op | 🟡 | LOW-MEDIUM |
| O2 start_date | ❌ | — |
| O3 SIGTERM/reaper | ❌ | — |
| O4 drain + processing orphelin | ✅ | MEDIUM |
| O5 PDF UTC | ✅ | LOW |

**Fiabilité du rapport** : les trouvailles base de données et caisse sont
solides (DB2, DB3, B1, B2 méritent un lot de correction). En revanche les deux
CRITICAL (C1 anonymisation, O1 job mensonge) sont contredits par le code
actuel, la « ligne exacte » F1 n'existe pas, et O2/O3 ignorent des gardes
présentes depuis les lots E. Pattern identique au rapport B1-B5 : à ne jamais
appliquer sans vérification fichier par fichier.

**Corrections recommandées par priorité** :
1. **DB3** — durcir C04 (tous champs sur facture payée/annulée + interdiction DELETE invoices/payments confirmés).
2. **DB2** — trigger UPDATE/DELETE sur payment_allocations + verrou ligne paiement.
3. **O4** — reclaim des notifications `processing` échouées (timeout) + try autour de la lecture devices.
4. **B1/B2** — imputation caisse au site d'encaissement + contrôle clôture veille.
5. **DB1** — index `invoice_lines(invoice_id)`.
6. **F6/F2** — client Dart : clé `offline/` préfixée tenant + vraie SHA-256 (avant toute compilation/release mobile).
7. **C3/DB6** — chemin d'anonymisation à chaud par enfant/famille (modalité d'effacement loi 25-11).
8. Nettoyages : O1 (supprimer le job redondant), F3 (gardes de route), B4, F4, O5.
