#!/usr/bin/env node
// G2 — Intégrité financière DB1/DB2/DB3 (rapport 2026-09-19, analyse 1).
// Prouve que la migration 064 :
//   - interdit les DELETE sur invoices/payments/payment_allocations ;
//   - rend immuable (sauf updated_at / gateway_response) les lignes clôturées ;
//   - verrouille le PAIEMENT lors des allocations (trou 023 : deux INSERT
//     concurrents pouvaient sur-allouer le même paiement) ;
//   - rejette toute modification d'allocation hors bornes ;
//   - conserve le flux cash applicatif (ordre exact : paiement confirmé →
//     allocation → paid_amount) — rétrocompatibilité.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ensureAppRole, appUrl } from './helpers.mjs';

assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let passed = 0, failed = 0;
const check = async (name, fn) => { try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}: ${e.message}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = randomUUID().slice(0, 8);

const appClient = async () => { const c = new pg.Client({ connectionString: appUrl() }); await c.connect(); return c; };
async function committed(tenant, fn) {
  const c = await appClient();
  try { await c.query('BEGIN'); if (tenant) await c.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]); return await fn(c); }
  finally { await c.query('COMMIT'); await c.end(); }
}
async function scoped(tenant, fn) {
  const c = await appClient();
  try { await c.query('BEGIN'); if (tenant) await c.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]); return await fn(c); }
  finally { await c.query('ROLLBACK'); await c.end(); }
}
const expectReject = async (fn, code) => {
  try { await fn(); } catch (e) {
    if (e.code === code) return;
    throw new Error(`code attendu ${code}, reçu ${e.code} (${e.message})`);
  }
  throw new Error(`refus attendu (${code}) — l'opération a réussi`);
};

