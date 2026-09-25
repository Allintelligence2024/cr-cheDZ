import { isDeepStrictEqual } from 'node:util';
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

/**
 * Les OCTETS ne passent pas par la file de synchronisation (décision D6 du plan
 * de réparation ; audit 2026-09-24, constat 33 : « photos offline en base64 en
 * clair »).
 *
 * Pourquoi un refus explicite ici — et pas un simple « champ ignoré » :
 *  - `sync_operations.payload` est stockée **verbatim** en JSONB : un client qui
 *    met une photo en base64 dans le payload la ferait **persister côté serveur**,
 *    hors du pipeline média (consentements, `is_visible_to_parents`, journal des
 *    accès) et hors de toute purge dédiée — une donnée d'enfant non voulue dans
 *    l'historique de synchronisation ;
 *  - le handler `add_photo` ne consomme PAS ce champ : l'accepter donnerait un
 *    « accepted » trompeur (l'asset existerait sans octets, lecture 404) ;
 *  - le chemin correct existe : `POST /api/v1/media/upload` (lot 2B) — l'API
 *    écrit les octets après consentement et plafond.
 *
 * Le contrôle porte sur la FORME, jamais sur un nom de champ : un champ renommé
 * (`photo_data`, `content`, …) ne doit pas contourner la règle. Deux règles :
 *  1. payload sérialisé ≤ `MAX_SYNC_PAYLOAD_BYTES` ;
 *  2. aucune valeur textuelle de ≥ `BASE64_BLOB_MIN_CHARS` caractères qui soit
 *     strictement du base64 (alphabet + padding, sans espace) — c'est-à-dire un
 *     transport d'octets, pas une note de texte.
 *
 * Le refus est **volontairement non persisté** : ce qu'on refuse de stocker, on
 * ne le stocke pas — même en « rejected ». Un nouvel envoi du même
 * `event_id` reçoit la même réponse, sans effet de bord (idempotent par nature).
 */
const MAX_SYNC_PAYLOAD_BYTES = 16 * 1024;
const BASE64_BLOB_MIN_CHARS = 4096;

