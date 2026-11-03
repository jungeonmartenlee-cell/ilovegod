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

/** 나눔방에서 쓸 질문 목록 — GBS 자료의 '마음 열기 / 말씀 나눔 / 삶 나눔' 번호 목록에서 뽑아요 */
export interface RoomQuestion { id: string; section: string; num: number; text: string }
const QUESTION_SECTIONS = ['마음 열기', '말씀 나눔', '삶 나눔'];
export function extractQuestions(body: string): RoomQuestion[] {
  const out: RoomQuestion[] = [];
  let section = '';
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const h = line.match(/^##\s+(.+)/);
    if (h) { section = h[1].trim(); continue; }
    const q = line.match(/^(\d+)\.\s+(.+)/);
    if (q && QUESTION_SECTIONS.includes(section)) {
      const text = q[2].replace(/\*\*/g, '').trim();
      out.push({ id: `${QUESTION_SECTIONS.indexOf(section)}-${q[1]}`, section, num: Number(q[1]), text });
    }
  }
  out.push({ id: 'pray', section: '함께 기도', num: 0, text: '서로의 기도제목을 나누고 함께 기도해요' });
  return out;
}
