#!/usr/bin/env node
// Contrat structurel ciblé des fichiers livrés, PAS un substitut à « compose up ».
// COMPOSE_TEST_DIR permet de tester les snapshots Git avant correction.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const directory = process.env.COMPOSE_TEST_DIR ?? 'infrastructure/docker';
function service(text, name) {
  const block = text.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|^volumes:|$(?![\\s\\S]))`, 'm'));
  assert.ok(block, `Service ${name} absent`);
  return block[1];
}

for (const stage of ['prod', 'staging']) {
  const text = readFileSync(join(directory, `docker-compose.${stage}.yml`), 'utf8').replace(/^\s*#.*$/gm, '');
  test(`${stage} : init postgres séparé de l'identité applicative`, () => {
    assert.match(service(text, 'postgres'), /^      POSTGRES_USER: postgres\s*$/m);
    for (const name of ['api', 'worker']) {
      const block = service(text, name);
      assert.match(block, /^      DATABASE_URL: \$\{DATABASE_URL[:}]/m);
      assert.match(block, /^      NODE_ENV: (production|staging)\s*$/m);
      assert.doesNotMatch(block, /MIGRATION_DATABASE_URL|MIGRATOR_DATABASE_PASSWORD|POSTGRES_PASSWORD|BOOTSTRAP_DATABASE_URL/);
    }
  });
  test(`${stage} : bootstrap sain → migrate → API et worker`, () => {
    assert.match(service(text, 'bootstrap-roles'), /postgres:\s+condition: service_healthy/);
    assert.match(service(text, 'migrate'), /bootstrap-roles:\s+condition: service_completed_successfully/);
    for (const name of ['api', 'worker']) {
      assert.match(service(text, name), /migrate:\s+condition: service_completed_successfully/);
    }
  });
  test(`${stage} : migrateur dédié, dépendances versionnées et contrôleur de schéma monté`, () => {
    const block = service(text, 'migrate');
    assert.match(block, /MIGRATION_DATABASE_URL: \$\{MIGRATION_DATABASE_URL/);
    assert.match(block, /image: ghcr\.io\/creche-saas\/api:/);
    assert.doesNotMatch(block, /npm install/);
    assert.match(block, /\.\.\/\.\.\/tests:\/app\/tests:ro/);
    assert.match(block, /node tests\/tenant-isolation\/schema-check\.mjs/);
  });
  test(`${stage} : bootstrap reçoit les secrets séparés, sans les inventer`, () => {
    const block = service(text, 'bootstrap-roles');
    assert.match(block, /BOOTSTRAP_DATABASE_URL: postgresql:\/\/postgres:/);
    for (const key of ['APP_DATABASE_PASSWORD', 'MIGRATOR_DATABASE_PASSWORD']) {
      assert.ok(block.includes(`${key}: \u0024{${key}:?`));
    }
    assert.match(block, /scripts\/bootstrap-roles\.mjs/);
  });
}

/**
 * MinIO : image CONSTRUITE localement (release officielle vérifiée par SHA-256),
 * surchargeable par `MINIO_IMAGE` pour un miroir d'exploitation.
 *
 * H1 (25/09/2026) : plus aucun registre public ne sert cette image — Docker Hub a
 * retiré le dépôt `minio/minio` le 12/09/2026 (404 côté API, 401 sur le manifeste
 * anonyme), puis Quay.io a coupé l'accès anonyme le 24/09/2026 (`unauthorized`,
 * alors que les autres dépôts du registre répondent 200). Tirer l'image n'est donc
 * plus une option : le défaut est une image LOCALE construite depuis le binaire
 * publié de la release épinglée, dont la somme SHA-256 est vérifiée par le builder
 * (`ADD --checksum`). Trois propriétés sont verrouillées ici :
 *   1. même image par défaut dans les trois environnements (aucune dérive) ;
 *   2. aucune référence à un registre public mort (c'est ce qui rendait H1 rouge) ;
 *   3. aucun `build:` dans le service minio : sinon `docker compose up` avec
 *      `MINIO_IMAGE=<miroir>` reconstruirait localement… et retaggerait le miroir
 *      avec des octets venus du dépôt (la surcharge serait un mensonge).
 */
