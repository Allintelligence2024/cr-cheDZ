# ADR-003 — Paiement en ligne désactivé jusqu'à post-pilotes

**Statut** : Accepté
**Date** : 2026-08-01

## Contexte
Le paiement en ligne CIB/Edahabia (SATIM) est annoncé dans l'architecture.

## Décision
Le flag `online_payment` reste **off** jusqu'à validation du MVP par les
pilotes. Le MVP n'enregistre que : espèces, virement bancaire, chèque
(`other`).

## Conséquences
- Zéro dépendance à un prestataire de paiement pendant les 8 premières
  semaines.
- Le schéma (`payments.external_reference`, `payment_gateway`,
  `gateway_response`) est déjà prêt pour SATIM.
