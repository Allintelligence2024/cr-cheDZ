#!/usr/bin/env node
/**
 * Construit l'image MinIO locale depuis la RELEASE OFFICIELLE (H1, 25/09/2026).
 *
 * MinIO a retiré ses images des registres publics (Docker Hub le 12/09/2026,
 * Quay.io le 24/09/2026 — mesuré, cf. docs/CI-DATABASE-JOB-FINDINGS.md) : tirer
 * l'image n'est plus possible, donc la stack la reconstruit à partir du binaire
 * publié, dont la somme SHA-256 est vérifiée par le builder.
 *
 * SOURCE DE VÉRITÉ : `infrastructure/docker/minio.Dockerfile`. Ce script LIT ses
 * valeurs par défaut (release, somme amd64) au lieu de les recopier ; seule la
 * somme arm64 est portée ici, parce que le Dockerfile n'a qu'un défaut, et un
 * test (`production-compose-contract`) vérifie que les deux fichiers concordent.
 *
 * Usage : node scripts/build-minio-image.mjs [tag]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCKERFILE = join('infrastructure', 'docker', 'minio.Dockerfile');

/** Sommes par architecture — arm64 seule valeur non lisible dans le Dockerfile. */
export const MINIO_SHA256_BY_ARCH = {
  amd64: null, // lue dans le Dockerfile (défaut de l'ARG MINIO_SHA256)
  arm64: '5c83cd2cf151717ba0243f73e1c7802ff36e272b67144bdd7f1f7d684fd6f03d',
};

export function minioPins(dockerfile = readFileSync(join(REPO, DOCKERFILE), 'utf8')) {
  const arg = (name) => {
    const m = dockerfile.match(new RegExp(`^ARG ${name}=(\\S+)$`, 'm'));
    if (!m) throw new Error(`ARG ${name} absent de ${DOCKERFILE}`);
    return m[1];
  };
  return { release: arg('MINIO_RELEASE'), amd64: arg('MINIO_SHA256'), arch: arg('MINIO_ARCH') };
}

export function buildMinioImage(tag, { env = process.env, arch = process.arch, log = console.log } = {}) {
  const pins = minioPins();
  const target = arch === 'arm64' ? 'arm64' : 'amd64';
  const sha256 = target === 'amd64' ? pins.amd64 : MINIO_SHA256_BY_ARCH.arm64;
  log(`MinIO ${pins.release} (${target}, sha256 ${sha256.slice(0, 12)}…) → ${tag}`);
  return execFileSync(
    'docker',
    ['build', '-f', DOCKERFILE, '-t', tag,
      '--build-arg', `MINIO_RELEASE=${pins.release}`,
      '--build-arg', `MINIO_ARCH=${target}`,
      '--build-arg', `MINIO_SHA256=${sha256}`,
      'infrastructure/docker'],
    { cwd: REPO, env, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pins = minioPins();
  buildMinioImage(process.argv[2] ?? `creche-minio:${pins.release}`);
}
