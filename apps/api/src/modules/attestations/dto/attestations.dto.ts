import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class IssueAttestationDto {
  @IsUUID() child_id!: string;
  @IsInt() @Min(2020) @Max(2100) year!: number;
}
export class AttestationIdParam { @IsUUID() attestationId!: string; }
