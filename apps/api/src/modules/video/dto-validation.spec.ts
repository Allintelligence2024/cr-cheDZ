/**
 * 4.2 — Validation des DTO du module video.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateCameraDto,
  UpdateCameraDto,
  PresignClipDto,
  RegisterClipDto,
  ListClipsQuery,
  VIDEO_ZONES,
} from './dto/video.dto';

const valid_CreateCameraDto = () => plainToInstance(CreateCameraDto, {
      name: "xx",
      zone: VIDEO_ZONES[0],
    });

describe('CreateCameraDto (4.2)', () => {
  const valid = valid_CreateCameraDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('CreateCameraDto.name requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.name;
    reject(dto, 'name');
  });
  it('CreateCameraDto.name invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.name = "x";
    reject(dto, 'name');
  });

  it('CreateCameraDto.zone requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.zone;
    reject(dto, 'zone');
  });
  it('CreateCameraDto.zone invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.zone = 12345;
    reject(dto, 'zone');
  });
});

const valid_UpdateCameraDto = () => plainToInstance(UpdateCameraDto, {
    });

describe('UpdateCameraDto (4.2)', () => {
  const valid = valid_UpdateCameraDto;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('UpdateCameraDto.name optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.name;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UpdateCameraDto.is_active optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.is_active;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_PresignClipDto = () => plainToInstance(PresignClipDto, {
      camera_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      filename: "a",
      mime_type: "video/mp4",
    });

describe('PresignClipDto (4.2)', () => {
  const valid = valid_PresignClipDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('PresignClipDto.camera_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.camera_id;
    reject(dto, 'camera_id');
  });
  it('PresignClipDto.camera_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.camera_id = "not-a-uuid";
    reject(dto, 'camera_id');
  });

  it('PresignClipDto.filename requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.filename;
    reject(dto, 'filename');
  });
  it('PresignClipDto.filename invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.filename = 12345;
    reject(dto, 'filename');
  });

  it('PresignClipDto.mime_type requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.mime_type;
    reject(dto, 'mime_type');
  });
  it('PresignClipDto.mime_type invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.mime_type = 12345;
    reject(dto, 'mime_type');
  });

  it('PresignClipDto.size_bytes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.size_bytes;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_RegisterClipDto = () => plainToInstance(RegisterClipDto, {
      camera_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      captured_at: "2026-01-15T00:00:00Z",
      storage_key: "a",
    });

describe('RegisterClipDto (4.2)', () => {
  const valid = valid_RegisterClipDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('RegisterClipDto.camera_id requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.camera_id;
    reject(dto, 'camera_id');
  });
  it('RegisterClipDto.camera_id invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.camera_id = "not-a-uuid";
    reject(dto, 'camera_id');
  });

  it('RegisterClipDto.captured_at requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.captured_at;
    reject(dto, 'captured_at');
  });
  it('RegisterClipDto.captured_at invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.captured_at = 12345;
    reject(dto, 'captured_at');
  });

  it('RegisterClipDto.storage_key requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.storage_key;
    reject(dto, 'storage_key');
  });
  it('RegisterClipDto.storage_key invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.storage_key = 12345;
    reject(dto, 'storage_key');
  });

  it('RegisterClipDto.storage_backend optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.storage_backend;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('RegisterClipDto.mime_type optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.mime_type;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('RegisterClipDto.size_bytes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.size_bytes;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('RegisterClipDto.duration_seconds optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.duration_seconds;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_ListClipsQuery = () => plainToInstance(ListClipsQuery, {
    });

describe('ListClipsQuery (4.2)', () => {
  const valid = valid_ListClipsQuery;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('ListClipsQuery.camera_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.camera_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ListClipsQuery.from optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.from;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('ListClipsQuery.to optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.to;
    expect(validateSync(dto)).toHaveLength(0);
  });
});
