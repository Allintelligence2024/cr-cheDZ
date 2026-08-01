# Tests — finance

À implémenter (Phase 8), selon la Partie 6.2 de l'architecture :
- Facture payée non modifiable (422 `INVOICE_IMMUTABLE`).
- Webhook reçu 3× = 1 paiement confirmé (idempotence `external_reference`).
- Total facture = somme des lignes.
- Paiement partiel → `partially_paid` ; complet → `paid` ; solde = 0.
- Caisse : ouverture/clôture cohérentes avec les paiements espèces.
