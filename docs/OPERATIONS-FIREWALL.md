# OPERATIONS-FIREWALL — Durcissement réseau du VPS (R8, remédiation 2026-09-21)

> Le repo ne contient aucune règle de firewall par défaut — c'était un trou
> de documentation qui devenait un trou réel : R3 a corrigé le `ports: 0.0.0.0`
> de MinIO, mais sans pare-feu hôte, n'importe quel service Docker qui oublie
> `127.0.0.1:` dans son `ports:` est exposé publiquement. Ce runbook décrit
> la politique de durcissement réseau minimale (UFW + compose-side bindings)
> à appliquer sur tout VPS de prod/staging.

## 1. Cibles (R8 / F3b du PLAN_REMEDIATION_FINAL)

- **Tout service interne (PostgreSQL, MinIO, Redis, alert-relay, métriques)
  reste sur `127.0.0.1:` ou sur le réseau compose — JAMAIS `0.0.0.0:`** côté
  compose `ports:`.
- **Seuls nginx (80/443) écoute publiquement** sur le VPS.
- **SSH reste sur le port 22** (ou un port non standard pivoté), avec une
  policy de clés fortes (no password) + fail2ban (optionnel).
- **Le pare-feu hôte (ufw) ferme tout SAUF** 22 (SSH), 80 (HTTP→301), 443
  (HTTPS). Tout autre port ouvert est une faute documentée.

## 2. UFW — règles minimales

À exécuter UNE FOIS sur le VPS cible (Ubuntu 22.04+, Debian 12+) :

```bash
# Politique par défaut : tout fermer en entrée, autoriser en sortie.
sudo ufw default deny incoming
sudo ufw default allow outgoing

# SSH (adapter le port si pivoté : 5022, 2222, etc.)
sudo ufw allow 22/tcp comment 'SSH (ou port pivoté : 5022/tcp ...)'

# HTTP → HTTPS redirect (nginx)
sudo ufw allow 80/tcp comment 'nginx HTTP (renvoyé vers 443)'

# HTTPS
sudo ufw allow 443/tcp comment 'nginx HTTPS'

# Tout autre port = INTERDIT côté hôte. Si un service interne a besoin
# d'être joint (debug, replica), passer par `ssh -L` ou par le réseau
# compose — JAMAIS ouvrir un port sur ufw pour un service interne.

# Activation
sudo ufw enable
sudo ufw status verbose
# Attendu :
#   To                         Action      From
#   --                         ------      ----
#   22/tcp                     ALLOW       Anywhere
#   80/tcp                     ALLOW       Anywhere
#   443/tcp                    ALLOW       Anywhere
```

## 3. Côté Compose — liaisons (`ports:`)

Règle absolue : tout service dont le port n'est utile QUE dans le réseau
compose (API, worker, postgres, minio, alert-relay, postgres-exporter,
prometheus, grafana) doit avoir un binding **loopback ou aucune** `ports:` —
le réseau compose suffit. Liste des exemptions attendues :

| Service | Compose `ports:` attendu | Justification |
|---|---|---|
| `nginx` | `80:80` + `443:443` | Entrée publique (Internet → VPS) |
| `postgres` | AUCUN ou `127.0.0.1:5432:5432` (dev/staging seulement) | RLS exige NOBYPASSRLS — l'API est le seul client |
| `minio` | `127.0.0.1:9000:9000` (après R3) | Debug VPS uniquement |
| `api` | AUCUN (joignable via `nginx:443/api/`) | Pas d'accès direct |
| `worker` | AUCUN | Tâches de fond uniquement |
| `admin-web` | AUCUN (joignable via `nginx:443/`) | SPA servie par nginx |
| `support-console` | AUCUN (joignable via `nginx:443/support/` + allowlist R7) | Pas d'accès direct |
| `prometheus` | `127.0.0.1:9090:9090` (optionnel) | Debug métriques VPS |
| `grafana` | `127.0.0.1:3000:3000` (optionnel) | Debug dashboards VPS |
| `alertmanager` | AUCUN | Prométhée le contacte via DNS compose |
| `alert-relay` | AUCUN | Reçoit les webhooks via DNS compose |
| `postgres-exporter` | `127.0.0.1:9187:9187` (optionnel) | Debug exporter VPS |

