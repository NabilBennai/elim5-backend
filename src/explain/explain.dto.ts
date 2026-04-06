import { IsString, MinLength, MaxLength } from 'class-validator';

export class CreateExplanationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  topic: string;
}
