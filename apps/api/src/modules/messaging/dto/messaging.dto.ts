import { IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateConversationDto {
  @IsOptional()
  @IsUUID()
  child_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  /** Participants supplémentaires (staff) — les gardiens de l'enfant sont ajoutés automatiquement. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  participant_user_ids?: string[];
}

export class ConversationIdParam {
  @IsUUID()
  id!: string;
}

export class SendMessageDto {
  @IsString()
  @MaxLength(4000)
  body!: string;

  @IsOptional()
  @IsUUID()
  attachment_id?: string;
}
