/**
 * Régression : la liste des photos renvoyée aux parents était TOUJOURS vide.
 *
 * `MediaService.list()` cloisonne le personnel par salle : il lit le rôle et
 * les `room_ids` du membership, et retourne `[]` dès que `room_ids` est vide
 * ou NULL pour un rôle qui ne « voit pas tout » (hors director / super_admin
 * / accountant).
 *
 * Or un parent (`parent_primary` / `parent_secondary`) n'appartient à aucune
 * salle : `room_ids` est NULL. `ParentsService.photos()` passait pourtant par
 * cette méthode, donc la liste parent était systématiquement vide — alors que
 * le téléchargement direct de la MÊME photo fonctionnait, ce qui rendait le
 * défaut très déroutant à diagnostiquer.
 *
 * Trois suites d'isolation échouaient dessus :
 *   - phase7-parent            « Parent A reçoit la photo avec URL signée »
 *   - phase37-parent-revocation « authorized: photos », « health revoked: photos »
 *   - phase41-photo-consent-scope « single/group authorized: parent list »
 *
 * Ces suites exigent un PostgreSQL réel. Ce test unitaire couvre la logique
 * de routage sans base : il vérifie que `photos()` n'emprunte PAS le chemin
 * cloisonné par salle, et que les garde-fous d'accès restent appliqués.
 */

import { AppError } from '../../shared/errors';
import { ParentsService } from './parents.service';

type Media = Record<string, unknown>;

/** Construit un ParentsService avec des collaborateurs doublés. */
function makeService(options: { visible: Media[] }): {
  service: ParentsService;
  calls: { list: number; listForParent: string[]; permissions: string[] };
} {
  const calls = { list: 0, listForParent: [] as string[], permissions: [] as string[] };

  const media = {
    // Chemin PERSONNEL : cloisonné par salle. Un parent n'ayant aucune salle,
    // il renvoyait [] — on reproduit fidèlement ce comportement.
    list: async (): Promise<Media[]> => {
      calls.list += 1;
      return [];
    },
    listForParent: async (childId: string): Promise<Media[]> => {
      calls.listForParent.push(childId);
      return options.visible;
    },
  };

  const service = Object.create(ParentsService.prototype) as ParentsService;
  Object.assign(service, { media });

  // Le lien de filiation est vérifié par assertPermission : on l'enregistre
  // pour prouver qu'il reste bien appelé avant toute lecture.
  Object.defineProperty(service, 'assertPermission', {
    configurable: true,
    value: async (_userId: string, childId: string, permission: string) => {
      calls.permissions.push(`${childId}:${permission}`);
    },
  });
  // Signature d'URL : succès simple, la révocation est testée séparément.
  Object.defineProperty(service, 'photoUrl', {
    configurable: true,
    value: async (_u: string, _c: string, mediaId: string) => ({
      url: `https://s3.test/${mediaId}?X-Amz-Signature=deadbeef`,
      key: `k/${mediaId}`,
    }),
  });

  return { service, calls };
}

describe('ParentsService.photos — liste des photos parent', () => {
  it('retourne les photos visibles (et non une liste vide)', async () => {
    const { service, calls } = makeService({
      visible: [{ id: 'm1', is_visible_to_parents: true }, { id: 'm2', is_visible_to_parents: true }],
    });

    const result = await service.photos('user-1', 'child-1', '127.0.0.1');

    expect(result).toHaveLength(2);
    expect(result[0].url).toContain('X-Amz-Signature=');
    // Le cœur de la régression : ne PAS emprunter la liste cloisonnée par salle.
    expect(calls.list).toBe(0);
    expect(calls.listForParent).toEqual(['child-1']);
  });

  it('vérifie le lien de filiation avant toute lecture', async () => {
    const { service, calls } = makeService({ visible: [] });
    await service.photos('user-1', 'child-1');
    expect(calls.permissions).toEqual(['child-1:can_view_journal']);
  });

  it('ne divulgue aucune URL si le consentement est retiré entre-temps', async () => {
    const { service } = makeService({ visible: [{ id: 'm1', is_visible_to_parents: true }] });
    // Rejoue une révocation survenant après la lecture, au moment de signer.
    Object.defineProperty(service, 'photoUrl', {
      configurable: true,
      value: async () => {
        throw new AppError('CONSENT_REVOKED', 'retiré', 'مسحوب', 422);
      },
    });

    await expect(service.photos('user-1', 'child-1')).resolves.toEqual([]);
  });

  it('propage les erreurs autres que CONSENT_REVOKED', async () => {
    const { service } = makeService({ visible: [{ id: 'm1', is_visible_to_parents: true }] });
    Object.defineProperty(service, 'photoUrl', {
      configurable: true,
      value: async () => {
        throw new Error('panne stockage');
      },
    });

    await expect(service.photos('user-1', 'child-1')).rejects.toThrow('panne stockage');
  });
});
