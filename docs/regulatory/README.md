# Textes réglementaires — Algérie

Références vérifiées (août 2026).

## Loi n° 25-11 du 24 juillet 2025
Modifie et complète la **loi n° 18-07 du 10 juin 2018** relative à la
protection des personnes physiques dans le traitement des données à
caractère personnel. Points structurants pour le produit :

- **ANPDP** : autorité de contrôle (déclarations, autorisations, sanctions).
- **DPO obligatoire** pour les traitements à risque.
- **Notification de violation sous 5 jours** à l'ANPDP.
- **DPIA / AIPD** (analyse d'impact) pour les traitements sensibles
  (photos d'enfants, données de santé, paie).
- Définitions précisées : données biométriques, pseudonymisation, profilage.
- **Pas** de droit à l'effacement automatique ni de portabilité explicites :
  les demandes de droits portent sur l'accès, la rectification, l'opposition.
- Transferts transfrontaliers : autorisation ANPDP au cas par cas.

## Décret exécutif n° 19-253 du 16 septembre 2019
Conditions de création, organisation, fonctionnement et contrôle des
établissements d'accueil de la petite enfance :

- **Crèche** : 3 mois → 3 ans · **Jardin d'enfants** : 3 → <6 ans ·
  **Multi-accueil** : 3 mois → <6 ans.
- **Capacité maximale : 150 enfants** par établissement.
- Encadrement par du **personnel qualifié** ; programmes pédagogiques
  approuvés par tranche d'âge.
- **Affichage obligatoire** de la liste des prestations et des tarifs.
- Intégration des enfants handicapés (aménagements).

## Implémentation dans le produit
- `organizations.establishment_type` et `max_children DEFAULT 150` (migration 002).
- Module conformité : règles paramétrées en base (seed `013_compliance.sql`).
- Module vie privée : registre des traitements, DPIA, violations, demandes de
  droits (migration 004 ; console support Phase 10).