**Anti-pattern à FUIR** : `ports: "9000:9000"` sans préfixe `127.0.0.1:` —
c'est exactement le bug F3 que R3 a corrigé pour MinIO prod, mais la même
classe d'erreur peut toucher n'importe quel service. Revue systématique
à chaque ajout de service.

## 4. Audit réseau (à automatiser)

Vérification périodique (mensuelle, à intégrer dans le `restore-drill` VPS — S5) :

```bash
# Ports TCP à l'écoute sur le VPS (toutes interfaces)
sudo ss -ltnp
# Attendu : uniquement 22 (sshd), 80 (nginx), 443 (nginx), et
# éventuellement les ports 127.0.0.1:9000, 127.0.0.1:5432 etc. en debug.

# Ports UDP (DNS, NTP — peu de raisons d'en avoir en prod)
sudo ss -lunp

# Connexions actives (anomalies : trop de connexions sortantes = C2)
sudo ss -tan state established | head -50

# Ports Docker mappés sur l'hôte (anti-pattern 0.0.0.0)
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -v '127.0.0.1' | grep -v ':::80\|:::443'
# Attendu : sortie vide.

# Test d'intrusion léger depuis l'extérieur (peut être automatisé via cron)
nmap -Pn -p 1-65535 --open <IP_PUBLIQUE_VPS>  # long, à faire ponctuellement
# Attendu : 22, 80, 443 ; tous les autres filtered/closed.
```

## 5. Rotation des accès opérateurs (avec R7)

Pour autoriser un opérateur à atteindre `/support/` :

1. **Préférer le VPN WireGuard** (R8 idéal) : installer WireGuard sur le
   VPS (port 51820/udp), configurer le CIDR du VPN (ex. `10.8.0.0/24`),
   distribuer la clé publique de l'opérateur. Aucun port supplémentaire
   exposé publiquement.
2. **Si pas de VPN** : ajouter l'IP publique statique de l'opérateur à
   `SUPPORT_ALLOWED_CIDRS` dans `.env`, puis `docker compose restart nginx`.
   Cette méthode est fragile (IP change si l'opérateur change de réseau) —
   à réserver à un usage ponctuel.
3. **Rotation** : retirer l'opérateur de `SUPPORT_ALLOWED_CIDRS` quand
   l'accès n'est plus nécessaire. Journaliser les accès dans
   `nginx access_log` (le `geo` n'identifie pas l'opérateur — c'est juste
   un bool, mais l'IP source est dans le log).

## 6. Rollback / incident

Si un service interne doit être débuggé **sans** compromettre la prod :

```bash
# Tunnel SSH local (port 5432 de postgres exposé UNIQUEMENT sur
# l'ordinateur de l'opérateur)
ssh -L 15432:localhost:5432 operator@vps.example.dz
# Côté opérateur : psql -h localhost -p 15432 -U creche_app creche
```

Cette méthode n'ouvre AUCUN port sur le VPS — le tunnel SSH est chiffré
et authentifié par clé. C'est l'anti-pattern idéal du pare-feu ouvert.

## 7. Liens

- `docs/BACKUP-RUNBOOK.md` § « Upgrade PostgreSQL 16 → 18 » (autre angle
  ops réseau : volume, exposition, rotation).
- `docs/PHASE_H2J_METRICS_RUNBOOK.md` (exposition métriques — H2k déjà
  conçu pour zéro exposition publique par défaut).
- `infrastructure/docker/docker-compose.prod.yml` (ports: bindings à
  auditer à chaque PR).
- `scripts/check-env-example.mjs` (garde anti-régression sur les .example —
  complémentaire de ce runbook pour la couche compose).

## 8. Vérification post-apply

Une fois UFW + compose-bounds alignés :

```bash
# Sur le VPS, depuis l'extérieur (autre machine ou via curl) :
curl -sI http://<IP_PUBLIQUE>:9000  # MinIO (devrait être bloqué : connection refused / timeout)
curl -sI http://<IP_PUBLIQUE>:5432  # postgres (idem)
curl -sI https://<DOMAINE>/support/  # /support/ sans CIDR autorisé : 403 (R7)
curl -sI https://<DOMAINE>/          # / : 200 (admin-web accessible)
```

Tous les checks "bloqué" doivent retourner `connection refused` (niveau
TCP, avant HTTP) ou `403` (niveau HTTP, après le pare-feu applicatif
nginx). Un `200` sur un port interne = fuite à corriger.
