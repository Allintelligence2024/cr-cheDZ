# Sécurité — posture (mise à jour 2026-09-28, remédiation lot 4)

## Posture

- **Isolation multi-tenant** : RLS PostgreSQL `USING` + `WITH CHECK` sur toutes
  les tables tenant, rôle applicatif `NOBYPASSRLS` (`creche_app`), helper
  `app_tenant_id()` (safe-by-default), filtres organisation explicites en
  défense en profondeur sur les lectures sensibles (billing, parents, santé,
  journal, sync — lot C, 2026-09). Vérifié par les suites
  `tests/tenant-isolation/*` (isolation + phase3 → phase78 + gardes contrat/schema/RLS)
  sur PostgreSQL réel, **rejouvées en CI avec les rôles de production**
  (Gate D — `scripts/test-production-roles.mjs`).
- **Rôles base de données** : bootstrap reproductible (`roles.sql` exécuté par
  le service `bootstrap-roles` des compose dev/staging/prod) — l'applicatif
  n'est JAMAIS superuser, le migrateur est séparé (`creche_migrator`).
- **Secrets** : exclusivement via variables d'environnement (`.env.prod.example`) ;
  aucun token ni secret journalisé ; audit PII masqué (`[REDACTED]`) ; le lien
  d'invitation (qui contient le jeton) n'est plus journalisé en mode dev ;
  `.env.prod` est un fichier local d'exploitation, non versionné.
- **JWT** : tokens d'accès (`purpose: 'access'`) seuls acceptés par le garde
  d'authentification ; secret d'invitation dérivé (HMAC) ; révocation globale
  immédiate par époque du principal (`users.token_epoch`) ; garde de boot
  refusant la production si `JWT_SECRET` est absent, trop court ou égal au
  défaut de développement.
- **OTP** : codes générés par `crypto.randomInt` (Math.random retiré — détecté
  par analyse statique locale).
- **Uploads** : URLs signées S3/MinIO courtes (1 h), consentements photo
  re-vérifiés à chaque URL, accès journalisés ; clés de stockage contrôlées
  côté DTO, côté service (`assertStorageKeyInTenant`) et en base
  (contrainte 049). *(L'upload par URL signée reste à proxyfier par l'API —
  voir « Lecture des contenus » ci-dessous.)*
- **Lecture des contenus (2026-09-24, lot 2 du plan de réparation)** : plus **aucune**
  URL de stockage n'est rendue au client. Photos, photos parent, exports Excel, PDF de
  facture et clips vidéo sont servis **en flux par l'API, same-origin**
  (`/api/v1/…/content`), derrière le même garde JWT et les mêmes contrôles métier
  (filiation `child_guardians` + consentement photo re-vérifiés **à chaque lecture**,
  journalisation `media_access_logs` + carnet 25-11 conservée). `presignGet` a été
  supprimé ; `getSignedUrl` ne sert plus qu'aux **PUT** d'upload. La lecture disque passe
  par un containment unique (anti `..`) et une politique de préfixe tenant —
  désormais appliquée aussi à `invoices.pdf_url` (aucune contrainte SQL sur cette
  colonne, contrairement aux quatre tables de la migration 049).
  `cache-control: private, no-store` sur tout contenu. Vérifié par
  `tests/tenant-isolation/phase66-content-same-origin.api.test.mjs`.
