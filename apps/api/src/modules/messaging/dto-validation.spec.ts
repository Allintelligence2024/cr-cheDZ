/**
 * 4.2 — Validation des DTO du module messaging.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateConversationDto,
  ConversationIdParam,
  SendMessageDto,
} from './dto/messaging.dto';

const valid_CreateConversationDto = () => plainToInstance(CreateConversationDto, {
    });

describe('CreateConversationDto (4.2)', () => {
  const valid = valid_CreateConversationDto;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateConversationDto.child_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateConversationDto.subject optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.subject;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('CreateConversationDto.participant_user_ids optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.participant_user_ids;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_ConversationIdParam = () => plainToInstance(ConversationIdParam, {
      id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('ConversationIdParam (4.2)', () => {
  const valid = valid_ConversationIdParam;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('ConversationIdParam.id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.id;
    reject(dto, 'id');
  });
  it('ConversationIdParam.id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.id = "not-a-uuid";
    reject(dto, 'id');
  });
});

const valid_SendMessageDto = () => plainToInstance(SendMessageDto, {
      body: "ok",
    });

describe('SendMessageDto (4.2)', () => {
  const valid = valid_SendMessageDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('SendMessageDto.body requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.body;
    reject(dto, 'body');
  });
  it('SendMessageDto.body invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.body = 12345;
    reject(dto, 'body');
  });

  it('SendMessageDto.attachment_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.attachment_id;
    expect(validateSync(dto)).toHaveLength(0);
  });
});
