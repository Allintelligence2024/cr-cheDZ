import { resolveStorageBackend, type StorageBackend } from '@creche/prod-config';
import { exportRange } from '@creche/prod-config';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import { S3ClientService } from '../../shared/storage/s3-client.service';

/**
 * Exports Excel (roadmap v2).
 *
 * La demande crée un job `export_report` (worker) ; la référence est suivie
 * dans report_exports (migration 038). Le téléchargement est autorisé pour
 * le tenant demandeur uniquement (RLS) — backend local (buffer) ou S3 (URL
 * signée), jamais de faux « prêt » avant que le worker n'ait écrit le fichier.
 *
 * E1 : plus de client S3 recréé à chaque téléchargement — S3ClientService
 * mutualisé (bucket + credentials résolus une seule fois au boot).
 */
@Injectable()
export class ExportsService {
  private readonly backend: StorageBackend;
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService,
    private readonly s3: S3ClientService,
  ) {
    this.backend = resolveStorageBackend({
      NODE_ENV: this.config.get<string>('NODE_ENV'),
      STORAGE_BACKEND: this.config.get<string>('STORAGE_BACKEND'),
    });
  }

  /** Crée la demande d'export (ligne pending + job worker). */
  async request(userId: string, dto: { report_type: string; period: string }): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const periodLabel = dto.period;
      const range = this.computeRange(dto.report_type, dto.period);
      const row = (await client.query(
        `INSERT INTO report_exports (organization_id, report_type, period_label, requested_by)
         VALUES ($1,$2,$3,$4) RETURNING id, report_type, period_label, status, created_at`,
        [tenantId, dto.report_type, periodLabel, userId],
      )).rows[0];
      await client.query(
        `INSERT INTO background_jobs (organization_id, job_type, payload, priority)
         VALUES ($1, 'export_report', $2, 3)`,
        [tenantId, JSON.stringify({ export_id: row.id, report_type: dto.report_type, period_label: periodLabel, range })],
      );
      return row;
    });
  }

  async list(): Promise<Array<Record<string, unknown>>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      await client.query('SELECT exports_reconcile_tenant()');
      return (await client.query(
        `SELECT id, report_type, period_label, status, file_size_bytes, failure_reason, created_at, completed_at
         FROM report_exports WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 50`, [tenantId],
      )).rows;
    });
  }

  /** Téléchargement : buffer (local) ou URL signée (S3) — 404 si absent du tenant, 409 si pas prêt. */
  async download(exportId: string): Promise<{ kind: 'buffer'; buffer: Buffer; filename: string } | { kind: 'redirect'; url: string; filename: string }> {
    requireTenant(this.tenantContext);
    const row = await this.tenantContext.withTenantConnection(async (client) => {
      const r = await client.query(
        `SELECT id, report_type, period_label, status, storage_key FROM report_exports WHERE id = $1`,
        [exportId],
      );
      return r.rows[0] ?? null;
    });
    if (!row) throw Errors.notFound();
    if (row.status !== 'done' || !row.storage_key) {
      throw new AppError('EXPORT_NOT_READY', "L'export n'est pas encore prêt", 'لم يكتمل التصدير بعد', 409);
    }
    // Défense croisée (audit) : la clé doit rester sous le préfixe exports DU
    // TENANT demandeur (la ligne est déjà filtrée par RLS, mais une clé
    // corrompue ne doit jamais permettre de lire un autre répertoire).
    const tenantId = requireTenant(this.tenantContext);
    const key = row.storage_key as string;
    if (key.includes('..') || !key.startsWith(`${tenantId}/exports/`)) {
      throw new AppError(
        'STORAGE_POLICY',
        'Clé de stockage refusée : elle doit se trouver sous le répertoire d’exports de votre établissement',
        'مفتاح تخزين مرفوض: يجب أن يكون ضمن مجلد التصديرات الخاص بمؤسستك',
        422,
      );
    }
    const filename = `export-${row.report_type}-${String(row.period_label).replace(/[^0-9-]/g, '_')}.xlsx`;
    if (this.backend === 'local') {
      // Garde anti path-traversal (audit) : resolve() + containment sous la
      // racine de stockage, et clé sous le préfixe du tenant demandeur —
      // aucune lecture disque avant ces contrôles.
      const baseDir = this.config.get<string>('STORAGE_LOCAL_DIR', '/tmp/creche-pdf');
      const root = resolve(baseDir);
      const filePath = resolve(root, row.storage_key as string);
      if (filePath !== root && !filePath.startsWith(root + sep)) {
        throw new AppError(
          'PATH_TRAVERSAL',
          'Clé de stockage interdite (chemin hors du répertoire de stockage)',
          'مفتاح تخزين مرفوض (مسار خارج مجلد التخزين)',
          422,
        );
      }
      // Garde d'existence (audit — symétrique de C4 sur les PDF) : une clé
      // orpheline (fichier purgé/disparu) ne doit pas produire un 500 ENOENT
      // mais un 404 clair.
      if (!existsSync(filePath)) {
        throw new AppError(
          'EXPORT_FILE_MISSING',
          'Le fichier d’export est introuvable sur le stockage local',
          'ملف التصدير غير موجود في التخزين المحلي',
          404,
        );
      }
      return { kind: 'buffer', buffer: await readFile(filePath), filename };
    }
    // E1 : URL signée via le client S3 mutualisé (900 s, comme avant).
    const url = await this.s3.presignGet(row.storage_key as string, 900);
    return { kind: 'redirect', url, filename };
  }

  private computeRange(reportType: string, period: string): [string, string] {
    try { return exportRange(reportType,period); }
    catch { throw new AppError('EXPORT_PERIOD_INVALID', 'Période d’export invalide', 'فترة التصدير غير صالحة', 400); }
  }
}
