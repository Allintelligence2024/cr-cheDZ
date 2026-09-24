import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MEDIA_MIME_TYPES, PresignUploadDto, UploadMediaDto } from './media.dto';

const CHILD_A = '33333333-3333-4333-8333-333333333333';
const CHILD_B = '44444444-4444-4444-8444-444444444444';

/**
 * LOT 2 (volet B) — DTO d'upload proxyfié par l'API.
 *
 * En `multipart/form-data` TOUT arrive en chaîne : sans normalisation explicite,
 * `children_in_photo` reste une chaîne, `all_consents_checked` reste faux côté
 * service (contrôle de consentement JAMAIS satisfait) et la photo ne peut plus
 * être publiée aux parents — régression silencieuse. Ces tests fixent les trois
 * formes acceptées (JSON, champ répété, valeur unique) et le cas `exif_stripped`.
 */
function parse(body: Record<string, unknown>): UploadMediaDto {
  return plainToInstance(UploadMediaDto, body);
}

function errors(dto: object): string[] {
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).flatMap((e) => Object.keys(e.constraints ?? {}));
}

describe('UploadMediaDto — normalisation multipart', () => {
  it('accepte children_in_photo en JSON (forme du client staff-mobile)', () => {
    const dto = parse({ children_in_photo: JSON.stringify([CHILD_A, CHILD_B]), exif_stripped: 'true' });
    expect(dto.children_in_photo).toEqual([CHILD_A, CHILD_B]);
    expect(dto.exif_stripped).toBe(true);
    expect(errors(dto)).toEqual([]);
  });

  it('accepte children_in_photo en champ répété (tableau brut de multer)', () => {
    const dto = parse({ children_in_photo: [CHILD_A, CHILD_B], exif_stripped: '1' });
    expect(dto.children_in_photo).toEqual([CHILD_A, CHILD_B]);
    expect(dto.exif_stripped).toBe(true);
    expect(errors(dto)).toEqual([]);
  });

  it('accepte children_in_photo en valeur unique (un seul enfant sur la photo)', () => {
    const dto = parse({ children_in_photo: CHILD_A });
    expect(dto.children_in_photo).toEqual([CHILD_A]);
    expect(errors(dto)).toEqual([]);
  });

  it('accepte le tableau à un seul élément portant du JSON (cas multer dégénéré)', () => {
    const dto = parse({ children_in_photo: [JSON.stringify([CHILD_A])] });
    expect(dto.children_in_photo).toEqual([CHILD_A]);
    expect(errors(dto)).toEqual([]);
  });

  it('absent ou vide → undefined (jamais [""])', () => {
    expect(parse({}).children_in_photo).toBeUndefined();
    expect(parse({ children_in_photo: '' }).children_in_photo).toBeUndefined();
  });

  it('exif_stripped absent reste undefined ; « false » devient false (et non truthy)', () => {
    expect(parse({}).exif_stripped).toBeUndefined();
    expect(parse({ exif_stripped: 'false' }).exif_stripped).toBe(false);
  });

  it('rejette un identifiant non-UUID (le consentement ne doit pas être contourné par un champ libre)', () => {
    expect(errors(parse({ children_in_photo: JSON.stringify(['pas-un-uuid']) }))).toContain('isUuid');
  });
});

describe('MEDIA_MIME_TYPES — liste blanche partagée upload/presign', () => {
  it('contient les trois images supportées et le PDF, rien d’autre', () => {
    expect([...MEDIA_MIME_TYPES].sort()).toEqual(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].sort());
  });

  it('PresignUploadDto n’accepte plus de type hors liste (SVG/HTML servis same-origin = XSS stocké)', () => {
    const bad = plainToInstance(PresignUploadDto, { mime_type: 'image/svg+xml', filename: 'x.svg' });
    expect(errors(bad)).toContain('isIn');

    const ok = plainToInstance(PresignUploadDto, { mime_type: 'image/jpeg', filename: 'x.jpg', file_size_bytes: 1024 });
    expect(errors(ok)).toEqual([]);
  });
});
