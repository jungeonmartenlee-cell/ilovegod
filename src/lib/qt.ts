import { getCollection, type CollectionEntry } from 'astro:content';

export type Qt = CollectionEntry<'qt'>;

/** 공개된 큐티를 최신순으로 정렬해서 돌려줍니다. */
export async function getSortedQt(): Promise<Qt[]> {
  const all = await getCollection('qt', ({ data }) => !data.draft);
  return all.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

/** 2026년 11월 1일 주일 형태 */
export function formatDate(d: Date): string {
  const days = ['주일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${days[d.getUTCDay()]}`;
}

/** 11.01 형태 (목록용) */
export function shortDate(d: Date): string {
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${m}.${day}`;
}

