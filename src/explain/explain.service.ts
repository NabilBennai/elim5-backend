import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExplanationDto } from './explain.dto';

const MOCK_ANSWERS = [
  "Imagine you have a big box of LEGOs. {topic} is like building something cool with those LEGOs — you take small, simple pieces and put them together step by step until you have something amazing. Each piece on its own isn't much, but together they make something great!",
  "You know how when you mix red and blue paint you get purple? {topic} works kind of like that — you take a couple of simple things, mix them together in the right way, and you get something completely new and different!",
  "Think of {topic} like a recipe for your favorite cookies. You need specific ingredients, you follow the steps in order, and at the end you get something delicious. If you skip a step or use the wrong ingredient, it won't turn out right!",
  "Imagine you're playing telephone with your friends. {topic} is like making sure the message gets from the first person to the last person without getting all mixed up. There are special rules to help keep the message clear!",
  "You know how a tree starts as a tiny seed? {topic} is like that — it starts really small and simple, but over time it grows bigger and more complex. And just like a tree needs water and sun, it needs the right conditions to work!",
];

@Injectable()
export class ExplainService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateExplanationDto, userId: string) {
    const mock = MOCK_ANSWERS[Math.floor(Math.random() * MOCK_ANSWERS.length)];
    const answer = mock.replace(/\{topic\}/g, dto.topic);

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
