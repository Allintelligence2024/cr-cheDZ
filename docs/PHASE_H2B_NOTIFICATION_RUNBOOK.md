# H2b — Révocation des notifications et lecture des inbox

2026-09-14 · PR #44 · aucun merge ni déploiement · fixtures synthétiques.

## Préflight et reproductions

H2a (`39cd223`) est confirmé : CI **34874774910**, check database **104079135223**,
9/9 checks, notices H2a (21 scénarios), F2/F4 et H1 dev/staging vérifiées.
La restauration de session avait désynchronisé HEAD/index ; tous les blobs publiés
ont été comparés aux fichiers avant réalignement, sans écrasement de source.

H2b reproduit de vraies fuites avec l'API HTTP, PostgreSQL et le worker livré :

- après publication, retirer can_view_journal/can_receive_push, supprimer le
  gardien/enfant, désactiver le membre ou suspendre l'utilisateur ne bloquait pas
  l'envoi ;
- masquer/rendre privé l'événement n'empêchait ni sa notification ni sa lecture
  dans l'inbox ;
- les anciennes notifications WhatsApp ne portaient que `to` et
  `event_type: whatsapp` : aucune identité enfant/événement à revérifier ;
- retrait du flag WhatsApp, changement de téléphone et retrait d'une préférence
  de canal après publication n'étaient pas pris en compte ;
- référence étrangère/malformée ou scope inconnu : messages encore transmis ;
- marquer comme lue une ancienne notification révoquée modifiait encore la ligne ;
- 101 lignes révoquées plus récentes masquaient l'ancienne notification autorisée
  derrière le LIMIT 100.

Suite initiale : **8/35 → 35/35**, puis **10/44 → 44/44**. Suite finale, rejouée
sur l'API et le worker publiés H2a sous les rôles stricts : **13/50 → 50/50**.
Les 37 échecs avant correction sont des assertions
métier/réseau ; une erreur initiale du double OAuth (mauvaise méthode interceptée)
a été corrigée avant le comptage, sans être présentée comme un finding applicatif.

### Régressions effectivement rencontrées

La première batterie complète a terminé **37/39 suites vertes**, pas 39/39 :

- phase6 : son parent existait globalement sans membership dans la crèche. La
  fixture a reçu une membership parent active, comme après inscription ; les
  assertions positives n'ont pas été supprimées et l'autorisation n'a pas été élargie ;
- phase28/E3 : les notifications génériques à données nulles étaient refusées à
  tort. Un cas dédié a reproduit **44/46**, puis le prédicat a été corrigé ;
- le rejeu phase6 sur base fraîche a exposé les doublons de flags globaux produits
  par les seeds répétés : erreur SQL réelle, corrigée par une agrégation prudente.
  La suite finale comprend des flags globaux contradictoires, sans modification
  des seeds historiques ni purge des doublons ;
- vérification complémentaire présence : événement lié à la bonne session mais
  à un autre enfant en base. Le test a fait **48/50** avant ajout de la comparaison
  explicite de l'enfant de l'événement. C'est une fixture PG incohérente, pas une
  preuve qu'un endpoint HTTP permet de fabriquer cette incohérence.

Après ces corrections : phase6 verte, phase28 **23/23**, H2a **21/21**, H2b
**50/50** sous rôles stricts. La batterie complète fraîche a ensuite terminé
**39/39 suites vertes**, avec les notices H2a 21 et H2b 50. Typecheck/build de tous
les workspaces, lint `--max-warnings=0`, **27/27 tests unitaires** et audit production
**0 vulnérabilité** sont verts. Aucun grant ad hoc. Docker/Flutter ne sont pas
disponibles localement : leurs gates réels et les checks du SHA publié restent à
confirmer en CI avant clôture de la livraison.

## Architecture du correctif

`packages/prod-config/src/notification-access.ts` fournit un **prédicat SQL commun**
au producteur, au worker et à l'inbox. Il s'exécute sous le rôle applicatif et dans
une transaction avec SET LOCAL app.tenant_id. Aucun SECURITY DEFINER supplémentaire,
aucun nouveau grant ou migration. Les fragments SQL sont des constantes de code,
jamais des identifiants ou clauses fournis par l'utilisateur.

Pour une notification d'événement enfant :

1. utilisateur actif et membership actif dans le tenant ;
2. gardien et enfant non supprimés, lien courant et can_receive_push ;
3. journal : can_view_journal + événement du même enfant/tenant/type, visible et
   non privé ;
4. présence : session et événement check_in/check_out du même enfant/tenant,
   sans assimiler ce droit au droit de journal ;
5. WhatsApp : téléphone toujours identique au destinataire enregistré, flag
   tenant/global toujours activé ; priorité à l'override tenant, sinon les éventuels
   doublons globaux doivent être unanimement activés (`bool_and`), sans choix de
   ligne arbitraire ni erreur de sous-requête scalaire ;
6. en livraison : préférence du canal non désactivée. L'inbox reste indépendante
   de cette préférence de transport et du flag WhatsApp.

Les nouveaux payloads conservent `scope: child_event`, `child_id`, `log_event_id`
et le vrai `event_type` dans **tous** les canaux ; WhatsApp ajoute `to`.
Pour une présence, log_event_id est historiquement l'identifiant de session,
avec vérification de l'événement d'arrivée/départ dans cette session.

