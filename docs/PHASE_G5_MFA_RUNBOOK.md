# Runbook PHASE G5 — durcissement MFA : secret chiffré au repos, codes à usage unique, facteur obligatoire sur tous les canaux

**Statut : implémenté, prouvé localement (RED 2/18 → GREEN 18/18) et CONSIGNÉ en CI — gate strict **9/9 success sur le SHA `6f96367`** (run ci `35072902044`, job `database` check `104718362609`), notice G agrégée relue par REST (`G5=18`, `G4=17`) ; voir §Suivi du plan. La qualification de déploiement production reste hors périmètre.**

## 1. Constat d'audit vérifié (avant correction)

1. `users.totp_secret` stockait le secret base32 **en clair** en base.
2. `TotpService.verify` était **stateless** (fenêtre ±1 pas ≈ 90 s) : le même
   code était réutilisable sans limite pendant la fenêtre — aucun état ne
   retenait un code déjà accepté.
3. Les canaux parent ignoraient totalement `totp_enabled` :
   - `POST /auth/parent/pin/login` : PIN valide ⇒ session **sans second
     facteur** sur un compte MFA (reproduit en RED : 200 + access_token) ;
   - `POST /auth/parent/otp/verify` : idem après consommation OTP ;
   - `POST /auth/parent/pin` (route protégée par simple JWT) : un porteur de
     session pouvait poser un PIN de contournement sur un compte MFA, puis s'en
     servir pour court-circuiter le facteur → boucle de downgrade complète.

## 2. Contrat livré

- **Anti-rejeu persistant** (migration 063, `users.totp_last_step bigint NULL`) :
  chaque code accepté enregistre son pas (epoch/30) ; tout pas ≤ dernier
  consommé est refusé (`TOTP_INVALID`, compté comme preuve erronée). La
  vérification+consommation se fait sous `SELECT … FOR UPDATE` sur la ligne
  utilisateur : sous concurrence réelle PG, une seule requête gagne le pas.
  Canaux couverts : login mot de passe, login PIN parent, verify OTP parent,
  `2fa/verify` (confirmation du setup) et `2fa/disable`. Conséquence
  contractuelle assumée : **« confirmer puis désactiver » avec le même code est
  désormais un rejeu (401)** — phase48 et `isolation` recalibrées sur un pas
  frais, et non l'assouplissement du garde.
