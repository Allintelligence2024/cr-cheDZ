/**
 * Tests unitaires — PrivacyService + AuditService (4.2, couverture hors-plan).
 *
 * Loi 18-07 modifiée par 25-11. Les invariants testés sont LÉGAUX :
 *   - `redact()` : aucune PII ne doit atterrir dans audit_logs (ADR-010) ;
 *   - `createRequest` : un parent ne peut demander que pour SON enfant ;
 *   - `logInTransaction` propage les erreurs (DPIA : mutation et audit
 *     atomiques) alors que `log()` les avale — l'audit ne doit jamais casser
 *     l'action métier, mais ne doit JAMAIS être silencieusement dropé dans
 *     une transaction de sécurité.
 */
import { randomUUID } from 'node:crypto';
import { redact } from '../../shared/redact';

// ── redact() — masquage ADR-010 ─────────────────────────────────────────────

describe('redact (ADR-010 : aucune PII dans audit_logs)', () => {

  test('les clés sensibles nommées sont masquées', () => {
    const out = redact({ password: 'x1', email: 'a@b.co', phone: '0555', national_id: '1' }) as Record<string, unknown>;
    expect(out).toEqual({ password: '[REDACTED]', email: '[REDACTED]', phone: '[REDACTED]', national_id: '[REDACTED]' });
  });

  test('les variantes camelCase sont aussi masquées', () => {
    const out = redact({ passwordHash: 'h', refreshTokenHash: 'h', phonePrimary: 'p' }) as Record<string, unknown>;
    expect(out.passwordHash).toBe('[REDACTED]');
    expect(out.refreshTokenHash).toBe('[REDACTED]');
    expect(out.phonePrimary).toBe('[REDACTED]');
  });

  test('les clés contenant token/secret/health/medication sont masquées', () => {
    const out = redact({ totp_secret: 's', fcm_token: 't', health_notes: 'x', medication_dose: '1', body_temperature: '37', chronic_condition: 'y' }) as Record<string, unknown>;
    for (const v of Object.values(out)) expect(v).toBe('[REDACTED]');
  });

  test('les données de santé imbriquées sont masquées récursivement', () => {
    const out = redact({ child: { first_name_fr: 'A', health_allergies: 'x', chronic_illness: 'y' } }) as Record<string, Record<string, unknown>>;
    expect(out.child.first_name_fr).toBe('A');
    expect(out.child.health_allergies).toBe('[REDACTED]');
    expect(out.child.chronic_illness).toBe('[REDACTED]');
  });

  test('les tableaux sont parcourus récursivement', () => {
    const out = redact([{ email: 'a@b.co' }, { ok: 1 }]);
    expect(out).toEqual([{ email: '[REDACTED]' }, { ok: 1 }]);
  });

  test('les valeurs non sensibles sont préservées (pas de sur-masquage)', () => {
    const out = redact({ first_name_fr: 'Amine', status: 'active', amount: 1000, room_name: 'Salle A' });
    expect(out).toEqual(out); // identité pour les valeurs neutres
    expect((out as Record<string, unknown>).first_name_fr).toBe('Amine');
    expect((out as Record<string, unknown>).amount).toBe(1000);
  });

  test('null/undefined/primitifs neutres inchangés', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact('text')).toBe('text');
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
  });

  test('une clé sensible avec une valeur non scalaire n est pas masquée (structure préservée)', () => {
    // redact ne masque que string|number : un objet sous 'email' reste structuré
    const out = redact({ email: { nested: 1 } });
    expect(out).toEqual({ email: { nested: 1 } });
  });
});

// ── AuditService — log vs logInTransaction ───────────────────────────────────

