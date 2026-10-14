/**
 * 4.2 — Validation des DTO du module sync.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  SyncOperationDto,
  SyncPushDto,
  SyncPullQuery,
  SYNC_COMMANDS,
  SYNC_ENTITY_TYPES,
} from './dto/sync.dto';

const valid_SyncOperationDto = () => plainToInstance(SyncOperationDto, {
      event_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      client_sequence: 1,
      schema_version: 1,
      command: SYNC_COMMANDS[0],
      entity_type: SYNC_ENTITY_TYPES[0],
      payload: {},
      occurred_at_device: "ok",
    });

describe('SyncOperationDto (4.2)', () => {
  const valid = valid_SyncOperationDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('SyncOperationDto.event_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.event_id;
    reject(dto, 'event_id');
  });
  it('SyncOperationDto.event_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.event_id = "not-a-uuid";
    reject(dto, 'event_id');
  });

  it('SyncOperationDto.client_sequence requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.client_sequence;
    reject(dto, 'client_sequence');
  });
  it('SyncOperationDto.client_sequence invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.client_sequence = 1.5;
    reject(dto, 'client_sequence');
  });

  it('SyncOperationDto.schema_version requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.schema_version;
    reject(dto, 'schema_version');
  });
  it('SyncOperationDto.schema_version invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.schema_version = 1.5;
    reject(dto, 'schema_version');
  });

  it('SyncOperationDto.command requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.command;
    reject(dto, 'command');
  });
  it('SyncOperationDto.command invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.command = 12345;
    reject(dto, 'command');
  });

  it('SyncOperationDto.entity_type requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.entity_type;
    reject(dto, 'entity_type');
  });
  it('SyncOperationDto.entity_type invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.entity_type = 12345;
    reject(dto, 'entity_type');
  });

  it('SyncOperationDto.entity_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.entity_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('SyncOperationDto.payload requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.payload;
    reject(dto, 'payload');
  });
  it('SyncOperationDto.payload invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.payload = 12345;
    reject(dto, 'payload');
  });

  it('SyncOperationDto.base_version optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.base_version;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('SyncOperationDto.occurred_at_device requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.occurred_at_device;
    reject(dto, 'occurred_at_device');
  });
  it('SyncOperationDto.occurred_at_device invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.occurred_at_device = 12345;
    reject(dto, 'occurred_at_device');
  });
});

const valid_SyncPushDto = () => plainToInstance(SyncPushDto, {
      device_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      operations: [valid_SyncOperationDto()],
    });

describe('SyncPushDto (4.2)', () => {
  const valid = valid_SyncPushDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('SyncPushDto.device_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.device_id;
    reject(dto, 'device_id');
  });
  it('SyncPushDto.device_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.device_id = "not-a-uuid";
    reject(dto, 'device_id');
  });

  it('SyncPushDto.operations requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.operations;
    reject(dto, 'operations');
  });
  it('SyncPushDto.operations invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.operations = "not-an-array";
    reject(dto, 'operations');
  });
});

const valid_SyncPullQuery = () => plainToInstance(SyncPullQuery, {
      cursor: "0",
      device_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('SyncPullQuery (4.2)', () => {
  const valid = valid_SyncPullQuery;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('SyncPullQuery.cursor requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.cursor;
    reject(dto, 'cursor');
  });
  it('SyncPullQuery.cursor invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.cursor = 12345;
    reject(dto, 'cursor');
  });

  it('SyncPullQuery.device_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.device_id;
    reject(dto, 'device_id');
  });
  it('SyncPullQuery.device_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.device_id = "not-a-uuid";
    reject(dto, 'device_id');
  });
});
