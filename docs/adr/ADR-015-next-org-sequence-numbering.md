# ADR-015 — Numérotation `next_org_sequence` : séquentielle vs non devinable

**Statut** — **Proposé** (2026-10-14). En attente de décision client et d'avis juridique.
Ce document ne tranche pas la question : il la pose, documente l'existant et
prépare la décision demandée par le plan d'audit (`docs/PLAN_CORRECTION_AUDIT_2026-09.md`,
§G3, item « next_org_sequence non hashé ») et par l'issue #41 (Phase G).

**Contexte** — La fonction SECURITY DEFINER `next_org_sequence(uuid)`
(migration `017_children_reference.sql`) renvoie un compteur strictement croissant
par organisation (`org_sequences.seq`, sans trou, sans aléa). Elle alimente :

| Champ | Format actuel | Fichier |
|---|---|---|
| Numéro de facture | `FAC-YYYYMM-<seq>` | `apps/api/src/modules/billing/billing.service.ts` |
| Référence de paiement web | `WEB-<seq>` | `infrastructure/database/migrations/024_phase8_webhook_jobs.sql` et `039_…` (`payment-provider.service.ts`, webhook) |
| Reçu | `REC-<seq>-<8 premiers caractères de l'organisation>` | idem |

Conséquences observées :

- **Devinable** : un numéro de facture ou de reçu se déduit de la séquence ; on
  peut énumérer les numéros voisins d'une organisation dès qu'un numéro est connu.
- **Fuite d'information commerciale** : la séquence révèle le volume de factures
  et de paiements d'une crèche (taille, rythme d'activité).
- Les identifiants techniques (UUID) ne sont pas concernés ; le risque porte sur
  les **numéros visibles** (documents, références de paiement, messages).

Contrainte à lever avant décision : une **numérotation séquentielle sans trou est
souvent exigée pour les factures fiscales**. Le cadre algérien doit être vérifié
par le client ou son conseil avant toute modification. Ne pas présumer la réponse.

## Options

**A — Conserver la séquence telle quelle (statu quo).**
Garantit l'absence de trou. Le risque de devinabilité reste entier. Acceptable
seulement si (1) l'obligation légale est confirmée **et** (2) aucune surface publique
ou non authentifiée n'expose ces numéros.

**B — Séparer la numérotation légale de la référence publique (recommandée sous réserve).**
- La séquence reste pour le **numéro légal interne** (facture, reçu fiscal) : pas de trou,
  conforme à une éventuelle obligation de numérotation.
- Toute **référence exposée à l'extérieur** (lien de paiement, webhook, page publique,
  notification) utilise un identifiant opaque : jeton aléatoire ≥ 128 bits ou HMAC
  de l'identifiant interne, stocké en colonne dédiée et indexé.
- Migration **nouvelle** (les migrations 001–102 sont immuables, ADR-007) ajoutant la
  colonne et backfill ; le format `WEB-<seq>` ne doit plus servir de clé de recherche
  côté webhook.

**C — Remplacer la séquence par un identifiant aléatoire partout.**
Supprime la devinabilité mais casse la continuité légale si elle est requise. À écarter
sauf si l'avis juridique confirme qu'aucune numérotation séquentielle n'est exigée.

## Ce qu'il faut faire pour clore la décision

1. Le client ou son conseil confirme l'obligation (ou son absence) de numérotation
   séquentielle des factures et reçus en Algérie.
2. Recenser les surfaces qui exposent `invoice_number`, `reference_number`,
   `receipt_number` (API parent, notifications, webhooks, exports) et marquer celles qui
   sont accessibles sans authentification ou hors tenant.
3. Choisir A, B ou C ; si B, ouvrir une migration dédiée et un test d'isolation
   (référence publique non devinable, numéro légal inchangé).
4. Passer ce statut à **Accepté** avec la date et la décision.

## Décision

_À compléter par le client. Statut actuel : Proposé, aucune modification de code._
