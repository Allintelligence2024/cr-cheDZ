# H2 — Confidentialité, lot a : publication et exports de droits

2026-09-14 · PR #44 · données synthétiques · aucun déploiement.

## Périmètre et preuves avant correction

`phase35-confidentiality.api.test.mjs` lance une vraie API HTTP compilée, avec
PostgreSQL et un rôle applicatif NOBYPASSRLS. Aucun transport payant n'est appelé :
les assertions notifications portent sur les lignes réellement insérées en base.

Première reproduction : **3/17 verts, 14 rouges**. Suite enrichie rejouée contre
l'API publiée `5469367` : **5/21 verts, 16 rouges** ; après correction : **21/21**.
L'échec initial d'une fixture e-mail trop longue a été corrigé avant ces mesures ;
un échec de préparation n'a pas été compté comme une reproduction de fuite.

| Finding | Reproduction | Correction |
|---|---|---|
| Notifications de journal sans `can_view_journal` | Parent refusé : 2 lignes push/WhatsApp + 1 inbox après un repas HTTP | Filtre commun avant insertion dans les trois destinations |
| Marqueur privé sur DTO mixte | Un repas portant `note_is_private=true` reste visible et notifie | Tout événement marqué privé reste non visible ; aucun envoi créé |
| Comptable opérateur privacy implicite | Création d'une demande pour un enfant sans lien, liste/détail des demandes d'autrui, export médical HTTP 201 | Opérateurs des demandes : director/super_admin uniquement ; les autres utilisateurs sont limités à leurs propres demandes |
| Notes privées/masquées dans l'export JSON | Sentinelles privées dans la réponse parent **et** directeur | Journal publié et non privé uniquement dans l'export destiné au sujet |
| Projection enfant trop large | `children.notes` et `special_needs_notes` dans l'export | Liste explicite de champs d'identité/scolarité, sans notes internes |
| Contournement des permissions par export | Santé, journal et finance apparaissent avec les trois permissions désactivées | Catégories recalculées d'après les droits courants avant lecture |
| Santé via le journal | Observation médicale malgré `can_view_health=false` | Champs médicaux masqués et événements `health_observation` exclus sans ce droit |
| Anciennes demandes après révocation | Demande déjà créée conserve les droits ; gardien supprimé exporte encore | Vérification du lien non supprimé et des permissions à chaque génération |

**Faux positif précisé :** `/exports` Excel n'accepte que `attendance` et `invoices`.
Le type médical était déjà HTTP 400, et l'export financier du comptable reste HTTP
201. Le contournement médical provenait de `/privacy/requests/:id/export` : aucun
correctif fictif n'a été appliqué au générateur Excel ni à son stockage.

## Règles appliquées

