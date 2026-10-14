/**
 * 4.2 — Validation des DTO du module attestations.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  IssueAttestationDto,
  AttestationIdParam,
} from './dto/attestations.dto';

const valid_IssueAttestationDto = () => plainToInstance(IssueAttestationDto, {
      child_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      year: 2020,
    });

describe('IssueAttestationDto (4.2)', () => {
  const valid = valid_IssueAttestationDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('IssueAttestationDto.child_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_id;
    reject(dto, 'child_id');
  });
  it('IssueAttestationDto.child_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.child_id = "not-a-uuid";
    reject(dto, 'child_id');
  });

  it('IssueAttestationDto.year requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.year;
    reject(dto, 'year');
  });
  it('IssueAttestationDto.year invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.year = 1.5;
    reject(dto, 'year');
  });
});

const valid_AttestationIdParam = () => plainToInstance(AttestationIdParam, {
      attestationId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

describe('AttestationIdParam (4.2)', () => {
  const valid = valid_AttestationIdParam;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('AttestationIdParam.attestationId requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.attestationId;
    reject(dto, 'attestationId');
  });
  it('AttestationIdParam.attestationId invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.attestationId = "not-a-uuid";
    reject(dto, 'attestationId');
  });
});
