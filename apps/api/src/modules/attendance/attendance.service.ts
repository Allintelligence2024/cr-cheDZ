import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import type { CommandResult } from './dto/attendance.dto';

interface ApplyParams {
  childId: string;
  siteId?: string | null;
  occurredAt: Date;
  recordedBy: string;
  deviceId?: string | null;
  syncEventId?: string | null;
}

/**
 * Machine à états de présence (append-only) :
 *
 *   expected ──check_in──▶ present ──check_out──▶ departed
 *      │  ▲                    │
 *      │  └──────check_in──────┘ (arrivée tardive)
 *      └──mark_absent──▶ absent ──check_in──▶ present
 *
 * - Les transitions illégales → INVALID_STATE_TRANSITION.
 * - Chaque transition écrit un événement immuable + une ligne sync_changelog
 *   DANS LA MÊME TRANSACTION (C02).
 * - session_date = date du jour à Africa/Algiers (jamais UTC).
 */
@Injectable()
export class AttendanceService {
  constructor(private readonly tenantContext: TenantContextService) {}

  // ── Flows HTTP (contexte tenant du JWT) ──────────────────────────────────

  async checkIn(userId: string, dto: { child_id: string; site_id?: string; occurred_at?: string }) {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const result = await this.applyCheckIn(client, {
        childId: dto.child_id,
        siteId: dto.site_id ?? null,
        occurredAt: dto.occurred_at ? new Date(dto.occurred_at) : new Date(),
        recordedBy: userId,
      });
      if (result.status !== 'accepted') this.throwCommand(result);
      return this.sessionFor(client, tenantId, dto.child_id);
    });
  }

  async checkOut(userId: string, dto: { child_id: string; occurred_at?: string }) {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const result = await this.applyCheckOut(client, {
        childId: dto.child_id,
        occurredAt: dto.occurred_at ? new Date(dto.occurred_at) : new Date(),
        recordedBy: userId,
      });
      if (result.status !== 'accepted') this.throwCommand(result);
      return this.sessionFor(client, this.tenantContext.getTenantId(), dto.child_id);
    });
  }

  async markAbsent(userId: string, dto: { child_id: string; reason?: string; occurred_at?: string }) {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const result = await this.applyMarkAbsent(client, {
        childId: dto.child_id,
        occurredAt: dto.occurred_at ? new Date(dto.occurred_at) : new Date(),
        recordedBy: userId,
        reason: dto.reason,
      });
      if (result.status !== 'accepted') this.throwCommand(result);
      return this.sessionFor(client, tenantId, dto.child_id);
    });
  }

  async correct(userId: string, dto: { child_id: string; action: string; reason: string; occurred_at?: string }) {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const result = await this.applyCorrection(client, {
        childId: dto.child_id,
        action: dto.action,
        reason: dto.reason,
        occurredAt: dto.occurred_at ? new Date(dto.occurred_at) : new Date(),
        recordedBy: userId,
      });
      if (result.status !== 'accepted') this.throwCommand(result);
      return this.sessionFor(client, tenantId, dto.child_id);
    });
  }

  /** Résumé des présences d'une salle (ou de tout le tenant) pour une date. */
  async summary(roomId?: string, date?: string): Promise<{ date: string; items: Array<Record<string, unknown>> }> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const day = date ?? (await this.todayInAlgiers(client));
      const params: unknown[] = [tenantId, day];
      let roomClause = '';
      if (roomId) {
        params.push(roomId);
        roomClause = `AND c.room_id = $${params.length}`;
      }
      const res = await client.query(
        `SELECT c.id AS child_id, c.reference_number,
                c.first_name_fr, c.last_name_fr, c.room_id,
                COALESCE(s.status, 'expected') AS status,
                s.expected_arrival, s.expected_departure,
                (SELECT e.occurred_at FROM attendance_events e
                  WHERE e.session_id = s.id AND e.event_type = 'check_in'
                  ORDER BY e.occurred_at LIMIT 1) AS check_in_at,
                (SELECT e.occurred_at FROM attendance_events e
                  WHERE e.session_id = s.id AND e.event_type = 'check_out'
                  ORDER BY e.occurred_at DESC LIMIT 1) AS check_out_at
         FROM children c
         LEFT JOIN attendance_sessions s
           ON s.child_id = c.id AND s.session_date = $2
         WHERE c.organization_id = $1
           AND c.deleted_at IS NULL
           AND c.status <> 'departed'
           ${roomClause}
         ORDER BY c.last_name_fr, c.first_name_fr`,
        params,
      );
      return { date: day, items: res.rows };
    });
  }

  // ── Cœur partagé avec le sync (transaction déjà ouverte) ─────────────────

  async applyCheckIn(client: PoolClient, p: ApplyParams): Promise<CommandResult> {
    const tenantId = this.tenantContext.getTenantId();
    const child = await this.childOfTenant(client, p.childId);
    if (!child) return this.rejected('PERMISSION_DENIED', 'Enfant introuvable dans cette organisation');

    const today = await this.todayInAlgiers(client);
    const session = await this.sessionForUpdate(client, p.childId, today);
    let sessionId: string;

    if (session) {
      if (session.status === 'present' || session.status === 'departed') {
        return this.rejected('INVALID_STATE_TRANSITION', `L'enfant est déjà ${session.status}`);
      }
      await client.query(
        `UPDATE attendance_sessions SET status = 'present', updated_at = NOW(), version = version + 1
         WHERE id = $1`,
        [session.id],
      );
      sessionId = session.id;
    } else {
      const created = await client.query(
        `INSERT INTO attendance_sessions
           (organization_id, site_id, room_id, child_id, session_date, status)
         VALUES ($1, $2, $3, $4, $5, 'present')
         RETURNING id`,
        [tenantId, p.siteId ?? child.site_id, child.room_id, p.childId, today],
      );
      sessionId = created.rows[0].id;
    }

    await this.insertEvent(client, {
      tenantId, sessionId, childId: p.childId, eventType: 'check_in',
      occurredAt: p.occurredAt, recordedBy: p.recordedBy,
      deviceId: p.deviceId, syncEventId: p.syncEventId,
    });
    await this.writeChangelog(client, tenantId, 'attendance', p.childId, 'check_in', {
      child_id: p.childId, session_id: sessionId, session_date: today,
      status: 'present', occurred_at: p.occurredAt.toISOString(),
    }, p.deviceId);
    // Notification parent — Phase 7 (le worker consommera ce job).
    await client.query(
      `INSERT INTO background_jobs (organization_id, job_type, payload, priority)
       VALUES ($1, 'send_parent_notification', $2, 1)`,
      [tenantId, JSON.stringify({ child_id: p.childId, event_type: 'check_in' })],
    );
    return { status: 'accepted' };
  }

  async applyCheckOut(client: PoolClient, p: ApplyParams): Promise<CommandResult> {
    const tenantId = this.tenantContext.getTenantId();
    const child = await this.childOfTenant(client, p.childId);
    if (!child) return this.rejected('PERMISSION_DENIED', 'Enfant introuvable dans cette organisation');

    const today = await this.todayInAlgiers(client);
    const session = await this.sessionForUpdate(client, p.childId, today);
    if (!session || session.status !== 'present') {
      return this.rejected('INVALID_STATE_TRANSITION', 'Départ impossible : l\'enfant n\'est pas présent');
    }
    await client.query(
      `UPDATE attendance_sessions SET status = 'departed', updated_at = NOW(), version = version + 1
       WHERE id = $1`,
      [session.id],
    );
    await this.insertEvent(client, {
      tenantId, sessionId: session.id, childId: p.childId, eventType: 'check_out',
      occurredAt: p.occurredAt, recordedBy: p.recordedBy,
      deviceId: p.deviceId, syncEventId: p.syncEventId,
    });
    await this.writeChangelog(client, tenantId, 'attendance', p.childId, 'check_out', {
      child_id: p.childId, session_id: session.id, session_date: today,
      status: 'departed', occurred_at: p.occurredAt.toISOString(),
    }, p.deviceId);
    return { status: 'accepted' };
  }

  async applyMarkAbsent(client: PoolClient, p: ApplyParams & { reason?: string }): Promise<CommandResult> {
    const tenantId = this.tenantContext.getTenantId();
    const child = await this.childOfTenant(client, p.childId);
    if (!child) return this.rejected('PERMISSION_DENIED', 'Enfant introuvable dans cette organisation');

    const today = await this.todayInAlgiers(client);
    const session = await this.sessionForUpdate(client, p.childId, today);
    if (session && (session.status === 'present' || session.status === 'departed')) {
      return this.rejected('INVALID_STATE_TRANSITION', `L'enfant est déjà ${session.status}`);
    }
    let sessionId = session?.id ?? null;
    if (!sessionId) {
      const created = await client.query(
        `INSERT INTO attendance_sessions
           (organization_id, site_id, room_id, child_id, session_date, status)
         VALUES ($1, $2, $3, $4, $5, 'absent')
         RETURNING id`,
        [tenantId, child.site_id, child.room_id, p.childId, today],
      );
      sessionId = created.rows[0].id;
    } else {
      await client.query(
        `UPDATE attendance_sessions SET status = 'absent', updated_at = NOW(), version = version + 1
         WHERE id = $1`,
        [sessionId],
      );
    }
    await this.insertEvent(client, {
      tenantId, sessionId, childId: p.childId, eventType: 'absence_declared',
      occurredAt: p.occurredAt, recordedBy: p.recordedBy,
      deviceId: p.deviceId, syncEventId: p.syncEventId,
      extra: p.reason ? { absence_reason: p.reason } : undefined,
    });
    await this.writeChangelog(client, tenantId, 'attendance', p.childId, 'absence_declared', {
      child_id: p.childId, session_id: sessionId, session_date: today,
      status: 'absent', occurred_at: p.occurredAt.toISOString(),
    }, p.deviceId);
    return { status: 'accepted' };
  }

  /** Correction tracée : force un statut + événement 'correction'. */
  async applyCorrection(
    client: PoolClient,
    p: ApplyParams & { action: string; reason: string },
  ): Promise<CommandResult> {
    const tenantId = this.tenantContext.getTenantId();
    const child = await this.childOfTenant(client, p.childId);
    if (!child) return this.rejected('PERMISSION_DENIED', 'Enfant introuvable dans cette organisation');

    const target: Record<string, string> = {
      check_in: 'present',
      check_out: 'departed',
      absent: 'absent',
    };
    const status = target[p.action];
    if (!status) return this.rejected('UNKNOWN_COMMAND', `Action de correction inconnue: ${p.action}`);

    const today = await this.todayInAlgiers(client);
    const session = await this.sessionForUpdate(client, p.childId, today);
    let sessionId = session?.id ?? null;
    if (!sessionId) {
      const created = await client.query(
        `INSERT INTO attendance_sessions
           (organization_id, site_id, room_id, child_id, session_date, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, version`,
        [tenantId, child.site_id, child.room_id, p.childId, today, status],
      );
      sessionId = created.rows[0].id;
    } else {
      await client.query(
        `UPDATE attendance_sessions SET status = $2, updated_at = NOW(), version = version + 1
         WHERE id = $1`,
        [sessionId, status],
      );
    }
    await this.insertEvent(client, {
      tenantId, sessionId, childId: p.childId, eventType: 'correction',
      occurredAt: p.occurredAt, recordedBy: p.recordedBy,
      deviceId: p.deviceId, syncEventId: p.syncEventId,
      extra: { correction_reason: p.reason },
    });
    await this.writeChangelog(client, tenantId, 'attendance', p.childId, 'correction', {
      child_id: p.childId, session_id: sessionId, session_date: today,
      status, action: p.action, reason: p.reason,
    }, p.deviceId);
    return { status: 'accepted' };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async childOfTenant(client: PoolClient, childId: string): Promise<{ id: string; site_id: string; room_id: string | null } | null> {
    // RLS : un enfant d'un autre tenant → 0 ligne.
    const res = await client.query(
      `SELECT id, site_id, room_id FROM children WHERE id = $1 AND deleted_at IS NULL`,
      [childId],
    );
    return res.rows[0] ?? null;
  }

  private async sessionForUpdate(client: PoolClient, childId: string, date: string) {
    const res = await client.query(
      `SELECT id, status FROM attendance_sessions
       WHERE child_id = $1 AND session_date = $2 FOR UPDATE`,
      [childId, date],
    );
    return res.rows[0] ?? null;
  }

  private async sessionFor(client: PoolClient, tenantId: string, childId: string) {
    const res = await client.query(
      `SELECT id, child_id, site_id, room_id, session_date, status, version
       FROM attendance_sessions WHERE child_id = $1 AND organization_id = $2
       ORDER BY session_date DESC LIMIT 1`,
      [childId, tenantId],
    );
    return res.rows[0] ?? null;
  }

  private async insertEvent(
    client: PoolClient,
    p: {
      tenantId: string; sessionId: string; childId: string; eventType: string;
      occurredAt: Date; recordedBy: string; deviceId?: string | null;
      syncEventId?: string | null; extra?: Record<string, string>;
    },
  ): Promise<void> {
    const extra = p.extra ?? {};
    await client.query(
      `INSERT INTO attendance_events
         (organization_id, session_id, child_id, event_type, occurred_at,
          recorded_by, device_id, sync_event_id, is_offline,
          absence_reason, correction_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        p.tenantId, p.sessionId, p.childId, p.eventType, p.occurredAt,
        p.recordedBy, p.deviceId ?? null, p.syncEventId ?? null, p.syncEventId != null,
        extra.absence_reason ?? null, extra.correction_reason ?? null,
      ],
    );
  }

  private async writeChangelog(
    client: PoolClient,
    tenantId: string,
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    payload: Record<string, unknown>,
    originDeviceId?: string | null,
  ): Promise<void> {
    await client.query(
      `INSERT INTO sync_changelog
         (organization_id, aggregate_type, aggregate_id, event_type, payload, origin_device_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, aggregateType, aggregateId, eventType, JSON.stringify(payload), originDeviceId ?? null],
    );
  }

  private async todayInAlgiers(client?: PoolClient): Promise<string> {
    // Date du jour au fuseau de l'établissement (jamais UTC).
    if (client) {
      const res = await client.query(`SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date AS d`);
      return res.rows[0].d as string;
    }
    const now = new Date(Date.now() + 60 * 60 * 1000);
    return now.toISOString().slice(0, 10);
  }

  private rejected(reason: string, message: string): CommandResult {
    return { status: 'rejected', reason, message };
  }

  private throwCommand(result: CommandResult): never {
    if (result.reason === 'INVALID_STATE_TRANSITION') {
      throw new AppError(
        'INVALID_STATE_TRANSITION',
        result.message ?? 'Transition d\'état invalide',
        'انتقال حالة غير صالح',
        409,
      );
    }
    throw Errors.notFound();
  }
}
