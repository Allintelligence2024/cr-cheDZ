#!/usr/bin/env node
/**
 * BANC DE MESURE — coût de l'absence d'index `organization_id` sur les tables
 * tenant (remédiation 2026-09-27, lot 1).
 *
 * Pourquoi ce banc existe
 * -----------------------
 * Chaque politique RLS s'écrit `USING (organization_id = app_tenant_id())`.
 * Sans index sur `organization_id`, PostgreSQL doit balayer **toute la table**
 * (toutes organisations confondues) pour rendre les lignes d'UN SEUL tenant :
 * le coût d'une requête d'une crèche croît donc avec le nombre total de
 * clients de la plateforme. Ce banc le mesure, index posé puis retiré, sur le
 * même jeu de données.
 *
 * Ce qu'il prouve
 * ---------------
 *  - le plan choisi (Seq Scan vs Index Scan) ;
 *  - le temps d'exécution réel avant / après ;
 *  - le rapport de vitesse, qui est la grandeur qui compte pour l'exploitation.
 *
 * Ce qu'il ne fait pas
 * --------------------
 * Il ne modifie pas le schéma de façon permanente : l'index de mesure est
 * créé puis supprimé, et les données de banc sont supprimées à la fin. Aucune
 * migration n'est appliquée ici (ADR-007 : c'est la migration qui porte l'index
 * définitif, ce banc ne fait que la justifier).
 *
 * Base de travail — jetable, créée depuis la base de référence
 * ----------------------------------------------------------
 * Le banc insère des données financières. Le cycle de vie financier est
 * IMMUABLE en base (`trg_no_delete_invoices`, `trg_no_delete_payments`,
 * `trg_no_delete_allocations` → `no_financial_delete()`, ERRCODE 42501) :
 * **rien ne peut être supprimé**. Nettoyer « à la main » est donc impossible,
 * et laisser traîner un jeu d'essai souillerait la base de travail.
 * Le banc crée donc sa propre base par clonage (`CREATE DATABASE … TEMPLATE`),
 * y travaille, puis la supprime. La base d'origine n'est jamais écrite.
 *
 * Usage : DATABASE_URL=... node tests/perf/bench-tenant-index.mjs [--orgs N] [--invoices N]
 *   DATABASE_URL doit pointer une base **de test** (`*_test`), qui sert de
 *   gabarit. L'utilisateur doit pouvoir CREATE DATABASE.
 */
import assert from 'node:assert/strict';
import pg from 'pg';

