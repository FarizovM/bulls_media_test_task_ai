import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class TriageRequestDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 2000)
  message!: string;
}
