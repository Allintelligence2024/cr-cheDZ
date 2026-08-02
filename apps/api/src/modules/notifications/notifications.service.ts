import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';

const EVENT_MESSAGES: Record<string, { fr: string; ar: string; body_fr: string; body_ar: string }> = {
  check_in: { fr: 'Arrivée', ar: 'وصول', body_fr: 'est arrivé(e) à la crèche', body_ar: 'وصل إلى الحضانة' },
  check_out: { fr: 'Départ', ar: 'مغادرة', body_fr: 'a quitté la crèche', body_ar: 'غادر الحضانة' },
  meal: { fr: 'Repas', ar: 'وجبة', body_fr: 'a pris son repas', body_ar: 'تناول وجبته' },
  nap_end: { fr: 'Sieste', ar: 'قيلولة', body_fr: 'a fini sa sieste', body_ar: 'أنهى قيلولته' },
  incident: { fr: 'Incident', ar: 'حادث', body_fr: 'un incident a été signalé', body_ar: 'تم تسجيل حادث' },
};

/**
 * Notifications — file d'envoi (notification_queue) + boîte de réception
 * (notification_inbox). Appelé DANS la transaction métier (client fourni).
 * L'envoi push réel (FCM/APNs) est consommé par le worker (Phase 7).
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async notifyGuardiansOfEvent(
    client: PoolClient,
    tenantId: string,
    childId: string,
    eventType: string,
    logEventId: string,
  ): Promise<void> {
    // Responsables autorisés à recevoir des push pour cet enfant.
    const guardians = await client.query(
      `SELECT cg.guardian_id, g.user_id, g.phone_primary, g.first_name_fr, c.first_name_fr AS child_name
       FROM child_guardians cg
       JOIN guardians g ON g.id = cg.guardian_id
       JOIN children c ON c.id = cg.child_id
       WHERE cg.child_id = $1 AND cg.can_receive_push = true
         AND g.user_id IS NOT NULL`,
      [childId],
    );
    for (const g of guardians.rows) {
      await this.enqueue(client, tenantId, {
        userId: g.user_id,
        eventType,
        titleFr: EVENT_MESSAGES[eventType]?.fr ?? 'Crèche',
        titleAr: EVENT_MESSAGES[eventType]?.ar ?? 'الحضانة',
        bodyFr: `${g.child_name} ${EVENT_MESSAGES[eventType]?.body_fr ?? '—'}`,
        bodyAr: `${g.child_name} ${EVENT_MESSAGES[eventType]?.body_ar ?? '—'}`,
        data: { child_id: childId, event_type: eventType, log_event_id: logEventId },
      });
      // WhatsApp (roadmap v2) : si le flag whatsapp_notifications est actif
      // pour le tenant et que le gardien a un téléphone, une notification
      // WhatsApp est mise en file (consommée par le worker).
      await this.enqueueWhatsApp(client, tenantId, g.user_id, g.phone_primary, EVENT_MESSAGES[eventType], g.child_name);
    }
  }

  /** Canal WhatsApp : soumis au flag whatsapp_notifications + téléphone présent. */
  private async enqueueWhatsApp(
    client: PoolClient,
    tenantId: string,
    userId: string,
    phone: string | null,
    event: { fr: string; ar: string; body_fr: string; body_ar: string } | undefined,
    childName: string,
  ): Promise<void> {
    if (!phone) return;
    const flag = await client.query(
      `SELECT COALESCE(f_org.is_enabled, f_global.is_enabled, false) AS enabled
       FROM (SELECT 1) x
       LEFT JOIN feature_flags f_org
         ON f_org.flag_key='whatsapp_notifications' AND f_org.organization_id=$1
       LEFT JOIN feature_flags f_global
         ON f_global.flag_key='whatsapp_notifications' AND f_global.organization_id IS NULL`,
      [tenantId],
    );
    if (!flag.rows[0]?.enabled) return;
    await client.query(
      `INSERT INTO notification_queue (organization_id, user_id, channel, title_fr, title_ar, body_fr, body_ar, data)
       VALUES ($1, $2, 'whatsapp', $3, $4, $5, $6, $7)`,
      [tenantId, userId, event?.fr ?? 'Crèche', event?.ar ?? 'الحضانة',
       `${childName} ${event?.body_fr ?? '—'}`, `${childName} ${event?.body_ar ?? '—'}`,
       JSON.stringify({ to: phone, event_type: 'whatsapp' })],
    );
  }

  /** Insertion file + boîte de réception (in-app), dans la transaction. */
  async enqueue(
    client: PoolClient,
    tenantId: string,
    params: {
      userId: string;
      eventType: string;
      titleFr: string;
      titleAr: string;
      bodyFr: string;
      bodyAr: string;
      data: Record<string, unknown>;
    },
  ): Promise<void> {
    const preference = await client.query<{ is_enabled: boolean; quiet_hours_start: string | null; quiet_hours_end: string | null }>(
      `SELECT is_enabled, quiet_hours_start::text, quiet_hours_end::text
       FROM notification_preferences WHERE organization_id=$1 AND user_id=$2
         AND channel='push' AND event_type=$3`,
      [tenantId, params.userId, params.eventType],
    );
    const pref = preference.rows[0];
    // Le centre in-app reste alimenté même si le parent coupe les pushes.
    if (!pref || pref.is_enabled) {
      const scheduledAt = this.quietHoursSchedule(pref?.quiet_hours_start ?? null, pref?.quiet_hours_end ?? null);
      await client.query(
        `INSERT INTO notification_queue
           (organization_id, user_id, channel, title_fr, title_ar, body_fr, body_ar, data, scheduled_at)
         VALUES ($1, $2, 'push', $3, $4, $5, $6, $7, $8)`,
        [tenantId, params.userId, params.titleFr, params.titleAr, params.bodyFr, params.bodyAr, JSON.stringify(params.data), scheduledAt],
      );
    }
    await client.query(
      `INSERT INTO notification_inbox
         (organization_id, user_id, type, title_fr, title_ar, body_fr, body_ar, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenantId, params.userId, params.eventType, params.titleFr, params.titleAr, params.bodyFr, params.bodyAr, JSON.stringify(params.data)],
    );
  }

  /** Diffère une notification tombant pendant la plage silencieuse (heure Alger). */
  private quietHoursSchedule(start: string | null, end: string | null): Date {
    if (!start || !end) return new Date();
    const now = new Date();
    const algiers = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const inQuiet = start <= end ? algiers >= start && algiers < end : algiers >= start || algiers < end;
    if (!inQuiet) return now;
    const [h, m] = end.split(':').map(Number);
    // Convertit l'heure de sortie en délai local ; le décalage Europe/Alger est
    // constant (UTC+1), ce qui évite de dépendre du fuseau du serveur.
    const current = Number(algiers.slice(0, 2)) * 60 + Number(algiers.slice(3, 5));
    const target = h * 60 + m;
    const delay = ((target - current + 1440) % 1440) || 1440;
    return new Date(now.getTime() + delay * 60_000);
  }

  /** Boîte de réception de l'utilisateur courant (API). */
  async inbox(userId: string): Promise<Array<Record<string, unknown>>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT id, type, title_fr, title_ar, body_fr, body_ar, data, is_read, created_at
         FROM notification_inbox
         WHERE user_id = $1 AND organization_id = $2
         ORDER BY created_at DESC
         LIMIT 100`,
        [userId, tenantId],
      );
      return res.rows;
    });
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    requireTenant(this.tenantContext);
    await this.tenantContext.withTenantConnection(async (client) => {
      await client.query(
        `UPDATE notification_inbox SET is_read = true, read_at = NOW()
         WHERE id = $1 AND user_id = $2`,
        [notificationId, userId],
      );
    });
  }
}
