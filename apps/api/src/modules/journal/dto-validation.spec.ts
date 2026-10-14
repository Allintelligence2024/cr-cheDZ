/**
 * 4.2 — Validation des DTO du module journal.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateJournalEventDto,
  GroupActionItemDto,
  GroupJournalEventDto,
  JournalListQuery,
  UpdateJournalVisibilityDto,
  JOURNAL_EVENT_TYPES,
} from './dto/journal.dto';

const valid_CreateJournalEventDto = () => plainToInstance(CreateJournalEventDto, {
      child_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      event_type: JOURNAL_EVENT_TYPES[0],
    });

describe('CreateJournalEventDto (4.2)', () => {
  const valid = valid_CreateJournalEventDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateJournalEventDto.child_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_id;
    reject(dto, 'child_id');
  });
  it('CreateJournalEventDto.child_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.child_id = "not-a-uuid";
    reject(dto, 'child_id');
  });

  it('CreateJournalEventDto.event_type requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.event_type;
    reject(dto, 'event_type');
  });
  it('CreateJournalEventDto.event_type invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.event_type = 12345;
    reject(dto, 'event_type');
  });

  it('CreateJournalEventDto.occurred_at optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.occurred_at;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.meal_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.meal_type;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.meal_quantity optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.meal_quantity;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.meal_notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.meal_notes;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.nap_start_at optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.nap_start_at;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.nap_end_at optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.nap_end_at;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.nap_quality optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.nap_quality;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.diaper_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.diaper_type;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.activity_name optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.activity_name;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.activity_notes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.activity_notes;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.temperature_celsius optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.temperature_celsius;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.health_observation optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.health_observation;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.note_text optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.note_text;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.note_is_private optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.note_is_private;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.incident_severity optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.incident_severity;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.incident_description optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.incident_description;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.incident_action optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.incident_action;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.corrects_event_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.corrects_event_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.correction_reason optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.correction_reason;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateJournalEventDto.visible_to_parents optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.visible_to_parents;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_GroupActionItemDto = () => plainToInstance(GroupActionItemDto, {
      child_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('GroupActionItemDto (4.2)', () => {
  const valid = valid_GroupActionItemDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('GroupActionItemDto.child_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_id;
    reject(dto, 'child_id');
  });
  it('GroupActionItemDto.child_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.child_id = "not-a-uuid";
    reject(dto, 'child_id');
  });
});

const valid_GroupJournalEventDto = () => plainToInstance(GroupJournalEventDto, {
      event_type: "meal",
      children: [valid_GroupActionItemDto()],
    });

describe('GroupJournalEventDto (4.2)', () => {
  const valid = valid_GroupJournalEventDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('GroupJournalEventDto.event_type requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.event_type;
    reject(dto, 'event_type');
  });
  it('GroupJournalEventDto.event_type invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.event_type = 12345;
    reject(dto, 'event_type');
  });

  it('GroupJournalEventDto.children requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.children;
    reject(dto, 'children');
  });
  it('GroupJournalEventDto.children invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.children = "not-an-array";
    reject(dto, 'children');
  });

  it('GroupJournalEventDto.meal_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.meal_type;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('GroupJournalEventDto.meal_quantity optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.meal_quantity;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('GroupJournalEventDto.diaper_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.diaper_type;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('GroupJournalEventDto.activity_name optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.activity_name;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('GroupJournalEventDto.occurred_at optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.occurred_at;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_JournalListQuery = () => plainToInstance(JournalListQuery, {
      child_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('JournalListQuery (4.2)', () => {
  const valid = valid_JournalListQuery;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('JournalListQuery.child_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_id;
    reject(dto, 'child_id');
  });
  it('JournalListQuery.child_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.child_id = "not-a-uuid";
    reject(dto, 'child_id');
  });

  it('JournalListQuery.date optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.date;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('JournalListQuery.event_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.event_type;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_UpdateJournalVisibilityDto = () => plainToInstance(UpdateJournalVisibilityDto, {
      visible_to_parents: true,
    });

describe('UpdateJournalVisibilityDto (4.2)', () => {
  const valid = valid_UpdateJournalVisibilityDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('UpdateJournalVisibilityDto.visible_to_parents requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.visible_to_parents;
    reject(dto, 'visible_to_parents');
  });
  it('UpdateJournalVisibilityDto.visible_to_parents invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.visible_to_parents = "not-a-bool";
    reject(dto, 'visible_to_parents');
  });
});
