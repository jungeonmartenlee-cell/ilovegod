// 큐티 자료(마크다운 파일)의 형식을 정의합니다.
// 파일 맨 위 frontmatter(--- 사이 부분)에 아래 항목이 꼭 있어야 해요.
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const qt = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/qt' }),
  schema: z.object({
    date: z.coerce.date(),              // 설교 날짜 (예: 2026-11-01)
    title: z.string(),                  // 설교 제목
    passage: z.string(),                // 본문 구절 (예: 요한복음 15:1-8)
    preacher: z.string(),               // 설교자
    summary: z.string().optional(),     // 목록에 보일 한 줄 요약 (선택)
    draft: z.boolean().optional(),      // true면 사이트에 안 보임 (선택)
  }),
});

export const collections = { qt };