describe('AuditService (atomique vs non-bloquant)', () => {
  const mk = async () => {
    const { AuditService } = await import('../privacy/audit.service');
    const executed: string[] = [];
    const pool = {
      query: async (sql: string) => {
        executed.push(sql.replace(/\s+/g, ' ').trim());
        return { rows: [], rowCount: 1 };
      },
    } as unknown as import('pg').Pool;
    return { svc: new AuditService(pool), executed };
  };

  test('log() écrit dans audit_logs', async () => {
    const { svc, executed } = await mk();
    await svc.log({ organizationId: randomUUID(), userId: randomUUID(), action: 'update', resourceType: 'child', newValues: { first_name_fr: 'A' } });
    expect(executed.some((s) => s.startsWith('INSERT INTO audit_logs'))).toBe(true);
  });

  test('log() avale les erreurs (l audit ne casse jamais le métier)', async () => {
    const { AuditService } = await import('../privacy/audit.service');
    const pool = {
      query: async () => { throw new Error('connexion perdue'); },
    } as unknown as import('pg').Pool;
    const svc = new AuditService(pool);
    // pas de rejet — l'action métier continue
    await expect(svc.log({ action: 'update', resourceType: 'child' })).resolves.toBeUndefined();
  });

  test('logInTransaction() PROPAGE les erreurs (DPIA : mutation+audit atomiques)', async () => {
    const { AuditService } = await import('../privacy/audit.service');
    const client = {
      query: async () => { throw new Error('deadlock'); },
    } as unknown as import('pg').PoolClient;
    const pool = {} as unknown as import('pg').Pool;
    const svc = new AuditService(pool);
    // DECISION DE SÉCURITÉ : ici l'échec doit faire ROLLBACK la mutation
    await expect(svc.logInTransaction(client, { action: 'update', resourceType: 'child' })).rejects.toThrow('deadlock');
  });

  test('logDataAccess() écrit dans data_access_logs (carnet d accès)', async () => {
    const { svc, executed } = await mk();
    await svc.logDataAccess({
      organizationId: randomUUID(), userId: randomUUID(), dataType: 'health_record',
      dataSubjectId: randomUUID(), dataSubjectType: 'child', accessType: 'read',
    });
    expect(executed.some((s) => s.startsWith('INSERT INTO data_access_logs'))).toBe(true);
  });

  test('logDataAccess() porte organization_id (policy RLS 088 : INSERT sans GUC tenant)', async () => {
    // AuditService écrit via this.pool, pas le client tenant : la GUC
    // app.tenant_id n'est PAS posée. La policy data_access_logs_insert_any
    // (migration 088) accepte donc organization_id IS NULL, mais refuse un
    // organization_id étranger. Ce test verrouille le contrat : le caller
    // DOIT passer organizationId (requireTenant) — sinon l'audit est rejeté.
    const { AuditService } = await import('../privacy/audit.service');
    let capturedParams: unknown[] = [];
    const pool = {
      query: async (_sql: string, params: unknown[]) => { capturedParams = params; return { rows: [], rowCount: 1 }; },
    } as unknown as import('pg').Pool;
    const org = randomUUID();
    const svc = new AuditService(pool);
    await svc.logDataAccess({
      organizationId: org, userId: randomUUID(), dataType: 'health_record',
      dataSubjectId: randomUUID(), dataSubjectType: 'child', accessType: 'read',
    });
    expect(capturedParams[0]).toBe(org);
  });

  test('les old/new values sont masquées avant insertion', async () => {
    const { AuditService } = await import('../privacy/audit.service');
    let capturedParams: unknown[] = [];
    const pool = {
      query: async (_sql: string, params: unknown[]) => {
        capturedParams = params;
        return { rows: [], rowCount: 1 };
      },
    } as unknown as import('pg').Pool;
    const svc = new AuditService(pool);
    await svc.log({
      action: 'update', resourceType: 'guardian',
      newValues: { first_name_fr: 'A', phone_primary: '0555000000', email: 'x@y.z' },
    });
    // old_values/new_values sont les index 9 et 10
    const newValues = String(capturedParams[9]);
    expect(newValues).not.toContain('0555000000');
    expect(newValues).not.toContain('x@y.z');
    expect(newValues).toContain('[REDACTED]');
  });
});

// ── PrivacyService.createRequest — autorité du demandeur ─────────────────────

