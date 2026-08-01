import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AuditService } from '../privacy/audit.service';
import { ImportChildRowDto, type ImportError, type ImportResult } from './dto/import.dto';

const VALID_GENDERS = new Set(['M', 'F']);

/**
 * Import d'enfants (50+ lignes).
 * - dry_run=true  : validation seule, AUCUNE écriture.
 * - dry_run=false : transaction complète (tout ou rien) — une ligne invalide
 *   est écartée et rapportée, les lignes valides sont insérées.
 * Chaque ligne crée l'enfant + son responsable (si renseigné) + le lien.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async importRows(rows: ImportChildRowDto[], dryRun: boolean, actorId: string): Promise<ImportResult> {
    const tenantId = requireTenant(this.tenantContext);
    const errors: ImportError[] = [];
    const validRows: Array<{ row: ImportChildRowDto; index: number }> = [];

    rows.forEach((row, index) => {
      const lineErrors = this.validateRow(row);
      if (lineErrors.length > 0) {
        for (const err of lineErrors) {
          errors.push({ row: index + 1, field: err.field, message_fr: err.message_fr, message_ar: err.message_ar });
        }
      } else {
        validRows.push({ row, index });
      }
    });

    // En dry-run, on s'arrête ici : aucun effet de bord.
    if (dryRun) {
      return { dry_run: true, inserted: 0, errors };
    }

    let inserted = 0;
    if (validRows.length > 0) {
      inserted = await this.tenantContext.withTenantConnection(async (client) => {
        let count = 0;
        for (const { row } of validRows) {
          // Lignes validées par validateRow : les champs requis existent.
          const firstName = row.first_name_fr as string;
          const lastName = row.last_name_fr as string;
          const dob = row.date_of_birth as string;
          const child = await this.insertChild(client, tenantId, firstName, lastName, dob, row, actorId);
          count += 1;
          if (row.guardian_first_name || row.guardian_last_name || row.guardian_phone) {
            await this.insertGuardianAndLink(client, tenantId, child.id, row, actorId);
          }
        }
        return count;
      });
    }

    await this.audit.log({
      organizationId: tenantId,
      userId: actorId,
      action: 'create',
      resourceType: 'child_import',
      newValues: { dry_run: false, rows: rows.length, inserted, errors: errors.length },
    });

    return { dry_run: false, inserted, errors };
  }

  private validateRow(row: ImportChildRowDto): Array<{ field: string; message_fr: string; message_ar: string }> {
    const out: Array<{ field: string; message_fr: string; message_ar: string }> = [];
    if (!row.first_name_fr || row.first_name_fr.trim().length < 2) {
      out.push({ field: 'first_name_fr', message_fr: 'Prénom manquant ou trop court', message_ar: 'الاسم الأول مفقود أو قصير جداً' });
    }
    if (!row.last_name_fr || row.last_name_fr.trim().length < 2) {
      out.push({ field: 'last_name_fr', message_fr: 'Nom manquant ou trop court', message_ar: 'اللقب مفقود أو قصير جداً' });
    }
    if (!row.date_of_birth) {
      out.push({ field: 'date_of_birth', message_fr: 'Date de naissance manquante', message_ar: 'تاريخ الميلاد مفقود' });
    } else {
      const d = new Date(row.date_of_birth);
      if (Number.isNaN(d.getTime())) {
        out.push({ field: 'date_of_birth', message_fr: 'Date de naissance invalide (YYYY-MM-DD)', message_ar: 'تاريخ ميلاد غير صالح' });
      } else if (d > new Date()) {
        out.push({ field: 'date_of_birth', message_fr: 'Date de naissance dans le futur', message_ar: 'تاريخ الميلاد في المستقبل' });
      }
    }
    if (row.gender && !VALID_GENDERS.has(row.gender)) {
      out.push({ field: 'gender', message_fr: 'Genre invalide (M ou F)', message_ar: 'الجنس غير صالح (M أو F)' });
    }
    if (row.guardian_first_name && (!row.guardian_last_name || !row.guardian_phone)) {
      out.push({
        field: 'guardian',
        message_fr: 'Responsable incomplet : nom ET téléphone requis si le prénom est renseigné',
        message_ar: 'ولي الأمر غير مكتمل: اللقب والهاتف مطلوبان',
      });
    }
    return out;
  }

  private async insertChild(
    client: PoolClient,
    tenantId: string,
    firstName: string,
    lastName: string,
    dateOfBirth: string,
    row: ImportChildRowDto,
    actorId: string,
  ): Promise<{ id: string }> {
    // Premier site de l'organisation (les lignes d'import n'ont pas de site_id).
    const site = await client.query(
      `SELECT id FROM sites WHERE organization_id = $1 AND is_active = true ORDER BY created_at LIMIT 1`,
      [tenantId],
    );
    if (site.rows.length === 0) {
      throw new Error('Aucun site actif pour l\'organisation');
    }

    const seq = await client.query(`SELECT next_org_sequence($1) AS seq`, [tenantId]);
    const year = new Date().getFullYear();
    const reference = `IMP-${year}-${String(seq.rows[0].seq).padStart(5, '0')}`;

    const res = await client.query(
      `INSERT INTO children
         (organization_id, site_id, room_id, reference_number,
          first_name_fr, last_name_fr, date_of_birth, gender, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        tenantId, site.rows[0].id, row.room_id ?? null, reference,
        firstName.trim(), lastName.trim(), dateOfBirth,
        row.gender ?? null, row.notes ?? null, actorId, actorId,
      ],
    );
    return res.rows[0] as { id: string };
  }

  private async insertGuardianAndLink(
    client: PoolClient,
    tenantId: string,
    childId: string,
    row: ImportChildRowDto,
    actorId: string,
  ): Promise<void> {
    const guardian = await client.query(
      `INSERT INTO guardians
         (organization_id, first_name_fr, last_name_fr, relationship, phone_primary, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [
        tenantId,
        (row.guardian_first_name ?? '').trim() || 'Parent',
        (row.guardian_last_name ?? '').trim() || 'Importé',
        row.guardian_relationship ?? 'parent',
        row.guardian_phone ?? null,
        actorId,
      ],
    );
    await client.query(
      `INSERT INTO child_guardians
         (organization_id, child_id, guardian_id, is_legal_guardian, is_primary, can_pickup)
       VALUES ($1,$2,$3,true,true,true)`,
      [tenantId, childId, guardian.rows[0].id],
    );
  }
}