Les anciens push/inbox d'événements enfant restent lisibles s'ils portent les
références vérifiables et si les droits actuels l'autorisent. Une ancienne queue
WhatsApp sans références est **refusée**, sans reconstruire une identité à partir
du texte ou du téléphone. Un scope inconnu ou une référence invalide est refusé
sans erreur de cast UUID (comparaisons texte normalisées).

Les messages génériques push/inbox **sans aucun indice d'événement enfant** gardent
leur comportement, y compris données SQL/JSON nulles, avec utilisateur/membership actifs. Cela n'autorise pas à
injecter du contenu enfant dans un payload générique : les seuls producteurs
actuels de notifications parent sont typés et internes, sans endpoint d'enqueue
arbitraire. Tout nouveau producteur doit déclarer sa portée et ses tests.
L'OTP WhatsApp est un autre flux et n'est pas routé par cette queue.

## Refus durable, sans faux accusé de livraison

Le worker revalide après le claim réel, avant de contacter le fournisseur. Un refus
est terminal, avec le motif :

`NOTIFICATION_ACCESS_REVOKED_OR_UNVERIFIABLE`

Le contrat E3 reste inchangé : statut `sent` = ligne consommée, **pas** preuve que
le fournisseur a livré le message. Le motif de non-envoi est conservé. Aucun retry
ne doit republier cette ligne après restauration des permissions. Une erreur SQL
technique, en revanche, emprunte le chemin d'échec/retry existant.

L'inbox est filtrée **en SQL avant LIMIT 100**, et la même règle encadre mark-read.
Une requête mark-read sur une ligne non autorisée reste HTTP 204 sans mutation,
pour ne pas transformer cette route en oracle d'existence. Les lignes historiques
restent stockées : aucune purge ou suppression d'évidence.

## Preuve de transport et course testée

`phase36-notification-revocation.api.test.mjs` :

- lance la vraie API et le worker compilé sur une base *_test dédiée ;
- remplace uniquement l'authentification Google et la destination réseau des
  fournisseurs dans **le processus de test** ; aucun compte fournisseur réel ;
- reçoit les véritables requêtes HTTP FCM/WhatsApp du worker sur loopback et en
  vérifie le nombre par destinataire, ainsi que statut/attempts/failure_reason PG ;
- observe le retour d'un vrai notif_queue_claim, vérifie la ligne `processing`,
  retire le droit en base, puis laisse le worker poursuivre : aucun appel de
  fournisseur autorisé par l'ancien droit ;
- redémarre le worker et fait traiter un nouveau job témoin : aucune ligne déjà
  consommée, autorisée ou refusée, n'est réenvoyée.

Le preload `tests/fixtures/notification-provider-bridge.mjs` n'est chargé que par
la commande du test (`--import`), jamais par les commandes worker livrées. Il est
exclu des images via l'exclusion des tests. Les appels non dirigés vers le serveur
HTTP local sont interdits par ce double. Ce n'est **pas** une qualification de
Google/Apple/Meta réels ; APNs n'a pas été contacté ni simulé séparément.

## Commandes et intégration

```sh
npm ci
npm run build --workspace @creche/api
npm run build --workspace @creche/worker
# DESTRUCTIF : base locale dédiée *_test, identités du runbook D.
ALLOW_DATABASE_RESET=1 DATABASE_URL=<URL_ADMIN_BASE_JETABLE_TEST> \
  node tests/tenant-isolation/phase36-notification-revocation.api.test.mjs
```

La suite fait explicitement reset → migrations → seeds avant ses fixtures, pour
que le worker ne consomme pas les tâches d'autres suites. Elle est exécutée après
les suites historiques dans le runner existant (39 suites/contrôles), sans workflow
nouveau. La CI exige les 50 scénarios et publie `H2b notifications passed`.
Les guards locaux du préflight ne remplacent pas les vrais gates Docker/Flutter CI.

## Rollback et limites restantes

- Code seulement, lockfile et migrations 001–061 intacts. Pas de purge, migration
  de payload historique, changement de statut métier ou nouveau SDK.
- En cas d'incident : suspendre le drain/les routes concernées, conserver les
  preuves, corriger puis rejouer les gates. Ne pas réactiver l'ancien envoi sans
  contrôle et ne pas replanifier les notifications refusées automatiquement.
- Déployer ultérieurement producteur et consommateurs compatibles ; un ancien
  consommateur ne possède pas ce contrôle. Aucun déploiement n'est réalisé ici.
- La vérification précède le transport ; elle ne peut pas rappeler un message
  déjà en vol ou remis à un fournisseur. Une révocation simultanée après le
  dernier contrôle ne constitue pas une garantie atomique avec un réseau externe.
- Les tokens déjà émis et l'autorisation des autres endpoints relèvent toujours
  de G et de la revue des routes. Ce lot ne corrige pas globalement leur révocation.
- H2 confidentialité conserve la revue des autres projections/contrôles de gardien,
  des snapshots privacy historiques et des routes registre/DPIA/violations.
  Anonymisation, metrics, stockage, invitations, autres dettes H2/H3, paie à décider
  et Android release restent ouverts. Aucune aptitude à la production n'est déclarée.
