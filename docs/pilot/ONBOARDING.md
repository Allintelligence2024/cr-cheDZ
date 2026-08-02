# ONBOARDING PILOTE — Guide de démarrage (Phase 12)

> Destiné aux 5 crèches pilotes : directrice, éducatrices, parents.
> Comptes de test fournis par `scripts/pilot/seed-pilot.mjs` (données de
> démonstration uniquement — jamais de données réelles avant validation).

---

## 1. Les 5 crèches pilotes

| N° | Slug | Nom | Wilaya | Type |
|---|---|---|---|---|
| 01 | `pilot-01` | Crèche Pilote El-Djazair | 16 | crèche |
| 02 | `pilot-02` | Crèche Pilote Oran | 31 | crèche |
| 03 | `pilot-03` | Crèche Pilote Constantine | 25 | crèche |
| 04 | `pilot-04` | Multi-accueil Pilote Annaba | 23 | multi-accueil |
| 05 | `pilot-05` | Jardin Pilote Sétif | 19 | jardin |

Chaque crèche dispose de : 1 site, 3 salles (Bébés 3-12 mois, Moyens 12-24,
Grands 24-36), 15 enfants, 1 directrice, 2 éducatrices, 1 comptable, 6
contrats actifs, parents avec permissions complètes.

## 2. Comptes de test (uniquement données de démonstration)

Mot de passe commun : `Password123!` (à changer dès la mise en production).

| Rôle | Email |
|---|---|
| Directrice | `pilot-NN.directrice@pilote.dz` |
| Éducatrice 1 | `pilot-NN.educatrice1@pilote.dz` |
| Éducatrice 2 | `pilot-NN.educatrice2@pilote.dz` |
| Comptable | `pilot-NN.comptable@pilote.dz` |

(NN = numéro de la crèche, 01…05.)

## 3. Fiche directrice (jour 1)

1. Se connecter à l'administration web (https://admin.creche.dz).
2. **Tableau de bord** : vérifier les présences du jour par salle et les
   alertes (enfants non pointés, documents expirants, factures impayées,
   incidents).
3. **Salles / Enfants** : vérifier que les 15 enfants de démonstration sont
   dans les bonnes salles ; ouvrir une fiche enfant (historique des salles).
4. **Facturation** : générer une facture mensuelle de test, vérifier le PDF
   (onglet Factures).
5. **Conformité** (onglet Conformité) : lancer les checks du décret 19-253.
6. **Santé** : ouvrir le dossier d'un enfant (allergies, vaccinations).
7. Signaler chaque difficulté dans le canal de feedback (section 6).

## 4. Fiche éducatrice (jour 1)

1. Se connecter à l'application personnel (QR `qr-app-staff.png`).
2. **Pointage** : pointer la section des Grands le matin (< 3 min pour
   12 enfants), puis les départs le soir.
3. **Journal** : enregistrer un repas groupé (12 enfants en une action,
   < 30 s), une sieste, un change, une activité.
4. **Photos** : prendre une photo (si appareil réel), vérifier qu'elle
   n'apparaît pas chez les parents avant validation de la directrice.
5. **Hors ligne** : tester en mode avion — les opérations restent en file et
   se synchronisent à la reconnexion.

## 5. Fiche parent (jour 1)

1. Installer l'application parents (QR `qr-app-parents.png`), se connecter
   avec le numéro de téléphone + code OTP, puis définir un PIN.
2. Vérifier le **fil du jour** : repas, sieste, activité, photos (après
   validation par la crèche).
3. Signaler une **absence** en 2 taps.
4. Consulter **factures** et reçus (lecture seule).
5. Vérifier que les **données santé** (vaccinations, allergies) sont
   visibles uniquement avec la permission accordée par la crèche.

## 6. Canal de feedback

- **Bug bloquant** : ouvrir un ticket support (console support → recherche
  par email/organisation) ; objectif : résolution < 24 h.
- **Irritant / suggestion** : journal des irritants tenu par la directrice
  (fichier partagé avec l'équipe) — chaque entrée : date, rôle, description,
  impact, gravité.
- **Données sensibles** : ne JAMAIS envoyer de photo ou donnée de santé par
  le canal de feedback ; utiliser les demandes de droits de l'application.

## 7. Rappels

- Les comptes `pilote-*` sont des données de démonstration : aucune donnée
  réelle ne doit être saisie avant le go/no-go.
- L'environnement de pré-production (staging) est pseudonymisé
  (`scripts/anonymize.sql`) : ne pas y chercher de données réelles.
- Toute violation de données constatée : créer l'événement dans l'API
  (`POST /privacy/violations`) — échéance ANPDP +5 jours.
