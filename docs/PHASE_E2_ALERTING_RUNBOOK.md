# E2 — alertes locales, e-mail, SMS et WhatsApp

Date : 2026-09-14. Choix client : **les quatre canaux**. Autorisation obtenue
pour pousser sur la branche de session et ouvrir une PR de validation, sans
merge ni déploiement. Aucun message n'est envoyé à un destinataire réel ici.

## Architecture livrée

PostgreSQL `scheduler_health()` → postgres-exporter → Prometheus → **Alertmanager**
→ **alert-relay**, processus Node séparé de l'API et du worker :

- journal JSONL local, sans données d'enfants, accessible à l'opérateur du VPS ;
- SMTP (TLS obligatoire hors test) ;
- SMS Twilio ;
- WhatsApp Twilio avec **Content SID d'un modèle approuvé**, pas de texte libre
  proactif supposant une fenêtre de conversation ouverte.

Les URLs, identifiants et destinataires sont uniquement des paramètres de
l'opérateur. Le contenu du webhook ne peut choisir ni destinataire, ni URL, ni
corps arbitraire. Seuls les trois noms d'alerte et les trois types de traitements
sont acceptés ; pas d'annotations libres/PII propagées. Dates canonicalisées.

Le relay est authentifié par bearer secret, sans port publié dans Compose.
`GET /healthz` ne révèle que sa disponibilité ; `GET /status` exige le secret et
renvoie les canaux actifs, la file, les erreurs et le nombre de reçus suivis.
Ne pas le publier sur Internet ; accès opérateur par réseau privé/SSH.

## Reprises et limites

Alertmanager persiste son état et réessaie après HTTP 503. Le relais sérialise
les lots et conserve un reçu **par canal**, sur volume persistant ; un SMTP
accepté n'est pas renvoyé parce que le SMS a échoué. Déduplication 1 h, rappel AM
4 h ; événements resolved distincts des firing. 16 requêtes en attente au plus,
64 Kio/100 alertes par requête. Ledger borné à 5000 événements/24 h. Journal
rotatif : environ 1 Mio + archive précédente.

Garantie at-least-once : un crash entre acceptation fournisseur et écriture du
reçu peut provoquer un doublon. Une acceptation SMTP/Twilio n'est **pas** une
preuve de livraison dans une boîte de réception ou sur un téléphone. Le relais
ne traite pas encore les callbacks de livraison Twilio. Aucune promesse de
SMS sans frais ; configurer budgets, quotas et autorisations géographiques.

## Mise en service (NON exécutée ici)

1. Images API récentes contenant `apps/api/operations/alert-relay.mjs`,
   Prometheus 2.53.0, Alertmanager 0.27.0, exporter 0.15.0.
2. Créer hors Git un secret aléatoire d'au moins 32 caractères. Fichier absolu
   `ALERT_WEBHOOK_TOKEN_FILE`, mode **0400**, propriétaire **65534:65534**, lisible
   par les deux conteneurs. Ne pas le coller dans le chat. Dossier parent protégé.
3. Les volumes `alerts_data` et `alertmanager_data` doivent être inscriptibles
   par uid 65534. L'image API initialise le dossier du relay avec cet owner ;
   contrôler/réparer les volumes préexistants pendant une maintenance. Pas de
   conteneur root permanent ni de chmod 777.
4. Remplir les variables `ALERT_*` de `.env.prod.example` dans un fichier privé :
   SMTP/from/to, compte Twilio/token, from/to E.164 pour chaque canal, Content SID.
   Modèle WhatsApp, par exemple : `Crèche DZ — Alerte {{1}}, état {{2}}, traitement
   {{3}}`. Les variables envoyées sont nom d'alerte / statut / type de traitement.
   Faire approuver le modèle et l'opt-in du destinataire avant activation réelle.
5. `ALERT_CHANNELS=local,email,sms,whatsapp` par défaut. Un canal actif incomplet
   **bloque le démarrage**. `ALERT_CHANNELS=local` est une option explicite de
   validation sans envoi externe, pas une prétendue livraison aux autres canaux.
6. Déployer les services `alertmanager`, `alert-relay`, `postgres-exporter`,
   `prometheus`. Aucun ne dépend de la disponibilité d'un worker pour alerter.
   La stack staging n'inclut pas ces services : raccorder le moniteur cible.
7. Sur données synthétiques, vérifier firing puis resolved dans le journal et
   les destinations choisies. Contrôler les états de livraison chez le fournisseur.

Arrêt/rollback : arrêter la chaîne de notification, conserver les volumes de
reçus et Alertmanager, rétablir une image compatible. Ne pas purger le ledger
pour « résoudre » un incident (risque de SMS dupliqués). Rotation du token :
remplacer atomiquement le fichier, redémarrer AM et le relay pendant une fenêtre
contrôlée. Une coupure du VPS entier exige toujours une supervision externe.

## Gates reproductibles

```bash
# Local : SMTP de test et simulateur HTTP Twilio, jamais d'envoi externe.
node --test tests/monitoring/*.test.mjs

# Vrai moteur Prometheus (binaire local ou Docker) :
PROMTOOL=/chemin/promtool npm run check:worker-monitoring
MONITORING_USE_DOCKER=1 npm run check:worker-monitoring

# Gate complet sur cluster *_test, après build ; Docker nécessaire pour le réseau.
# Génère ses credentials de test et conserve les vrais rôles D.
ALLOW_DATABASE_RESET=1 RUN_MONITORING_STACK=1 \
DATABASE_URL=postgres://postgres:postgres@localhost:5432/creche_test \
npm run test:production-roles
```

Dans GitHub Actions, le workflow existant appelle `run-isolation-suites.sh` :
ce script délègue au gate D strict (garde anti-récursion), puis exécute le test
réseau E2. **Aucun fichier workflow modifié.** Le gate est bloquant, pas un skip.

Le test réseau démarre les vrais exporter/Prometheus/Alertmanager sous Docker,
avec le rôle `creche_app` et **aucun worker**. Il vieillit `last_success_at`, vérifie
le firing local + SMTP + requêtes SMS/WhatsApp, le resolved, puis arrête l'exporter
et vérifie l'alerte de perte de supervision. Seuls les délais de ce test réseau
sont accélérés ; promtool évalue les règles et leurs délais de production intacts.
Les fournisseurs téléphone sont simulés et le SMTP est local. Les services et
ports de test sont nettoyés. Les binaires/images/credentials ne sont pas committés.

## État des preuves

- Avant raccordement : **0/2** tests de routage ; après : **2/2**.
- Relais : **4/4**, avec vrai dialogue SMTP local, panne partielle SMS,
  reprise après redémarrage, déduplication concurrente, auth et limites d'entrée.
- Sandbox : Docker absent ; téléchargement officiel des binaires bloqué.
- Gate moteur/réseau : **validation CI en attente** au moment de cette rédaction.
- Réception réelle e-mail/SMS/WhatsApp : non testée sans configuration opérateur.
  Ne pas la confondre avec les reçus des simulateurs.
