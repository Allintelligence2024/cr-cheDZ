import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateJournalEventDto, GroupJournalEventDto } from './dto/journal.dto';

/** Types déclenchant une notification push parent. */
const NOTIFY_PARENT_TYPES = new Set(['meal', 'nap_end', 'incident']);

export interface JournalEventInput {
  childId: string;
  eventType: string;
  occurredAt: Date;
  recordedBy: string;
  deviceId?: string | null;
  syncEventId?: string | null;
  isOffline?: boolean;
  visibleToParents?: boolean;
  fields: Record<string, unknown>;
}

/**
 * Journal quotidien — événements append-only (jamais d'écrasement).
 * - Insertion partagée HTTP + sync (transaction déjà ouverte).
 * - Corrections = nouveaux événements (is_correction + corrects_event_id).
 * - Événements visibles → notification parent (notification_queue/inbox).
 */
@Injectable()
export class JournalService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ── HTTP ─────────────────────────────────────────────────────────────────

  async createEvent(userId: string, dto: CreateJournalEventDto): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const result = await this.insertEvent(client, tenantId, {
        childId: dto.child_id,
        eventType: dto.event_type,
        occurredAt: dto.occurred_at ? new Date(dto.occurred_at) : new Date(),
        recordedBy: userId,
        visibleToParents: dto.visible_to_parents,
        fields: {
          meal_type: dto.meal_type, meal_quantity: dto.meal_quantity, meal_notes: dto.meal_notes,
          nap_start_at: dto.nap_start_at, nap_end_at: dto.nap_end_at, nap_quality: dto.nap_quality,
          diaper_type: dto.diaper_type,
          activity_name: dto.activity_name, activity_notes: dto.activity_notes,
          temperature_celsius: dto.temperature_celsius, health_observation: dto.health_observation,
          note_text: dto.note_text, note_is_private: dto.note_is_private,
          incident_severity: dto.incident_severity, incident_description: dto.incident_description,
          incident_action: dto.incident_action,
          corrects_event_id: dto.corrects_event_id, correction_reason: dto.correction_reason,
        },
      });
      return result;
    });
  }

  /** Action groupée (repas de section…) — un événement par enfant, même transaction. */
  async groupAction(userId: string, dto: GroupJournalEventDto): Promise<{ count: number; items: Array<Record<string, unknown>> }> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const items: Array<Record<string, unknown>> = [];
      for (const child of dto.children) {
        const evt = await this.insertEvent(client, tenantId, {
          childId: child.child_id,
          eventType: dto.event_type,
          occurredAt: dto.occurred_at ? new Date(dto.occurred_at) : new Date(),
          recordedBy: userId,
          fields: {
            meal_type: dto.meal_type, meal_quantity: dto.meal_quantity,
            diaper_type: dto.diaper_type, activity_name: dto.activity_name,
          },
        });
        items.push(evt);
      }
      await this.audit.log({
        organizationId: tenantId,
        userId,
        action: 'create',
        resourceType: 'journal_group',
        newValues: { event_type: dto.event_type, count: items.length },
      });
      return { count: items.length, items };
    });
  }

  /** Liste des événements d'un enfant (vue personnel) pour une date. */
  async listForChild(childId: string, date?: string): Promise<Array<Record<string, unknown>>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      await this.childOfTenant(client, childId);
      const day = date ?? (await this.todayAlgiers(client));
      const res = await client.query(
        `SELECT id, event_type, event_date, occurred_at, recorded_by,
                meal_type, meal_quantity, meal_notes,
                nap_start_at, nap_end_at, nap_quality,
                diaper_type, temperature_celsius, health_observation,
                activity_name, activity_notes, note_text, note_is_private,
                incident_severity, incident_description, incident_action,
                is_correction, corrects_event_id, correction_reason,
                visible_to_parents, parent_notified
         FROM daily_log_events
         WHERE child_id = $1 AND event_date = $2
         ORDER BY occurred_at ASC`,
        [childId, day],
      );
      return res.rows;
    });
  }

  /** Fil parent : événements visibles uniquement (Phase 7 sécurisera l'accès parent). */
  async feedForChild(childId: string, date?: string): Promise<Array<Record<string, unknown>>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      await this.childOfTenant(client, childId);
      const day = date ?? (await this.todayAlgiers(client));
      const res = await client.query(
        `SELECT id, event_type, occurred_at, meal_type, meal_quantity,
                nap_start_at, nap_end_at, nap_quality,
                diaper_type, activity_name, activity_notes,
                incident_severity, incident_description,
                visible_to_parents
         FROM daily_log_events
         WHERE child_id = $1 AND event_date = $2
           AND visible_to_parents = true
           AND (note_is_private = false OR note_is_private IS NULL)
         ORDER BY occurred_at ASC`,
        [childId, day],
      );
      return res.rows;
    });
  }

  /**
   * Modération (directrice) : afficher/masquer un événement dans le fil
   * parent. Une note privée ne devient JAMAIS visible par les parents (422).
   */
  async setVisibility(eventId: string, visible: boolean): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const event = (await client.query(
        `SELECT id, note_is_private, visible_to_parents FROM daily_log_events WHERE id = $1`,
        [eventId],
      )).rows[0];
      if (!event) throw Errors.notFound();
      if (visible && event.note_is_private) {
        throw new AppError(
          'NOTE_IS_PRIVATE',
          'Une note privée ne peut pas être visible par les parents',
          'لا يمكن عرض ملاحظة خاصة على الوالدين',
          422,
        );
      }
      const updated = (await client.query(
        `UPDATE daily_log_events SET visible_to_parents = $2 WHERE id = $1
         RETURNING id, event_type, visible_to_parents`,
        [eventId, visible],
      )).rows[0];
      return updated;
    });
  }

  // ── Insertion partagée (HTTP + sync) ─────────────────────────────────────

  async insertEvent(
    client: PoolClient,
    tenantId: string,
    input: JournalEventInput,
  ): Promise<Record<string, unknown>> {
    const child = await this.childOfTenant(client, input.childId);
    if (!child) {
      throw new AppError('NOT_FOUND', 'Enfant introuvable dans cette organisation', 'الطفل غير موجود', 404);
    }
    const f = input.fields;

    // Un événement 'note' privé n'est jamais visible aux parents.
    const visible = input.visibleToParents ?? true;
    const isPrivateNote = input.eventType === 'note' && (f.note_is_private as boolean) === true;

    const day = await this.todayAlgiers(client);
    const res = await client.query(
      `INSERT INTO daily_log_events
         (organization_id, child_id, room_id, event_date, event_type, occurred_at,
          recorded_by, device_id, is_offline, sync_event_id,
          meal_type, meal_quantity, meal_notes,
          nap_start_at, nap_end_at, nap_quality,
          diaper_type, temperature_celsius, health_observation,
          activity_name, activity_notes, note_text, note_is_private,
          incident_severity, incident_description, incident_action,
          is_correction, corrects_event_id, correction_reason,
          visible_to_parents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
               $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
               $27,$28,$29,$30)
       RETURNING id, event_type, event_date, occurred_at`,
      [
        tenantId, input.childId, child.room_id, day, input.eventType, input.occurredAt,
        input.recordedBy, input.deviceId ?? null, input.isOffline ?? false, input.syncEventId ?? null,
        f.meal_type ?? null, f.meal_quantity ?? null, f.meal_notes ?? null,
        f.nap_start_at ?? null, f.nap_end_at ?? null, f.nap_quality ?? null,
        f.diaper_type ?? null, f.temperature_celsius ?? null, f.health_observation ?? null,
        f.activity_name ?? null, f.activity_notes ?? null, f.note_text ?? null, f.note_is_private ?? null,
        f.incident_severity ?? null, f.incident_description ?? null, f.incident_action ?? null,
        f.corrects_event_id != null, f.corrects_event_id ?? null, f.correction_reason ?? null,
        isPrivateNote ? false : visible,
      ],
    );
    const evt = res.rows[0];

    // Changelog (C02) — le mobile reçoit l'événement via le pull.
    await client.query(
      `INSERT INTO sync_changelog
         (organization_id, aggregate_type, aggregate_id, event_type, payload, origin_device_id)
       VALUES ($1, 'daily_log', $2, $3, $4, $5)`,
      [
        tenantId, evt.id, input.eventType,
        JSON.stringify({
          child_id: input.childId, event_type: input.eventType, event_date: day,
          occurred_at: input.occurredAt.toISOString(),
        }),
        input.deviceId ?? null,
      ],
    );

    // Notification parent pour les événements visibles notifiables.
    if (!isPrivateNote && visible && NOTIFY_PARENT_TYPES.has(input.eventType)) {
      await this.notifications.notifyGuardiansOfEvent(client, tenantId, input.childId, input.eventType, evt.id);
    }

    return evt;
  }

  private async childOfTenant(client: PoolClient, childId: string): Promise<{ id: string; room_id: string | null } | null> {
    const res = await client.query(
      `SELECT id, room_id FROM children WHERE id = $1 AND deleted_at IS NULL`,
      [childId],
    );
    return res.rows[0] ?? null;
  }

  private async todayAlgiers(client: PoolClient): Promise<string> {
    const res = await client.query(`SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date AS d`);
    return res.rows[0].d as string;
  }
}
