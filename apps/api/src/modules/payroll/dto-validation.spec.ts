/**
 * 4.2 — Validation des DTO du module payroll.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  GeneratePayrollDto,
  PayrollLineDto,
  AddLineDto,
  EntryIdParam,
  RunIdParam,
} from './dto/payroll.dto';

const valid_GeneratePayrollDto = () => plainToInstance(GeneratePayrollDto, {
      period_year: 2020,
      period_month: 1,
    });

describe('GeneratePayrollDto (4.2)', () => {
  const valid = valid_GeneratePayrollDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('GeneratePayrollDto.period_year requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.period_year;
    reject(dto, 'period_year');
  });
  it('GeneratePayrollDto.period_year invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.period_year = 1.5;
    reject(dto, 'period_year');
  });

  it('GeneratePayrollDto.period_month requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.period_month;
    reject(dto, 'period_month');
  });
  it('GeneratePayrollDto.period_month invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.period_month = 1.5;
    reject(dto, 'period_month');
  });
});

const valid_PayrollLineDto = () => plainToInstance(PayrollLineDto, {
      line_type: "base",
      label_fr: "ok",
      amount: -999999,
    });

describe('PayrollLineDto (4.2)', () => {
  const valid = valid_PayrollLineDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('PayrollLineDto.line_type requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.line_type;
    reject(dto, 'line_type');
  });
  it('PayrollLineDto.line_type invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.line_type = 12345;
    reject(dto, 'line_type');
  });

  it('PayrollLineDto.label_fr requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.label_fr;
    reject(dto, 'label_fr');
  });
  it('PayrollLineDto.label_fr invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.label_fr = 12345;
    reject(dto, 'label_fr');
  });

  it('PayrollLineDto.label_ar optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.label_ar;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('PayrollLineDto.amount requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.amount;
    reject(dto, 'amount');
  });
  it('PayrollLineDto.amount invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.amount = "not-a-number";
    reject(dto, 'amount');
  });
});

const valid_AddLineDto = () => plainToInstance(AddLineDto, {
      lines: [valid_PayrollLineDto()],
    });

describe('AddLineDto (4.2)', () => {
  const valid = valid_AddLineDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('AddLineDto.lines requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.lines;
    reject(dto, 'lines');
  });
  it('AddLineDto.lines invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.lines = "not-an-array";
    reject(dto, 'lines');
  });
});

const valid_EntryIdParam = () => plainToInstance(EntryIdParam, {
      id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('EntryIdParam (4.2)', () => {
  const valid = valid_EntryIdParam;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('EntryIdParam.id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.id;
    reject(dto, 'id');
  });
  it('EntryIdParam.id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.id = "not-a-uuid";
    reject(dto, 'id');
  });
});

const valid_RunIdParam = () => plainToInstance(RunIdParam, {
      id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('RunIdParam (4.2)', () => {
  const valid = valid_RunIdParam;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('RunIdParam.id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.id;
    reject(dto, 'id');
  });
  it('RunIdParam.id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.id = "not-a-uuid";
    reject(dto, 'id');
  });
});
