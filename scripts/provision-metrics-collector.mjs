#!/usr/bin/env node
/**
 * H2k — provisioning du credential de collecte Prometheus (/api/v1/metrics).
 *
 * Génère un secret opaque de 32 octets (43 caractères base64url, ≥ la borne
 * MIN_SECRET_LENGTH de la garde de prod) et produit les DEUX moitiés du
 * couple, sans jamais placer le secret dans le dépôt :
 *   - le DIGEST SHA-256 à coller dans METRICS_COLLECTOR_TOKEN_HASHES (API) ;
 *   - le fichier de token lu par Prometheus (`authorization.credentials_file`),
 *     hors dépôt, mode 0600 (retirer le read-modifier pour un redéploiement).
 *
 * Rotation : générer d'abord, AJOUTER le nouveau digest à la liste (les deux
 * coexistent pendant la bascule), remplacer le fichier côté Prometheus, puis
 * RETIRER l'ancien digest → l'ancien collecteur est coupé (401, sans corps).
 * Révocation : retirer le digest (et le fichier) ; un environnement vide ou
 * malformé désactive le chemin collecteur — jamais un repli public.
 *
 * `--hash-file` valide un fichier existant (mode, longueur, digest) ; le
 * token doit être la valeur EXACTE (trim) envoyée par le client HTTP : le
 * digest est calculé sur le contenu tronqué des blancs, comme le reçoit le
 * serveur (l'espacement optionnel d'en-tête est retiré par la pile HTTP).
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { MIN_SECRET_LENGTH } from '@creche/prod-config';

const args = process.argv.slice(2);
function flag(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  assert.ok(value && !value.startsWith('--'), `${name} attend une valeur`);
  return value;
}
function digestOf(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
function entropyFloor(token, source) {
  assert.ok(token.length >= MIN_SECRET_LENGTH,
    `${source}: secret trop court (${token.length} < ${MIN_SECRET_LENGTH} caractères) — refus de provisionner un collecteur devinable`);
}
function assertOutsideRepo(path) {
  const repo = resolve(process.cwd());
  const target = resolve(path);
  assert.ok(target !== repo && !target.startsWith(repo + '/'),
    `refus d'écrire un secret dans le dépôt (${target}) — destination hors dépôt obligatoire (ex. /run/secrets/…)`);
}
function printMaterial(token, outFile) {
  if (outFile) {
    console.log(`Fichier de token écrit : ${outFile} (mode 0600) — le contenu n'est PAS affiché.`);
  } else {
    console.log(`\n# Valeur à placer dans le fichier Prometheus (NE JAMAIS la logger en clair ni la committer) :`);
    console.log(token);
  }
  console.log(`\n# Côté API (aucun secret en clair — uniquement ce digest) :`);
  console.log(`METRICS_COLLECTOR_TOKEN_HASHES=${digestOf(token)}`);
  console.log(`\n# Rotation : générer un NOUVEAU couple, ajouter le nouveau digest à la liste (les deux actifs`);
  console.log(`# pendant la bascule), remplacer le fichier côté Prometheus, puis retirer l'ancien digest.`);
  console.log(`# Révocation : retirer le digest et le fichier ; la route redevient administrateur-seul, jamais publique.`);
}

const outFile = flag('--out-file');
const hashFile = flag('--hash-file');
if (Boolean(outFile) && Boolean(hashFile)) {
  console.error('--out-file et --hash-file sont exclusifs.');
  process.exit(1);
}
if (hashFile) {
  const raw = readFileSync(hashFile, 'utf8');
  const token = raw.trim();
  entropyFloor(token, hashFile);
  const mode = statSync(hashFile).mode & 0o777;
  if (process.getuid && statSync(hashFile).uid === process.getuid() && mode & 0o077) {
    console.error(`${hashFile}: permissions ${mode.toString(8)} trop ouvertes pour un secret (visibles du groupe/des autres) — chmod 600 requis`);
    process.exit(1);
  }
  printMaterial(token, hashFile);
} else {
  if (outFile && !isAbsolute(outFile)) {
    console.error('--out-file exige un chemin absolu hors dépôt (ex. /run/secrets/metrics-collector-token).');
    process.exit(1);
  }
  if (outFile) assertOutsideRepo(outFile);
  const token = randomBytes(32).toString('base64url');
  entropyFloor(token, 'génération');
  if (outFile) {
    writeFileSync(outFile, `${token}\n`, { mode: 0o600, flag: 'wx' });
    // 'wx' : refuse d'écraser silencieusement un secret existant (rotation = nouveau fichier + lien, ou --force hors périmètre).
  }
  printMaterial(token, outFile);
}