- **Écriture des contenus (2026-09-24, volet B du lot 2)** : les octets des médias passent par
  l'API — `POST /api/v1/media/upload` (multipart, rôles personnel). La **clé de stockage est
  construite côté serveur** sous le préfixe de l'organisation (le client ne choisit jamais son
  périmètre) ; avant toute écriture, le serveur vérifie le **SHA-256** annoncé
  (`MEDIA_CHECKSUM_MISMATCH`) et la **signature binaire** réelle du fichier
  (`MEDIA_CONTENT_MISMATCH`) contre une liste blanche de types (`image/jpeg|png|webp`,
  `application/pdf` — donc **pas de SVG/HTML**, qui seraient du XSS stocké servi same-origin).
  Plafonds : 8 Mio (produit, 422 bilingue) et 12 Mio (dur, 413 JSON), `client_max_body_size 12M`
  côté nginx. En production, le presign d'écriture est **refusé** (503
  `UPLOAD_VIA_API_REQUIRED`) tant que `S3_PUBLIC_ENDPOINT` n'est pas configuré : aucune URL
  `minio:9000`/`127.0.0.1` ne peut plus être rendue à un client. Vérifié par
  `tests/tenant-isolation/phase67-media-upload.api.test.mjs` + 15 tests unitaires.

  **Limites connues** (mises à jour le 2026-09-27 — chacune est confrontée au
  code et à une preuve exécutable par `tests/tenant-isolation/claims-contract.test.mjs`) :
  - ~~le client `staff-mobile` appelle encore le presign~~ → **CORRIGÉ** au lot
    L2F (2026-09-26) : `media_uploader.dart` envoie les octets à
    `POST /api/v1/media/upload` (multipart, vraie SHA-256, 1 seul retry sur
    panne de **transport**, délais bornés). Plus aucun appelant du presign
    d'écriture ; verrouillé par `tests/tenant-isolation/media-client-wiring.test.mjs`.
  - ~~la photo hors ligne crée un asset sans transférer les octets~~ →
    **RETIRÉ** (décision D6 option c, 2026-09-25) : la commande `add_photo`
    est refusée par le serveur (`OFFLINE_PHOTO_UNSUPPORTED`) et le chemin
    d'écriture sans octets n'existe plus ; prouvé par
    `tests/tenant-isolation/phase77-sync-payload-guard.api.test.mjs`.
  - **Reste réellement ouvert** :
    - Le téléversement des **clips vidéo par l'API** n'est pas implémenté :
      `POST /media/upload` n'accepte pas les types vidéo et le contrôleur vidéo
      ne reçoit pas de fichier binaire. Le presign vidéo peut toutefois émettre
      un PUT en production si `S3_PUBLIC_ENDPOINT` est configuré ; sans cette
      variable, il échoue explicitement en 503 `UPLOAD_VIA_API_REQUIRED`.
      Aucun écran client n'envoie actuellement de clip (décision D5). Preuves :
      `apps/api/src/modules/video/video.controller.ts`,
      `apps/api/src/modules/video/video.service.ts`,
      `apps/api/src/modules/media/storage.service.spec.ts` et
      `tests/tenant-isolation/phase21-video-surveillance.api.test.mjs`.
    - Aucun retrait EXIF n'est effectué par l'uploader `staff-mobile` ni par
      l'upload API : le client transmet les octets sans les transformer et
      n'envoie pas `exif_stripped`; le serveur conserve les octets reçus et
      enregistre `false` par défaut. Le champ reste une déclaration fournie
      par l'appelant : ne pas le mettre à `true` sans dépouillement réel.
      Preuves : `apps/staff-mobile/test/media_uploader_phase4_test.dart`,
      `apps/api/src/modules/media/media.service.ts` et
      `tests/tenant-isolation/phase67-media-upload.api.test.mjs`.
- **Webhook** : signature HMAC-SHA256 sur le corps brut, idempotence par
  `external_reference`.
- **Erreurs** : `AppError` FR/AR, jamais de SQL brut ni d'anglais exposé.
- **En-têtes de bord (2026-09-24, lot 1 du plan de réparation)** :
  `Content-Security-Policy` servie par nginx (`default-src 'self'`, `object-src 'none'`,
  `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`, `connect-src 'self'`).
  **Étape 1 sur 2** : `script-src` tolère encore `'unsafe-inline'` pour le bootstrap
  anti-FOUC et le chargement non bloquant de la police écrits dans `index.html` ; l'étape 2
  (extraction de ces deux inline → `script-src 'self'` strict) exige la vérification
  navigateur du job `e2e`. Vérifié par `tests/tenant-isolation/edge-headers-contract.test.mjs`.
- **Limitation de débit** : en production, `RATE_LIMIT_DISABLED=true|1` **bloque le démarrage**
  (`@creche/prod-config`) — le garde applicatif interprète ces valeurs comme une désactivation
  sans regarder `NODE_ENV`. Correspondance stricte avec la sémantique du garde, `false`/absent
  admis.
