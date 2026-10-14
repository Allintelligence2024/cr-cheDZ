import { Injectable, Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { Inject } from '@nestjs/common';
import { PG_POOL } from '../../shared/database/database.provider';
import { redact } from '../../shared/redact';

export interface AuditEntry {
  organizationId?: string | null;
  userId?: string | null;
  deviceId?: string | null;
  sessionId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  resourceLabel?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

export interface DataAccessEntry {
  organizationId: string;
  userId: string;
  deviceId?: string | null;
  dataType: string;
  dataSubjectId: string;
  dataSubjectType: string;
  accessType: string;
  justification?: string | null;
  ipAddress?: string | null;
}

/**
 * Journal d'audit (loi 18-07 modifiée par 25-11).
 *
 * Écrit via un client emprunté à la pool — pas le contexte tenant — car
 * l'audit doit tracer même avant résolution du tenant (échecs d'auth, où
 * organizationId est NULL). Mais audit_logs/data_access_logs sont FORCE RLS
 * (migration 088) avec `WITH CHECK (organization_id IS NULL OR
 * organization_id = app_tenant_id())` : si on écrit sans poser le GUC,
 * `organization_id = NULL` est NULL (jamais TRUE), donc TOUT INSERT tenant est
 * rejeté silencieusement → journal vide (correctif 2026-10-09, 099).
 *
 * On pose donc app.tenant_id sur le client quand on connaît l'organization,
 * puis on RESTORE la valeur précédente (jamais un RESET brut : la pool est
 * partagée et la connexion retourne à d'autres requêtes).
 * Exception explicite : logInTransaction utilise le client du métier (GUC
 * déjà posé par withTenantConnection) et propage les erreurs (DPIA), pour
 * rendre mutation et audit atomiques.
 * Les valeurs sont masquées (ADR-010) : aucune PII dans old/new_values.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('AuditService');

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      // organizationId NULL : échec d'auth avant résolution du tenant — la
      // branche NULL de la policy couvre ce cas, pas besoin de GUC.
      if (!entry.organizationId) {
        await this.writeEntry(this.pool, entry);
        return;
      }
      await this.writeWithTenantContext(entry);
    } catch (error) {
      // L'audit ne doit jamais faire échouer l'action métier.
      this.logger.error(`Échec écriture audit: ${(error as Error).message}`);
    }
  }

  /**
   * Emprunte un client, pose app.tenant_id le temps de l'INSERT, puis RESTORE
   * la valeur précédente (pool partagée — un RESET bruiterait les autres
   * requêtes ; un client libéré sans restore pourrait fuiter le tenant).
   */
  private async writeWithTenantContext(entry: AuditEntry): Promise<void> {
    const client = await this.pool.connect();
    try {
      const prev = (
        await client.query(`SELECT current_setting('app.tenant_id', true) AS v`)
      ).rows[0].v as string | null;
      await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [entry.organizationId]);
      try {
        await this.writeEntry(client, entry);
      } finally {
        // is_local=false → la pool voit la valeur restaurée.
        await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [prev ?? '']);
      }
    } finally {
      client.release();
    }
  }

  /** Security-sensitive caller owns BEGIN/COMMIT: audit failure must roll back
   * the business mutation. Unlike log(), errors are deliberately propagated.
   */
  async logInTransaction(client: PoolClient, entry: AuditEntry): Promise<void> {
    await this.writeEntry(client, entry);
  }

  private async writeEntry(client: Pick<PoolClient, 'query'>, entry: AuditEntry): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
         (organization_id, user_id, device_id, session_id, action,
          resource_type, resource_id, resource_label,
          old_values, new_values, ip_address, user_agent, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        entry.organizationId ?? null,
        entry.userId ?? null,
        entry.deviceId ?? null,
        entry.sessionId ?? null,
        entry.action,
        entry.resourceType,
        entry.resourceId ?? null,
        entry.resourceLabel ?? null,
        entry.oldValues ? JSON.stringify(redact(entry.oldValues)) : null,
        entry.newValues ? JSON.stringify(redact(entry.newValues)) : null,
        entry.ipAddress ?? null,
        entry.userAgent ?? null,
        entry.correlationId ?? null,
      ],
    );
  }

  /** Carnet d'accès aux données sensibles (dossier médical, photos…). */
  async logDataAccess(entry: DataAccessEntry): Promise<void> {
    try {
      // organizationId est required (requireTenant côté appelant), donc pose
      // toujours le GUC — data_access_logs est FORCE RLS, sans lui l'INSERT
      // est rejeté (organization_id = NULL → NULL, jamais TRUE).
      const client = await this.pool.connect();
      try {
        const prev = (
          await client.query(`SELECT current_setting('app.tenant_id', true) AS v`)
        ).rows[0].v as string | null;
        await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [entry.organizationId]);
        try {
          await client.query(
            `INSERT INTO data_access_logs
           (organization_id, user_id, device_id, data_type,
            data_subject_id, data_subject_type, access_type,
            justification, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              entry.organizationId,
              entry.userId,
              entry.deviceId ?? null,
              entry.dataType,
              entry.dataSubjectId,
              entry.dataSubjectType,
              entry.accessType,
              entry.justification ?? null,
              entry.ipAddress ?? null,
            ],
          );
        } finally {
          await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [prev ?? '']);
        }
      } finally {
        client.release();
      }
    } catch (error) {
      this.logger.error(`Échec écriture data_access_logs: ${(error as Error).message}`);
    }
  }
}
