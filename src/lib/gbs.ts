import { getCollection, type CollectionEntry } from 'astro:content';

export type Gbs = CollectionEntry<'gbs'>;

/** GBS 파일이 속한 공동체 (폴더 이름) — 예: 'gil' */
export const gbsCommunity = (gbs: Gbs) => gbs.id.split('/')[0];
/** GBS 주소용 이름 (파일 이름) — 예: '2026-11-01' */
export const gbsSlug = (gbs: Gbs) => gbs.id.split('/').slice(1).join('/');
/** GBS 페이지 주소 — 예: '/gil/gbs/2026-11-01' */
export const gbsUrl = (gbs: Gbs) => `/${gbsCommunity(gbs)}/gbs/${gbsSlug(gbs)}`;

/** 한 공동체의 공개된 GBS를 최신순으로 */
export async function getSortedGbs(community: string): Promise<Gbs[]> {
  const all = await getCollection('gbs', (gbs) => !gbs.data.draft && gbsCommunity(gbs) === community && gbsSlug(gbs) !== '');
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
