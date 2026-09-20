# P1-1 — Paiement en ligne CIB / Edahabia (SATIM) : enrôlement, sandbox, preuve

## État du code
- Adaptateur : `apps/api/src/modules/billing/payment-provider.service.ts` — init HTTP réel signé HMAC-SHA256, timeout 10 s, un seul `pending` actif par facture, `failed` explicite en cas d'erreur, jamais de statut deviné.
- Confirmation : `POST /billing/webhooks/payment` (signature `x-payment-signature` sur le corps brut, `PAYMENT_WEBHOOK_SECRET` ≥ 32 car.), idempotente par `external_reference` (`billing_webhook_apply`, migration 024).
- Rapprochement (nouveau) : `GET /billing/payments/online/reconciliation?stale_minutes=30&from=&to=` — confirmés / en attente / **en souffrance** (pending sans webhook au-delà du délai, `transaction_id` à réclamer au PSP) / échoués, avec montants. Rôles direction et comptabilité.
- Garde de configuration : les 3 variables `SATIM_MERCHANT_ID`, `SATIM_SECRET`, `SATIM_GATEWAY_URL` ensemble ou aucune (`@creche/prod-config`), sinon démarrage refusé en production ; feature flag `online_payment` par organisation.

## Ce qui dépend de SATIM (externe, hors code)
1. **Convention e-paiement** avec la banque acquéreuse de la crèche (CIB) et/ou Algérie Poste (Edahabia) ; SATIM délivre les identifiants marchands de **test** puis de production.
2. Fournir à SATIM : l'URL publique du webhook (`https://<api>/api/v1/billing/webhooks/payment`), l'URL de retour, le logo/nom marchand.
3. Recette obligatoire SATIM : jeu de cartes de test, scénarios acceptés/refusés/abandon, puis bascule production.

## Preuve de bout en bout (à rejouer avec la sandbox réelle)
```bash
# 1) API configurée : SATIM_* (sandbox), PAYMENT_WEBHOOK_SECRET, flag online_payment activé pour l'org.
# 2) Sans compte marchand : simulateur local au même contrat
SATIM_SECRET=<secret> PAYMENT_WEBHOOK_SECRET=<secret-webhook> API_URL=http://localhost:3000 node scripts/satim-sandbox-server.mjs
#    → SATIM_GATEWAY_URL=http://127.0.0.1:4545 côté API
# 3) Scénario complet (init → webhook → facture payée → rapprochement)
API_URL=http://localhost:3000 LOGIN_EMAIL=... LOGIN_PASSWORD=... INVOICE_ID=<uuid> \
PAYMENT_WEBHOOK_SECRET=<secret-webhook> SIMULATE_WEBHOOK=1 node scripts/satim-sandbox-proof.mjs
# Avec la sandbox SATIM : retirer SIMULATE_WEBHOOK, payer dans le navigateur (redirect_url), le script attend le vrai webhook (10 min max).
```
Le script échoue si la facture n'est pas réellement passée à `paid`/`partially_paid` par le webhook, ou si le paiement n'apparaît pas `confirmed` au rapprochement.

## Gate automatisé
`tests/tenant-isolation/phase14-online-payment.api.test.mjs` (init signé, 401 mauvaise signature, webhook idempotent) et **phase60** (rapprochement : pending récent, pending en souffrance, confirmé, échoué ; isolation).

## Exploitation
- Contrôle quotidien : rapprochement avec `stale_minutes=30` ; toute ligne *stale* = vérifier chez SATIM par `transaction_id` (paiement réellement encaissé sans webhook → rejouer le webhook signé ; sinon le parent relance un init, l'ancien pending est automatiquement `failed / SUPERSEDED_BY_NEW_INIT`).
- Jamais de confirmation manuelle d'un paiement en ligne hors webhook : un encaissement constaté sur le relevé bancaire mais sans webhook se saisit comme **virement** (`bank_transfer`) avec la référence SATIM en note, pour garder la piste d'audit.
