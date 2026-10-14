/**
 * 4.2 — Validation des DTO du module parents.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ChildIdParam,
  MediaIdParam,
  ReportAbsenceDto,
  SaveConsentDto,
  SaveNotificationPreferenceDto,
  InvoiceIdParam,
  PaymentIdParam,
} from './dto/parent.dto';

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

const valid_MediaIdParam = () => plainToInstance(MediaIdParam, {
      mediaId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('MediaIdParam (4.2)', () => {
  const valid = valid_MediaIdParam;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('MediaIdParam.mediaId requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.mediaId;
    reject(dto, 'mediaId');
  });
  it('MediaIdParam.mediaId invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.mediaId = "not-a-uuid";
    reject(dto, 'mediaId');
  });
});

const valid_ReportAbsenceDto = () => plainToInstance(ReportAbsenceDto, {
      child_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('ReportAbsenceDto (4.2)', () => {
  const valid = valid_ReportAbsenceDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('ReportAbsenceDto.child_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_id;
    reject(dto, 'child_id');
  });
  it('ReportAbsenceDto.child_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.child_id = "not-a-uuid";
    reject(dto, 'child_id');
  });

  it('ReportAbsenceDto.reason optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.reason;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_SaveConsentDto = () => plainToInstance(SaveConsentDto, {
      child_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      consent_type: "ok",
      granted: true,
    });

describe('SaveConsentDto (4.2)', () => {
  const valid = valid_SaveConsentDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('SaveConsentDto.child_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_id;
    reject(dto, 'child_id');
  });
  it('SaveConsentDto.child_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.child_id = "not-a-uuid";
    reject(dto, 'child_id');
  });

  it('SaveConsentDto.consent_type requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.consent_type;
    reject(dto, 'consent_type');
  });
  it('SaveConsentDto.consent_type invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.consent_type = 12345;
    reject(dto, 'consent_type');
  });

  it('SaveConsentDto.granted requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.granted;
    reject(dto, 'granted');
  });
  it('SaveConsentDto.granted invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.granted = "not-a-bool";
    reject(dto, 'granted');
  });
});

const valid_SaveNotificationPreferenceDto = () => plainToInstance(SaveNotificationPreferenceDto, {
      event_type: "ok",
      is_enabled: true,
    });

describe('SaveNotificationPreferenceDto (4.2)', () => {
  const valid = valid_SaveNotificationPreferenceDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('SaveNotificationPreferenceDto.event_type requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.event_type;
    reject(dto, 'event_type');
  });
  it('SaveNotificationPreferenceDto.event_type invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.event_type = 12345;
    reject(dto, 'event_type');
  });

  it('SaveNotificationPreferenceDto.is_enabled requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.is_enabled;
    reject(dto, 'is_enabled');
  });
  it('SaveNotificationPreferenceDto.is_enabled invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.is_enabled = "not-a-bool";
    reject(dto, 'is_enabled');
  });

  it('SaveNotificationPreferenceDto.quiet_hours_start optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.quiet_hours_start;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('SaveNotificationPreferenceDto.quiet_hours_end optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.quiet_hours_end;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_InvoiceIdParam = () => plainToInstance(InvoiceIdParam, {
      invoiceId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('InvoiceIdParam (4.2)', () => {
  const valid = valid_InvoiceIdParam;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('InvoiceIdParam.invoiceId requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.invoiceId;
    reject(dto, 'invoiceId');
  });
  it('InvoiceIdParam.invoiceId invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.invoiceId = "not-a-uuid";
    reject(dto, 'invoiceId');
  });
});

const valid_PaymentIdParam = () => plainToInstance(PaymentIdParam, {
      paymentId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('PaymentIdParam (4.2)', () => {
  const valid = valid_PaymentIdParam;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('PaymentIdParam.paymentId requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.paymentId;
    reject(dto, 'paymentId');
  });
  it('PaymentIdParam.paymentId invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.paymentId = "not-a-uuid";
    reject(dto, 'paymentId');
  });
});