try {
  await ensureAppRole(db);

  // ── Fixtures (rôle app, tenant A) ─────────────────────────────────────────
  const ids = {};
  await committed(null, async (c) => {
    ids.orgA = (await c.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'G2b-A','31') RETURNING id`, [randomUUID()])).rows[0].id;
    ids.orgB = (await c.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'G2b-B','16') RETURNING id`, [randomUUID()])).rows[0].id;
    ids.user = (await c.query(`INSERT INTO users(email,first_name,last_name,status) VALUES($1,'G2b','Test','active') RETURNING id`, [`${RUN}@test.invalid`])).rows[0].id;
  });
  await committed(ids.orgA, async (c) => {
    ids.site = (await c.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'G2b Site') RETURNING id`, [ids.orgA])).rows[0].id;
    ids.child = (await c.query(`INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,created_by) VALUES($1,$2,'Lina','G2b','2020-01-15',$3) RETURNING id`, [ids.orgA, ids.site, ids.user])).rows[0].id;
    ids.child2 = (await c.query(`INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,created_by) VALUES($1,$2,'Yacine','G2b','2019-06-01',$3) RETURNING id`, [ids.orgA, ids.site, ids.user])).rows[0].id;
    const inv = async (key, org, n, total = 100) => {
      ids[key] = (await c.query(
        `INSERT INTO invoices(organization_id,invoice_number,child_id,period_year,period_month,subtotal,total_amount,due_date,status,created_by)
         VALUES($1,$2,$3,2026,6,$4,$4,'2026-07-10','draft',$5) RETURNING id`,
        [org, `INV-${RUN}-${n}`, ids.child, total, ids.user],
      )).rows[0].id;
    };
    await inv('invA', ids.orgA, 'A'); await inv('invB', ids.orgA, 'B', 120);
    await inv('invC', ids.orgA, 'C'); await inv('invD', ids.orgA, 'D');
    ids.paid250 = (await c.query(
      `INSERT INTO payments(organization_id,reference_number,child_id,amount,method,status,received_at,confirmed_at,created_by,site_id)
       VALUES($1,$2,$3,250,'cash','confirmed',NOW(),NOW(),$4,$5) RETURNING id`,
      [ids.orgA, `PAY-G2b-${RUN}-1`, ids.child, ids.user, ids.site],
    )).rows[0].id;
    ids.pend50 = (await c.query(
      `INSERT INTO payments(organization_id,reference_number,child_id,amount,method,status,created_by,site_id)
       VALUES($1,$2,$3,50,'bank_transfer','pending',$4,$5) RETURNING id`,
      [ids.orgA, `PAY-G2b-${RUN}-2`, ids.child, ids.user, ids.site],
    )).rows[0].id;
  });
  // Facture d'une AUTRE organisation (pour le contrôle anti-cross-tenant).
  await committed(ids.orgB, async (c) => {
    const siteB = (await c.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'G2b Site B') RETURNING id`, [ids.orgB])).rows[0].id;
    ids.childB = (await c.query(`INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,created_by) VALUES($1,$2,'Nour','G2b','2021-03-03',$3) RETURNING id`, [ids.orgB, siteB, ids.user])).rows[0].id;
    ids.invX = (await c.query(
      `INSERT INTO invoices(organization_id,invoice_number,child_id,period_year,period_month,subtotal,total_amount,due_date,status,created_by)
       VALUES($1,$2,$3,2026,6,100,100,'2026-07-10','draft',$4) RETURNING id`,
      [ids.orgB, `INV-${RUN}-X`, ids.childB, ids.user],
    )).rows[0].id;
  });

  // ── Rétrocompatibilité : ordre exact du flux cash applicatif ──────────────
  // INSERT paiement confirmé → INSERT allocation → UPDATE paid_amount.
  const allocInsert = (c, paymentId, invoiceId, amount) => c.query(
    `INSERT INTO payment_allocations(organization_id,payment_id,invoice_id,amount_allocated,allocated_by)
     VALUES($1,$2,$3,$4,$5)`,
    [ids.orgA, paymentId, invoiceId, amount, ids.user],
  );
  await check('rétrocompat : flux cash (paiement→allocation→paid) accepté', async () => {
    await committed(ids.orgA, async (c) => {
      await allocInsert(c, ids.paid250, ids.invA, 100);
      await c.query(`UPDATE invoices SET paid_amount=paid_amount+100, status='paid' WHERE id=$1`, [ids.invA]);
      await allocInsert(c, ids.paid250, ids.invB, 120);
      await c.query(`UPDATE invoices SET paid_amount=paid_amount+120, status='paid' WHERE id=$1`, [ids.invB]);
    });
  });
  // État : invA paid 100/100, invB paid 120/120, paiement 250 confirmé (220 alloués), 50 pending.

  // ── DB3 : DELETE interdit ─────────────────────────────────────────────────
  await check('DB3 : DELETE facture payée refusé (42501)', async () => {
    await scoped(ids.orgA, (c) => expectReject(() => c.query(`DELETE FROM invoices WHERE id=$1`, [ids.invA]), '42501'));
  });
  await check('DB3 : DELETE paiement confirmé refusé (42501)', async () => {
    await scoped(ids.orgA, (c) => expectReject(() => c.query(`DELETE FROM payments WHERE id=$1`, [ids.paid250]), '42501'));
  });
  await check('DB3 : DELETE allocation refusé (42501)', async () => {
    await scoped(ids.orgA, (c) => expectReject(() => c.query(`DELETE FROM payment_allocations WHERE payment_id=$1 AND invoice_id=$2`, [ids.paid250, ids.invA]), '42501'));
  });

  // ── DB3 : facture payée immuable (sauf updated_at) ────────────────────────
  const paidInvoice = (set) => scoped(ids.orgA, (c) => expectReject(
    () => c.query(`UPDATE invoices SET ${set} WHERE id=$1`, [ids.invA]), 'P0001'));
  await check('DB3 : facture payée — due_date verrouillé', () => paidInvoice(`due_date='2026-07-20'`));
  await check('DB3 : facture payée — child_id verrouillé', () => scoped(ids.orgA, (c) => expectReject(
    () => c.query(`UPDATE invoices SET child_id=$2 WHERE id=$1`, [ids.invA, ids.child2]), 'P0001')));
  await check('DB3 : facture payée — status→cancelled verrouillé', () => paidInvoice(`status='cancelled'`));
  // pdf_url est AUTORISÉ même sur facture payée : le worker génère/régénère
  // le document (job generate_invoice_pdf) après encaissement — ce n'est pas
  // du contenu financier (contrôle phase8 : « pdf_url renseigné sur la facture »).
  await check('DB3 : facture payée — pdf_url autorisé (génération PDF worker post-paiement)', async () => {
    await scoped(ids.orgA, async (c) => {
      const r = await c.query(`UPDATE invoices SET pdf_url='http://storage/inv.pdf' WHERE id=$1 RETURNING id`, [ids.invA]);
      assert.equal(r.rowCount, 1);
    });
  });
  await check('DB3 : facture payée — période verrouillée', () => paidInvoice(`period_month=12`));
  await check('DB3 : facture payée — notes verrouillées', () => paidInvoice(`notes='h2b'`));
  await check('DB3 : facture payée — updated_at (maintenance) autorisé', async () => {
    await scoped(ids.orgA, async (c) => {
      const r = await c.query(`UPDATE invoices SET updated_at=NOW() WHERE id=$1 RETURNING id`, [ids.invA]);
      assert.equal(r.rowCount, 1);
    });
  });
  await check('DB3 : facture brouillon — due_date + status libres', async () => {
    await scoped(ids.orgA, async (c) => {
      const r = await c.query(`UPDATE invoices SET due_date='2026-07-30', status='cancelled' WHERE id=$1 RETURNING id`, [ids.invD]);
      assert.equal(r.rowCount, 1);
    });
  });

  // ── DB3 : paiement confirmé immuable (sauf gateway_response) ──────────────
  const confirmedPayment = (set) => scoped(ids.orgA, (c) => expectReject(
    () => c.query(`UPDATE payments SET ${set} WHERE id=$1`, [ids.paid250]), 'P0001'));
  await check('DB3 : paiement confirmé — montant verrouillé', () => confirmedPayment(`amount=251`));
  await check('DB3 : paiement confirmé — méthode verrouillée', () => confirmedPayment(`method='bank_transfer'`));
  await check('DB3 : paiement confirmé — status verrouillé', () => confirmedPayment(`status='refunded'`));
  await check('DB3 : paiement confirmé — gateway_response autorisé', async () => {
    await scoped(ids.orgA, async (c) => {
      const r = await c.query(`UPDATE payments SET gateway_response='{"ok":true}' WHERE id=$1 RETURNING id`, [ids.paid250]);
      assert.equal(r.rowCount, 1);
    });
  });
  await check('DB3 : neutralisation anonymisation DPO (anonymize.sql:220) autorisée', async () => {
    // Rejeu exact de anonymize.sql:220 : les 3 colonnes neutralisées sont dans
    // la liste de maintenance du garde (métadonnées, pas contenu financier).
    const r = await db.query(`UPDATE payments SET external_reference=NULL, gateway_response=NULL, notes=NULL WHERE id=$1 RETURNING id`, [ids.paid250]);
    assert.equal(r.rowCount, 1);
  });
  await check('DB3 : paiement pending — montant modifiable', async () => {
    await scoped(ids.orgA, async (c) => {
      const r = await c.query(`UPDATE payments SET amount=60 WHERE id=$1 RETURNING id`, [ids.pend50]);
      assert.equal(r.rowCount, 1);
    });
  });

  // ── DB2 : modifications d'allocations bornées ─────────────────────────────
  const allocUpdate = (set) => scoped(ids.orgA, (c) => expectReject(
    () => c.query(`UPDATE payment_allocations SET ${set} WHERE payment_id=$1 AND invoice_id=$2`, [ids.paid250, ids.invA]), 'P0001'));
  await check('DB2 : allocation montant > paiement refusé', () => allocUpdate(`amount_allocated=140`));
  await check('DB2 : allocation re-ciblage hors plafond facture refusé', () => scoped(ids.orgA, (c) => expectReject(
    () => c.query(`UPDATE payment_allocations SET amount_allocated=120 WHERE payment_id=$1 AND invoice_id=$2`, [ids.paid250, ids.invA]), 'P0001')));
  await check('DB2 : allocation réduction dans les bornes autorisée', async () => {
    await scoped(ids.orgA, async (c) => {
      const r = await c.query(`UPDATE payment_allocations SET amount_allocated=80 WHERE payment_id=$1 AND invoice_id=$2 RETURNING id`, [ids.paid250, ids.invA]);
      assert.equal(r.rowCount, 1);
    });
  });
  await check("DB2 : allocation vers facture d'une autre organisation refusée (42501, SQL directe)", async () => {
    // Superuser sans tenant : la RLS ne joue pas, c'est le garde qui doit refuser.
    try {
      await db.query(`INSERT INTO payment_allocations(organization_id,payment_id,invoice_id,amount_allocated,allocated_by)
        VALUES($1,$2,$3,10,$4)`, [ids.orgA, ids.paid250, ids.invX, ids.user]);
      throw new Error('refus attendu (42501) — l\'allocation cross-tenant a réussi');
    } catch (e) {
      if (e.code === '42501') return;
      throw new Error(`code attendu 42501, reçu ${e.code} (${e.message})`);
    }
  });
  await check('DB2 : allocation sur paiement non confirmé refusé', async () => {
    await scoped(ids.orgA, (c) => expectReject(
      () => allocInsert(c, ids.pend50, ids.invC, 50), 'P0001'));
  });
  await check('DB2 : allocation INSERT dépassant le paiement refusé', async () => {
    // 220→200 après réduction (80+120) ; +60 = 260 > 250.
    await scoped(ids.orgA, (c) => expectReject(
      () => allocInsert(c, ids.paid250, ids.invC, 60), 'P0001'));
  });
  await check('DB2 : allocation INSERT valide (restant paiement) autorisée', async () => {
    // 200 + 30 = 230 ≤ 250 ; facture C paid 0 + 30 ≤ 100.
    await scoped(ids.orgA, async (c) => {
      const r = await allocInsert(c, ids.paid250, ids.invC, 30);
      assert.equal(r.rowCount, 1);
    });
  });
  // État avant course : 230 alloués sur 250 (restant 20).

  // ── DB2 : la course concurrente du rapport (trou 023) ─────────────────────
  // AVANT la correction : A (tx ouverte) alloue 20 sur C, B (autre facture D)
  // alloue 20 sans blocage (verrous factures différents), les deux commits
  // passent chacun leur contrôle (somme lise sans l'autre) → 250 alloués sur 250
  // alors que le paiement n'est que 250 avec 230 déjà alloués → sur-allocation.
  // APRÈS : B est bloqué sur le verrou du paiement, voit 250 committés, refusé.
  await check('DB2 : concurrence — 2e allocation sur le même paiement refusée après commit du 1er', async () => {
    const cA = await appClient();
    const cB = await appClient();
    try {
      await cA.query('BEGIN');
      await cA.query("SELECT set_config('app.tenant_id',$1,true)", [ids.orgA]);
      await allocInsert(cA, ids.paid250, ids.invC, 20); // 230 + 20 = 250 ≤ 250 (ne verrouille plus rien d'autre)
      await cB.query('BEGIN');
      await cB.query("SELECT set_config('app.tenant_id',$1,true)", [ids.orgA]);
      let bDone = null;
      const bPromise = allocInsert(cB, ids.paid250, ids.invD, 20) // doit bloquer sur le paiement
        .then(() => { bDone = 'committed'; })
        .catch((e) => { bDone = `rejected:${e.message}`; });
      await sleep(800);
      assert.equal(bDone, null, 'B doit être bloqué sur le verrou du paiement (pas encore exécuté)');
      await cA.query('COMMIT');
      await bPromise;
      assert.match(String(bDone), /^rejected:/, `B doit être refusé, reçu: ${bDone}`);
      assert.match(String(bDone), /EXCEEDS_PAYMENT/, `B doit être refusé pour sur-allocation, reçu: ${bDone}`);
    } finally {
      try { await cA.query('ROLLBACK'); } catch { /* déjà commit */ }
      try { await cB.query('ROLLBACK'); } catch { /* tx avortée par le refus */ }
      await cA.end(); await cB.end();
    }
  });

  // ── DB1 : index présent ───────────────────────────────────────────────────
  await check('DB1 : index invoice_lines(invoice_id) présent', async () => {
    const r = await db.query(`SELECT 1 FROM pg_indexes WHERE indexname='idx_invoice_lines_invoice'`);
    assert.equal(r.rowCount, 1);
  });
} finally {
  await db.end();
}
console.log(`phase44b: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