- **Gardiens exécutés en CI** : les gardes `.env.example`, manifest Android, inventaire des
  gardes de route et seuils de charge sont désormais lancés par le job `quality` (ils ne
  l'étaient par **aucun** workflow avant le 2026-09-24).

## Dépendances — `npm audit --omit=dev` : **0 vulnérabilité** ✅

Corrections appliquées le 2026-08-02 (migration de durcissement) :

| Paquet | Avant | Après |
|---|---|---|
| @nestjs/{core,common,platform-express,cli,jwt,passport} | 10.x (advisories moderate/high) | **11.1.x** (advisories corrigées) |
| @nestjs/config | 4.0.4 | 4.0.4 (inchangé, déjà sûr) |
| nodemailer | 9.0.3 | 9.0.3 (déjà sûr) |
| lodash (transitif) | override 4.18.1 | override conservé |
| react-router / react-router-dom (admin-web) | 6.x (open redirect) | **react-router 8.3.0** + React 19 |
| xlsx (admin-web, import) | high prototype pollution, SANS correctif | **remplacé par exceljs** (chunk lazy) |
| uuid (via gaxios/worker) | 9.0.1 | override **^11.1.1** |

## Analyse statique

- semgrep local (règles maison, hors ligne) : 5 résultats — 1 vrai bug corrigé
  (Math.random pour les OTP), 4 faux positifs documentés (logs sans secret).
- **CodeQL configuré et exécuté** : le run `36381541444` a terminé avec succès
  l'analyse JavaScript/TypeScript sur le code du commit `34fc103` de la PR #51.
  Cette réussite ne donne pas à elle seule le nombre de findings. Un administrateur doit toujours
  vérifier dans **Settings → Code security and analysis → Code scanning** que le
  « default setup » ne fait pas conflit avec ce workflow : GitHub refuse les
  uploads SARIF avancés si cette configuration reste activée
  ([documentation GitHub](https://docs.github.com/en/code-security/code-scanning/troubleshooting-sarif-uploads/default-setup-enabled)).
  L'intégration n'a pas pu lire cette configuration (403).
- **Images conteneur** : `docker.yml` construit les quatre images et ne publie
  sur GHCR depuis `main` qu'après des scans Trivy sans `CRITICAL,HIGH`. Le run
  `36381541319` a construit et scanné les quatre images du commit `34fc103` ; les
  quatre scans et leurs étapes de résumé réussissent, chacun avec l'annotation
  « Aucune vulnérabilité CRITICAL/HIGH dans le JSON ». L4 est validé côté Trivy
  pour ce head. Les CVE HIGH de Debian observées dans l'essai précédent
  (`36380608074`) sont conservées comme findings historiques, pas comme findings
  actuels. Les artifacts sont archivés ; leur téléchargement depuis ce poste
  échoue (`EOF`/`SSL_ERROR_SYSCALL`), mais les résumés ont lu les JSON complets.
  Détails et provenance figurent dans
  [`docs/PLAN_REMEDIATION_2026-09-27.md` §14](docs/PLAN_REMEDIATION_2026-09-27.md#14-lot-4--codeql--trivy).

## CI — configuration versionnée (2026-09-27)

Les workflows sont committés ; leurs déclencheurs et étapes sont dans les fichiers
ci-dessous (`docs/CI-RESTORE.md` est historique). CodeQL et Trivy ont désormais
été exécutés sur la PR #51 ; l'état des runs et les findings sont consignés au §14
du plan de remédiation.

| Workflow | Contenu |
|---|---|
| `ci.yml` | `database` (PG18 : migrations, seeds, schema-check, garde RLS, suites d'isolation sous rôles de prod), `backup-drill`, `quality` (eslint + contrats + jest), `e2e` (Playwright contre l'API réelle), `admin-web`, `support-console`, `security` (npm audit) |
| `codeql.yml` | Analyse JavaScript/TypeScript en PR vers `main`, push `main` et hebdomadaire ; le run PR `36381541444` a réussi, réglage « default setup » à confirmer par un administrateur |
| `docker.yml` | Configure build local + scan Trivy des 4 images ; le push GHCR sur `main` est conditionné au passage de `CRITICAL,HIGH` |
| `flutter.yml` | `pub get`, `analyze`, tests et compilation des APK release pour les deux apps ; sans secrets de signature, l'APK CI est debug-signé et non publiable |
| `security-audit.yml` | `npm audit --omit=dev` hebdomadaire, issue auto si vulnérabilité |

## Recommandations restantes

1. **Préparer les signatures mobiles** : fournir le keystore Android et les secrets
   correspondants pour produire des APK/AAB publiables ; l'iOS (ipa) exige toujours
   un compte Apple Developer.
2. **Gate de merge** : le job `quality` reste à ajouter aux checks requis de la
   branch protection `main` (réglage manuel, accès d'administration nécessaire) ;
   conserver aussi `database`.
3. Maintenir `npm audit --omit=dev --audit-level=high` à 0 et conserver les
   scans Trivy bloquants avant toute publication GHCR. Les quatre images passent
   actuellement le seuil `CRITICAL,HIGH` au run `36381541319` (commit `34fc103`).
4. Headers de sécurité, TLS et rate limiting : configurés dans
   `infrastructure/nginx/nginx.conf` (template, à déployer avec le VPS).
