/**
 * 4.2 — Validation des DTO du module identity.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  LoginDto,
  RefreshDto,
  SwitchOrgDto,
  ChangePasswordDto,
  TotpDto,
  ParentOtpRequestDto,
  ParentPinDto,
  AcceptInvitationDto,
} from './dto/auth.dto';
import {
  RegisterDeviceDto,
} from './dto/device.dto';

const valid_LoginDto = () => plainToInstance(LoginDto, {
      email: "a@b.co",
      password: "xxxxxxxx",
    });

describe('LoginDto (4.2)', () => {
  const valid = valid_LoginDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('LoginDto.email requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.email;
    reject(dto, 'email');
  });
  it('LoginDto.email invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.email = "not-an-email";
    reject(dto, 'email');
  });

  it('LoginDto.password requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.password;
    reject(dto, 'password');
  });
  it('LoginDto.password invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.password = "xxxxxxx";
    reject(dto, 'password');
  });

  it('LoginDto.totp_code optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.totp_code;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('LoginDto.device_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.device_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('LoginDto.web_client optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.web_client;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_RefreshDto = () => plainToInstance(RefreshDto, {
    });

describe('RefreshDto (4.2)', () => {
  const valid = valid_RefreshDto;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('RefreshDto.refresh_token optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.refresh_token;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('RefreshDto.device_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.device_id;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_SwitchOrgDto = () => plainToInstance(SwitchOrgDto, {
      organization_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('SwitchOrgDto (4.2)', () => {
  const valid = valid_SwitchOrgDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('SwitchOrgDto.organization_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.organization_id;
    reject(dto, 'organization_id');
  });
  it('SwitchOrgDto.organization_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.organization_id = "not-a-uuid";
    reject(dto, 'organization_id');
  });

  it('SwitchOrgDto.refresh_token optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.refresh_token;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('SwitchOrgDto.device_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.device_id;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_ChangePasswordDto = () => plainToInstance(ChangePasswordDto, {
      old_password: "xxxxxxxx",
      new_password: "xxxxxxxx",
    });

describe('ChangePasswordDto (4.2)', () => {
  const valid = valid_ChangePasswordDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('ChangePasswordDto.old_password requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.old_password;
    reject(dto, 'old_password');
  });
  it('ChangePasswordDto.old_password invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.old_password = "xxxxxxx";
    reject(dto, 'old_password');
  });

  it('ChangePasswordDto.new_password requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.new_password;
    reject(dto, 'new_password');
  });
  it('ChangePasswordDto.new_password invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.new_password = "xxxxxxx";
    reject(dto, 'new_password');
  });
});

const valid_TotpDto = () => plainToInstance(TotpDto, {
      code: "000000",
    });

describe('TotpDto (4.2)', () => {
  const valid = valid_TotpDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('TotpDto.code requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.code;
    reject(dto, 'code');
  });
  it('TotpDto.code invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.code = 12345;
    reject(dto, 'code');
  });
});

const valid_ParentOtpRequestDto = () => plainToInstance(ParentOtpRequestDto, {
      phone: "00000000",
    });

describe('ParentOtpRequestDto (4.2)', () => {
  const valid = valid_ParentOtpRequestDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('ParentOtpRequestDto.phone requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.phone;
    reject(dto, 'phone');
  });
  it('ParentOtpRequestDto.phone invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.phone = 12345;
    reject(dto, 'phone');
  });

  it('ParentOtpRequestDto.channel optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.channel;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_ParentPinDto = () => plainToInstance(ParentPinDto, {
      pin: "0000",
    });

describe('ParentPinDto (4.2)', () => {
  const valid = valid_ParentPinDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('ParentPinDto.pin requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.pin;
    reject(dto, 'pin');
  });
  it('ParentPinDto.pin invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.pin = 12345;
    reject(dto, 'pin');
  });

  it('ParentPinDto.totp_code optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.totp_code;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_AcceptInvitationDto = () => plainToInstance(AcceptInvitationDto, {
      invitation_token: "xxxxxxxxxxxxxxxx",
      first_name: "xx",
      last_name: "xx",
      password: "xxxxxxxx",
    });

describe('AcceptInvitationDto (4.2)', () => {
  const valid = valid_AcceptInvitationDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('AcceptInvitationDto.invitation_token requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.invitation_token;
    reject(dto, 'invitation_token');
  });
  it('AcceptInvitationDto.invitation_token invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.invitation_token = "xxxxxxxxxxxxxxx";
    reject(dto, 'invitation_token');
  });

  it('AcceptInvitationDto.first_name requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.first_name;
    reject(dto, 'first_name');
  });
  it('AcceptInvitationDto.first_name invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.first_name = "x";
    reject(dto, 'first_name');
  });

  it('AcceptInvitationDto.last_name requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.last_name;
    reject(dto, 'last_name');
  });
  it('AcceptInvitationDto.last_name invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.last_name = "x";
    reject(dto, 'last_name');
  });

  it('AcceptInvitationDto.password requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.password;
    reject(dto, 'password');
  });
  it('AcceptInvitationDto.password invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.password = "xxxxxxx";
    reject(dto, 'password');
  });

  it('AcceptInvitationDto.device_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.device_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('AcceptInvitationDto.web_client optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.web_client;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_RegisterDeviceDto = () => plainToInstance(RegisterDeviceDto, {
      name: "xx",
      device_fingerprint: "xxxxxxxx",
      platform: "android",
    });

describe('RegisterDeviceDto (4.2)', () => {
  const valid = valid_RegisterDeviceDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('RegisterDeviceDto.name requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.name;
    reject(dto, 'name');
  });
  it('RegisterDeviceDto.name invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.name = "x";
    reject(dto, 'name');
  });

  it('RegisterDeviceDto.device_fingerprint requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.device_fingerprint;
    reject(dto, 'device_fingerprint');
  });
  it('RegisterDeviceDto.device_fingerprint invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.device_fingerprint = "xxxxxxx";
    reject(dto, 'device_fingerprint');
  });

  it('RegisterDeviceDto.platform requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.platform;
    reject(dto, 'platform');
  });
  it('RegisterDeviceDto.platform invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.platform = 12345;
    reject(dto, 'platform');
  });

  it('RegisterDeviceDto.app_version optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.app_version;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('RegisterDeviceDto.fcm_token optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.fcm_token;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('RegisterDeviceDto.apns_token optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.apns_token;
    expect(validateSync(dto)).toHaveLength(0);
  });
});