export function refuseNonStorablePayload(op: { payload: Record<string, unknown> }):
  { status: 'rejected'; reason: string; message: string } | null {
  let serialized: string;
  try {
    serialized = JSON.stringify(op.payload ?? {});
  } catch {
    return {
      status: 'rejected',
      reason: 'PAYLOAD_NOT_SERIALIZABLE',
      message: 'Payload de synchronisation non sérialisable',
    };
  }
  const base64ish = (value: string): boolean =>
    value.length >= BASE64_BLOB_MIN_CHARS && /^[A-Za-z0-9+/]+={0,2}$/.test(value);

  const carriesBase64 = (value: unknown): boolean => {
    if (typeof value === 'string') return base64ish(value);
    if (Array.isArray(value)) return value.some(carriesBase64);
    if (value && typeof value === 'object') {
      return Object.values(value as Record<string, unknown>).some(carriesBase64);
    }
    return false;
  };

  if (serialized.length > MAX_SYNC_PAYLOAD_BYTES) {
    return {
      status: 'rejected',
      reason: 'PAYLOAD_TOO_LARGE_FOR_SYNC',
      message: `Payload de synchronisation trop volumineux (max ${MAX_SYNC_PAYLOAD_BYTES} octets) : `
        + 'les fichiers passent par POST /api/v1/media/upload',
    };
  }
  if (carriesBase64(op.payload)) {
    return {
      status: 'rejected',
      reason: 'PAYLOAD_BINARY_NOT_ALLOWED',
      message: 'Les octets ne passent pas par la file de synchronisation : utiliser POST /api/v1/media/upload',
    };
  }
  return null;
}

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
    const result: SyncPushResult = { accepted: [], rejected: [], conflicts: [], next_cursor: '0' };

    for (const op of operations) {
      try {
        // Publish the ACK only AFTER withTenantConnection has committed.
        const outcome = await this.processOperation(op, userId, deviceId, tenantId);
        if (outcome.status === 'accepted') {
          result.accepted.push(op.event_id);
        } else if (outcome.status === 'conflict') {
          result.conflicts.push({ event_id: op.event_id, reason: outcome.reason ?? 'CONFLICT', current_version: outcome.currentVersion ?? 0 });
        } else {
          result.rejected.push({ event_id: op.event_id, reason: outcome.reason ?? 'REJECTED', message: outcome.message ?? 'Opération rejetée' });
        }
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
    tenantId: string,
  ): Promise<CommandOutcome> {
    // Refus AVANT toute connexion et tout INSERT : ce qu'on refuse de stocker
    // ne doit pas atteindre `sync_operations.payload` (voir le garde ci-dessus).
    const refusal = refuseNonStorablePayload(op);
    if (refusal) return refusal;

    return this.tenantContext.withTenantConnection(async (client): Promise<CommandOutcome> => {
      if (!this.isKnownCommand(op.command)) {
        return { status: 'rejected', reason: 'UNKNOWN_COMMAND', message: `Commande ${op.command} inconnue` };
      }
      if (op.schema_version > 1) {
        return { status: 'rejected', reason: 'UNSUPPORTED_SCHEMA_VERSION', message: `Version ${op.schema_version} non supportée` };
      }
      const dev = await client.query(
        `SELECT id FROM devices WHERE id = $1 AND registered_by = $2 AND is_active = true AND revoked_at IS NULL`,
        [deviceId, userId],
      );
      if (dev.rows.length === 0) {
        return { status: 'rejected', reason: 'DEVICE_REVOKED', message: 'Appareil révoqué ou inconnu' };
      }
      // Serialize retries BEFORE reading/inserting the unique event. A loser must
      // read the committed result, not turn a unique violation into INTERNAL_ERROR.
      // Tenant participates in the key; all row access below remains under RLS.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 48272))', [JSON.stringify([tenantId.toLowerCase(), op.event_id.toLowerCase()])]);
      const existing = await client.query(
        `SELECT device_id, user_id, status, response_outcome, command, entity_type,
                entity_id, payload, base_version, schema_version, client_sequence, occurred_at_device
         FROM sync_operations WHERE event_id = $1`,
        [op.event_id],
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (row.device_id !== deviceId.toLowerCase() || row.user_id !== userId.toLowerCase()) {
          return { status: 'rejected', reason: 'EVENT_ID_OWNERSHIP_MISMATCH', message: 'Identifiant déjà utilisé par un autre appareil ou utilisateur' };
        }
        if (row.command !== op.command || row.entity_type !== op.entity_type ||
            row.entity_id !== (op.entity_id?.toLowerCase() ?? null) || row.base_version !== (op.base_version ?? null) ||
            row.schema_version !== op.schema_version || String(row.client_sequence) !== String(op.client_sequence) ||
            new Date(row.occurred_at_device).getTime() !== new Date(op.occurred_at_device).getTime() ||
            !isDeepStrictEqual(row.payload, op.payload)) {
          return { status: 'rejected', reason: 'EVENT_ID_REUSED', message: 'Identifiant déjà utilisé avec un autre contenu' };
        }
        if (row.response_outcome) return row.response_outcome as CommandOutcome;
        // Historical accepted ACKs are unambiguous. Never invent a conflict
        // version, re-execute an old command, or infer its result from live state.
        if (row.status === 'accepted') return { status: 'accepted' };
        return { status: 'rejected', reason: 'LEGACY_RESULT_UNAVAILABLE', message: 'Résultat historique incomplet ; vérification manuelle requise' };
      }
      const deviceTime = new Date(op.occurred_at_device);
      if (Number.isNaN(deviceTime.getTime())) {
        return { status: 'rejected', reason: 'INVALID_DEVICE_TIME', message: 'Heure appareil invalide' };
      }
      if (deviceTime.getTime() > Date.now() + DEVICE_TIME_TOLERANCE_MS) {
        return { status: 'rejected', reason: 'DEVICE_TIME_AHEAD', message: 'Heure appareil dans le futur' };
      }
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
      const outcome = await this.applyCommand(client, op, userId, deviceId);
      // A retryable failure may occur AFTER a write (including a non-SQL throw).
      // Roll back the operation AND all effects; don't persist a terminal rejection.
      if (outcome.reason === 'INTERNAL_ERROR') throw new Error('Retryable sync operation failure');
      await client.query(
        `UPDATE sync_operations SET status = $1, processed_at = NOW(), rejection_reason = $2,
           response_outcome = $3::jsonb WHERE event_id = $4`,
        [outcome.status, outcome.reason ?? null, JSON.stringify(outcome), op.event_id],
      );
      return outcome;
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
      case 'correct_attendance':
        return this.attendance.applyCorrection(client, {
          ...base,
          action: payload.action as string,
          reason: (payload.reason as string) ?? 'correction_sync',
          baseVersion: op.base_version ?? undefined,
        });
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
      `SELECT id FROM children\n       -- C6 : filtre organisation explicite en plus de la RLS (fail-closed).\n       WHERE id = $1 AND organization_id = current_setting('app.tenant_id')::uuid AND deleted_at IS NULL`,
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
      `SELECT id FROM children\n       -- C6 : filtre organisation explicite en plus de la RLS (fail-closed).\n       WHERE id = $1 AND organization_id = current_setting('app.tenant_id')::uuid AND deleted_at IS NULL`,
      [base.childId],
    );
    if (child.rows.length === 0) {
      return { status: 'rejected', reason: 'PERMISSION_DENIED', message: 'Enfant introuvable dans cette organisation' };
    }
    if (!p.storage_key || !p.mime_type) {
      return { status: 'rejected', reason: 'MISSING_FIELDS', message: 'storage_key et mime_type requis' };
    }
    // C3 (audit 2026-09) : rejet PAR OPÉRATION (pas un 500 global) si la clé
    // est hors du périmètre du tenant.
    if (!String(p.storage_key).startsWith(`${tenantId}/`)) {
      return { status: 'rejected', reason: 'STORAGE_KEY_TENANT_MISMATCH', message: 'Clé de stockage hors organisation' };
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
    } catch (err) {
      if (err instanceof AppError && err.code === 'STORAGE_KEY_TENANT_MISMATCH') {
        return { status: 'rejected', reason: err.code, message: err.messageFr };
      }
      return { status: 'rejected', reason: 'INTERNAL_ERROR', message: 'Erreur lors de l\'enregistrement de la photo' };
    }
  }

  // ── Pull ─────────────────────────────────────────────────────────────────

  async pull(cursor: string, deviceId: string): Promise<{ events: Array<Record<string, unknown>>; next_cursor: string }> {
    const tenantId = this.tenantContext.getTenantId();
    return this.tenantContext.withTenantConnection(async (client) => {
      const dev = await client.query(
        `SELECT id FROM devices WHERE id = $1 AND registered_by = $2 AND is_active = true AND revoked_at IS NULL`,
        [deviceId, this.tenantContext.getUserId()],
      );
      if (dev.rows.length === 0) {
        throw new AppError('DEVICE_REVOKED', 'Appareil révoqué ou inconnu', 'تم إلغاء الجهاز', 403);
      }

      const res = await client.query(
        `SELECT sync_seq::text AS sync_seq, aggregate_type AS type, aggregate_id, event_type, payload, created_at
         FROM sync_changelog
         WHERE organization_id = $1 AND sync_seq > $2
         ORDER BY sync_changelog.sync_seq
         LIMIT ${MAX_PULL_BATCH}`,
        [tenantId, cursor],
      );
      const events = res.rows;
      const nextCursor = events.length > 0 ? (events[events.length - 1].sync_seq as string) : cursor;

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

  private async currentMaxSeq(tenantId: string): Promise<string> {
    // Connexion avec contexte tenant (jamais la pool brute sur une table RLS).
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT COALESCE(MAX(sync_seq), 0)::text AS m FROM sync_changelog WHERE organization_id = $1`,
        [tenantId],
      );
      return res.rows[0].m as string;
    });
  }
}
