import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExplanationDto } from './explain.dto';

const SYSTEM_PROMPT = `You are an expert at explaining complex topics in simple terms.
When a user gives you a topic or concept, explain it as if they were 5 years old.
Use simple analogies, everyday examples, and short sentences.
Keep your explanation friendly, fun, and easy to understand.
Do not use jargon or technical terms without immediately explaining them.
Keep responses concise — aim for 3-5 short paragraphs at most.
IMPORTANT: Always respond in the same language the user wrote their question in.`;

interface ChatCompletionResponse {
  choices: { message: { role: string; content: string } }[];
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
          { role: 'user', content: `Explain this like I'm 5: ${dto.topic}` },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM API request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const answer = data.choices[0].message.content;

    return this.prisma.explanation.create({
      data: {
        topic: dto.topic,
        answer,
        userId,
      },
      select: {
        id: true,
        topic: true,
        answer: true,
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
        answer: true,
        createdAt: true,
      },
    });
  }
}
