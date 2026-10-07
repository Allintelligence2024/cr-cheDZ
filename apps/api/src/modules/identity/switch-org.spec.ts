import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SwitchOrgDto } from './dto/auth.dto';

/**
 * 3.2.11 (remédiation 2026-10-05) — le bouton « changer d'organisation » du
 * director-mobile affichait « à implémenter ». L'endpoint `/auth/switch-org`
 * a été ajouté : il valide le membership cible (via auth_get_memberships),
 * révoque l'ancienne session et émet une nouvelle paire de jetons pour
 * l'org cible — jamais de falsification de token.
 *
 * La sécurité repose sur `organization_id` obligatoirement UUID valide : un
 * attaquant ne peut pas demander un token pour une org arbitraire. Ces tests
 * fixent ce contrat.
 */

const VALID_ORG = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('SwitchOrgDto (3.2.11)', () => {
  it('accepte un organization_id UUID valide', () => {
    const dto = plainToInstance(SwitchOrgDto, { organization_id: VALID_ORG });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.organization_id).toBe(VALID_ORG);
  });

  it('rejecte un organization_id absent — pas d org cible implicite', () => {
    const dto = plainToInstance(SwitchOrgDto, {});
    const errors = validateSync(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('organization_id');
  });

  it('rejecte un organization_id qui n est pas un UUID', () => {
    for (const bad of ['not-a-uuid', '1', '../../etc/passwd', VALID_ORG + 'x']) {
      const dto = plainToInstance(SwitchOrgDto, { organization_id: bad });
      const errors = validateSync(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('organization_id');
    }
  });

  it('accepte un refresh_token optionnel ≥ 16 caractères', () => {
    const dto = plainToInstance(SwitchOrgDto, {
      organization_id: VALID_ORG,
      refresh_token: 'a'.repeat(32),
    });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejecte un refresh_token trop court (< 16)', () => {
    const dto = plainToInstance(SwitchOrgDto, {
      organization_id: VALID_ORG,
      refresh_token: 'short',
    });
    const errors = validateSync(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('refresh_token');
  });

  it('device_id est optionnel et libre (jamais requis pour le switch)', () => {
    const dto = plainToInstance(SwitchOrgDto, { organization_id: VALID_ORG });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.device_id).toBeUndefined();
  });
});
