import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExplanationDto, CreatePublicCommentDto } from './explain.dto';

const SYSTEM_PROMPT = `You are an expert teacher.
Explain topics clearly for the requested audience level.
Always respond in the same language the user used.
Avoid unnecessary jargon. If technical terms are required, define them immediately.
Keep explanations concise and structured.

Output format rules (strict):
- Return valid Markdown for prose structure.
- Use headings, bullet lists, and tables only when useful.
- Use LaTeX only for math with inline $...$ and display $$...$$.
- Never emit malformed math like standalone [ ... ].
- Never double-escape backslashes in LaTeX commands.
- Avoid duplicated artifacts like ee, xx, or 100x2=200100x2=200.`;

const LEVEL_INSTRUCTIONS: Record<CreateExplanationDto['level'], string> = {
  ELI5: 'Use very simple language, playful analogies, and short sentences suitable for a young child.',
  BEGINNER:
    'Use simple language for a newcomer. Introduce key terms gently with practical examples.',
  INTERMEDIATE:
    'Assume basic familiarity. Provide a more detailed explanation with cause/effect and common pitfalls.',
  EXPERT:
    'Assume strong background. Be precise, nuanced, and compact. Include tradeoffs and technical depth.',
};

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | Array<{ type?: string; text?: string }>;
    };
    text?: string;
  }>;
}

@Injectable()
export class ExplainService {
  private apiUrl: string;
  private apiKey: string;
  private model: string;

  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    this.apiUrl = 'https://api.llmapi.ai/v1/chat/completions';
    this.apiKey = config.getOrThrow<string>('LLMAPI_KEY');
    this.model = config.get<string>('LLMAPI_MODEL', 'qwen-flash');
  }

  async create(dto: CreateExplanationDto, userId: string) {
    const levelInstruction = LEVEL_INSTRUCTIONS[dto.level];

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Level: ${dto.level}\nInstruction: ${levelInstruction}\nTopic: ${dto.topic}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM API request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const answer = this.extractAnswer(data);

    return this.prisma.explanation.create({
      data: {
        topic: dto.topic,
        level: dto.level,
        answer,
        userId,
      },
      select: {
        id: true,
        topic: true,
        level: true,
        answer: true,
        shareId: true,
        createdAt: true,
      },
    });
  }

  async findAllByUser(userId: string) {
    return this.prisma.explanation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        topic: true,
        level: true,
        answer: true,
        shareId: true,
        createdAt: true,
      },
    });
  }

  async createShare(explanationId: string, userId: string) {
    const explanation = await this.prisma.explanation.findUnique({
      where: { id: explanationId },
      select: { id: true, userId: true, shareId: true },
    });

    if (!explanation) {
      throw new NotFoundException('Explanation not found');
    }

    if (explanation.userId !== userId) {
      throw new ForbiddenException('You can only share your own explanations');
    }

    if (explanation.shareId) {
      return { shareId: explanation.shareId };
    }

    const shareId = await this.generateUniqueShareId();
    await this.prisma.explanation.update({
      where: { id: explanationId },
      data: { shareId },
    });

    return { shareId };
  }

  async getSharedExplanation(shareId: string) {
    const explanation = await this.prisma.explanation.findUnique({
      where: { shareId },
      select: {
        id: true,
        topic: true,
        level: true,
        answer: true,
        createdAt: true,
        comments: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            authorName: true,
            content: true,
            createdAt: true,
          },
        },
      },
    });

    if (!explanation) {
      throw new NotFoundException('Shared explanation not found');
    }

    return explanation;
  }

  async addPublicComment(shareId: string, dto: CreatePublicCommentDto) {
    const explanation = await this.prisma.explanation.findUnique({
      where: { shareId },
      select: { id: true },
    });

    if (!explanation) {
      throw new NotFoundException('Shared explanation not found');
    }

    const authorName = dto.authorName?.trim() || 'Anonymous';
    const content = dto.content.trim();

    return this.prisma.publicComment.create({
      data: {
        authorName,
        content,
        explanationId: explanation.id,
      },
      select: {
        id: true,
        authorName: true,
        content: true,
        createdAt: true,
      },
    });
  }

  private extractAnswer(data: ChatCompletionResponse): string {
    const choice = data.choices?.[0];
    const messageContent = choice?.message?.content;

    if (typeof messageContent === 'string' && messageContent.trim()) {
      return messageContent;
    }

    if (Array.isArray(messageContent)) {
      const joined = messageContent
        .map((chunk) => chunk.text ?? '')
        .join('')
        .trim();

      if (joined) {
        return joined;
      }
    }

    if (typeof choice?.text === 'string' && choice.text.trim()) {
      return choice.text;
    }

    throw new BadGatewayException('LLM API returned an empty answer payload');
  }

  private async generateUniqueShareId() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const shareId = randomBytes(9).toString('base64url');
      const existing = await this.prisma.explanation.findUnique({
        where: { shareId },
        select: { id: true },
      });

      if (!existing) {
        return shareId;
      }
    }

    throw new BadGatewayException('Failed to generate a unique share link');
  }
}
