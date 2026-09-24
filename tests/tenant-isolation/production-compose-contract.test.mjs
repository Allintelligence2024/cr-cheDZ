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

for (const stage of ['prod', 'staging', 'dev']) {
  test(`${stage}: MinIO uses the available versioned registry and immutable manifest`, () => {
    const text = readFileSync(join(directory, `docker-compose.${stage}.yml`), 'utf8');
    assert.match(service(text, 'minio'), /image: quay\.io\/minio\/minio:RELEASE\.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e/);
  });
}

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
