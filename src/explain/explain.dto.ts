import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const EXPLANATION_LEVELS = ['ELI5', 'BEGINNER', 'INTERMEDIATE', 'EXPERT'] as const;
export type ExplanationLevel = (typeof EXPLANATION_LEVELS)[number];

export class CreateExplanationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  topic: string;

  @IsString()
  @IsIn(EXPLANATION_LEVELS)
  level: ExplanationLevel;
}

export class CreatePublicCommentDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  authorName?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  content: string;
}
