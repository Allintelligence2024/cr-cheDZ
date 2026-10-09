/**
 * 4.2 — Validation des DTO du module children.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateChildDto,
  UpdateChildDto,
  MoveRoomDto,
  ListChildrenQuery,
} from './dto/children.dto';
import {
  CreateGuardianDto,
  UpdateGuardianDto,
  LinkGuardianDto,
  CreateEmergencyContactDto,
  CreatePickupDto,
  UpdatePickupDto,
} from './dto/guardians.dto';
import {
  ImportChildRowDto,
  ImportChildrenDto,
} from './dto/import.dto';

const valid_CreateChildDto = () => plainToInstance(CreateChildDto, {
      site_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      first_name_fr: "xx",
      last_name_fr: "xx",
      date_of_birth: "2026-01-15",
    });

describe('CreateChildDto (4.2)', () => {
  const valid = valid_CreateChildDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateChildDto.site_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.site_id;
    reject(dto, 'site_id');
  });
  it('CreateChildDto.site_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.site_id = "not-a-uuid";
    reject(dto, 'site_id');
  });

  it('CreateChildDto.room_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.room_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateChildDto.first_name_fr requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.first_name_fr;
    reject(dto, 'first_name_fr');
  });
  it('CreateChildDto.first_name_fr invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.first_name_fr = "x";
    reject(dto, 'first_name_fr');
  });

  it('CreateChildDto.first_name_ar optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.first_name_ar;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateChildDto.last_name_fr requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.last_name_fr;
    reject(dto, 'last_name_fr');
  });
  it('CreateChildDto.last_name_fr invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.last_name_fr = "x";
    reject(dto, 'last_name_fr');
  });

  it('CreateChildDto.last_name_ar optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.last_name_ar;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateChildDto.date_of_birth requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.date_of_birth;
    reject(dto, 'date_of_birth');
  });
  it('CreateChildDto.date_of_birth invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.date_of_birth = "not-a-date";
    reject(dto, 'date_of_birth');
  });

  it('CreateChildDto.gender optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.gender;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateChildDto.status optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.status;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateChildDto.enrollment_date optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.enrollment_date;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateChildDto.schedule_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.schedule_type;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateChildDto.is_walking optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.is_walking;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateChildDto.has_special_needs optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.has_special_needs;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateChildDto.special_needs_notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.special_needs_notes;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateChildDto.notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.notes;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_UpdateChildDto = () => plainToInstance(UpdateChildDto, {
    });

describe('UpdateChildDto (4.2)', () => {
  const valid = valid_UpdateChildDto;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('UpdateChildDto.room_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.room_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateChildDto.first_name_fr optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.first_name_fr;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateChildDto.first_name_ar optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.first_name_ar;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateChildDto.last_name_fr optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.last_name_fr;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateChildDto.last_name_ar optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.last_name_ar;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateChildDto.gender optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.gender;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateChildDto.status optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.status;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateChildDto.enrollment_date optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.enrollment_date;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateChildDto.departure_date optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.departure_date;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateChildDto.departure_reason optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.departure_reason;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateChildDto.schedule_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.schedule_type;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateChildDto.is_walking optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.is_walking;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateChildDto.has_special_needs optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.has_special_needs;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateChildDto.special_needs_notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.special_needs_notes;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateChildDto.notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.notes;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_MoveRoomDto = () => plainToInstance(MoveRoomDto, {
      room_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('MoveRoomDto (4.2)', () => {
  const valid = valid_MoveRoomDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('MoveRoomDto.room_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.room_id;
    reject(dto, 'room_id');
  });
  it('MoveRoomDto.room_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.room_id = "not-a-uuid";
    reject(dto, 'room_id');
  });

  it('MoveRoomDto.reason optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.reason;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_ListChildrenQuery = () => plainToInstance(ListChildrenQuery, {
    });

describe('ListChildrenQuery (4.2)', () => {
  const valid = valid_ListChildrenQuery;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('ListChildrenQuery.site_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.site_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ListChildrenQuery.room_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.room_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ListChildrenQuery.status optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.status;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ListChildrenQuery.search optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.search;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ListChildrenQuery.limit optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.limit;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ListChildrenQuery.offset optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.offset;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_CreateGuardianDto = () => plainToInstance(CreateGuardianDto, {
      first_name_fr: "xx",
      last_name_fr: "xx",
      relationship: "xx",
    });

describe('CreateGuardianDto (4.2)', () => {
  const valid = valid_CreateGuardianDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateGuardianDto.first_name_fr requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.first_name_fr;
    reject(dto, 'first_name_fr');
  });
  it('CreateGuardianDto.first_name_fr invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.first_name_fr = "x";
    reject(dto, 'first_name_fr');
  });

  it('CreateGuardianDto.first_name_ar optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.first_name_ar;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateGuardianDto.last_name_fr requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.last_name_fr;
    reject(dto, 'last_name_fr');
  });
  it('CreateGuardianDto.last_name_fr invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.last_name_fr = "x";
    reject(dto, 'last_name_fr');
  });

  it('CreateGuardianDto.last_name_ar optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.last_name_ar;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateGuardianDto.relationship requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.relationship;
    reject(dto, 'relationship');
  });
  it('CreateGuardianDto.relationship invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.relationship = "x";
    reject(dto, 'relationship');
  });

  it('CreateGuardianDto.phone_primary optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.phone_primary;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateGuardianDto.phone_secondary optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.phone_secondary;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateGuardianDto.email optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.email;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateGuardianDto.national_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.national_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateGuardianDto.address optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.address;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateGuardianDto.employer optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.employer;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateGuardianDto.user_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.user_id;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_UpdateGuardianDto = () => plainToInstance(UpdateGuardianDto, {
    });

describe('UpdateGuardianDto (4.2)', () => {
  const valid = valid_UpdateGuardianDto;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('UpdateGuardianDto.first_name_fr optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.first_name_fr;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateGuardianDto.last_name_fr optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.last_name_fr;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateGuardianDto.relationship optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.relationship;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateGuardianDto.phone_primary optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.phone_primary;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateGuardianDto.phone_secondary optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.phone_secondary;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateGuardianDto.email optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.email;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateGuardianDto.address optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.address;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateGuardianDto.employer optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.employer;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_LinkGuardianDto = () => plainToInstance(LinkGuardianDto, {
      guardian_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('LinkGuardianDto (4.2)', () => {
  const valid = valid_LinkGuardianDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('LinkGuardianDto.guardian_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.guardian_id;
    reject(dto, 'guardian_id');
  });
  it('LinkGuardianDto.guardian_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.guardian_id = "not-a-uuid";
    reject(dto, 'guardian_id');
  });

  it('LinkGuardianDto.is_legal_guardian optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.is_legal_guardian;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('LinkGuardianDto.is_primary optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.is_primary;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('LinkGuardianDto.can_view_journal optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.can_view_journal;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('LinkGuardianDto.can_view_health optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.can_view_health;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('LinkGuardianDto.can_receive_invoices optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.can_receive_invoices;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('LinkGuardianDto.can_pay_invoices optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.can_pay_invoices;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('LinkGuardianDto.can_pickup optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.can_pickup;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('LinkGuardianDto.can_authorize_pickup optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.can_authorize_pickup;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('LinkGuardianDto.can_receive_push optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.can_receive_push;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('LinkGuardianDto.receives_invoice_copies optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.receives_invoice_copies;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('LinkGuardianDto.priority_order optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.priority_order;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_CreateEmergencyContactDto = () => plainToInstance(CreateEmergencyContactDto, {
      first_name: "xx",
      last_name: "xx",
      relationship: "xx",
      phone_primary: "xxxxxx",
    });

describe('CreateEmergencyContactDto (4.2)', () => {
  const valid = valid_CreateEmergencyContactDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateEmergencyContactDto.first_name requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.first_name;
    reject(dto, 'first_name');
  });
  it('CreateEmergencyContactDto.first_name invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.first_name = "x";
    reject(dto, 'first_name');
  });

  it('CreateEmergencyContactDto.last_name requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.last_name;
    reject(dto, 'last_name');
  });
  it('CreateEmergencyContactDto.last_name invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.last_name = "x";
    reject(dto, 'last_name');
  });

  it('CreateEmergencyContactDto.relationship requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.relationship;
    reject(dto, 'relationship');
  });
  it('CreateEmergencyContactDto.relationship invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.relationship = "x";
    reject(dto, 'relationship');
  });

  it('CreateEmergencyContactDto.phone_primary requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.phone_primary;
    reject(dto, 'phone_primary');
  });
  it('CreateEmergencyContactDto.phone_primary invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.phone_primary = "xxxxx";
    reject(dto, 'phone_primary');
  });

  it('CreateEmergencyContactDto.phone_secondary optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.phone_secondary;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateEmergencyContactDto.priority_order optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.priority_order;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_CreatePickupDto = () => plainToInstance(CreatePickupDto, {
      first_name: "xx",
      last_name: "xx",
      relationship: "xx",
    });

describe('CreatePickupDto (4.2)', () => {
  const valid = valid_CreatePickupDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreatePickupDto.first_name requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.first_name;
    reject(dto, 'first_name');
  });
  it('CreatePickupDto.first_name invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.first_name = "x";
    reject(dto, 'first_name');
  });

  it('CreatePickupDto.last_name requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.last_name;
    reject(dto, 'last_name');
  });
  it('CreatePickupDto.last_name invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.last_name = "x";
    reject(dto, 'last_name');
  });

  it('CreatePickupDto.relationship requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.relationship;
    reject(dto, 'relationship');
  });
  it('CreatePickupDto.relationship invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.relationship = "x";
    reject(dto, 'relationship');
  });

  it('CreatePickupDto.phone optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.phone;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreatePickupDto.national_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.national_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreatePickupDto.valid_from optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.valid_from;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreatePickupDto.valid_until optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.valid_until;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_UpdatePickupDto = () => plainToInstance(UpdatePickupDto, {
    });

describe('UpdatePickupDto (4.2)', () => {
  const valid = valid_UpdatePickupDto;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('UpdatePickupDto.is_active optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.is_active;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_ImportChildRowDto = () => plainToInstance(ImportChildRowDto, {
    });

describe('ImportChildRowDto (4.2)', () => {
  const valid = valid_ImportChildRowDto;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('ImportChildRowDto.first_name_fr optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.first_name_fr;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ImportChildRowDto.last_name_fr optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.last_name_fr;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ImportChildRowDto.date_of_birth optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.date_of_birth;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ImportChildRowDto.gender optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.gender;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ImportChildRowDto.room_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.room_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ImportChildRowDto.guardian_first_name optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.guardian_first_name;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ImportChildRowDto.guardian_last_name optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.guardian_last_name;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ImportChildRowDto.guardian_phone optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.guardian_phone;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ImportChildRowDto.guardian_relationship optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.guardian_relationship;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ImportChildRowDto.notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.notes;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_ImportChildrenDto = () => plainToInstance(ImportChildrenDto, {
      rows: [valid_ImportChildRowDto()],
    });

describe('ImportChildrenDto (4.2)', () => {
  const valid = valid_ImportChildrenDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('ImportChildrenDto.dry_run optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.dry_run;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ImportChildrenDto.rows requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.rows;
    reject(dto, 'rows');
  });
  it('ImportChildrenDto.rows invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.rows = "not-an-array";
    reject(dto, 'rows');
  });
});
