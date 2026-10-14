/**
 * 3.5.2 (remédiation 2026-10-05) — un device dont le curseur était tombé sous
 * le seuil de purge recevait une page vide, sauvegardait son curseur inchangé,
 * et croyait silencieusement être à jour. La correction ajoute
 * `resync_required` (booléen REQUIRED) à PullResponse : le serveur compare le
 * curseur client à MIN(sync_seq) et signale ; le client remet son curseur à 0
 * et relit tout (payloads idempotents), borné à 1 resync/cycle.
 *
 * Ces tests valident le CONTRAT lui-même — pas le code généré (déjà couvert
 * par generate-sync-contract.mjs --check) : le champ est booléen, requis, et
 * le générateur sait valider le type `boolean` côté Dart.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const schema = require('../../packages/sync-contract/sync.schema.json');

const PULL = schema.definitions.PullResponse;

test('PullResponse declare resync_required de type boolean', () => {
  assert.deepEqual(PULL.properties.resync_required, { type: 'boolean' });
});

test('resync_required est REQUIS (un serveur qui l oublie rompt le client)', () => {
  assert.ok(PULL.required.includes('resync_required'), 'resync_required doit etre required');
});

test('le validateur Dart généré supporte le type boolean', () => {
  // 3.5.2 : le type n'était pas géré par _typeMatches — ajouté.
  const dart = readFileSync(
    join(process.cwd(), 'apps/staff-mobile/lib/core/network/generated/sync_wire_client.dart'),
    'utf8',
  );
  assert.ok(dart.includes("case 'boolean': return value is bool;"), 'le validateur Dart doit valider boolean');
});

test('le schema ne declare que des types que le generateur sait valider', () => {
  const types = new Set();
  for (const def of Object.values(schema.definitions)) {
    const props = def.properties;
    if (props) {
      for (const p of Object.values(props)) {
        if (Array.isArray(p?.type)) {
          for (const t of p.type) types.add(t);
        } else if (p?.type) {
          types.add(p.type);
        }
      }
    }
  }
  // null est autorisé (union ["string","null"]) mais ignoré : le validateur
  // Dart teste la nullabilité avant le type.
  const KNOWN = ['string', 'number', 'integer', 'boolean', 'array', 'object'];
  for (const t of types) {
    if (t === 'null') continue;
    assert.ok(KNOWN.includes(t), `type schema non gere par le validateur : ${t}`);
  }
});
