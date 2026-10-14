/**
 * 4.2 — Validation des DTO du module health.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  UpsertHealthRecordDto,
  CreateAllergyDto,
  UpdateAllergyDto,
  CreateVaccinationDto,
  UpdateVaccinationDto,
  CreateMedicationAuthorizationDto,
  RecordMedicationAdministrationDto,
  ChildIdParam,
  AllergyIdParam,
  VaccinationIdParam,
  MedAuthIdParam,
  MedAdminIdParam,
} from './dto/health.dto';

const valid_UpsertHealthRecordDto = () => plainToInstance(UpsertHealthRecordDto, {
    });

describe('UpsertHealthRecordDto (4.2)', () => {
  const valid = valid_UpsertHealthRecordDto;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('UpsertHealthRecordDto.blood_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.blood_type;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpsertHealthRecordDto.family_doctor optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.family_doctor;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpsertHealthRecordDto.doctor_phone optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.doctor_phone;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpsertHealthRecordDto.health_insurance optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.health_insurance;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpsertHealthRecordDto.chronic_conditions optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.chronic_conditions;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpsertHealthRecordDto.general_notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.general_notes;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_CreateAllergyDto = () => plainToInstance(CreateAllergyDto, {
      allergen: "ok",
      allergen_type: "food",
      severity: "mild",
    });

describe('CreateAllergyDto (4.2)', () => {
  const valid = valid_CreateAllergyDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateAllergyDto.allergen requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.allergen;
    reject(dto, 'allergen');
  });
  it('CreateAllergyDto.allergen invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.allergen = 12345;
    reject(dto, 'allergen');
  });

  it('CreateAllergyDto.allergen_type requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.allergen_type;
    reject(dto, 'allergen_type');
  });
  it('CreateAllergyDto.allergen_type invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.allergen_type = 12345;
    reject(dto, 'allergen_type');
  });

  it('CreateAllergyDto.severity requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.severity;
    reject(dto, 'severity');
  });
  it('CreateAllergyDto.severity invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.severity = 12345;
    reject(dto, 'severity');
  });

  it('CreateAllergyDto.reaction optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.reaction;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateAllergyDto.treatment optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.treatment;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateAllergyDto.emergency_protocol optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.emergency_protocol;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateAllergyDto.confirmed_by_doctor optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.confirmed_by_doctor;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateAllergyDto.diagnosed_date optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.diagnosed_date;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateAllergyDto.notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.notes;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_UpdateAllergyDto = () => plainToInstance(UpdateAllergyDto, {
    });

describe('UpdateAllergyDto (4.2)', () => {
  const valid = valid_UpdateAllergyDto;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('UpdateAllergyDto.allergen optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.allergen;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateAllergyDto.allergen_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.allergen_type;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateAllergyDto.severity optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.severity;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateAllergyDto.is_active optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.is_active;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_CreateVaccinationDto = () => plainToInstance(CreateVaccinationDto, {
      vaccine_name: "ok",
    });

describe('CreateVaccinationDto (4.2)', () => {
  const valid = valid_CreateVaccinationDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateVaccinationDto.vaccine_name requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.vaccine_name;
    reject(dto, 'vaccine_name');
  });
  it('CreateVaccinationDto.vaccine_name invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.vaccine_name = 12345;
    reject(dto, 'vaccine_name');
  });

  it('CreateVaccinationDto.dose_number optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.dose_number;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateVaccinationDto.administered_date optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.administered_date;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateVaccinationDto.next_dose_date optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.next_dose_date;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateVaccinationDto.administered_by optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.administered_by;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateVaccinationDto.lot_number optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.lot_number;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_UpdateVaccinationDto = () => plainToInstance(UpdateVaccinationDto, {
    });

describe('UpdateVaccinationDto (4.2)', () => {
  const valid = valid_UpdateVaccinationDto;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('UpdateVaccinationDto.next_dose_date optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.next_dose_date;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateVaccinationDto.verified optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.verified;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_CreateMedicationAuthorizationDto = () => plainToInstance(CreateMedicationAuthorizationDto, {
      guardian_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      medication_name: "ok",
      dosage: "ok",
      frequency: "ok",
      start_date: "2026-01-15",
    });

describe('CreateMedicationAuthorizationDto (4.2)', () => {
  const valid = valid_CreateMedicationAuthorizationDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateMedicationAuthorizationDto.guardian_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.guardian_id;
    reject(dto, 'guardian_id');
  });
  it('CreateMedicationAuthorizationDto.guardian_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.guardian_id = "not-a-uuid";
    reject(dto, 'guardian_id');
  });

  it('CreateMedicationAuthorizationDto.medication_name requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.medication_name;
    reject(dto, 'medication_name');
  });
  it('CreateMedicationAuthorizationDto.medication_name invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.medication_name = 12345;
    reject(dto, 'medication_name');
  });

  it('CreateMedicationAuthorizationDto.dosage requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.dosage;
    reject(dto, 'dosage');
  });
  it('CreateMedicationAuthorizationDto.dosage invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.dosage = 12345;
    reject(dto, 'dosage');
  });

  it('CreateMedicationAuthorizationDto.frequency requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.frequency;
    reject(dto, 'frequency');
  });
  it('CreateMedicationAuthorizationDto.frequency invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.frequency = 12345;
    reject(dto, 'frequency');
  });

  it('CreateMedicationAuthorizationDto.administration_times optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.administration_times;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateMedicationAuthorizationDto.start_date requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.start_date;
    reject(dto, 'start_date');
  });
  it('CreateMedicationAuthorizationDto.start_date invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.start_date = "not-a-date";
    reject(dto, 'start_date');
  });

  it('CreateMedicationAuthorizationDto.end_date optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.end_date;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateMedicationAuthorizationDto.special_instructions optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.special_instructions;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_RecordMedicationAdministrationDto = () => plainToInstance(RecordMedicationAdministrationDto, {
      authorization_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      administered_at: "2026-01-15",
      dose_given: "ok",
    });

describe('RecordMedicationAdministrationDto (4.2)', () => {
  const valid = valid_RecordMedicationAdministrationDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('RecordMedicationAdministrationDto.authorization_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.authorization_id;
    reject(dto, 'authorization_id');
  });
  it('RecordMedicationAdministrationDto.authorization_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.authorization_id = "not-a-uuid";
    reject(dto, 'authorization_id');
  });

  it('RecordMedicationAdministrationDto.administered_at requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.administered_at;
    reject(dto, 'administered_at');
  });
  it('RecordMedicationAdministrationDto.administered_at invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.administered_at = "not-a-date";
    reject(dto, 'administered_at');
  });

  it('RecordMedicationAdministrationDto.dose_given requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.dose_given;
    reject(dto, 'dose_given');
  });
  it('RecordMedicationAdministrationDto.dose_given invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.dose_given = 12345;
    reject(dto, 'dose_given');
  });

  it('RecordMedicationAdministrationDto.observations optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.observations;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_ChildIdParam = () => plainToInstance(ChildIdParam, {
      childId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('ChildIdParam (4.2)', () => {
  const valid = valid_ChildIdParam;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('ChildIdParam.childId requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.childId;
    reject(dto, 'childId');
  });
  it('ChildIdParam.childId invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.childId = "not-a-uuid";
    reject(dto, 'childId');
  });
});

const valid_AllergyIdParam = () => plainToInstance(AllergyIdParam, {
      id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('AllergyIdParam (4.2)', () => {
  const valid = valid_AllergyIdParam;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('AllergyIdParam.id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.id;
    reject(dto, 'id');
  });
  it('AllergyIdParam.id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.id = "not-a-uuid";
    reject(dto, 'id');
  });
});

const valid_VaccinationIdParam = () => plainToInstance(VaccinationIdParam, {
      id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('VaccinationIdParam (4.2)', () => {
  const valid = valid_VaccinationIdParam;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('VaccinationIdParam.id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.id;
    reject(dto, 'id');
  });
  it('VaccinationIdParam.id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.id = "not-a-uuid";
    reject(dto, 'id');
  });
});

const valid_MedAuthIdParam = () => plainToInstance(MedAuthIdParam, {
      id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('MedAuthIdParam (4.2)', () => {
  const valid = valid_MedAuthIdParam;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('MedAuthIdParam.id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.id;
    reject(dto, 'id');
  });
  it('MedAuthIdParam.id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.id = "not-a-uuid";
    reject(dto, 'id');
  });
});

const valid_MedAdminIdParam = () => plainToInstance(MedAdminIdParam, {
      id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('MedAdminIdParam (4.2)', () => {
  const valid = valid_MedAdminIdParam;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('MedAdminIdParam.id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.id;
    reject(dto, 'id');
  });
  it('MedAdminIdParam.id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.id = "not-a-uuid";
    reject(dto, 'id');
  });
});
