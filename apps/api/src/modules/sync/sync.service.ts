import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { AppError } from '../../shared/errors';
import { AttendanceService } from '../attendance/attendance.service';
import { JournalService } from '../journal/journal.service';
import { MediaService } from '../media/media.service';
import type { SyncOperationDto, SyncPushResult } from './dto/sync.dto';

const MAX_PULL_BATCH = 500;
const DEVICE_TIME_TOLERANCE_MS = 5 * 60 * 1000; // ±5 min

interface CommandOutcome {
  status: 'accepted' | 'rejected' | 'conflict';
  reason?: string;
  message?: string;
  currentVersion?: number;
}

/**
 * Synchronisation offline (Partie 3.4 réécrite avec C02).
 *
 * push  : chaque opération est traitée dans SA propre transaction :
 *         vérification appareil → dédup par event_id → heure appareil →
 *         commande métier (état) → sync_changelog écrit dans la même
 *         transaction → statut sync_operations.
 * pull  : événements du sync_changelog depuis le curseur (sync_seq),
 *         lot de 500 ; curseur persisté par appareil (sync_cursors).
 *
 * SÉCURITÉ : toute lecture d'un enfant se fait sous RLS tenant — une
 * opération visant un enfant d'une autre organisation → PERMISSION_DENIED.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly attendance: AttendanceService,
    private readonly journal: JournalService,
    private readonly media: MediaService,
  ) {}

  async push(deviceId: string, userId: string, operations: SyncOperationDto[]): Promise<SyncPushResult> {
    const tenantId = this.tenantContext.getTenantId();
    const result: SyncPushResult = { accepted: [], rejected: [], conflicts: [], next_cursor: 0 };

    for (const op of operations) {
      try {
        await this.processOperation(op, userId, deviceId, result, tenantId);
      } catch {
        // Une opération ne doit jamais faire échouer le lot entier.
        result.rejected.push({
          event_id: op.event_id,
          reason: 'INTERNAL_ERROR',
          message: 'Erreur interne, réessayez',
        });
      }
    }
    result.next_cursor = await this.currentMaxSeq(tenantId);
    return result;
  }

  private async processOperation(
    op: SyncOperationDto,
    userId: string,
    deviceId: string,
    result: SyncPushResult,
    tenantId: string,
  ): Promise<void> {
    await this.tenantContext.withTenantConnection(async (client) => {
      // 0. Commande connue (avant tout INSERT : l'enum DB rejetterait sinon)
      if (!this.isKnownCommand(op.command)) {
        result.rejected.push({
          event_id: op.event_id,
          reason: 'UNKNOWN_COMMAND',
          message: `Commande ${op.command} inconnue`,
        });
        return;
      }
      // 1. Version de schéma
      if (op.schema_version > 1) {
        result.rejected.push({
          event_id: op.event_id,
          reason: 'UNSUPPORTED_SCHEMA_VERSION',
          message: `Version ${op.schema_version} non supportée`,
        });
        return;
      }
      // 2. Appareil actif (RLS : appareil du tenant courant)
      const dev = await client.query(
        `SELECT id FROM devices WHERE id = $1 AND is_active = true AND revoked_at IS NULL`,
        [deviceId],
      );
      if (dev.rows.length === 0) {
        result.rejected.push({
          event_id: op.event_id,
          reason: 'DEVICE_REVOKED',
          message: 'Appareil révoqué ou inconnu',
        });
        return;
      }
      // 3. Déduplication par event_id (idempotence)
      const existing = await client.query(
        `SELECT status FROM sync_operations WHERE event_id = $1`,
        [op.event_id],
      );
      if (existing.rows.length > 0) {
        if (existing.rows[0].status === 'accepted') {
          result.accepted.push(op.event_id);
        } else {
          result.rejected.push({
            event_id: op.event_id,
            reason: 'ALREADY_PROCESSED',
            message: 'Opération déjà traitée',
          });
        }
        return;
      }
      // 4. Heure appareil cohérente (trop dans le futur → rejet)
      const deviceTime = new Date(op.occurred_at_device);
      if (Number.isNaN(deviceTime.getTime())) {
        result.rejected.push({ event_id: op.event_id, reason: 'INVALID_DEVICE_TIME', message: 'Heure appareil invalide' });
        return;
      }
      if (deviceTime.getTime() > Date.now() + DEVICE_TIME_TOLERANCE_MS) {
        result.rejected.push({ event_id: op.event_id, reason: 'DEVICE_TIME_AHEAD', message: 'Heure appareil dans le futur' });
        return;
      }
      // 5. Enregistrer l'opération (processing)
      await client.query(
        `INSERT INTO sync_operations
           (organization_id, device_id, user_id, event_id, client_sequence,
            schema_version, command, entity_type, entity_id, payload,
            base_version, occurred_at_device, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'processing')`,
        [
          tenantId, deviceId, userId, op.event_id, op.client_sequence,
          op.schema_version, op.command, op.entity_type, op.entity_id ?? null,
          JSON.stringify(op.payload), op.base_version ?? null, op.occurred_at_device,
        ],
      );
      // 6. Appliquer la commande
      const outcome = await this.applyCommand(client, op, userId, deviceId);
      // 7. Statut final
      await client.query(
        `UPDATE sync_operations SET status = $1, processed_at = NOW(), rejection_reason = $2
         WHERE event_id = $3`,
        [outcome.status, outcome.reason ?? null, op.event_id],
      );

      if (outcome.status === 'accepted') {
        result.accepted.push(op.event_id);
      } else if (outcome.status === 'conflict') {
        result.conflicts.push({
          event_id: op.event_id,
          reason: outcome.reason ?? 'CONFLICT',
          current_version: outcome.currentVersion ?? 0,
        });
      } else {
        result.rejected.push({
          event_id: op.event_id,
          reason: outcome.reason ?? 'REJECTED',
          message: outcome.message ?? 'Opération rejetée',
        });
      }
    });
  }

  private isKnownCommand(command: string): boolean {
    return [
      'check_in', 'check_out', 'mark_absent',
      'log_meal', 'log_nap_start', 'log_nap_end', 'log_diaper',
      'log_activity', 'log_temperature', 'log_note',
      'add_photo', 'log_incident', 'correct_attendance',
    ].includes(command);
  }

  private async applyCommand(
    client: PoolClient,
    op: SyncOperationDto,
    userId: string,
    deviceId: string,
  ): Promise<CommandOutcome> {
    const payload = op.payload as Record<string, unknown>;
    const occurredAt = new Date(op.occurred_at_device);
    const base = {
      childId: payload.child_id as string,
      siteId: (payload.site_id as string | undefined) ?? null,
      occurredAt,
      recordedBy: userId,
      deviceId,
      syncEventId: op.event_id,
    };

    switch (op.command) {
      case 'check_in':
        return this.attendance.applyCheckIn(client, base);
      case 'check_out':
        return this.attendance.applyCheckOut(client, base);
      case 'mark_absent':
        return this.attendance.applyMarkAbsent(client, { ...base, reason: payload.reason as string | undefined });
      case 'correct_attendance': {
        const outcome = await this.attendance.applyCorrection(client, {
          ...base,
          action: payload.action as string,
          reason: (payload.reason as string) ?? 'correction_sync',
        });
        // Conflit optimiste : base_version de la session attendue.
        if (op.base_version !== undefined && outcome.status === 'accepted') {
          const session = await client.query(
            `SELECT version FROM attendance_sessions WHERE child_id = $1 AND session_date =
               (SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date)`,
            [payload.child_id],
          );
          if (session.rows.length > 0 && session.rows[0].version !== op.base_version) {
            return {
              status: 'conflict',
              reason: 'VERSION_MISMATCH',
              currentVersion: session.rows[0].version,
            };
          }
        }
        return outcome;
      }
      case 'log_meal':
      case 'log_nap_start':
      case 'log_nap_end':
      case 'log_diaper':
      case 'log_activity':
      case 'log_temperature':
      case 'log_note':
      case 'log_incident':
        return this.applyDailyLog(client, op, base);
      case 'add_photo':
        return this.applyAddPhoto(client, op, base);
      default:
        return { status: 'rejected', reason: 'UNKNOWN_COMMAND', message: `Commande ${op.command} inconnue` };
    }
  }

  /** Événements de journal quotidien — délègue à JournalService (append-only). */
  private async applyDailyLog(
    client: PoolClient,
    op: SyncOperationDto,
    base: { childId: string; siteId?: string | null; occurredAt: Date; recordedBy: string; deviceId?: string | null; syncEventId?: string | null },
  ): Promise<CommandOutcome> {
    const tenantId = this.tenantContext.getTenantId();
    const p = op.payload as Record<string, unknown>;

    // L'enfant doit appartenir au tenant (RLS).
    const child = await client.query(
      `SELECT id FROM children WHERE id = $1 AND deleted_at IS NULL`,
      [base.childId],
    );
    if (child.rows.length === 0) {
      return { status: 'rejected', reason: 'PERMISSION_DENIED', message: 'Enfant introuvable dans cette organisation' };
    }

    const eventType = op.command.replace('log_', '');
    const fields: Record<string, unknown> = {
      meal_type: p.meal_type, meal_quantity: p.meal_quantity, meal_notes: p.meal_notes,
      nap_start_at: p.nap_start_at, nap_end_at: p.nap_end_at, nap_quality: p.nap_quality,
      diaper_type: p.diaper_type, temperature_celsius: p.temperature_celsius,
      health_observation: p.health_observation,
      activity_name: p.activity_name, activity_notes: p.activity_notes,
      note_text: p.note_text,
      incident_severity: p.incident_severity, incident_description: p.incident_description,
      incident_action: p.incident_action,
    };
    try {
      await this.journal.insertEvent(client, tenantId, {
        childId: base.childId,
        eventType,
        occurredAt: base.occurredAt,
        recordedBy: base.recordedBy,
        deviceId: base.deviceId,
        syncEventId: base.syncEventId,
        isOffline: true,
        fields,
      });
      return { status: 'accepted' };
    } catch {
      return { status: 'rejected', reason: 'INTERNAL_ERROR', message: 'Erreur lors de l\'écriture du journal' };
    }
  }

  /** Photo offline : enregistre l'asset (jamais visible sans consentement). */
  private async applyAddPhoto(
    client: PoolClient,
    op: SyncOperationDto,
    base: { childId: string; siteId?: string | null; occurredAt: Date; recordedBy: string; deviceId?: string | null; syncEventId?: string | null },
  ): Promise<CommandOutcome> {
    const tenantId = this.tenantContext.getTenantId();
    const p = op.payload as Record<string, unknown>;
    const child = await client.query(
      `SELECT id FROM children WHERE id = $1 AND deleted_at IS NULL`,
      [base.childId],
    );
    if (child.rows.length === 0) {
      return { status: 'rejected', reason: 'PERMISSION_DENIED', message: 'Enfant introuvable dans cette organisation' };
    }
    if (!p.storage_key || !p.mime_type) {
      return { status: 'rejected', reason: 'MISSING_FIELDS', message: 'storage_key et mime_type requis' };
    }
    try {
      await this.media.registerFromSync(client, tenantId, {
        childId: base.childId,
        userId: base.recordedBy,
        deviceId: base.deviceId,
        syncEventId: base.syncEventId,
        storageKey: p.storage_key as string,
        mimeType: p.mime_type as string,
        takenAt: (p.taken_at as string | undefined) ?? base.occurredAt.toISOString(),
        checksum: p.checksum as string | undefined,
        childrenInPhoto: p.children_in_photo as string[] | undefined,
      });
      return { status: 'accepted' };
    } catch {
      return { status: 'rejected', reason: 'INTERNAL_ERROR', message: 'Erreur lors de l\'enregistrement de la photo' };
    }
  }

  // ── Pull ─────────────────────────────────────────────────────────────────

  async pull(cursor: number, deviceId: string): Promise<{ events: Array<Record<string, unknown>>; next_cursor: number }> {
    const tenantId = this.tenantContext.getTenantId();
    return this.tenantContext.withTenantConnection(async (client) => {
      const dev = await client.query(
        `SELECT id FROM devices WHERE id = $1 AND is_active = true AND revoked_at IS NULL`,
        [deviceId],
      );
      if (dev.rows.length === 0) {
        throw new AppError('DEVICE_REVOKED', 'Appareil révoqué ou inconnu', 'تم إلغاء الجهاز', 403);
      }

      const res = await client.query(
        `SELECT sync_seq, aggregate_type AS type, aggregate_id, event_type, payload, created_at
         FROM sync_changelog
         WHERE organization_id = $1 AND sync_seq > $2
         ORDER BY sync_seq
         LIMIT ${MAX_PULL_BATCH}`,
        [tenantId, cursor],
      );
      const events = res.rows;
      const nextCursor = events.length > 0 ? (events[events.length - 1].sync_seq as number) : cursor;

      await client.query(
        `INSERT INTO sync_cursors (device_id, organization_id, cursor_value, last_sync_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (device_id, organization_id) DO UPDATE SET
           cursor_value = EXCLUDED.cursor_value, last_sync_at = NOW()`,
        [deviceId, tenantId, nextCursor],
      );
      return { events, next_cursor: nextCursor };
    });
  }

  private async currentMaxSeq(tenantId: string): Promise<number> {
    // Connexion avec contexte tenant (jamais la pool brute sur une table RLS).
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT COALESCE(MAX(sync_seq), 0)::int AS m FROM sync_changelog WHERE organization_id = $1`,
        [tenantId],
      );
      return res.rows[0].m as number;
    });
  }
}