const MINIO_IMAGE_DEFAULT = 'creche-minio:RELEASE.2025-09-07T16-13-09Z';
const MINIO_RELEASE = 'RELEASE.2025-09-07T16-13-09Z';
const MINIO_DOCKERFILE = 'minio.Dockerfile';
const MINIO_SHA256_AMD64 = '7c5bd8512c6e966455b1d198209358b2d191c77a83ab377c4073281065fb855f';

const minioImageDefault = (text) => {
  const m = service(text, 'minio').match(/image: \$\{MINIO_IMAGE:-([^}]+)\}/);
  assert.ok(m, 'MinIO doit être `image: ${MINIO_IMAGE:-<défaut>}` (surcharge H1)');
  return m[1];
};

for (const stage of ['prod', 'staging', 'dev']) {
  test(`${stage}: MinIO — image locale par défaut, surcharge par MINIO_IMAGE, aucun registre mort`, () => {
    const text = readFileSync(join(directory, `docker-compose.${stage}.yml`), 'utf8');
    const image = minioImageDefault(text);
    // 1) le défaut est l'image construite depuis la release épinglée
    assert.equal(image, MINIO_IMAGE_DEFAULT, 'image MinIO par défaut inattendue');
    // 2) l'image RÉELLEMENT utilisée est celle de la surcharge (aucune valeur
    //    codée en dur à côté)
    assert.doesNotMatch(service(text, 'minio'), /^ {4}image: (?!\$\{MINIO_IMAGE:-)/m);
    // 3) aucun tirage d'un registre public (les deux sont morts pour MinIO)
    const block = service(text, 'minio');
    assert.doesNotMatch(block, /quay\.io\/minio|(^|[\/\s])minio\/minio:/m,
      'image MinIO tirée d\'un registre public retiré (H1)');
    // 4) pas de build dans le compose : un miroir ne doit pas être retaggé en local
    assert.doesNotMatch(block, /^ {4}build:/m, 'pas de `build:` sous minio (piège de la surcharge)');
  });
}

test('MinIO : image construite depuis la release officielle, somme vérifiée par le builder', () => {
  const dockerfile = readFileSync(join(directory, MINIO_DOCKERFILE), 'utf8');
  assert.match(dockerfile, /^FROM alpine:[0-9.]+$/m);
  assert.match(dockerfile, new RegExp(`^ARG MINIO_RELEASE=${MINIO_RELEASE}$`, 'm'));
  assert.match(dockerfile, new RegExp(`^ARG MINIO_SHA256=${MINIO_SHA256_AMD64}$`, 'm'),
    'la somme amd64 doit être le défaut de l\'ARG (aucune somme implicite)');
  assert.match(dockerfile, /^ARG MINIO_ARCH=amd64$/m);
  // le builder vérifie lui-même les octets : ce n'est pas une confiance dans le réseau
  assert.match(dockerfile,
    /ADD --checksum=sha256:\$\{MINIO_SHA256\} \\\n\s+https:\/\/github\.com\/minio\/minio\/releases\/download\/\$\{MINIO_RELEASE\}\/minio\.linux-\$\{MINIO_ARCH\}\.\$\{MINIO_RELEASE\} \\\n\s+\/usr\/local\/bin\/minio/);
  // une architecture non prévue échoue AVANT le téléchargement (message explicite)
  assert.match(dockerfile, /MINIO_ARCH non supportée/);
});

test('MinIO : le script de construction ne recopie pas les valeurs du Dockerfile', () => {
  // Source de vérité unique : le script LIT la release et la somme amd64 du
  // Dockerfile ; seule la somme arm64 y est portée, et elle doit rester celle
  // que le Dockerfile documente (sinon arm64 construirait d'autres octets).
  const script = readFileSync(join(directory, '..', '..', 'scripts', 'build-minio-image.mjs'), 'utf8');
  assert.match(script, /readFileSync\(join\(REPO, DOCKERFILE\)/);
  assert.match(script, /const arg = \(name\) =>/, 'le script doit lire les ARG du Dockerfile, pas les recopier');
  const dockerfile = readFileSync(join(directory, MINIO_DOCKERFILE), 'utf8');
  const arm64 = script.match(/arm64: '([0-9a-f]{64})'/);
  assert.ok(arm64, 'somme arm64 absente du script');
  assert.ok(dockerfile.includes(arm64[1]), 'la somme arm64 du script doit être celle documentée dans le Dockerfile');
  assert.match(script, /arch === 'arm64' \? 'arm64' : 'amd64'/, 'le script doit choisir la somme selon l\'architecture');
});

test('MinIO : les trois environnements partagent le même digest par défaut', () => {
  const digests = ['prod', 'staging', 'dev'].map((stage) =>
    minioImageDefault(readFileSync(join(directory, `docker-compose.${stage}.yml`), 'utf8')),
  );
  assert.equal(new Set(digests).size, 1, `digests divergents : ${JSON.stringify(digests)}`);
});

test('MinIO : la stack de qualification construit l’image, ou tire le miroir CONFIGURÉ', () => {
  // `test-staging-stack.mjs` lit `config.services.minio.image` (compose résolu) :
  // c'est ce qui rend `MINIO_IMAGE` opérant. Sans miroir, il CONSTRUIT cette même
  // image (H1 : plus rien à tirer) — jamais une référence codée en dur, qui
  // court-circuiterait la surcharge en silence.
  const script = readFileSync(join(directory, '..', '..', 'scripts', 'test-staging-stack.mjs'), 'utf8');
  assert.match(script, /const minioImage = config\.services\.minio\.image;/);
  assert.match(script, /env\.MINIO_IMAGE\s*\n?\s*\? await pullRegistryImage\(minioImage, \{ env \}\)/,
    'un miroir fourni doit être TIRÉ (chemin d\'exploitation)');
  assert.match(script, /execFileSync\(process\.execPath, \['scripts\/build-minio-image\.mjs', minioImage\]/,
    'sans miroir, l\'image résolue doit être construite localement');
  assert.ok(!/pullRegistryImage\(['\"]minio/.test(script), 'image MinIO codée en dur au lieu de la config résolue');
});

/**
 * Point de montage des données PostgreSQL.
 *
 * À partir de postgres:18, l'image officielle stocke les données dans
 * $PGDATA=/var/lib/postgresql/18/docker et déclare son VOLUME sur le parent
 * /var/lib/postgresql (docker-library/postgres#1259). Un volume monté sur
 * l'ancien chemin /var/lib/postgresql/data n'est alors JAMAIS écrit : le
 * conteneur refuse de démarrer, même sur un volume neuf.
 *
 * Symptôme observé en CI : « Error: in 18+, these Docker images are
 * configured to store database data in a format which is compatible with
 * pg_ctlcluster […] there appears to be PostgreSQL data in:
 * /var/lib/postgresql/data (unused mount/volume) ».
 *
 * Le piège est silencieux : le mauvais chemin reste une ligne YAML
 * parfaitement valide. D'où ce test sur les trois environnements.
 */
for (const stage of ['prod', 'staging', 'dev']) {
  test(`${stage} : le volume PostgreSQL est monté sur /var/lib/postgresql (exigence 18+)`, () => {
    const block = service(readFileSync(join(directory, `docker-compose.${stage}.yml`), 'utf8'), 'postgres');
    assert.match(
      block,
      /- postgres_\w+_data:\/var\/lib\/postgresql$/m,
      'le volume doit être monté sur /var/lib/postgresql',
    );
    assert.doesNotMatch(
      block,
      /:\/var\/lib\/postgresql\/data/,
      'chemin pré-18 : postgres:18+ refuse de démarrer sur ce montage',
    );
  });
}
