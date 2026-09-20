# Effacement (loi 18-07 modifiée par 25-11) — modalité retenue : ANONYMISATION

Rapport 5 analyses, Phase 5 (C3 + DB6). Migration `067_anonymize_child.sql`,
endpoint `POST /privacy/children/:id/anonymize`, suites
`phase56-anonymize-child.pg.test.mjs` (17 ✓) et
`phase56b-anonymize-child.api.test.mjs` (10 ✓).

## Décision de conception (DB6) : pas de suppression physique

Toutes les clés étrangères vers `children` et `guardians` sont `RESTRICT`
(ou sans action = `RESTRICT`) ; zéro `ON DELETE CASCADE` dans le schéma ; les
triggers `trg_no_delete_invoices` / `trg_no_delete_payments` (064) interdisent
la suppression des pièces comptables ; le journal d'audit est en append-only.

Ce n'est **pas une lacune** : c'est le contrôle qui rend la suppression en dur
impossible par accident ou par un seul acteur (intégrité comptable — factures,
paiements, allocations — et registre de preuve). La loi 25-11 admet
l'**anonymisation** comme modalité d'exécution du droit à l'effacement : une
fois la personne non identifiable, les données subsistantes ne sont plus des
données à caractère personnel.

Il existe donc deux outils, pour deux besoins distincts :

| Besoin | Outil | Périmètre |
|---|---|---|
| Base de staging sans données réelles | `scripts/anonymize.sql` (H2l) | **Globale**, base entière, refuse la production |
| Effacement d'**une** personne (enfant/famille sortante) | `anonymize_child(uuid, uuid, text)` (067) | **À chaud**, par enfant, en production |

## Ce que fait `anonymize_child(p_child_id, p_actor_id, p_reason)`

