# Matrice d'autorisation par module (v1 — audit 2026-09, Phase C)

> Décidée le 2026-09-14 en exécution du plan `PLAN_CORRECTION_AUDIT_2026-09.md` (C1).
> Source de vérité : les constantes `@Roles(...)` des contrôleurs de `apps/api/src/modules/`.
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
