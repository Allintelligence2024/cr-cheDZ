/**
 * 4.2 — Validation des DTO du module staff.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateStaffDto,
  UpdateStaffDto,
  CreateStaffDocumentDto,
  CreateStaffAssignmentDto,
  StaffAttendanceDto,
  CreateShiftDto,
  GenerateWeekDto,
  ScheduleQuery,
  CoverageQuery,
} from './dto/staff.dto';

const valid_CreateStaffDto = () => plainToInstance(CreateStaffDto, {
      user_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      qualification: "educator_qualified",
      hire_date: "2026-01-15",
    });

describe('CreateStaffDto (4.2)', () => {
  const valid = valid_CreateStaffDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateStaffDto.user_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.user_id;
    reject(dto, 'user_id');
  });
  it('CreateStaffDto.user_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.user_id = "not-a-uuid";
    reject(dto, 'user_id');
  });

  it('CreateStaffDto.employee_number optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.employee_number;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateStaffDto.national_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.national_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateStaffDto.cnas_number optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.cnas_number;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateStaffDto.qualification requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.qualification;
    reject(dto, 'qualification');
  });
  it('CreateStaffDto.qualification invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.qualification = 12345;
    reject(dto, 'qualification');
  });

  it('CreateStaffDto.hire_date requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.hire_date;
    reject(dto, 'hire_date');
  });
  it('CreateStaffDto.hire_date invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.hire_date = "not-a-date";
    reject(dto, 'hire_date');
  });

  it('CreateStaffDto.contract_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.contract_type;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateStaffDto.base_salary optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.base_salary;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateStaffDto.phone optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.phone;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateStaffDto.emergency_contact_name optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.emergency_contact_name;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateStaffDto.emergency_contact_phone optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.emergency_contact_phone;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateStaffDto.notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.notes;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_UpdateStaffDto = () => plainToInstance(UpdateStaffDto, {
    });

describe('UpdateStaffDto (4.2)', () => {
  const valid = valid_UpdateStaffDto;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('UpdateStaffDto.employee_number optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.employee_number;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateStaffDto.national_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.national_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateStaffDto.cnas_number optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.cnas_number;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateStaffDto.qualification optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.qualification;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateStaffDto.contract_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.contract_type;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateStaffDto.base_salary optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.base_salary;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateStaffDto.phone optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.phone;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateStaffDto.notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.notes;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateStaffDto.is_active optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.is_active;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_CreateStaffDocumentDto = () => plainToInstance(CreateStaffDocumentDto, {
      document_type: "xx",
      title: "xx",
      storage_key: "xxx",
    });

describe('CreateStaffDocumentDto (4.2)', () => {
  const valid = valid_CreateStaffDocumentDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateStaffDocumentDto.document_type requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.document_type;
    reject(dto, 'document_type');
  });
  it('CreateStaffDocumentDto.document_type invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.document_type = "x";
    reject(dto, 'document_type');
  });

  it('CreateStaffDocumentDto.title requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.title;
    reject(dto, 'title');
  });
  it('CreateStaffDocumentDto.title invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.title = "x";
    reject(dto, 'title');
  });

  it('CreateStaffDocumentDto.storage_key requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.storage_key;
    reject(dto, 'storage_key');
  });
  it('CreateStaffDocumentDto.storage_key invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.storage_key = "xx";
    reject(dto, 'storage_key');
  });

  it('CreateStaffDocumentDto.issued_date optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.issued_date;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateStaffDocumentDto.expiry_date optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.expiry_date;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateStaffDocumentDto.issuing_authority optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.issuing_authority;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateStaffDocumentDto.alert_days_before optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.alert_days_before;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_CreateStaffAssignmentDto = () => plainToInstance(CreateStaffAssignmentDto, {
      room_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      start_date: "2026-01-15",
    });

describe('CreateStaffAssignmentDto (4.2)', () => {
  const valid = valid_CreateStaffAssignmentDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateStaffAssignmentDto.room_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.room_id;
    reject(dto, 'room_id');
  });
  it('CreateStaffAssignmentDto.room_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.room_id = "not-a-uuid";
    reject(dto, 'room_id');
  });

  it('CreateStaffAssignmentDto.site_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.site_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateStaffAssignmentDto.is_primary optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.is_primary;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateStaffAssignmentDto.start_date requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.start_date;
    reject(dto, 'start_date');
  });
  it('CreateStaffAssignmentDto.start_date invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.start_date = "not-a-date";
    reject(dto, 'start_date');
  });

  it('CreateStaffAssignmentDto.end_date optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.end_date;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_StaffAttendanceDto = () => plainToInstance(StaffAttendanceDto, {
      attendance_date: "2026-01-15",
    });

describe('StaffAttendanceDto (4.2)', () => {
  const valid = valid_StaffAttendanceDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('StaffAttendanceDto.attendance_date requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.attendance_date;
    reject(dto, 'attendance_date');
  });
  it('StaffAttendanceDto.attendance_date invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.attendance_date = "not-a-date";
    reject(dto, 'attendance_date');
  });

  it('StaffAttendanceDto.check_in optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.check_in;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('StaffAttendanceDto.check_out optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.check_out;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('StaffAttendanceDto.absence_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.absence_type;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('StaffAttendanceDto.notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.notes;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_CreateShiftDto = () => plainToInstance(CreateShiftDto, {
      staff_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      shift_date: "2026-01-15",
      start_time: "00:00",
      end_time: "00:00",
    });

describe('CreateShiftDto (4.2)', () => {
  const valid = valid_CreateShiftDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateShiftDto.staff_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.staff_id;
    reject(dto, 'staff_id');
  });
  it('CreateShiftDto.staff_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.staff_id = "not-a-uuid";
    reject(dto, 'staff_id');
  });

  it('CreateShiftDto.room_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.room_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateShiftDto.site_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.site_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateShiftDto.shift_date requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.shift_date;
    reject(dto, 'shift_date');
  });
  it('CreateShiftDto.shift_date invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.shift_date = "not-a-date";
    reject(dto, 'shift_date');
  });

  it('CreateShiftDto.start_time requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.start_time;
    reject(dto, 'start_time');
  });
  it('CreateShiftDto.start_time invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.start_time = 12345;
    reject(dto, 'start_time');
  });

  it('CreateShiftDto.end_time requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.end_time;
    reject(dto, 'end_time');
  });
  it('CreateShiftDto.end_time invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.end_time = 12345;
    reject(dto, 'end_time');
  });

  it('CreateShiftDto.shift_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.shift_type;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateShiftDto.notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.notes;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_GenerateWeekDto = () => plainToInstance(GenerateWeekDto, {
      week_start: "2026-01-15",
    });

describe('GenerateWeekDto (4.2)', () => {
  const valid = valid_GenerateWeekDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('GenerateWeekDto.week_start requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.week_start;
    reject(dto, 'week_start');
  });
  it('GenerateWeekDto.week_start invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.week_start = "not-a-date";
    reject(dto, 'week_start');
  });

  it('GenerateWeekDto.days optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.days;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('GenerateWeekDto.start_time optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.start_time;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('GenerateWeekDto.end_time optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.end_time;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('GenerateWeekDto.site_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.site_id;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_ScheduleQuery = () => plainToInstance(ScheduleQuery, {
      from: "2026-01-15",
      to: "2026-01-15",
    });

describe('ScheduleQuery (4.2)', () => {
  const valid = valid_ScheduleQuery;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('ScheduleQuery.from requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.from;
    reject(dto, 'from');
  });
  it('ScheduleQuery.from invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.from = "not-a-date";
    reject(dto, 'from');
  });

  it('ScheduleQuery.to requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.to;
    reject(dto, 'to');
  });
  it('ScheduleQuery.to invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.to = "not-a-date";
    reject(dto, 'to');
  });

  it('ScheduleQuery.site_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.site_id;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_CoverageQuery = () => plainToInstance(CoverageQuery, {
      date: "2026-01-15",
    });

describe('CoverageQuery (4.2)', () => {
  const valid = valid_CoverageQuery;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CoverageQuery.date requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.date;
    reject(dto, 'date');
  });
  it('CoverageQuery.date invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.date = "not-a-date";
    reject(dto, 'date');
  });

  it('CoverageQuery.site_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.site_id;
    expect(validateSync(dto)).toHaveLength(0);
  });
});
