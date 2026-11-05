// GBS 나눔지의 형식을 정의합니다.
// 나눔지 하나 = 마크다운 파일 하나 (내용은 맨 위 --- 사이에 모두 적어요)
// 빈 양식과 설명: src/content/gbs/_템플릿.md
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const gbs = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/gbs' }),
  schema: z.object({
    date: z.coerce.date(),                        // 설교 날짜
    title: z.string(),                            // 설교 제목
    passage: z.string(),                          // 본문 구절
    preacher: z.string(),                         // 설교자
    service: z.string().optional(),               // 예배 이름 (예: 주일예배, 화요램넌트예배)
    key: z.string(),                              // 핵심 메시지 한 문장
    communities: z.array(z.string()).optional(),  // 보낼 공동체 (shared 폴더에 둘 때) 예: [gil, shalom]
    draft: z.boolean().optional(),                // true면 사이트에 안 보임
    // review = 교역자 검수 중 (승인되면 공개), approved = 바로 공개
    status: z.enum(['review', 'approved']).default('approved'),

    // ── 요약 탭
    summary: z.array(z.string()).min(1),          // 3줄 요약
    verses: z.array(z.object({ ref: z.string(), text: z.string() })).default([]),
    word: z.object({ original: z.string().optional(), word: z.string(), meaning: z.string() }).optional(),
    flow: z.array(z.object({ title: z.string(), note: z.string().optional() })).default([]),

    // ── 나눔 탭
    share: z.object({
      minutes: z.number().optional(),
      questions: z.array(z.object({ tag: z.string(), text: z.string() })).min(1),
      practice: z.string().optional(),
    }),

    // ── 5일 묵상 탭
    devotions: z.array(z.object({
      day: z.string(), ref: z.string(), title: z.string(), body: z.string(), question: z.string(),
    })).default([]),

    // ── 기도 탭
    prayers: z.array(z.string()).default([]),
    songs: z.array(z.string()).default([]),
  }),
});

export const collections = { gbs };
