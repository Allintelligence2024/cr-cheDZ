# syntax=docker/dockerfile:1.6
# =============================================================================
# Image MinIO — construite depuis la RELEASE OFFICIELLE (binaire GitHub + SHA-256)
#
# POURQUOI CE DOCKERFILE EXISTE (H1, mesuré le 25/09/2026)
# ------------------------------------------------------
# MinIO n'est plus distribuable par tirage d'image : ses images ont été retirées
# des deux registres publics.
#   * Docker Hub : le dépôt `minio/minio` a disparu (le 12/09/2026, l'API Hub
#     rend `404` et le manifeste anonyme `401`) — d'où le `pull access denied …
#     repository does not exist` des déploiements de septembre ;
#   * Quay.io : accès anonyme coupé le 24/09/2026 à ~12:55 UTC
#     (`unauthorized: access to the requested resource is not authorized`),
#     alors que les autres dépôts publics du même registre répondent 200.
# C'est la cause unique de H1 (le seul job CI rouge) et, plus grave, d'un
# déploiement neuf qui échoue sur le tirage de l'object store. On reconstruit
# donc l'image à partir du BINAIRE PUBLIÉ de la release épinglée — dont le
# SHA-256 est vérifié par le builder lui-même (`ADD --checksum`), pas par
# confiance — au lieu de dépendre d'un registre tiers.
#
# PROVENANCE DES VALEURS (relevées le 25/09/2026 par l'API GitHub, champ `digest`
# de chaque asset de la release `RELEASE.2025-09-07T16-13-09Z`, tag annoté
# pointant sur le commit 01ce918d8279a20e4706b96a64396146894adee4) :
#   minio.linux-amd64.RELEASE.2025-09-07T16-13-09Z   110 989 496 o   7c5bd8512c6e966455b1d198209358b2d191c77a83ab377c4073281065fb855f
#   minio.linux-arm64.RELEASE.2025-09-07T16-13-09Z   105 251 000 o   5c83cd2cf151717ba0243f73e1c7802ff36e272b67144bdd7f1f7d684fd6f03d
# Re-vérification (le dépôt ne doit pas mentir si l'amont change) :
#   gh api repos/minio/minio/releases/tags/<release> --jq '.assets[] | {name, size, digest}'
#
# UTILISATION
#   node scripts/build-minio-image.mjs           # amd64 ou arm64 selon la machine
#   (arm64 à la main : --build-arg MINIO_ARCH=arm64 --build-arg MINIO_SHA256=5c83cd2c…6f03d)
# Les composes consomment `${MINIO_IMAGE:-creche-minio:<release>}` : l'exploitant
# qui préfère un miroir interne définit `MINIO_IMAGE` et n'utilise pas ce fichier.
#
# NOTE D'EXPLOITATION : le conteneur tourne en root, comme l'image amont d'origine
# (les volumes déjà créés par un déploiement antérieur appartiennent à root ; un
# `USER minio` casserait une mise à jour sur volume existant). Durcissement
# possible (uid 1000) avec un volume NEUF, à décider côté ops.
# =============================================================================
FROM alpine:3.21

ARG MINIO_RELEASE=RELEASE.2025-09-07T16-13-09Z
ARG MINIO_ARCH=amd64
ARG MINIO_SHA256=7c5bd8512c6e966455b1d198209358b2d191c77a83ab377c4073281065fb855f

# Un couple (architecture, somme) incohérent doit échouer ICI, avec un message
# qui dit quoi faire — jamais un binaire silencieusement différent.
RUN case "${MINIO_ARCH}" in \
      amd64|arm64) ;; \
      *) echo "MINIO_ARCH non supportée : ${MINIO_ARCH} (amd64 ou arm64 attendus)" >&2; exit 1 ;; \
    esac

# Le builder télécharge ET vérifie la somme : si l'amont republie l'asset
# (ou si quelqu'un se trompe d'architecture), le build s'arrête.
ADD --checksum=sha256:${MINIO_SHA256} \
    https://github.com/minio/minio/releases/download/${MINIO_RELEASE}/minio.linux-${MINIO_ARCH}.${MINIO_RELEASE} \
    /usr/local/bin/minio

RUN chmod 0755 /usr/local/bin/minio \
 && mkdir -p /data \
 && minio --version

EXPOSE 9000 9001
VOLUME ["/data"]
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
