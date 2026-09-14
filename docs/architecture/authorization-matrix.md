# Matrice d'autorisation par module (v2 — audit 2026-09, Phases C/H2a)

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
| **parent** (`/parent/*`) | tout rôle `parent_*` (scoping par guardianship dans le service) | idem | — |

## Décisions à reconfirmer en Phase H (G2/H2)

- L'accountant lit `staff` (liste + détail sans champs sensibles) : confirmé par alignement sur
  payroll — à revalider avec le métier.
- Les 44 routes sans garde explicite (inventaire) : revue module par module + justification
  écrite pour chaque route self-service conservée sans `@Roles`.
- `staff_documents.storage_key` (création) : même défaut de préfixe tenant que C3 — à corriger
  avec la dette H2.

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
