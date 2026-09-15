# Matrice d'autorisation par module (v13 — audit 2026-09, Phases C/H2a/H2b/H2c/H2d/H2e/H2f/H2g/H2h/G1a/G1b/G1c/G2/G3a)

> Décidée le 2026-09-14 en exécution du plan `PLAN_CORRECTION_AUDIT_2026-09.md` (C1).
> Sources : constantes `@Roles(...)` des contrôleurs et politiques self-service des services.
> H2a : `shared/authorization/disclosure-policy.ts` centralise opérateurs privacy et types journal notifiables.
> Outil de contrôle : `npm run check:routes-inventory` (liste les routes sans `@Roles` ni `@Public`).

## Principes

1. **Toute route authentifiée qui ne déclare pas `@Roles` est ouverte à tous les rôles du
   tenant** (RolesGuard est fail-open). Les exceptions sont des routes self-service scopées
   dans le service (`/parent/*`, `/devices`, `/messaging`, `/users/me`, …) — chacune doit être
   revue et justifiée dans la revue G/H, pas tolérée par défaut.
2. **Les champs sensibles ne sortent jamais par les API de lecture génériques** : la paie et la
   RH lisent `base_salary`/`national_id`/`cnas_number` en base (côté serveur, `payroll.service`),
   pas via les réponses HTTP du module staff.
3. **`super_admin` n'est jamais attribuable** par une API (invitations, multi-rôles) — garde
   centralisée `shared/roles/assignable-roles.ts`. Il est réservé au seed de la plateforme.

## Matrice

| Module | Lire | Écrire | Champs sensibles exposés ? |
|---|---|---|---|
| **staff** | `super_admin`, `director`, `accountant` | `super_admin`, `director` | **Non** — jamais via l'API (projection explicite ; paie en base) |
| **payroll** | `super_admin`, `director`, `accountant` | `super_admin`, `director`, `accountant` | `base_salary` calculé serveur, jamais renvoyé brut |
| **billing** | `director`, `accountant` (+ `super_admin` sur certaines routes) | `director`, `accountant` | — |
| **children** | `super_admin`, `director`, `receptionist`, `educator` | `super_admin`, `director`, `receptionist` | — |
| **media** | `super_admin`, `director`, `educator`, `receptionist` | idem (visibilité : `super_admin`, `director`) | — |
| **sync** | staff mobile (STAFF_ROLES) | staff mobile | — |
| **invitations** | `super_admin`, `director` | `super_admin`, `director` (jamais `super_admin` comme cible) | — |
| **multi-rôles** (`/members/:id/roles`) | `super_admin`, `director` | `super_admin`, `director` (jamais `super_admin` comme cible) | — |
| **parent** (13 routes enfant) | Utilisateur/membership actifs + lien gardien/enfant courant ; capacités distinctes, pas le seul rôle JWT | Absence : journal ; consentement : lien courant | Finances minimisées H2d ; autres projections à revoir |

## Décisions à reconfirmer en Phase H (G2/H2)

- L'accountant lit `staff` (liste + détail sans champs sensibles) : confirmé par alignement sur
  payroll — à revalider avec le métier.
- Les 44 routes sans garde explicite (inventaire) : revue module par module + justification
  écrite pour chaque route self-service conservée sans `@Roles`.
- `staff_documents.storage_key` (création) : préfixe tenant C3 appliqué dans H2h ;
  existence/contenu des objets et anciennes références non qualifiés.

## H2a — demandes de droits et publication de journal

| Chemin / action | Autorisation et projection |
|---|---|
| `GET /privacy/requests`, `GET /privacy/requests/:id` | director/super_admin : tenant courant ; tous les autres (dont accountant) : requester_id courant uniquement |
| `POST /privacy/requests` | Pour un enfant : opérateur director/super_admin ou gardien lié non supprimé ; sans sujet : demande personnelle |
| `POST /privacy/requests/:id/export` | Même portée de demande ; non-opérateur : lien enfant/gardien non supprimé, revalidé à chaque génération |
| Journal dans l'export | can_view_journal pour le self-service ; seulement visible_to_parents et non privé, y compris pour l'opérateur |
| Santé dans l'export | can_view_health pour le self-service ; ce droit couvre aussi les observations médicales du journal |
| Factures/paiements dans l'export | can_receive_invoices pour le self-service ; métier paie inchangé |
| Notification repas/nap_end/incident (création) | can_receive_push ET can_view_journal ; gardien/enfant non supprimés ; toutes les destinations : push, WhatsApp, inbox |
| Notification arrivée/départ (création) | can_receive_push, politique distincte conservée |
| `/exports` Excel | attendance/invoices seulement, rôles existants inchangés ; type médical déjà refusé |