- **Chiffrement au repos** (`apps/api/src/shared/auth/totp-crypto.ts`) : format
  `v1gcm.<iv>.<tag>.<ct>` AES-256-GCM, AAD = identifiant utilisateur.
  `TOTP_ENCRYPTION_KEY` = liste `courante,ancienne,…` (rotation) ; rescellage à
  la courante à l'usage (lignes legacy en clair → upgrade-on-use ; scellés
  sous ancienne clé → rotation). Sans clé (test/dev uniquement) : mode
  historique en clair, anti-rejeu quand même actif. Production : boot refusé
  sans clé valide (`@creche/prod-config`, section 9 d'`OPERATIONS-SECRETS.md`).
- **Fail-closed lecture** : secret scellé indéchiffrable (clé retirée, octet
  altéré, AAD croisé entre comptes, `totp_enabled=true` sans secret) ⇒
  `403 MFA_SECRET_UNREADABLE`, **aucune session**, aucun compteur utilisateur
  touché, aucune matière de secret (clair ou scellé) dans la réponse ni dans
  l'audit.
- **Canaux parent** : `totp_code` optionnel dans les DTO (PIN login, OTP
  verify, pose de PIN) ; dès que le compte a le facteur actif, code valide et
  frais exigé (sinon `401 TOTP_REQUIRED`). Le refus n'intervient qu'APRÈS la
  preuve principale correcte (PIN vérifié, OTP consommé) — pas d'oracle
  d'énumération. `2fa/disable` conserve la sémantique G1d (aucun compteur
  touché quand aucun facteur n'existe).

## 3. Preuves

- `tests/tenant-isolation/phase54-mfa-hardening.api.test.mjs` — 18 scénarios
  HTTP+PG réels incluant redémarrages d'app pour la rotation et course PG à
  même code (une seule session). Marqueur : `G5 MFA hardening: 18 passed, 0 failed`.
- Unités : `totp-crypto.spec.ts` (5 cas purs : formats, AAD croisé, tamper,
  rotation, absence de faux rescellage) + garde prod dans `production-config.spec.ts`.
- Gate strict : 57 suites ; notice agrégée `G security passed` inclut `G5=`.

## 4. Déploiement

1. Appliquer la **migration 063 AVANT** le redémarrage de l'API avec le code
   G5 (l'anti-rejeu écrit dans cette colonne ; sans elle : refus fail-closed).
   Additive pure : aucun verrou de table long, aucune mutation de données.
2. Fournir `TOTP_ENCRYPTION_KEY` (32 octets, `openssl rand -hex 32`) en
   production à l'API **et au worker** : la garde de boot `@creche/prod-config`
   est partagée et exige la clé valide partout où `NODE_ENV=production`
   (le worker n'utilise pas le chiffrement lui-même — aucun flux TOTP — mais
   son démarrage passe la même garde). Le `docker-compose.prod.yml` livré rend
   la variable obligatoire (`:?`) sur les deux services : le `compose up`
   échoue immédiatement plutôt qu'un crash-loop au boot.
3. Les lignes existantes en clair continuent de fonctionner (lecture legacy)
   et se rescellent à l'usage, au premier code correctement saisi par chaque
   compte. Aucun reset de secret n'est nécessaire.
4. Rotation future : `TOTP_ENCRYPTION_KEY=nouvelle,ancienne`, redéploiement,
   laisser les comptes actifs se reconnecter, puis retirer l'ancienne.
   La clé doit être sauvegardée avec les secrets d'infrastructure (BACKUP-RUNBOOK) :
   sans elle, les secrets scellés sont **définitivement** irrécupérables
   → chaque compte MFA devrait être ré-enrôlé manuellement.

## 5. Rollback (écrit, non exécuté)

- Revenir à l'image pré-G5 : l'API ignore `totp_last_step` (colonne additive
  conservée, jamais supprimée) et relit les secrets **en clair** — les lignes
  déjà rescellées deviennent illisibles en clair : **conserver la clé dans
  l'env** même après rollback applicatif, et fournir aux utilisateurs
  concernés une procédure de ré-enrôlement si le rollback dure.
- Ne jamais « réparer » en écrasant `totp_secret` en base.

## 6. Limites assumées (non revendiquées fermées)

- **Codes de récupération MFA : NON implémentés** — décision client explicite
  (UX de génération/distribution à trancher) ; ce lot ne la devine pas.
- Un secret changé via SQL (ré-enrôlement forcé par un opérateur) ne révoque
  pas les sessions en vol — frontière G4 documentée (le changement de facteur
  seul n'est pas un événement révocatoire ; statut/mot de passe le sont).
- La fenêtre garde→commit d'une requête unique reste la frontière G4 inchangée.
- La vérification TOTP n'est pas asservie à une horloge serveur dédiée :
  tolérance ±1 pas (30 s) conservée, c'est le contrat RFC 6238 usuel ; le
  premier facteur (mot de passe/PIN/OTP) garde le verrouillage G1d partagé.
- Pas d'anti-rejeu sur les OTP SMS/WhatsApp : déjà consommés atomiquement
  (`otp_codes.used_at`, verrou 5 tentatives) — inchangé, volontaire.
- Preuve locale (PG embarqué 18.4 + HTTP réel) ; CI PG16 réelle consignée
  (batterie complète verte sur `6f96367`) ; staging applicatif reste du
  ressort des runs dédiés H1 (non re-exécutés pour G5 hors batterie).
