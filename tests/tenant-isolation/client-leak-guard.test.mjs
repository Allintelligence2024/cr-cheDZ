/**
 * Garde anti-fuite de connexion PostgreSQL dans les suites d'isolation.
 *
 * Pourquoi ce test existe
 * -----------------------
 * Un `pg.Client` connecté maintient un socket actif. Tant qu'il n'est pas
 * fermé, Node ne sort JAMAIS — même quand la suite a terminé tout son
 * travail et affiché son résultat. Le processus reste vivant, la batterie
 * s'arrête à cette suite, et le job CI se bloque jusqu'au plafond.
 *
 * C'est exactement ce qui est arrivé à `phase62-payroll-finalized-lock` :
 * le client d'amorçage (celui qui appelle `ensureAppRole`) n'était jamais
 * fermé, alors que ses trois autres clients l'étaient. Le symptôme est
 * particulièrement trompeur : la suite passe, écrit « validée », puis fige.
 *
 * Ce contrôle est volontairement statique — il ne demande ni PostgreSQL ni
 * exécution des suites — pour rester exécutable partout et pour attraper la
 * régression au plus tôt, là où le diagnostic coûte des heures en CI.
 *
 * Limite assumée : on compare des occurrences textuelles `.connect()` et
 * `.end()`. C'est une heuristique, pas une analyse de flot. Elle suffit
 * parce que les suites suivent toutes la même forme (un client = un
 * `.connect()` = un `.end()`), et les rares formes légitimes qui déséquilibrent
 * ce compte sont listées ci-dessous avec leur justification.
 */

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Suites dont le déséquilibre est légitime, avec la raison.
 * Toute nouvelle entrée doit être justifiée : c'est le seul moyen d'éviter
 * qu'une vraie fuite se cache derrière une exemption de confort.
 */
const JUSTIFIED = new Map([
  [
    'phase27-worker-lifecycle.test.mjs',
    "le client `admin` est fermé dans un hook after(), hors du comptage textuel",
  ],
  [
    'phase32-sync-children.api.test.mjs',
    'tous les clients sont fermés sur une seule ligne de teardown groupée',
  ],
]);

const suites = readdirSync(here)
  .filter((f) => f.endsWith('.test.mjs') && f !== 'client-leak-guard.test.mjs')
  .sort();

test('chaque suite ferme autant de clients PostgreSQL qu’elle en ouvre', () => {
  assert.ok(suites.length > 20, `trop peu de suites trouvées (${suites.length})`);

  const leaking = [];
  for (const file of suites) {
    const source = readFileSync(join(here, file), 'utf8');
    const opened = (source.match(/\.connect\(\)/g) ?? []).length;
    const closed = (source.match(/\.end\(\)/g) ?? []).length;
    if (opened > closed && !JUSTIFIED.has(file)) {
      leaking.push(`${file} : ${opened} .connect() pour ${closed} .end()`);
    }
  }

  assert.deepEqual(
    leaking,
    [],
    'client PostgreSQL non fermé — la suite ne rendra jamais la main et bloquera la CI :\n  ' +
      leaking.join('\n  '),
  );
});

test('les exemptions déclarées correspondent à des suites réelles', () => {
  for (const file of JUSTIFIED.keys()) {
    assert.ok(suites.includes(file), `exemption obsolète : ${file} n'existe plus`);
  }
});