Les quatre routes de demandes sont volontairement sans `@Roles` : elles sont
**authentifiées**, chaque service vérifie la portée du demandeur. Un comptable qui
est aussi gardien peut exercer ses droits personnels ; son rôle comptable ne lui
accorde plus d'accès aux demandes ou dossiers des autres familles. Une ancienne
demande dont il est l'auteur ne remplace pas un lien actuel à l'enfant.

L'export destiné au sujet exclut les notes internes enfant et privées du journal,
pas la vue interne de travail des éducateurs. Il s'agit d'une projection minimisée,
pas d'une validation juridique de toutes les catégories du droit d'accès.

**Non couvert par H2a** : revalidation à la livraison externe et lecture des inbox
historiques après révocation, permissions des autres routes privacy/parent. Le
registre, les DPIA et les violations conservent leurs rôles antérieurs, à revoir
avec H2b/G. Cette section ne clôture pas l'inventaire global des routes.

## H2b — notifications : contrôle à chaque frontière

Le prédicat commun est `packages/prod-config/src/notification-access.ts`, exécuté
sous le rôle applicatif avec tenant local, sans privilège de lecture global.

| Frontière | Contrôle actuel |
|---|---|
| Publication parent | Utilisateur/membership actifs ; lien gardien/enfant courant ; référence/type d'événement valides ; droits can_receive_push et, pour journal, can_view_journal ; visibilité et non-privé |
| Worker après claim | Même règle revalidée avant appel du fournisseur ; préférence du canal courante ; WhatsApp : flag courant et téléphone toujours identique |
| Lecture inbox | Même autorisation enfant/événement et état utilisateur/membership, en SQL **avant LIMIT 100** ; pas de couplage à la préférence/au flag du transport externe |
| Mark-read | Même autorisation ; 204 sans mutation sur notification désormais interdite |
| Queue refusée | Consommée une seule fois avec motif explicite de non-envoi (contrat E3) ; pas de retry après restauration des droits |
| Ancien WhatsApp sans identité enfant/événement | Refusé comme invérifiable ; pas de reconstruction depuis le texte ou le numéro |

Les messages génériques push/inbox sans scope ni indices d'événement enfant
restent régis par utilisateur/membership actifs ; aucun endpoint ne permet à un
client d'injecter arbitrairement ces messages. Un nouveau producteur doit déclarer
sa portée et ses tests. Toute référence enfant fournie, même malformée, et tout
scope déclaré inconnu entraînent un contrôle fermé.

Les constantes de types journal H2a sont maintenant réexportées depuis ce package
commun. Les quatre routes privacy self-service H2a ne changent pas dans ce lot.

**Limites maintenues :** autres endpoints et révocation globale des tokens (G),
autres projections privacy/parent et snapshots historiques, fournisseurs externes
réels. Une vérification avant transport ne rappelle pas un message déjà transmis
et n'est pas atomique avec une révocation simultanée sur un réseau externe.


## H2c — portail parent : lien courant et capacités distinctes

Les 13 routes enfant du portail utilisent maintenant
`shared/authorization/guardian-access.ts` : gardien/enfant non supprimés,
utilisateur/membership actifs, appartenances tenant cohérentes, puis capacité
journal/santé/factures selon la route. Consentements : lien courant seulement.
Les listes filtrent en SQL ; détails et écritures refusent les anciens droits.
Ces routes self-service ne nécessitent pas un rôle JWT parent si l'utilisateur
est réellement gardien autorisé ; être parent de rôle sans lien ne suffit pas.

La matrice réelle **12 états × 13 routes = 156** vérifie les positifs, les
révocations, un pair, un autre tenant et les capacités indépendantes. Avant
correction : **107/156** ; après : **156/156**. Voir le
[runbook H2c](../PHASE_H2C_PARENT_ACCESS_RUNBOOK.md) pour les faux positifs écartés.

**Non couvert :** les deux routes de préférences personnelles, la révocation
JWT globale (G), les projections de champs financières/santé et les autres
routes privacy. Le contrôle d'une nouvelle URL ne rappelle pas une URL déjà
signée. Aucune sérialisation globale des révocations en cours de requête.


## H2d — finances parent : projections explicites

Les listes et détails de factures/reçus partagent deux projections fermées dans
`modules/parents/financial-projection.ts`. Les contrôles H2c demeurent : lien courant,
utilisateur/membership actifs et can_receive_invoices. Le contenu n'est pas autorisé
par sa seule forme.