La [matrice d'autorisation](architecture/authorization-matrix.md) documente ce lot.
Les constantes des opérateurs privacy et des types de notification journal sont
partagées dans `shared/authorization/disclosure-policy.ts`.

- Opérateur privacy : rôle sélectionné `director` ou `super_admin`, toujours dans
  le tenant courant. Le comptable n'est plus opérateur des demandes d'autrui.
- Self-service : tout utilisateur authentifié conserve ses demandes personnelles.
  Pour un enfant, il faut un lien de gardien non supprimé ; l'export exige encore
  ce lien au moment de la génération. Être l'auteur d'une ancienne demande ne
  constitue pas une autorisation permanente sur l'enfant.
- `can_view_journal` : journal exportable seulement s'il est visible et non privé.
- `can_view_health` : dossier, allergies, vaccins, médicaments et champs médicaux
  du journal. Sans cette permission : dossier null, collections médicales vides.
- `can_receive_invoices` : factures/paiements ; collections vides sans permission.
- L'export enfant est une **projection minimisée**, pas la promesse juridique d'un
  dossier exhaustif. Les présences et consentements restent des catégories du sujet
  lié, comme auparavant. Une demande juridique exceptionnelle exige une revue dédiée.
- Les notifications de repas/fin de sieste/incident exigent aussi `can_receive_push`,
  un enfant non supprimé et un gardien non supprimé. L'arrivée/départ conserve sa
  politique distincte `can_receive_push` : le contrôle positif HTTP la protège.
- Les permissions d'un opérateur ne permettent pas d'inclure les notes privées
  dans un export à remettre au sujet. La vue interne du journal n'est pas modifiée.
- La réponse et le JSON nouvellement persisté sont identiques et filtrés. Aucun
  ancien snapshot n'est réécrit ou supprimé implicitement.

## Exécution et gates

```sh
npm ci
npm run build --workspace @creche/api
# Uniquement base dédiée *_test : préparer du neuf avec les identités du runbook D.
node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs
node tests/tenant-isolation/phase35-confidentiality.api.test.mjs
# Gate complet avec rôles/grants livrés :
ALLOW_DATABASE_RESET=1 DATABASE_URL=<URL_ADMIN_BASE_JETABLE_TEST> npm run test:production-roles
```

Ne pas employer une URL cliente ou de production. Le runner strict recrée le schéma
avant les suites historiques. La nouvelle suite ne fait pas de reset et rejoint
le runner existant (38 suites/contrôles), sans workflow supplémentaire. Elle utilise
des fixtures uniques ; le reset du cluster jetable reste la procédure de nettoyage.

Les gates Docker H1 et Flutter F2/F4 demeurent obligatoires sur GitHub. Leur statut
se lit sur le HEAD courant de la PR, pas sur un commit antérieur ni sur le seul
code de sortie de `gh run watch`.

## Limites et suite obligatoire H2b

**La grappe confidentialité n'est pas clôturée par ce lot.** Le contrôle des
notifications est ici à la création, pas une qualification de livraison externe.
Restent à reproduire/corriger ensemble avant toute mise en production :

1. Révocation entre mise en file et envoi effectif ; revalidation des droits,
   appartenances et visibilité au moment d'envoyer. Les anciens payloads WhatsApp
   ne portent pas l'identité enfant/événement permettant cette vérification.
2. Lecture des anciennes inbox après retrait des permissions ou changement de
   visibilité ; politique des notifications déjà envoyées et snapshots historiques.
3. Revue des autres projections et contrôles de gardien, ainsi que les routes
   privacy registre/DPIA/violations non modifiées ici. Les quatre routes de demandes
   sans `@Roles` sont justifiées dans la matrice, pas toutes les routes sans garde.

Les tests positifs prouvent les nouveaux enregistrements en queue et inbox ; ils ne
prouvent ni FCM/APNs/WhatsApp réels, ni la révocation des messages déjà livrés.
Aucune règle de paie n'est déduite de la facturation de garde. G, le reste de H2,
H3, stockage/CVE et Android release restent ouverts.

## Rollback et données

Code seulement : aucune migration, aucun changement de lockfile ni nouveau SDK.
Migrations 001–061 intactes. Aucun ancien export ou historique n'est purgé.

En cas d'incident, suspendre la publication des notifications et les exports
privacy concernés, préserver les données et diagnostiquer. Ne pas réactiver les
anciennes réponses vulnérables pour rétablir le service. Une remise en service
requiert les tests de confidentialité et les gates de rôles/isolation verts.

### Résultats locaux du lot

- `npm ci`, typecheck et build de tous les workspaces : verts.
- Lint `--max-warnings=0` : vert ; unitaires API : **27/27**.
- `npm audit --omit=dev` : **0 vulnérabilité**.
- Rôles/grants de production, schéma neuf puis batterie : **38/38 suites**, dont
  les **21 scénarios** H2a. Pas de grants de confort ajoutés par les helpers stricts.
- Le runner exige la preuve de cette suite et émet une notice CI `H2a confidentiality passed`.
  Docker et Flutter sont non exécutés localement : attendre leurs vrais checks CI.
- Préflight H1 : HEAD précédent `5469367`, CI **34871282171**, **9/9 checks verts** ;
  notices H1 dev/staging et F2/F4 confirmées. Ce résultat n'est pas réutilisé comme
  validation du nouveau code H2a.