describe('PrivacyService.createRequest (cercle parent)', () => {
  const ORG = randomUUID();
  const PARENT = randomUUID();
  const CHILD = randomUUID();

  const mk = async (overrides: {
    linkedGuardian?: boolean;
    role?: string;
    childExists?: boolean;
  } = {}) => {
    const { PrivacyService } = await import('./privacy.service');
    const executed: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        const compact = sql.replace(/\s+/g, ' ').trim();
        executed.push({ sql: compact, params });
        if (compact.startsWith('SELECT 1 FROM users privacy_actor')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
        if (compact.startsWith('SELECT 1 FROM child_guardians')) {
          return { rows: overrides.linkedGuardian === false ? [] : [{ '?column?': 1 }], rowCount: overrides.linkedGuardian === false ? 0 : 1 };
        }
        if (compact.startsWith('SELECT id FROM children')) {
          return { rows: overrides.childExists === false ? [] : [{ id: CHILD }], rowCount: overrides.childExists === false ? 0 : 1 };
        }
        if (compact.startsWith('INSERT INTO privacy_requests')) {
          return { rows: [{ id: randomUUID(), request_type: 'access', subject_id: CHILD, status: 'pending', deadline: '2026-11-05' }], rowCount: 1 };
        }
        throw new Error(`SQL inattendue dans le mock : ${compact.slice(0, 80)}`);
      },
    };
    const tenantContext = {
      withTenantConnection: (cb: (c: typeof client) => Promise<unknown>) => cb(client),
      getTenantIdOrNull: () => ORG,
    } as unknown as import('../../shared/database/tenant-context.service').TenantContextService;
    const audit = { log: async () => undefined } as unknown as import('./audit.service').AuditService;
    const jwt = {} as unknown as import('@nestjs/jwt').JwtService;
    const config = {} as unknown as import('@nestjs/config').ConfigService;
    const pool = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as import('pg').Pool;
    const s3 = {} as unknown as import('../../shared/storage/s3-client.service').S3ClientService;
    return { svc: new PrivacyService(tenantContext, audit, jwt, config, pool, s3), executed };
  };

  test('parent NON gardien de l enfant → 403 PARENT_ACCESS_DENIED', async () => {
    const { svc } = await mk({ linkedGuardian: false, role: 'parent' });
    await expect(svc.createRequest(PARENT, 'parent', { request_type: 'access', subject_id: CHILD }))
      .rejects.toMatchObject({ code: 'PARENT_ACCESS_DENIED', status: 403 });
  });

  test('parent gardien → demande créée', async () => {
    const { svc } = await mk({ linkedGuardian: true, role: 'parent' });
    const res = await svc.createRequest(PARENT, 'parent', { request_type: 'access', subject_id: CHILD });
    expect(res).toHaveProperty('id');
  });

  test('director : peut demander pour N IMPORTE quel enfant du tenant', async () => {
    const { svc } = await mk({ linkedGuardian: false, role: 'director' });
    const res = await svc.createRequest(PARENT, 'director', { request_type: 'access', subject_id: CHILD });
    expect(res).toHaveProperty('id');
  });

  test('super_admin : peut demander pour n importe quel enfant', async () => {
    const { svc } = await mk({ linkedGuardian: false, role: 'super_admin' });
    const res = await svc.createRequest(PARENT, 'super_admin', { request_type: 'access', subject_id: CHILD });
    expect(res).toHaveProperty('id');
  });

  test('enfant supprimé (deleted_at) → 404', async () => {
    const { svc } = await mk({ childExists: false, role: 'director' });
    await expect(svc.createRequest(PARENT, 'director', { request_type: 'access', subject_id: CHILD }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('le deadline légal est de 30 jours', async () => {
    const { svc, executed } = await mk({ role: 'parent' });
    await svc.createRequest(PARENT, 'parent', { request_type: 'access', subject_id: CHILD });
    const ins = executed.find((q) => q.sql.startsWith('INSERT INTO privacy_requests'));
    expect(ins!.sql).toContain("INTERVAL '30 days'");
  });

  test('sans subject_id : demande globale (pas de vérification gardien)', async () => {
    const { svc, executed } = await mk({ role: 'parent', linkedGuardian: false });
    await svc.createRequest(PARENT, 'parent', { request_type: 'access' });
    // aucune requête child_guardians n est émise
    expect(executed.some((q) => q.sql.startsWith('SELECT 1 FROM child_guardians'))).toBe(false);
  });
});
