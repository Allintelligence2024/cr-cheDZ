import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
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
 * Utilise la pool DIRECTEMENT (pas le contexte tenant) : l'audit doit
 * toujours fonctionner ; audit_logs/data_access_logs sont des tables
 * système sans RLS, accès DPO/super_admin uniquement.
 * Les valeurs sont masquées (ADR-010) : aucune PII dans old/new_values.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('AuditService');

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.pool.query(
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
    } catch (error) {
      // L'audit ne doit jamais faire échouer l'action métier.
      this.logger.error(`Échec écriture audit: ${(error as Error).message}`);
    }
  }

  /** Carnet d'accès aux données sensibles (dossier médical, photos…). */
  async logDataAccess(entry: DataAccessEntry): Promise<void> {
    try {
      await this.pool.query(
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
    } catch (error) {
      this.logger.error(`Échec écriture data_access_logs: ${(error as Error).message}`);
    }
  }
}
