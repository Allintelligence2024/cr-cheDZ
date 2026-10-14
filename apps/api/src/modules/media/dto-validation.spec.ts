/**
 * 4.2 — Validation des DTO du module media.
 *
 * Généré par introspection des décorateurs class-validator. Chaque test fixe
 * un invariant métier : un endpoint qui accepte une entrée invalide est un
 * bug de sécurité (injection SQL via filtre, UUID falsifié pour-tenant…).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  UploadMediaDto,
  PresignUploadDto,
  RegisterMediaDto,
  UpdateMediaVisibilityDto,
  ListMediaQuery,
  MEDIA_MIME_TYPES,
} from './dto/media.dto';

const valid_UploadMediaDto = () => plainToInstance(UploadMediaDto, {
    });

describe('UploadMediaDto (4.2)', () => {
  const valid = valid_UploadMediaDto;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('UploadMediaDto.child_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UploadMediaDto.log_event_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.log_event_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UploadMediaDto.children_in_photo optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.children_in_photo;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UploadMediaDto.taken_at optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.taken_at;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UploadMediaDto.checksum optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.checksum;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('UploadMediaDto.exif_stripped optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.exif_stripped;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_PresignUploadDto = () => plainToInstance(PresignUploadDto, {
      filename: "x",
      mime_type: MEDIA_MIME_TYPES[0],
    });

describe('PresignUploadDto (4.2)', () => {
  const valid = valid_PresignUploadDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('PresignUploadDto.filename requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.filename;
    reject(dto, 'filename');
  });
  it('PresignUploadDto.filename invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.filename = "";
    reject(dto, 'filename');
  });

  it('PresignUploadDto.mime_type requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.mime_type;
    reject(dto, 'mime_type');
  });
  it('PresignUploadDto.mime_type invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.mime_type = 12345;
    reject(dto, 'mime_type');
  });

  it('PresignUploadDto.child_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('PresignUploadDto.log_event_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.log_event_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('PresignUploadDto.children_in_photo optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.children_in_photo;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('PresignUploadDto.taken_at optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.taken_at;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('PresignUploadDto.file_size_bytes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.file_size_bytes;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_RegisterMediaDto = () => plainToInstance(RegisterMediaDto, {
      storage_key: "aaa",
      mime_type: "xxx",
    });

describe('RegisterMediaDto (4.2)', () => {
  const valid = valid_RegisterMediaDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('RegisterMediaDto.storage_key requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.storage_key;
    reject(dto, 'storage_key');
  });
  it('RegisterMediaDto.storage_key invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.storage_key = "xx";
    reject(dto, 'storage_key');
  });

  it('RegisterMediaDto.mime_type requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.mime_type;
    reject(dto, 'mime_type');
  });
  it('RegisterMediaDto.mime_type invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.mime_type = "xx";
    reject(dto, 'mime_type');
  });

  it('RegisterMediaDto.child_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('RegisterMediaDto.log_event_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.log_event_id;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('RegisterMediaDto.children_in_photo optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.children_in_photo;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('RegisterMediaDto.taken_at optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.taken_at;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('RegisterMediaDto.file_size_bytes optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.file_size_bytes;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('RegisterMediaDto.original_filename optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.original_filename;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('RegisterMediaDto.checksum optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.checksum;
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('RegisterMediaDto.exif_stripped optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.exif_stripped;
    expect(validateSync(dto)).toHaveLength(0);
  });
});

const valid_UpdateMediaVisibilityDto = () => plainToInstance(UpdateMediaVisibilityDto, {
      is_visible_to_parents: true,
    });

describe('UpdateMediaVisibilityDto (4.2)', () => {
  const valid = valid_UpdateMediaVisibilityDto;
  const reject = (o: object, p: string) => expect(validateSync(o).map(e => e.property)).toContain(p);

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('UpdateMediaVisibilityDto.is_visible_to_parents requis — absent → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.is_visible_to_parents;
    reject(dto, 'is_visible_to_parents');
  });
  it('UpdateMediaVisibilityDto.is_visible_to_parents invalide → rejet', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    dto.is_visible_to_parents = "not-a-bool";
    reject(dto, 'is_visible_to_parents');
  });
});

const valid_ListMediaQuery = () => plainToInstance(ListMediaQuery, {
    });

describe('ListMediaQuery (4.2)', () => {
  const valid = valid_ListMediaQuery;

  it('instance valide → 0 erreur (le contrat de la spec est le vrai contrat)', () => {
    expect(validateSync(valid())).toHaveLength(0);
  });

  it('ListMediaQuery.child_id optionnel → accepté (IsOptional)', () => {
    const dto = valid() as unknown as Record<string, unknown>;
    delete dto.child_id;
    expect(validateSync(dto)).toHaveLength(0);
  });
});
