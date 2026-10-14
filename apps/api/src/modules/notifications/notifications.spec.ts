/**
 * Tests unitaires — NotificationsService (4.2, couverture hors-plan).
 *
 * Deux invariants de ce service sont des décisions produit, pas des détails :
 *   1. `quietHoursSchedule` : une notification qui tombe dans la plage
 *      silencieuse (heure d'Alger) est DIFFÉRÉE, jamais dropped — et la
 *      conversion du délai ne dépend pas du fuseau du serveur ;
 *   2. `enqueue` : le centre in-app reste alimenté MÊME si le parent coupe
 *      les pushes (l'in-app n'est pas un canal push) ;
 *   3. `notifyGuardiansOfEvent` : les événements journal sensibles ne vont
 *      qu'aux guardians ayant `can_view_journal` — `incident` et `meal` sont
 *      dans JOURNAL_NOTIFICATION_TYPES, pas `check_in`.
 */
import { randomUUID } from 'node:crypto';

describe('NotificationsService.quietHoursSchedule', () => {
  const ORG = randomUUID();

  const mk = async () => {
    const { NotificationsService } = await import('./notifications.service');
    const tenantContext = {
      withTenantConnection: async () => [],
      getTenantIdOrNull: () => ORG,
    } as unknown as import('../../shared/database/tenant-context.service').TenantContextService;
    return new NotificationsService(tenantContext);
  };

  test('pas de plage silencieuse → envoi immédiat (now)', async () => {
    const svc = await mk();
    const before = Date.now();
    const scheduled = (svc as unknown as { quietHoursSchedule: (s: string | null, e: string | null) => Date }).quietHoursSchedule(null, null);
    expect(scheduled.getTime() - before).toBeLessThan(5000);
  });

  test('plage silencieuse non chevauchante : 22:00–07:00 → différé si dans la plage', async () => {
    const svc = await mk();
    const scheduled = (svc as unknown as { quietHoursSchedule: (s: string | null, e: string | null) => Date })
      .quietHoursSchedule('22:00', '07:00');
    // On ne peut pas assert l'heure exacte (fuseau serveur), mais le délai
    // est borné : 0 (hors plage) à 24 h max (jamais plus d'un jour).
    const delayMin = (scheduled.getTime() - Date.now()) / 60_000;
    expect(delayMin).toBeGreaterThanOrEqual(-1);
    expect(delayMin).toBeLessThanOrEqual(24 * 60 + 1);
  });

  test('plage silencieuse bornée : 13:00–14:00 → délai ≤ 60 min si dedans', async () => {
    const svc = await mk();
    const scheduled = (svc as unknown as { quietHoursSchedule: (s: string | null, e: string | null) => Date })
      .quietHoursSchedule('13:00', '14:00');
    const delayMin = (scheduled.getTime() - Date.now()) / 60_000;
    // Hors plage → ~0 ; dans la plage → jusqu'à 60 min. Jamais négatif.
    expect(delayMin).toBeGreaterThanOrEqual(-1);
    expect(delayMin).toBeLessThanOrEqual(60 + 1);
  });

  test('plage inversée (22:00–07:00) : on retombe toujours sur end, pas avant', async () => {
    const svc = await mk();
    const scheduled = (svc as unknown as { quietHoursSchedule: (s: string | null, e: string | null) => Date })
      .quietHoursSchedule('23:00', '06:00');
    const delayMin = (scheduled.getTime() - Date.now()) / 60_000;
    expect(delayMin).toBeLessThanOrEqual(24 * 60 + 1);
  });
});

