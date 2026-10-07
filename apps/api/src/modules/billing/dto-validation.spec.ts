/**
 * 4.2 — Validation des DTO du module billing.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateContractDto,
  GenerateInvoiceDto,
  RecordCashPaymentDto,
  OpenCashRegisterDto,
  CloseCashRegisterDto,
  CreateOnlinePaymentDto,
  AllocatePaymentDto,
  ContractIdParam,
  InvoiceIdParam,
  PaymentIdParam,
  CashRegisterQueryDto,
  SendReminderDto,
} from './dto/billing.dto';

const valid_CreateContractDto = () => plainToInstance(CreateContractDto, {
      child_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      start_date: "2026-01-15",
    });

describe('CreateContractDto (4.2)', () => {
  const valid = valid_CreateContractDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateContractDto.child_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_id;
    reject(dto, 'child_id');
  });
  it('CreateContractDto.child_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.child_id = "not-a-uuid";
    reject(dto, 'child_id');
  });

  it('CreateContractDto.monthly_base_amount optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.monthly_base_amount;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateContractDto.weekly_schedule optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.weekly_schedule;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateContractDto.hours_per_day optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.hours_per_day;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateContractDto.annual_weeks optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.annual_weeks;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateContractDto.daily_rate optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.daily_rate;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateContractDto.absence_deduction optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.absence_deduction;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateContractDto.extra_day_rate optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.extra_day_rate;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateContractDto.start_date requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.start_date;
    reject(dto, 'start_date');
  });
  it('CreateContractDto.start_date invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.start_date = "not-a-date";
    reject(dto, 'start_date');
  });

  it('CreateContractDto.end_date optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.end_date;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateContractDto.schedule_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.schedule_type;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateContractDto.discount_percent optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.discount_percent;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_GenerateInvoiceDto = () => plainToInstance(GenerateInvoiceDto, {
      contract_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      period_year: 2020,
      period_month: 1,
      due_date: "2026-01-15",
    });

describe('GenerateInvoiceDto (4.2)', () => {
  const valid = valid_GenerateInvoiceDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('GenerateInvoiceDto.contract_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.contract_id;
    reject(dto, 'contract_id');
  });
  it('GenerateInvoiceDto.contract_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.contract_id = "not-a-uuid";
    reject(dto, 'contract_id');
  });

  it('GenerateInvoiceDto.period_year requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.period_year;
    reject(dto, 'period_year');
  });
  it('GenerateInvoiceDto.period_year invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.period_year = 1.5;
    reject(dto, 'period_year');
  });

  it('GenerateInvoiceDto.period_month requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.period_month;
    reject(dto, 'period_month');
  });
  it('GenerateInvoiceDto.period_month invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.period_month = 1.5;
    reject(dto, 'period_month');
  });

  it('GenerateInvoiceDto.due_date requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.due_date;
    reject(dto, 'due_date');
  });
  it('GenerateInvoiceDto.due_date invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.due_date = "not-a-date";
    reject(dto, 'due_date');
  });
});

const valid_RecordCashPaymentDto = () => plainToInstance(RecordCashPaymentDto, {
      invoice_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      amount: 0.01,
    });

describe('RecordCashPaymentDto (4.2)', () => {
  const valid = valid_RecordCashPaymentDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('RecordCashPaymentDto.invoice_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.invoice_id;
    reject(dto, 'invoice_id');
  });
  it('RecordCashPaymentDto.invoice_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.invoice_id = "not-a-uuid";
    reject(dto, 'invoice_id');
  });

  it('RecordCashPaymentDto.amount requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.amount;
    reject(dto, 'amount');
  });
  it('RecordCashPaymentDto.amount invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.amount = "not-a-number";
    reject(dto, 'amount');
  });

  it('RecordCashPaymentDto.notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.notes;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_OpenCashRegisterDto = () => plainToInstance(OpenCashRegisterDto, {
      site_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('OpenCashRegisterDto (4.2)', () => {
  const valid = valid_OpenCashRegisterDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('OpenCashRegisterDto.site_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.site_id;
    reject(dto, 'site_id');
  });
  it('OpenCashRegisterDto.site_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.site_id = "not-a-uuid";
    reject(dto, 'site_id');
  });

  it('OpenCashRegisterDto.opening_balance optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.opening_balance;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_CloseCashRegisterDto = () => plainToInstance(CloseCashRegisterDto, {
      site_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('CloseCashRegisterDto (4.2)', () => {
  const valid = valid_CloseCashRegisterDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CloseCashRegisterDto.site_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.site_id;
    reject(dto, 'site_id');
  });
  it('CloseCashRegisterDto.site_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.site_id = "not-a-uuid";
    reject(dto, 'site_id');
  });

  it('CloseCashRegisterDto.notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.notes;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_CreateOnlinePaymentDto = () => plainToInstance(CreateOnlinePaymentDto, {
      invoice_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      method: "cib",
    });

describe('CreateOnlinePaymentDto (4.2)', () => {
  const valid = valid_CreateOnlinePaymentDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateOnlinePaymentDto.invoice_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.invoice_id;
    reject(dto, 'invoice_id');
  });
  it('CreateOnlinePaymentDto.invoice_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.invoice_id = "not-a-uuid";
    reject(dto, 'invoice_id');
  });

  it('CreateOnlinePaymentDto.method requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.method;
    reject(dto, 'method');
  });
  it('CreateOnlinePaymentDto.method invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.method = 12345;
    reject(dto, 'method');
  });
});

const valid_AllocatePaymentDto = () => plainToInstance(AllocatePaymentDto, {
      invoice_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      amount_allocated: 0.01,
    });

describe('AllocatePaymentDto (4.2)', () => {
  const valid = valid_AllocatePaymentDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('AllocatePaymentDto.invoice_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.invoice_id;
    reject(dto, 'invoice_id');
  });
  it('AllocatePaymentDto.invoice_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.invoice_id = "not-a-uuid";
    reject(dto, 'invoice_id');
  });

  it('AllocatePaymentDto.amount_allocated requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.amount_allocated;
    reject(dto, 'amount_allocated');
  });
  it('AllocatePaymentDto.amount_allocated invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.amount_allocated = "not-a-number";
    reject(dto, 'amount_allocated');
  });
});

const valid_ContractIdParam = () => plainToInstance(ContractIdParam, {
      contractId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('ContractIdParam (4.2)', () => {
  const valid = valid_ContractIdParam;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('ContractIdParam.contractId requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.contractId;
    reject(dto, 'contractId');
  });
  it('ContractIdParam.contractId invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.contractId = "not-a-uuid";
    reject(dto, 'contractId');
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

const valid_CashRegisterQueryDto = () => plainToInstance(CashRegisterQueryDto, {
    });

describe('CashRegisterQueryDto (4.2)', () => {
  const valid = valid_CashRegisterQueryDto;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CashRegisterQueryDto.site_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.site_id;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_SendReminderDto = () => plainToInstance(SendReminderDto, {
      level: 1,
      channel: "email",
    });

describe('SendReminderDto (4.2)', () => {
  const valid = valid_SendReminderDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('SendReminderDto.level requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.level;
    reject(dto, 'level');
  });
  it('SendReminderDto.level invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.level = 12345;
    reject(dto, 'level');
  });

  it('SendReminderDto.channel requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.channel;
    reject(dto, 'channel');
  });
  it('SendReminderDto.channel invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.channel = 12345;
    reject(dto, 'channel');
  });

  it('SendReminderDto.notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.notes;
    expect(validateSync(dto)).toHaveLength(0);
  });
});
