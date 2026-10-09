/**
 * 4.2 — Validation des DTO du module enrollment.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateEnrollmentRequestDto,
  OfferPlaceDto,
  DecideDto,
  EnrollmentListQuery,
} from './dto/enrollment.dto';

const valid_CreateEnrollmentRequestDto = () => plainToInstance(CreateEnrollmentRequestDto, {
      site_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      child_first_name: "ok",
      child_last_name: "ok",
      child_date_of_birth: "2026-01-15",
      guardian_name: "ok",
      guardian_phone: "00000000",
      desired_start_date: "2026-01-15",
    });

describe('CreateEnrollmentRequestDto (4.2)', () => {
  const valid = valid_CreateEnrollmentRequestDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateEnrollmentRequestDto.site_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.site_id;
    reject(dto, 'site_id');
  });
  it('CreateEnrollmentRequestDto.site_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.site_id = "not-a-uuid";
    reject(dto, 'site_id');
  });

  it('CreateEnrollmentRequestDto.child_first_name requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_first_name;
    reject(dto, 'child_first_name');
  });
  it('CreateEnrollmentRequestDto.child_first_name invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.child_first_name = 12345;
    reject(dto, 'child_first_name');
  });

  it('CreateEnrollmentRequestDto.child_last_name requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_last_name;
    reject(dto, 'child_last_name');
  });
  it('CreateEnrollmentRequestDto.child_last_name invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.child_last_name = 12345;
    reject(dto, 'child_last_name');
  });

  it('CreateEnrollmentRequestDto.child_date_of_birth requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_date_of_birth;
    reject(dto, 'child_date_of_birth');
  });
  it('CreateEnrollmentRequestDto.child_date_of_birth invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.child_date_of_birth = "not-a-date";
    reject(dto, 'child_date_of_birth');
  });

  it('CreateEnrollmentRequestDto.guardian_name requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.guardian_name;
    reject(dto, 'guardian_name');
  });
  it('CreateEnrollmentRequestDto.guardian_name invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.guardian_name = 12345;
    reject(dto, 'guardian_name');
  });

  it('CreateEnrollmentRequestDto.guardian_phone requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.guardian_phone;
    reject(dto, 'guardian_phone');
  });
  it('CreateEnrollmentRequestDto.guardian_phone invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.guardian_phone = 12345;
    reject(dto, 'guardian_phone');
  });

  it('CreateEnrollmentRequestDto.guardian_email optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.guardian_email;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateEnrollmentRequestDto.desired_start_date requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.desired_start_date;
    reject(dto, 'desired_start_date');
  });
  it('CreateEnrollmentRequestDto.desired_start_date invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.desired_start_date = "not-a-date";
    reject(dto, 'desired_start_date');
  });

  it('CreateEnrollmentRequestDto.schedule_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.schedule_type;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateEnrollmentRequestDto.has_sibling optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.has_sibling;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateEnrollmentRequestDto.is_staff_child optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.is_staff_child;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateEnrollmentRequestDto.priority_notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.priority_notes;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateEnrollmentRequestDto.notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.notes;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_OfferPlaceDto = () => plainToInstance(OfferPlaceDto, {
      room_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('OfferPlaceDto (4.2)', () => {
  const valid = valid_OfferPlaceDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('OfferPlaceDto.room_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.room_id;
    reject(dto, 'room_id');
  });
  it('OfferPlaceDto.room_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.room_id = "not-a-uuid";
    reject(dto, 'room_id');
  });

  it('OfferPlaceDto.offer_days optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.offer_days;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_DecideDto = () => plainToInstance(DecideDto, {
      decision: "accepted",
    });

describe('DecideDto (4.2)', () => {
  const valid = valid_DecideDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('DecideDto.decision requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.decision;
    reject(dto, 'decision');
  });
  it('DecideDto.decision invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.decision = 12345;
    reject(dto, 'decision');
  });

  it('DecideDto.notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.notes;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_EnrollmentListQuery = () => plainToInstance(EnrollmentListQuery, {
    });

describe('EnrollmentListQuery (4.2)', () => {
  const valid = valid_EnrollmentListQuery;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('EnrollmentListQuery.site_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.site_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('EnrollmentListQuery.status optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.status;
    expect(validateSync(dto)).toHaveLength(0);
  });
});