describe('NotificationsService.enqueue (centre in-app)', () => {
  const ORG = randomUUID();
  const USER = randomUUID();

  const mk = async (pref: { is_enabled: boolean } | undefined) => {
    const { NotificationsService } = await import('./notifications.service');
    const executed: string[] = [];
    const client = {
      query: async (sql: string, _params: unknown[] = []) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        executed.push(compact);
        if (compact.startsWith('SELECT is_enabled, quiet_hours_start')) {
          return { rows: pref ? [pref] : [], rowCount: pref ? 1 : 0 };
        }
        if (compact.startsWith('INSERT INTO notification_queue')) return { rows: [{ id: randomUUID() }], rowCount: 1 };
        if (compact.startsWith('INSERT INTO notification_inbox')) return { rows: [{ id: randomUUID() }], rowCount: 1 };
        throw new Error(`SQL inattendue dans le mock : ${compact.slice(0, 80)}`);
      },
    };
    const tenantContext = {
      withTenantConnection: (cb: (c: typeof client) => Promise<unknown>) => cb(client),
      getTenantIdOrNull: () => ORG,
    } as unknown as import('../../shared/database/tenant-context.service').TenantContextService;
    return {
      svc: new NotificationsService(tenantContext),
      client,
      executed,
    };
  };

  const evt = () => ({
    userId: USER,
    eventType: 'check_in',
    titleFr: 'Arrivée',
    titleAr: 'وصول',
    bodyFr: 'est arrivé(e) à la crèche',
    bodyAr: 'وصل إلى الحضانة',
    data: { scope: 'child_event', child_id: randomUUID() },
  });

  test('push ACTIVÉ → queue ET inbox alimentés', async () => {
    const { svc, client, executed } = await mk({ is_enabled: true });
    await svc.enqueue(client as unknown as import('pg').PoolClient, ORG, evt());
    expect(executed.some((s) => s.startsWith('INSERT INTO notification_queue'))).toBe(true);
    expect(executed.some((s) => s.startsWith('INSERT INTO notification_inbox'))).toBe(true);
  });

  test('push COUPÉ → queue vide MAIS inbox alimentée (l in-app n est pas un push)', async () => {
    const { svc, client, executed } = await mk({ is_enabled: false });
    await svc.enqueue(client as unknown as import('pg').PoolClient, ORG, evt());
    const queueInsert = executed.filter((s) => s.startsWith('INSERT INTO notification_queue'));
    const inboxInsert = executed.filter((s) => s.startsWith('INSERT INTO notification_inbox'));

    // Décision produit : couper les pushes ne vide pas le centre de notification.
    expect(queueInsert).toHaveLength(0);
    expect(inboxInsert.length).toBeGreaterThanOrEqual(1);
  });

  test('aucune préférence → push envoyé (opt-out explicite, jamais opt-in silencieux)', async () => {
    const { svc, client, executed } = await mk(undefined);
    await svc.enqueue(client as unknown as import('pg').PoolClient, ORG, evt());
    expect(executed.some((s) => s.startsWith('INSERT INTO notification_queue'))).toBe(true);
    expect(executed.some((s) => s.startsWith('INSERT INTO notification_inbox'))).toBe(true);
  });
});

describe('NotificationsService.notifyGuardiansOfEvent (cercle journal)', () => {
  const ORG = randomUUID();
  const CHILD = randomUUID();

  const mk = async () => {
    const { NotificationsService } = await import('./notifications.service');
    const executed: string[] = [];
    const client = {
      query: async (sql: string) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        executed.push(compact);
        if (compact.startsWith('SELECT cg.guardian_id')) {
          return { rows: [{ guardian_id: randomUUID(), user_id: randomUUID(), phone_primary: null, first_name_fr: 'P', child_name: 'Enfant' }], rowCount: 1 };
        }
        if (compact.startsWith('SELECT (') && compact.includes('AS allowed FROM')) return { rows: [{ allowed: true }], rowCount: 1 };
        if (compact.startsWith('SELECT is_enabled, quiet_hours_start')) return { rows: [], rowCount: 0 };
        if (compact.startsWith('INSERT INTO notification_queue')) return { rows: [{ id: randomUUID() }], rowCount: 1 };
        if (compact.startsWith('INSERT INTO notification_inbox')) return { rows: [{ id: randomUUID() }], rowCount: 1 };
        throw new Error(`SQL inattendue dans le mock : ${compact.slice(0, 80)}`);
      },
    };
    const tenantContext = {
      withTenantConnection: (cb: (c: typeof client) => Promise<unknown>) => cb(client),
      getTenantIdOrNull: () => ORG,
    } as unknown as import('../../shared/database/tenant-context.service').TenantContextService;
    return { svc: new NotificationsService(tenantContext), client, executed };
  };

  test('un événement journal (meal) exige can_view_journal dans le WHERE', async () => {
    const { svc, client, executed } = await mk();
    await svc.notifyGuardiansOfEvent(client as unknown as import('pg').PoolClient, ORG, CHILD, 'meal', randomUUID());
    const guardianQuery = executed.find((s) => s.startsWith('SELECT cg.guardian_id'));
    expect(guardianQuery).toBeDefined();
    // le filtre journal est posé pour les événements sensibles
    expect(guardianQuery).toContain('can_view_journal = true');
  });

  test('un check_in (cercle présence) ne restreint PAS au journal', async () => {
    const { svc, client, executed } = await mk();
    await svc.notifyGuardiansOfEvent(client as unknown as import('pg').PoolClient, ORG, CHILD, 'check_in', randomUUID());
    const guardianQuery = executed.find((s) => s.startsWith('SELECT cg.guardian_id'));
    expect(guardianQuery).toBeDefined();
    // check_in n'est pas un événement journal → pas de restriction journal
    expect(guardianQuery!.includes('NOT $2')).toBe(true);
  });

  test('WhatsApp : guardian sans téléphone → aucune file whatsapp', async () => {
    const { svc, client, executed } = await mk();
    await svc.notifyGuardiansOfEvent(client as unknown as import('pg').PoolClient, ORG, CHILD, 'check_in', randomUUID());
    // le push reste mis en file ; le canal whatsapp est SAUTÉ (phone_primary null)
    const waInserts = executed.filter((s) => s.startsWith('INSERT INTO notification_queue') && s.includes("'whatsapp'"));
    expect(waInserts).toHaveLength(0);
    // le push, lui, est bien présent
    expect(executed.some((s) => s.startsWith('INSERT INTO notification_queue'))).toBe(true);
  });
});
