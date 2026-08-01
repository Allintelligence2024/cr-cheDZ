# ADR-001 — Un rôle par utilisateur et par organisation

**Statut** : Accepté (MVP)
**Date** : 2026-08-01

## Contexte
`memberships` a `UNIQUE(organization_id, user_id)` : un utilisateur ne peut
avoir qu'un seul rôle par organisation.

## Décision
Pour le MVP, un utilisateur a **un seul rôle par organisation**. Les
multi-rôles (ex. directrice + comptable) viendront en v2 via une table
`role_assignments` (migration additive, jamais de modification de
`memberships`).

## Conséquences
- Simple et prévisible pour les guards (un rôle → un jeu de permissions).
- Le passage au multi-rôles est une migration additive sans impact sur les
  données existantes.

## Alternatives
- Multi-rôles dès le MVP : complexité de résolution de permissions sans
  besoin terrain démontré.
