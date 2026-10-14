/**
 * 4.2 — Validation des DTO du module organizations.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateInvitationDto,
} from './dto/invitations.dto';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  CreateSiteDto,
  UpdateSiteDto,
  CreateRoomDto,
  UpdateRoomDto,
} from './dto/organizations.dto';

const valid_CreateInvitationDto = () => plainToInstance(CreateInvitationDto, {
      email: "a@b.co",
      role_slug: "super_admin",
    });

describe('CreateInvitationDto (4.2)', () => {
  const valid = valid_CreateInvitationDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateInvitationDto.email requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.email;
    reject(dto, 'email');
  });
  it('CreateInvitationDto.email invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.email = "not-an-email";
    reject(dto, 'email');
  });

  it('CreateInvitationDto.role_slug requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.role_slug;
    reject(dto, 'role_slug');
  });
  it('CreateInvitationDto.role_slug invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.role_slug = 12345;
    reject(dto, 'role_slug');
  });

  it('CreateInvitationDto.first_name optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.first_name;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateInvitationDto.last_name optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.last_name;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateInvitationDto.site_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.site_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateInvitationDto.room_ids optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.room_ids;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateInvitationDto.organization_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.organization_id;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_CreateOrganizationDto = () => plainToInstance(CreateOrganizationDto, {
      slug: "aaa",
      name_fr: "xx",
      wilaya: "x",
    });

describe('CreateOrganizationDto (4.2)', () => {
  const valid = valid_CreateOrganizationDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateOrganizationDto.slug requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.slug;
    reject(dto, 'slug');
  });
  it('CreateOrganizationDto.slug invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.slug = 12345;
    reject(dto, 'slug');
  });

  it('CreateOrganizationDto.name_fr requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.name_fr;
    reject(dto, 'name_fr');
  });
  it('CreateOrganizationDto.name_fr invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.name_fr = "x";
    reject(dto, 'name_fr');
  });

  it('CreateOrganizationDto.name_ar optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.name_ar;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateOrganizationDto.legal_name optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.legal_name;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateOrganizationDto.establishment_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.establishment_type;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateOrganizationDto.registration_number optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.registration_number;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateOrganizationDto.phone optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.phone;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateOrganizationDto.email optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.email;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateOrganizationDto.address_line1 optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.address_line1;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateOrganizationDto.commune optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.commune;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateOrganizationDto.wilaya requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.wilaya;
    reject(dto, 'wilaya');
  });
  it('CreateOrganizationDto.wilaya invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.wilaya = "";
    reject(dto, 'wilaya');
  });

  it('CreateOrganizationDto.max_children optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.max_children;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateOrganizationDto.timezone optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.timezone;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateOrganizationDto.settings optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.settings;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_UpdateOrganizationDto = () => plainToInstance(UpdateOrganizationDto, {
    });

describe('UpdateOrganizationDto (4.2)', () => {
  const valid = valid_UpdateOrganizationDto;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('UpdateOrganizationDto.name_fr optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.name_fr;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateOrganizationDto.name_ar optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.name_ar;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateOrganizationDto.legal_name optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.legal_name;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateOrganizationDto.establishment_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.establishment_type;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateOrganizationDto.phone optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.phone;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateOrganizationDto.email optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.email;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateOrganizationDto.max_children optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.max_children;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateOrganizationDto.settings optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.settings;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_CreateSiteDto = () => plainToInstance(CreateSiteDto, {
      name_fr: "xx",
    });

describe('CreateSiteDto (4.2)', () => {
  const valid = valid_CreateSiteDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateSiteDto.name_fr requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.name_fr;
    reject(dto, 'name_fr');
  });
  it('CreateSiteDto.name_fr invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.name_fr = "x";
    reject(dto, 'name_fr');
  });

  it('CreateSiteDto.name_ar optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.name_ar;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateSiteDto.phone optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.phone;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateSiteDto.address_line1 optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.address_line1;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateSiteDto.commune optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.commune;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateSiteDto.wilaya optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.wilaya;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateSiteDto.authorized_capacity optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.authorized_capacity;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_UpdateSiteDto = () => plainToInstance(UpdateSiteDto, {
    });

describe('UpdateSiteDto (4.2)', () => {
  const valid = valid_UpdateSiteDto;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('UpdateSiteDto.name_fr optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.name_fr;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateSiteDto.name_ar optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.name_ar;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateSiteDto.phone optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.phone;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateSiteDto.authorized_capacity optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.authorized_capacity;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateSiteDto.is_active optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.is_active;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_CreateRoomDto = () => plainToInstance(CreateRoomDto, {
      name_fr: "xx",
      site_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });

describe('CreateRoomDto (4.2)', () => {
  const valid = valid_CreateRoomDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateRoomDto.name_fr requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.name_fr;
    reject(dto, 'name_fr');
  });
  it('CreateRoomDto.name_fr invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.name_fr = "x";
    reject(dto, 'name_fr');
  });

  it('CreateRoomDto.name_ar optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.name_ar;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateRoomDto.site_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.site_id;
    reject(dto, 'site_id');
  });
  it('CreateRoomDto.site_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.site_id = 12345;
    reject(dto, 'site_id');
  });

  it('CreateRoomDto.min_age_months optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.min_age_months;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateRoomDto.max_age_months optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.max_age_months;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateRoomDto.max_capacity optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.max_capacity;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_UpdateRoomDto = () => plainToInstance(UpdateRoomDto, {
    });

describe('UpdateRoomDto (4.2)', () => {
  const valid = valid_UpdateRoomDto;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('UpdateRoomDto.name_fr optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.name_fr;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateRoomDto.name_ar optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.name_ar;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateRoomDto.min_age_months optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.min_age_months;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateRoomDto.max_age_months optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.max_age_months;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateRoomDto.max_capacity optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.max_capacity;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateRoomDto.is_active optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.is_active;
    expect(validateSync(dto)).toHaveLength(0);
  });
});