- Factures : identification, période, montants/solde, statut/dates, noms d'enfant ;
  détail avec lignes FR/AR. `pdf_ready` indique une référence PDF non vide, sans
  révéler la clé ; téléchargement via la route PDF protégée existante.
- Reçus : références métier, montant/devise, méthode/statut/dates, enfant. Pas de
  notes internes, réponse JSON passerelle, référence fournisseur, créateur ou clé
  de stockage. Le statut pending du détail n'est pas transformé en confirmé.
- Back-office comptable inchangé et toujours protégé par ses rôles ; notes,
  allocations et diagnostics restent en base. Aucune purge rétroactive.

**32/44 → 44/44** scénarios réels API/PG ; adaptateur paiement HTTP avec fournisseur
loopback synthétique. Le [runbook H2d](../PHASE_H2D_FINANCIAL_PROJECTION_RUNBOOK.md)
détaille les champs, la réduction du contrat client et les faux positifs écartés.
Santé/journal/médias, routes privacy et révocation globale JWT ne sont pas qualifiés
par ce contrôle de projection financière.


## H2e — événements médicaux dans le journal parent

Le fil parent et les nouveaux exports de droits utilisent
`shared/authorization/journal-disclosure.ts` : visible et non privé, puis droit
santé requis pour **temperature et health_observation**. L'accès journal reste
nécessaire ; santé seule ne le remplace pas. Le fil applique le filtre avant LIMIT
100 et conserve sa projection (pas de nouvelles valeurs médicales brutes).

L'export autorisé conserve les valeurs médicales sous sa politique H2a ; sans
santé, les colonnes médicales des événements non médicaux mixtes restent masquées.
La vue brute/prévisualisation du personnel reste protégée par ses rôles et inchangée.

**28/36 → 36/36** HTTP/PG, dont révocation avant requête, nouveaux JSON persistés,
pagination sur 101 événements médicaux publiés par HTTP, et conservation des anciens
snapshots. Voir le [runbook H2e](../PHASE_H2E_JOURNAL_HEALTH_RUNBOOK.md).

Ce contrôle ne classe pas sémantiquement tous les textes libres et ne corrige pas
les autres autorisations privacy ou la révocation globale des sessions (G).


## H2f — acteur courant des demandes de droits

`PrivacyService.assertCurrentRequestActor` vérifie utilisateur actif/non supprimé
et membership active du tenant avant création, liste, détail, nouvel export et
résolution, y compris pour l'opérateur. Refus 403 sans effet métier. La vérification
est sous RLS dans la transaction de l'opération ; pas de nouveau grant.

Propriétaire et politique d'opérateur H2a inchangés. Un demandeur actif garde son
propre historique après suppression du gardien, sans nouvel accès au dossier enfant.
Un opérateur actif peut traiter le dossier d'un demandeur inactif. Création enfant
et capacités d'export réutilisent le lien courant H2c.

Le contrôle vise l'état de l'acteur, **pas les changements de rôles des anciens JWT**.
Les gardes/claims de rôles existants, le support global et les autres endpoints restent
à revoir en G. Registre/DPIA/violations et anciens snapshots restent hors de ce lot.
Voir le [runbook H2f](../PHASE_H2F_PRIVACY_ACTOR_RUNBOOK.md) pour la matrice HTTP/PG,
les positifs conservés et les frontières exactes.


## H2g — consentements photo à publication et nouvelle URL parent

Le helper `shared/authorization/photo-consent.ts` est partagé par la publication
(`visible=true`) et la nouvelle URL parent, après le garde H2c dans ce dernier cas.
Déclaration non vide/non nulle, flag vrai, ensemble dédupliqué primaire + participants,
enfants du tenant non supprimés et derniers consentements `photo_individual` accordés
et non révoqués. Le primaire ne peut plus être omis pour échapper au contrôle.

Publication refusée : 422 sans mutation ; URL refusée : 422 sans signature ni journal
d'accès média ; exclusion du fil. Retrait de visibilité et accès staff interne sous
rôles inchangés. Doublons valides désormais acceptés aussi en lecture parent.

**35/58 → 58/58** HTTP/PG, avec signatures SDK locales seulement. Les incohérences
historiques sont explicitement injectées en SQL, pas soumises comme un flag client.
Pas de purge/réécriture des sources, reconnaissance des personnes dans les octets,
rappel d'URLs signées, sérialisation concurrente, arbitrage multi-gardiens ou changement
de politique document/MIME. Autres projections médias et revalidation des rôles/JWT
restent ouvertes. Voir le [runbook H2g](../PHASE_H2G_PHOTO_CONSENT_RUNBOOK.md).


## H2h — clés des documents du personnel

