import {
  BadGatewayException,
  ForbiddenException,
  HttpException,
  HttpStatus,
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

interface SourceContext {
  sourceType: 'url' | 'pdf';
  sourceUrl: string;
  snippets: string[];
}

interface CreditWindowStatus {
  key: 'fiveHours' | 'daily' | 'weekly';
  label: string;
  windowHours: number;
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
}

interface CreditStatusResponse {
  allowed: boolean;
  planId: 'free' | 'starter' | 'pro';
  windows: CreditWindowStatus[];
}

@Injectable()
export class ExplainService {
  private apiUrl: string;
  private apiKey: string;
  private model: string;
  private freeLimits: { fiveHours: number; daily: number; weekly: number };
  private starterLimits: { fiveHours: number; daily: number; weekly: number };
  private proLimits: { fiveHours: number; daily: number; weekly: number };

  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    this.apiUrl = 'https://api.llmapi.ai/v1/chat/completions';
    this.apiKey = config.getOrThrow<string>('LLMAPI_KEY');
    this.model = config.get<string>('LLMAPI_MODEL', 'qwen-flash');
    this.freeLimits = {
      fiveHours: this.readPositiveInt(config, 'AI_CREDITS_5H', 10),
      daily: this.readPositiveInt(config, 'AI_CREDITS_DAILY', 25),
      weekly: this.readPositiveInt(config, 'AI_CREDITS_WEEKLY', 120),
    };
    this.starterLimits = {
      fiveHours: this.readPositiveInt(config, 'AI_CREDITS_5H_STARTER', 45),
      daily: this.readPositiveInt(config, 'AI_CREDITS_DAILY_STARTER', 180),
      weekly: this.readPositiveInt(config, 'AI_CREDITS_WEEKLY_STARTER', 800),
    };
    this.proLimits = {
      fiveHours: this.readPositiveInt(config, 'AI_CREDITS_5H_PRO', 140),
      daily: this.readPositiveInt(config, 'AI_CREDITS_DAILY_PRO', 600),
      weekly: this.readPositiveInt(config, 'AI_CREDITS_WEEKLY_PRO', 2500),
    };
  }

  async create(dto: CreateExplanationDto, userId: string) {
    await this.enforceCredits(userId);

    const levelInstruction = LEVEL_INSTRUCTIONS[dto.level];
    const sourceContext = dto.sourceUrl ? await this.fetchSourceContext(dto.sourceUrl) : null;
    const sourcePrompt = sourceContext
      ? `\n\nUse only the source snippets below for factual claims and cite them as [1], [2], etc.\nSource URL: ${sourceContext.sourceUrl}\nSnippets:\n${sourceContext.snippets
          .map((snippet, idx) => `[${idx + 1}] ${snippet}`)
          .join('\n')}`
      : '';

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
            content: `Level: ${dto.level}\nInstruction: ${levelInstruction}\nTopic: ${dto.topic}${sourcePrompt}`,
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
        sources: sourceContext
          ? {
              create: sourceContext.snippets.map((snippet, idx) => ({
                citationIndex: idx + 1,
                sourceUrl: sourceContext.sourceUrl,
                sourceType: sourceContext.sourceType,
                snippet,
              })),
            }
          : undefined,
      },
      select: {
        id: true,
        topic: true,
        level: true,
        answer: true,
        shareId: true,
        sources: {
          orderBy: { citationIndex: 'asc' },
          select: {
            id: true,
            citationIndex: true,
            sourceUrl: true,
            sourceType: true,
            snippet: true,
          },
        },
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
        sources: {
          orderBy: { citationIndex: 'asc' },
          select: {
            id: true,
            citationIndex: true,
            sourceUrl: true,
            sourceType: true,
            snippet: true,
          },
        },
        createdAt: true,
      },
    });
  }

  async getCredits(userId: string): Promise<CreditStatusResponse> {
    const now = new Date();
    const planId = await this.getEffectivePlan(userId);
    const limits = this.getLimitsForPlan(planId);
    const windows = this.getWindows(now, limits);

    const usage = await Promise.all(
      windows.map((window) =>
        this.prisma.explanation.count({
          where: {
            userId,
            createdAt: { gte: window.since },
          },
        }),
      ),
    );

    const statuses: CreditWindowStatus[] = windows.map((window, index) => {
      const used = usage[index];
      const remaining = Math.max(window.limit - used, 0);

      return {
        key: window.key,
        label: window.label,
        windowHours: window.hours,
        limit: window.limit,
        used,
        remaining,
        resetAt: new Date(now.getTime() + window.hours * 60 * 60 * 1000).toISOString(),
      };
    });

    const allowed = statuses.every((status) => status.remaining > 0);
    return { allowed, planId, windows: statuses };
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
        sources: {
          orderBy: { citationIndex: 'asc' },
          select: {
            id: true,
            citationIndex: true,
            sourceUrl: true,
            sourceType: true,
            snippet: true,
          },
        },
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

  private async enforceCredits(userId: string) {
    const creditStatus = await this.getCredits(userId);
    if (creditStatus.allowed) return;

    throw new HttpException(
      {
        message:
          'AI credit limit reached. Your credits recharge on rolling windows: 5 hours, daily, and weekly.',
        code: 'AI_CREDITS_EXHAUSTED',
        creditStatus,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private getWindows(now: Date, limits: { fiveHours: number; daily: number; weekly: number }) {
    return [
      {
        key: 'fiveHours' as const,
        label: '5h',
        hours: 5,
        limit: limits.fiveHours,
        since: new Date(now.getTime() - 5 * 60 * 60 * 1000),
      },
      {
        key: 'daily' as const,
        label: '24h',
        hours: 24,
        limit: limits.daily,
        since: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      },
      {
        key: 'weekly' as const,
        label: '7d',
        hours: 7 * 24,
        limit: limits.weekly,
        since: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      },
    ];
  }

  private async getEffectivePlan(userId: string): Promise<'free' | 'starter' | 'pro'> {
    const activeSubscription = await this.prisma.billingSubscription.findFirst({
      where: {
        userId,
        status: { in: ['active', 'trialing', 'past_due'] },
      },
      orderBy: { updatedAt: 'desc' },
      select: { planId: true },
    });

    if (activeSubscription?.planId === 'starter' || activeSubscription?.planId === 'pro') {
      return activeSubscription.planId;
    }

    return 'free';
  }

  private getLimitsForPlan(planId: 'free' | 'starter' | 'pro') {
    if (planId === 'starter') {
      return this.starterLimits;
    }

    if (planId === 'pro') {
      return this.proLimits;
    }

    return this.freeLimits;
  }

  private readPositiveInt(config: ConfigService, key: string, defaultValue: number) {
    const raw = config.get<string | number | undefined>(key);
    if (raw === undefined || raw === null || raw === '') {
      return defaultValue;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return defaultValue;
    }

    return Math.floor(parsed);
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

  private async fetchSourceContext(rawUrl: string): Promise<SourceContext> {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadGatewayException('Only http/https source URLs are supported');
    }

    const response = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'ExplainLikeIm5Bot/1.0' },
    });

    if (!response.ok) {
      throw new BadGatewayException(`Failed to fetch source URL (${response.status})`);
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const isPdf =
      contentType.includes('application/pdf') || parsed.pathname.toLowerCase().endsWith('.pdf');

    const text = isPdf
      ? await this.extractPdfText(response)
      : this.extractTextFromHtml(await response.text());
    const snippets = this.buildSnippets(text);

    if (!snippets.length) {
      throw new BadGatewayException('Source URL does not contain enough readable text');
    }

    return {
      sourceType: isPdf ? 'pdf' : 'url',
      sourceUrl: parsed.toString(),
      snippets,
    };
  }

  private async extractPdfText(response: Response) {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await response.arrayBuffer();
    const parsed = await pdfParse(Buffer.from(data));
    return parsed.text ?? '';
  }

  private extractTextFromHtml(html: string) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildSnippets(text: string) {
    const clean = text.replace(/\s+/g, ' ').trim();
    const maxSnippets = 5;
    const snippetLength = 360;
    if (!clean) return [];

    const snippets: string[] = [];
    let cursor = 0;

    while (cursor < clean.length && snippets.length < maxSnippets) {
      const end = Math.min(cursor + snippetLength, clean.length);
      const slice = clean.slice(cursor, end);
      const normalized = slice.trim();
      if (normalized.length > 40) {
        snippets.push(normalized);
      }
      cursor = end;
    }

    return snippets;
  }
}
