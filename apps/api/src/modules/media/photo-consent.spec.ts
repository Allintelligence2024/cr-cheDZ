import { photoConsentsAllowed } from '../../shared/authorization/photo-consent';
import type { PoolClient } from 'pg';

/**
 * 3.1.5 (H1, remédiation 2026-10-05) — le chemin staff `/media/:id/content`
 * ne vérifiait que le préfixe tenant ; un staff pouvait lire une photo
 * d'enfants dont le consentement avait été retiré (loi 25-11).
 *
 * La garde ajoutée dans `streamContent()` s'appuie sur
 * `photoConsentsAllowed()`. Ces tests fixent son comportement attendu :
 * fail-closed sur tout manque (children_in_photo absent, case non cochée,
 * enfant non déclaré, consentement révoqué).
 */

function fakeClient(rows: Array<Record<string, unknown>>): PoolClient {
  return {
    query: async () => ({ rows, rowCount: rows.length }),
  } as unknown as PoolClient;
}

const TENANT = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const CHILD_A = '11111111-1111-1111-1111-111111111111';
const CHILD_B = '22222222-2222-2222-2222-222222222222';

describe('photo-consent (3.1.5 H1)', () => {
  it('refuse si children_in_photo est vide ou absent', async () => {
    expect(await photoConsentsAllowed(fakeClient([]), TENANT, {
      child_id: CHILD_A, children_in_photo: [], all_consents_checked: true,
    })).toBe(false);
    expect(await photoConsentsAllowed(fakeClient([]), TENANT, {
      child_id: CHILD_A, children_in_photo: null, all_consents_checked: true,
    })).toBe(false);
  });

  it('refuse si all_consents_checked est faux (legacy non vérifié)', async () => {
    expect(await photoConsentsAllowed(fakeClient([]), TENANT, {
      child_id: CHILD_A, children_in_photo: [CHILD_A], all_consents_checked: false,
    })).toBe(false);
  });

  it('refuse si un enfant déclaré n a pas de consentement (fail-closed)', async () => {
    // B absent de consent_records → 1 ligne sur 2 → refus.
    const client = fakeClient([{ id: CHILD_A }]);
    expect(await photoConsentsAllowed(client, TENANT, {
      child_id: CHILD_A, children_in_photo: [CHILD_A, CHILD_B], all_consents_checked: true,
    })).toBe(false);
  });

  it('accepte si chaque enfant déclaré a un consentement accordé non révoqué', async () => {
    const client = fakeClient([{ id: CHILD_A }, { id: CHILD_B }]);
    expect(await photoConsentsAllowed(client, TENANT, {
      child_id: CHILD_A, children_in_photo: [CHILD_A, CHILD_B], all_consents_checked: true,
    })).toBe(true);
  });

  it('compte l enfant principal (child_id) en plus des enfants déclarés', async () => {
    // child_id absent de children_in_photo doit aussi être contrôlé.
    const client = fakeClient([{ id: CHILD_A }, { id: CHILD_B }]);
    expect(await photoConsentsAllowed(client, TENANT, {
      child_id: CHILD_B, children_in_photo: [CHILD_A], all_consents_checked: true,
    })).toBe(true);
  });

  it('déduit les doublons (un enfant déclaré deux fois compte une fois)', async () => {
    const client = fakeClient([{ id: CHILD_A }]);
    expect(await photoConsentsAllowed(client, TENANT, {
      child_id: CHILD_A, children_in_photo: [CHILD_A, CHILD_A], all_consents_checked: true,
    })).toBe(true);
  });

  it('refuse si un enfant de children_in_photo vaut null', async () => {
    expect(await photoConsentsAllowed(fakeClient([]), TENANT, {
      child_id: CHILD_A, children_in_photo: [CHILD_A, null], all_consents_checked: true,
    })).toBe(false);
  });
});
