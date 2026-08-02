import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';

/**
 * Messagerie (roadmap v2 — premier livrable).
 *
 * Conversations par enfant, participants explicites (conversation_participants).
 * La RLS limite aux données du tenant ; la GARDE APPLICATIVE exige d'être
 * participant pour lire/écrire (un parent ne voit que ses conversations).
 */
@Injectable()
export class MessagingService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async createConversation(userId: string, dto: { child_id?: string; subject?: string; participant_user_ids?: string[] }): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      if (dto.child_id) {
        const child = await client.query(`SELECT id FROM children WHERE id=$1 AND deleted_at IS NULL`, [dto.child_id]);
        if (!child.rows[0]) throw Errors.notFound();
      }
      const participantIds = new Set<string>([userId]);
      for (const uid of dto.participant_user_ids ?? []) participantIds.add(uid);
      if (dto.child_id) {
        // Ajout automatique des gardiens de l'enfant ayant un compte utilisateur.
        const guardians = await client.query(
          `SELECT DISTINCT g.user_id FROM child_guardians cg
           JOIN guardians g ON g.id = cg.guardian_id
           WHERE cg.child_id = $1 AND g.user_id IS NOT NULL`,
          [dto.child_id],
        );
        for (const g of guardians.rows) participantIds.add(g.user_id as string);
      }
      // Chaque participant doit appartenir au tenant (membership active).
      const members = await client.query(
        `SELECT m.user_id FROM memberships m WHERE m.organization_id=$1 AND m.is_active=true AND m.user_id = ANY($2::uuid[])`,
        [tenantId, [...participantIds]],
      );
      const validIds = new Set<string>(members.rows.map((r) => r.user_id as string));
      if (!validIds.has(userId)) {
        throw new AppError('PARTICIPANT_INVALID', 'Participant hors organisation', 'المشارك خارج المؤسسة', 422);
      }
      const conversation = (await client.query(
        `INSERT INTO conversations (organization_id, child_id, subject, created_at) VALUES ($1,$2,$3,NOW()) RETURNING *`,
        [tenantId, dto.child_id ?? null, dto.subject ?? null],
      )).rows[0];
      for (const uid of [...participantIds]) {
        if (!validIds.has(uid)) continue;
        await client.query(
          `INSERT INTO conversation_participants (conversation_id, organization_id, user_id) VALUES ($1,$2,$3)`,
          [conversation.id, tenantId, uid],
        );
      }
      return conversation;
    });
  }

  async listConversations(userId: string): Promise<Array<Record<string, unknown>>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT c.id, c.child_id, c.subject, c.is_archived, c.last_message_at, c.created_at,
              ch.first_name_fr AS child_first_name, ch.last_name_fr AS child_last_name,
              (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL) AS message_count
       FROM conversations c
       JOIN conversation_participants cp ON cp.conversation_id = c.id
       LEFT JOIN children ch ON ch.id = c.child_id
       WHERE cp.user_id = $1
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`, [userId],
    )).rows);
  }

  async getConversation(userId: string, conversationId: string): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      await this.assertParticipant(client, userId, conversationId);
      const conversation = (await client.query(
        `SELECT c.*, ch.first_name_fr AS child_first_name, ch.last_name_fr AS child_last_name
         FROM conversations c LEFT JOIN children ch ON ch.id = c.child_id WHERE c.id = $1`, [conversationId],
      )).rows[0];
      if (!conversation) throw Errors.notFound();
      const participants = (await client.query(
        `SELECT cp.user_id, cp.last_read_at, u.first_name, u.last_name, u.email
         FROM conversation_participants cp JOIN users u ON u.id = cp.user_id
         WHERE cp.conversation_id = $1 ORDER BY u.first_name`, [conversationId],
      )).rows;
      const messages = (await client.query(
        `SELECT id, sender_id, body, attachment_id, is_system_message, sent_at
         FROM messages WHERE conversation_id = $1 AND deleted_at IS NULL
         ORDER BY sent_at DESC LIMIT 100`, [conversationId],
      )).rows;
      return { ...conversation, participants, messages: messages.reverse() };
    });
  }

  async sendMessage(userId: string, conversationId: string, dto: { body: string; attachment_id?: string }): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      await this.assertParticipant(client, userId, conversationId);
      if (dto.attachment_id) {
        const media = await client.query(
          `SELECT id FROM media_assets WHERE id=$1 AND deleted_at IS NULL`, [dto.attachment_id],
        );
        if (!media.rows[0]) throw Errors.notFound();
      }
      const message = (await client.query(
        `INSERT INTO messages (organization_id, conversation_id, sender_id, body, attachment_id)
         VALUES ((SELECT organization_id FROM conversations WHERE id=$1), $1, $2, $3, $4)
         RETURNING id, sender_id, body, attachment_id, is_system_message, sent_at`,
        [conversationId, userId, dto.body, dto.attachment_id ?? null],
      )).rows[0];
      await client.query(
        `UPDATE conversations SET last_message_at = NOW() WHERE id = $1`, [conversationId],
      );
      return message;
    });
  }

  async markRead(userId: string, conversationId: string): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      await this.assertParticipant(client, userId, conversationId);
      await client.query(
        `UPDATE conversation_participants SET last_read_at = NOW()
         WHERE conversation_id = $1 AND user_id = $2`, [conversationId, userId],
      );
      return { conversation_id: conversationId, read_at: new Date().toISOString() };
    });
  }

  private async assertParticipant(client: import('pg').PoolClient, userId: string, conversationId: string): Promise<void> {
    const r = await client.query(
      `SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    if (!r.rows[0]) throw Errors.notFound();
  }
}