`POST /staff/:id/documents` conserve ses rôles director/super_admin et sa recherche
du profil sous RLS. La clé doit ensuite commencer par `<tenant courant>/` via le
helper partagé `shared/authorization/storage-key.ts`, sinon 400 sans INSERT ni audit
de création. Profil absent/hors tenant : 404 inchangé ; autres rôles : 403 inchangé.
Les listes direction/comptabilité restent minimisées, sans clé de stockage.

**16/32 → 32/32** HTTP/PG : clés propres conservées à l'identique, clés hors périmètre
refusées, historique non réécrit. Les formes déjà bloquées par 049 ne constituent pas
de nouvelles fuites. Ni lecture d'objet, ni nouveau téléchargement, ni revalidation
JWT/roles globale ; le support global n'est pas qualifié par le super_admin tenant
utilisé dans le test. [Runbook H2h](../PHASE_H2H_STAFF_DOCUMENT_RUNBOOK.md).


## G2 — policies SQL et capacités globales explicites

La migration 055 limite les DML ordinaires sur `feature_flags`, `background_jobs`
et `outbox_events` aux lignes du tenant courant. Les lignes NULL restent lisibles,
mais ne peuvent être créées, mises à jour, adoptées ou supprimées par ces DML.
Les fonctions privilégiées worker/support existantes restent des capacités explicites
du serveur : leurs autorités HTTP/JWT sont un contrôle séparé, pas supprimé par RLS.

Les trois policies privacy de 029 utilisent le helper GUC robuste de 018. Le trigger
INSERT d'allocation verrouille aussi le paiement avant la somme, sans refonte des
règles de facturation ni purge des anciennes données. **52/113 → 113/113** sous rôle
applicatif réel ; [runbook G2](../PHASE_G2_RLS_INTEGRITY_RUNBOOK.md). Pas de qualification
des autres mutations financières ou de la possession des identifiants DB par un acteur.


## G3a — Déclaration et approbation DPIA

POST /privacy/dpias et POST /privacy/dpias/:id/approve conservent leurs rôles HTTP
**director/super_admin** ; les écritures vérifient également le compte actif,
non supprimé, et un membership actif du tenant portant actuellement l'un de ces
rôles. Un JWT antérieur à un déclassement ne suffit pas pour ces opérations.

L'approbateur doit être un **autre compte** que le déclarant, même si tous deux ont
le rôle director. Première approbation sérialisée, réessais sans remplacement de
métadonnées ni double audit. Mutation et audit minimal atomiques ; panne d'audit =
rollback. Les lectures DPIA, l'audit best-effort des autres domaines et les anciennes
décisions ne sont pas modifiés. Pas de preuve d'indépendance de deux personnes,
de contrôle global d'impersonation ou de révocation concurrente après vérification.
**11/33 → 33/33**, [runbook G3a](../PHASE_G3_DPIA_RUNBOOK.md).


## G1b — Rotation des refresh tokens

/auth/refresh reste public et rate-limité : le refresh opaque est sa preuve
présentée. Verrous compte→session et transaction commune empêchent les doubles
rotations et les remplacements partiels. L'état de session est relu après attente.
Une réutilisation révoque les refresh sessions du compte avant de répondre en erreur,
conformément à la politique existante. Audit best-effort hors de ce commit.

**16/24 → 24/24**, [runbook G1b](../PHASE_G1B_REFRESH_RUNBOOK.md). Ce contrôle ne
révoque pas les JWT d'accès existants et ne ferme ni la sélection globale de tenant,
ni la propriété/réassociation d'appareil, ni toutes les courses de révocation.


## G1c — Invitations

POST /invitations conserve director/super_admin mais revérifie l'acteur actif et
son autorité actuelle. Le directeur reste dans son tenant (rôle principal ou
additionnel) ; seul un vrai administrateur plateforme peut cibler une autre organisation.
Token de développement uniquement. Aucun transport réel livré : 503 sans écriture
hors development, et non un succès annonçant un e-mail envoyé.

POST /auth/accept-invitation reste public, avec JWT dédié signé et non expiré après
attente. Compte pending, e-mail et rôle conformes, organisation/membership actifs,
non rejoints ; transaction compte→membership avec profil/session/audit atomiques.
Le token donne le tenant cible, pas une autorisation de choisir un ancien membership.

**10/37 → 37/37**, [runbook G1c](../PHASE_G1C_INVITATIONS_RUNBOOK.md). Pas de nonce
révoquant une ancienne réinvitation, de livraison réelle, de qualification de toutes
les courses d'émission ou de révocation globale des JWT. GET invitations inchangé.
