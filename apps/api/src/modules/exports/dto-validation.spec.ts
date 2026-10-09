/**
 * 4.2 — Validation des DTO du module exports.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateExportDto,
  ExportIdParam,
} from './dto/exports.dto';

const valid_CreateExportDto = () => plainToInstance(CreateExportDto, {
      report_type: "attendance",
      period: "0000-00",
    });

describe('CreateExportDto (4.2)', () => {
  const valid = valid_CreateExportDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateExportDto.report_type requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.report_type;
    reject(dto, 'report_type');
  });
  it('CreateExportDto.report_type invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.report_type = 12345;
    reject(dto, 'report_type');
  });

  it('CreateExportDto.period requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.period;
    reject(dto, 'period');
  });
  it('CreateExportDto.period invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.period = 12345;
    reject(dto, 'period');
  });
});

const valid_ExportIdParam = () => plainToInstance(ExportIdParam, {
      id: "000000000000000000000000000000000000",
    });

describe('ExportIdParam (4.2)', () => {
  const valid = valid_ExportIdParam;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('ExportIdParam.id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.id;
    reject(dto, 'id');
  });
  it('ExportIdParam.id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.id = 12345;
    reject(dto, 'id');
  });
});
