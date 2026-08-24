import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';

/**
 * Exports Excel (roadmap v2).
 *
 * La demande crée un job `export_report` (worker) ; la référence est suivie
 * dans report_exports (migration 038). Le téléchargement est autorisé pour
 * le tenant demandeur uniquement (RLS) — backend local (buffer) ou S3 (URL
 * signée), jamais de faux « prêt » avant que le worker n'ait écrit le fichier.
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService,
  ) {}

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
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT id, report_type, period_label, status, file_size_bytes, failure_reason, created_at, completed_at
       FROM report_exports WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 50`, [tenantId],
    )).rows);
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
    if (this.config.get<string>('STORAGE_BACKEND', 's3') === 'local') {
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
      return { kind: 'buffer', buffer: await readFile(filePath), filename };
    }
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const client = new S3Client({
      endpoint: this.config.get<string>('S3_ENDPOINT', 'http://localhost:9000'),
      region: this.config.get<string>('S3_REGION', 'us-east-1'),
      credentials: {
        accessKeyId: this.config.get<string>('S3_ACCESS_KEY', 'minio_dev'),
        secretAccessKey: this.config.get<string>('S3_SECRET_KEY', 'minio_dev_password'),
      },
      forcePathStyle: true,
    });
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: this.config.get<string>('S3_BUCKET', 'creche-media'), Key: row.storage_key as string }),
      { expiresIn: 900 },
    );
    return { kind: 'redirect', url, filename };
  }

  private computeRange(reportType: string, period: string): [string, string] {
    if (reportType === 'invoices') {
      const [year, month] = period.split('-').map(Number);
      return [String(year), String(month)];
    }
    if (period.includes('..')) {
      const [start, end] = period.split('..');
      return [start, end];
    }
    // Mois complet pour les présences : 'YYYY-MM' → début/fin de mois.
    const [year, month] = period.split('-').map(Number);
    const end = new Date(Date.UTC(year, month, 0));
    return [`${period}-01`, `${year}-${String(month).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`];
  }
}