const url = process.env.DATABASE_URL;
assert.ok(url, 'DATABASE_URL requis');
const parsed = new URL(url);
const template = parsed.pathname.replace(/^\//, '');
assert.ok(template.endsWith('_test'), `base de test requise (*_test), reçu : ${parsed.pathname}`);

const benchDb = `creche_bench_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
const admin = new pg.Client({ connectionString: url.replace(/\/[a-z0-9_]*$/, '/postgres') });
await admin.connect();
// Aucune connexion ne doit viser le gabarit pendant le clonage.
await admin.query(
  `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
  [template],
);
await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(benchDb)} TEMPLATE ${pg.escapeIdentifier(template)}`);
await admin.end();

const benchUrl = url.replace(/\/[a-z0-9_]*$/, `/${benchDb}`);
console.log(`Base de banc jetable : ${benchDb} (clonée depuis ${template}, supprimée à la fin)`);

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? Number(process.argv[i + 1]) : fallback;
};
const ORGS = arg('--orgs', 40);
const INVOICES = arg('--invoices', 25);
const LINES = 3;

const db = new pg.Client({ connectionString: benchUrl });
await db.connect();
const suffix = Math.random().toString(36).slice(2, 8);

const created = { orgs: [], children: [], invoices: [], lines: 0 };

try {
  const user = (
    await db.query(
      `INSERT INTO users(email, first_name, last_name, password_hash, status)
       VALUES ($1,'Bench','Index','bench-not-a-real-hash','active') RETURNING id`,
      [`bench-${suffix}@test.invalid`],
    )
  ).rows[0].id;
  created.user = user;

  await db.query('BEGIN');
  for (let i = 0; i < ORGS; i++) {
    const org = (
      await db.query(
        `INSERT INTO organizations(slug, name_fr, wilaya) VALUES ($1,'Bench index','31') RETURNING id`,
        [`bench-${suffix}-${i}`],
      )
    ).rows[0].id;
    created.orgs.push(org);
    const site = (
      await db.query(`INSERT INTO sites(organization_id, name_fr) VALUES ($1,'Bench') RETURNING id`, [org])
    ).rows[0].id;
    const child = (
      await db.query(
        `INSERT INTO children(organization_id, site_id, first_name_fr, last_name_fr, date_of_birth, created_by)
         VALUES ($1,$2,'Bench','Index','2022-01-01',$3) RETURNING id`,
        [org, site, user],
      )
    ).rows[0].id;
    created.children.push(child);
    for (let f = 0; f < INVOICES; f++) {
      const inv = (
        await db.query(
          `INSERT INTO invoices(organization_id, invoice_number, child_id, period_year, period_month,
             subtotal, discount_amount, total_amount, due_date, created_by)
           VALUES ($1,$2,$3,2026,1,100,0,100,'2026-02-01',$4) RETURNING id`,
          [org, `BENCH-${suffix}-${i}-${f}`, child, user],
        )
      ).rows[0].id;
      created.invoices.push(inv);
      for (let l = 0; l < LINES; l++) {
        await db.query(
          `INSERT INTO invoice_lines(organization_id, invoice_id, description_fr, quantity, unit_price, total_price)
           VALUES ($1,$2,'Garde mensuelle',1,100,100)`,
          [org, inv],
        );
        created.lines++;
      }
    }
  }
  await db.query('COMMIT');
  await db.query('ANALYZE invoice_lines');

  const total = Number((await db.query('SELECT count(*) FROM invoice_lines')).rows[0].count);
  const target = created.orgs[Math.floor(ORGS / 2)];
  console.log(
    `Jeu d'essai : ${created.lines} lignes de facture, ${ORGS} organisations ` +
      `(~${Math.round(total / ORGS)} lignes par tenant ; ${total} au total).`,
  );

  /** Mesure le plan et le temps d'une requête « un seul tenant » (ce que fait l'API sous RLS). */
  async function measure(label) {
    const runs = [];
    let plan = '';
    for (let i = 0; i < 5; i++) {
      const r = await db.query(
        'EXPLAIN (ANALYZE) SELECT sum(total_price) FROM invoice_lines WHERE organization_id = $1',
        [target],
      );
      const text = r.rows.map((x) => x['QUERY PLAN']).join('\n');
      plan = text;
      runs.push(parseFloat(text.match(/Execution Time: ([\d.]+) ms/)[1]));
    }
    runs.sort((a, b) => a - b);
    const median = runs[Math.floor(runs.length / 2)];
    const scan = /Seq Scan/.test(plan) ? 'Seq Scan' : /Index Scan/.test(plan) ? 'Index Scan' : 'autre';
    console.log(`\n── ${label} ──`);
    console.log(`  nœud d'accès  : ${scan}`);
    console.log(`  médiane (5 exécutions) : ${median.toFixed(3)} ms`);
    return { median, scan };
  }

  const before = await measure('AVANT — sans index organization_id');
  await db.query('CREATE INDEX bench_tmp_invoice_lines_org ON invoice_lines(organization_id)');
  await db.query('ANALYZE invoice_lines');
  const after = await measure('APRÈS — index organization_id posé');
  await db.query('DROP INDEX bench_tmp_invoice_lines_org');

  const ratio = before.median / after.median;
  console.log('\n═══ RÉSULTAT ═══');
  console.log(`  ${before.scan} ${before.median.toFixed(3)} ms  →  ${after.scan} ${after.median.toFixed(3)} ms`);
  console.log(`  accélération : ${ratio.toFixed(1)}×`);

  // Critère de sortie du lot : le gain doit être démontré, pas espéré.
  assert.ok(
    after.scan === 'Index Scan',
    `l'index doit être choisi par le planificateur (observé : ${after.scan})`,
  );
  assert.ok(ratio > 1.5, `gain attendu > 1,5× (mesuré : ${ratio.toFixed(2)}×)`);
  console.log(`  ✓ critère tenu : plan indexé et gain ${ratio.toFixed(1)}× (> 1,5×)`);
} catch (error) {
  // Ne pas masquer la cause réelle derrière une erreur de nettoyage : la
  // transaction peut être en état « aborted », ce qui ferait échouer toutes
  // les suppressions du bloc finally en 25P02.
  console.error('\n✗ ÉCHEC DU BANC :', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  // Aucun nettoyage ligne à ligne : la base entière est supprimée. C'est la
  // seule voie compatible avec l'immuabilité financière (pas de DELETE).
  await db.end().catch(() => undefined);
  const drop = new pg.Client({ connectionString: url.replace(/\/[a-z0-9_]*$/, '/postgres') });
  await drop.connect();
  await drop.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [benchDb],
  );
  await drop.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(benchDb)}`);
  await drop.end();
  console.log(`\nBase de banc ${benchDb} supprimée.`);
}
