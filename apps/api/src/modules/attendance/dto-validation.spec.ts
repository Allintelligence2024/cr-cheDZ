/**
 * 4.2 — Validation des DTO du module attendance.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CheckInDto,
  MarkAbsentDto,
  CorrectAttendanceDto,
  AttendanceSummaryQuery,
} from './dto/attendance.dto';

const valid_CheckInDto = () => plainToInstance(CheckInDto, {
      child_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('CheckInDto (4.2)', () => {
  const valid = valid_CheckInDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CheckInDto.child_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_id;
    reject(dto, 'child_id');
  });
  it('CheckInDto.child_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.child_id = "not-a-uuid";
    reject(dto, 'child_id');
  });

  it('CheckInDto.site_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.site_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CheckInDto.occurred_at optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.occurred_at;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_MarkAbsentDto = () => plainToInstance(MarkAbsentDto, {
      child_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('MarkAbsentDto (4.2)', () => {
  const valid = valid_MarkAbsentDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('MarkAbsentDto.child_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_id;
    reject(dto, 'child_id');
  });
  it('MarkAbsentDto.child_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.child_id = "not-a-uuid";
    reject(dto, 'child_id');
  });

  it('MarkAbsentDto.reason optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.reason;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('MarkAbsentDto.occurred_at optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.occurred_at;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_CorrectAttendanceDto = () => plainToInstance(CorrectAttendanceDto, {
      child_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      action: "check_in",
      reason: "xxx",
    });

describe('CorrectAttendanceDto (4.2)', () => {
  const valid = valid_CorrectAttendanceDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CorrectAttendanceDto.child_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_id;
    reject(dto, 'child_id');
  });
  it('CorrectAttendanceDto.child_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.child_id = "not-a-uuid";
    reject(dto, 'child_id');
  });

  it('CorrectAttendanceDto.action requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.action;
    reject(dto, 'action');
  });
  it('CorrectAttendanceDto.action invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.action = 12345;
    reject(dto, 'action');
  });

  it('CorrectAttendanceDto.reason requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.reason;
    reject(dto, 'reason');
  });
  it('CorrectAttendanceDto.reason invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.reason = "xx";
    reject(dto, 'reason');
  });

  it('CorrectAttendanceDto.occurred_at optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.occurred_at;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_AttendanceSummaryQuery = () => plainToInstance(AttendanceSummaryQuery, {
    });

describe('AttendanceSummaryQuery (4.2)', () => {
  const valid = valid_AttendanceSummaryQuery;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('AttendanceSummaryQuery.room_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.room_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('AttendanceSummaryQuery.date optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.date;
    expect(validateSync(dto)).toHaveLength(0);
  });
});