Fonction `SECURITY DEFINER`, **fail-closed** sur le tenant (`app_tenant_id()`
obligatoire ; l'enfant doit lui appartenir — un enfant étranger ou inexistant
donne la même réponse `CHILD_NOT_FOUND`, pas d'oracle). Une seule
transaction (celle de l'appelant) ; **idempotente** (rejeu → aucun écrit,
`already_anonymized = true`).

Pré-conditions refusées explicitement :
- `CHILD_STILL_ACTIVE` : l'enfant n'est ni `departed` ni soft-deleted. On
  n'efface jamais un dossier en cours — enregistrer d'abord la sortie.
- `ANONYMIZE_REASON_REQUIRED` : motif < 5 caractères.
- `ANONYMIZE_ACTOR_REQUIRED` : pas d'acteur.

Anonymisé (valeurs d'origine irrécupérables) :
- **Enfant** : prénoms/noms → `Anonyme-<8 hex sha256(id)>` / `Anonyme`, date de
  naissance réduite au 1er du mois (âge statistique conservé), genre, photo,
  notes, besoins particuliers ; `status = departed`, `deleted_at` posé,
  `departure_reason = 'ANONYMIZED'` (marqueur d'idempotence — ne pas réutiliser).
- **Santé** : dossier (groupe sanguin, médecin, assurance, pathologies, notes),
  allergies (`allergen = 'anonymisé'`, inactivées), vaccins (nom/lot/par qui),
  autorisations de traitement (inactivées), observations d'administration.
- **Journal** : tous les textes libres (repas, activités, notes, incidents,
  observations santé, motifs de correction). Événements et compteurs restent.
- **Entourage** : contacts d'urgence, personnes autorisées (inactivées).
- **Messagerie** de l'enfant : corps → `anonymisé` + `deleted_at`, sujets.
- **Médias** : nom d'origine, checksum, visibilité parents, `deleted_at` — pour
  les photos de l'enfant **et** les photos de groupe où il figure
  (`children_in_photo`). Les **octets S3/MinIO sont hors SQL** : les clés sont
  retournées (`media_storage_keys`) pour purge par l'API (voir plus bas).
- **Consentements** : preuve conservée (type, date, accordé) ; IP et
  signature effacées.
- **Tuteurs EXCLUSIFS** (liés à cet enfant et à aucun autre enfant non
  anonymisé) : identité, téléphones, email, pièce d'identité, adresse,
  employeur, photo, notes ; `deleted_at`. Un tuteur **partagé** (fratrie encore
  inscrite) est **conservé** intact — ses données restent nécessaires.
- **Comptes parents** de ces tuteurs : email → `anonyme+<hex>@anonymise.invalid`,
  téléphone, noms, mot de passe, secret TOTP, PIN ; `status = deleted` ; toutes
  les **sessions révoquées** (`ANONYMIZED`) ; le trigger G4 incrémente
  `token_epoch` → tous les jetons émis sont invalides immédiatement ;
  adhésions désactivées ; boîte de notifications et file d'envoi neutralisées.

**Conservé** (obligation légale / intégrité, non identifiant après coup) :
contrats, factures, paiements, allocations, historique de statut, présences
agrégées, changements de salle, journal d'audit (les valeurs personnelles n'y
sont pas réécrites : c'est le registre de preuve ; il est déjà soumis à la
rétention 5 ans de `retention_purge_logs`).

Preuves écrites par la fonction : une ligne `audit_logs` (`delete` / `child`,
motif, compteurs, **aucune donnée personnelle**) et le **tombstone de sync**
(trigger 059 : les appareils reçoivent `deleted` sans identité).

## Endpoint et purge des octets

`POST /api/v1/privacy/children/:id/anonymize` — rôles `director`,
`super_admin` ; corps `{ reason: string (≥5, ≤500), request_id?: uuid }`.

1. `anonymize_child` dans la transaction tenant (401/403 par rôle, 404 tenant
   étranger, 409 `CHILD_STILL_ACTIVE`, 400 `ANONYMIZE_REASON_REQUIRED`).
2. Si `request_id` est fourni, la demande de droits correspondante
   (`privacy_requests`) est clôturée dans la **même** transaction.
3. **Hors** transaction : suppression de chaque clé S3 retournée. La purge est
   best-effort et **honnête** : la réponse contient
   `media_purge: { purged, failed: [{ key, error }] }` et un audit
   `media_purge` est écrit. Un échec n'est jamais masqué — l'opérateur relance
   la purge des clés listées (les métadonnées SQL sont déjà masquées ; les
   URL signées ne sont plus délivrées pour un asset `deleted_at`).

## Procédure opérateur

1. Vérifier la demande (identité du demandeur, lien avec l'enfant, absence de
   litige comptable en cours — les pièces comptables sont conservées de toute
   façon).
2. Enregistrer la **sortie** de l'enfant si ce n'est pas fait
   (`status = departed`).
3. Appeler l'endpoint avec un motif explicite (référence de la demande).
4. Vérifier `media_purge.failed` ; si non vide, purger ces clés et consigner.
5. Conserver le numéro d'audit ; répondre au demandeur dans le délai légal.

## Rejouer les preuves

```bash
DATABASE_URL=postgres://…/creche_test node tests/tenant-isolation/phase56-anonymize-child.pg.test.mjs
DATABASE_URL=postgres://…/creche_test node tests/tenant-isolation/phase56b-anonymize-child.api.test.mjs   # nécessite apps/api/dist
```

## Limites assumées

- Les **sauvegardes** antérieures contiennent encore les données : elles
  expirent avec la rotation documentée dans `BACKUP-RUNBOOK.md` ; une
  restauration ne doit jamais être suivie d'une remise en ligne sans rejouer
  les anonymisations postérieures à la sauvegarde (le journal d'audit les
  liste : `resource_type = 'child' AND action = 'delete'`).
- Les exports déjà téléchargés par des parents/directeurs sont hors de portée.
- Le personnel (`staff_profiles`) a son propre cycle de vie RH : hors périmètre
  de cette fonction.
