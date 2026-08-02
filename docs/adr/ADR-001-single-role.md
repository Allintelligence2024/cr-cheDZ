# ADR-001 — Rôle principal + rôles additionnels par utilisateur et organisation

**Statut** : Évolué (roadmap v2) — voir la section « Évolution » ci-dessous
**Date initiale** : 2026-08-01 · **Mise à jour** : 2026-08-02

## Contexte initial
`memberships` a `UNIQUE(organization_id, user_id)` : un utilisateur ne peut
avoir qu'un seul rôle par organisation.

## Décision initiale (MVP)
Un utilisateur a **un seul rôle par organisation** (simplicité des guards).

## Évolution (migration 040, roadmap v2)
Le besoin terrain (une directrice qui fait aussi la comptabilité) a été
démontré. Le multi-rôles est introduit de façon **additive et
rétrocompatible** :

- `memberships.role_id` reste le **rôle principal** (défaut, invariablement
  utilisé par `/me`, les invitations, les tests existants) ;
- la table **`role_assignments`** (migration 040, RLS `USING`+`WITH CHECK`)
  porte les rôles **additionnels** ;
- le JWT embarque **`roles[]`** (rôles effectifs = principal + additions) en
  plus de `role` (principal) ; `RolesGuard` accepte l'un ou l'autre ;
- `auth_user_roles()` (SECURITY DEFINER, corrigée en 041) liste les rôles
  effectifs ;
- API : `GET /members/:userId/roles`, `POST /members/:userId/roles`,
  `DELETE /role-assignments/:id` (directeur/super_admin) — gardes : doublon
  avec le principal (409 `ROLE_ALREADY_PRIMARY`), double assignation (409),
  utilisateur cible hors tenant (404).

## Conséquences
- Aucune modification des données existantes ni des contrats `/me`.
- Les guards résolvent les permissions sur l'ensemble des rôles effectifs.
- Le rôle principal reste la référence pour l'affichage et l'audit.

## Alternatives rejetées
- Table `role_assignments` remplaçant `memberships` : migration destructive
  et cassante pour `/me`, les invitations et les tests (rejeté).
