# H2l — Anonymisation staging : audit d'`anonymize.sql` contre le schéma actuel

2026-09-15 · baseline `47bac1a69fccabfac697bc0bef391d74ce8a51a1` (main post-PR #44) · PR #45.
Base de test jetable `*_test` uniquement ; aucun environnement client touché ;
aucune purge de production exécutée ni revendiquée.

## Finding reproduit (rouge)

L'audit 2026-09 affirmait : « `anonymize.sql` laisse `guardians`/`staff`/
`messages`/`sessions` intacts ». **Confirmé par reproduction** (suite
`phase52-anonymization.pg.test.mjs`, canari synthétique unique par colonne
couverte) : ancienne version du script → **4/14** ; dix scénarios rouges
notamment : identités d'état civil des tuteurs, `national_id`/CNAS/téléphones
du personnel, corps des messages, hashes de refresh réellement importés,
tokens FCM/APNs réels, IP réelles (consents/sessions/audit), noms de fichiers
d'origine, miroirs JSONB de sync/outbox, sites (coordonnées), et absence de
garde anti-mauvaise-base. Trois contrôles étaient déjà verts avant
correction (le scan lui-même, le refus de purge, refresh inerte côté
schéma de test) — pas trois vulnérabilités supplémentaires.

## Correction livrée (verte : 14/14)

`scripts/anonymize.sql` réécrit, dans l'esprit du script existant
(pseudonymisation déterministe md5 par ligne, aucun DELETE, liens conservés) :

- **identité complète** : `users` (email/tél/noms + haché de mot de passe
  **remplacé** par le hash public de staging `Creche#Staging2026!` et secret
  TOTP **supprimé**), `guardians`, `staff_profiles`, `emergency_contacts`,
  `authorized_pickups`, `children`, `sites` et `organizations` ;
- **texte libre** : `messages.body`, `conversations.subject`, notifications
  file/boîte (FR **et** AR), journaux (déjà traités) étendus, notes
  contrats/factures/caisses/privacy, DPIA `risk_assessment`, violations ;
- **séances et appareils** : `sessions.refresh_token_hash` remplacé (une
  session importée ne se rejoue plus), IP en TEST-NET-2 (RFC 5737) partout
  (`users.last_login_ip`, `sessions`, `consent_records`, `audit_logs`,
  `data_access_logs`, `media_access_logs`), tokens `fcm_token`/`apns_token`
  pseudo-tokens déterministes, `otp_codes.target` pseudonymisé ;
- **miroirs JSONB** (payloads `outbox_events`, `sync_changelog`,
  `sync_operations.payload` et le sous-arbre `body` de
  `response_outcome`) : toute valeur texte remplacée par `staging-anon`,
  structure/types non-textes conservés — le CHECK composite de
  `sync_operations` (`response_outcome->>'status' = status`) reste valide,
  la fonction helper est créée dans la transaction et **droppée** à la fin ;
- **auto-vérification transactionnelle** : 20 contrôles finaux (un par
  famille) ; tout résidu → `RAISE EXCEPTION 'Anonymisation incomplète —
  résidus: …'` et **rollback du lot entier** (prouvé par scénario de script
  amputé : rien d'écrit) ;
- **garde de nom de base** : refus sur base ne finissant pas par `staging`
  ou `_test` (prouvé sur une base temporaire `anonprod_like_h2l`) ;
- **idempotence** : rejouable sans erreur (fonction helper
  `DROP IF EXISTS`, expressions déterministes stables) ;
- fichiers média : seul `original_filename` est pseudonymisé (extension
  conservée pour les tests MIME) ; `storage_key`/`checksum` **inchangés**.

## Preuves

Suite **14/14** HTTP réel (login API après anonymisation : mot de passe
public OK, ancien mot de passe réel 401, refresh importé 401), PostgreSQL
réel, scan dynamique **de toutes les colonnes texte/jsonb du schéma** pour
les canaris (le scan voit aussi le résidu assumé `organizations.settings`,
preuve qu'il n'est pas vacueux). BATTERIE : `run-isolation-suites.sh` porté
à **55 suites/contrôles** (phase51 puis phase52 en fin de course — la suite
réécrit les données, elle doit rester dernière).

## Limites ASSUMÉES — aucune conformité globale n'est revendiquée

- **Binaires en stockage objet** : photos, pièces jointes, PDF d'exports
  (`privacy_request_exports`), clips vidéo : hors de portée d'un UPDATE SQL.
  Un staging alimenté depuis un dump prod doit repartir d'un bucket
  **propre**, sans objets de production ; les URLs signées expirent par TTL.
- **Côté fournisseurs** : tokens push déjà enregistrés chez FCM/APNs,
  e-mails/SMS/WhatsApp déjà envoyés : irrévocables par ce script.
- `organizations.settings` et `background_jobs.payload` conservés
  (identifiants internes ; résidu documenté et VISIBLE par le scan).
- `children.date_of_birth` conservée — date indirectement identifiante :
  décision DPO requise avant tout import réel (documentée dans le script).
- Les montants financiers sont conservés volontairement (utilité staging).
- Le script reste une **étape manuelle** après import d'un dump : aucun
  job planifié livré ; l'automatiser exigerait un gate de confirmation
  hors de ce lot.

## Rejouer

```sh
npm ci && npm run build
node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs
DATABASE_URL=... node tests/tenant-isolation/phase52-anonymization.pg.test.mjs   # 14/14
# gate complet (strict rôles de prod) :
ALLOW_DATABASE_RESET=1 node scripts/test-production-roles.mjs
```

En staging réel : `psql "$DATABASE_URL_STAGING" -v ON_ERROR_STOP=1 -f
scripts/anonymize.sql` depuis un compte pouvant `CREATE FUNCTION` public
(⚠️ `creche_app` n'a pas le droit — utiliser `creche_migrator` ou postgres,
comme pour les migrations). Après exécution : re-bootstrap complet des
clients mobiles de staging (miroirs sync neutralisés).

## Rollback écrit, non exécuté

Aucune migration, aucun changement de grant, aucun workflow. Le script
n'effaçant aucune ligne, son « rollback » n'existe pas — c'est le sens du
choix UPDATE-only : en cas d'erreur, la transaction annule tout ; après
commit, la restauration est une ré-importation depuis le dump source puis
re-anonymisation corrigée. Installation neuve, aucune donnée client à
restaurer.
