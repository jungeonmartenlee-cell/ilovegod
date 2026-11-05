import { getCollection, type CollectionEntry } from 'astro:content';

export type Gbs = CollectionEntry<'gbs'>;

/** 폴더 이름 — 공동체 폴더(예: 'gil') 또는 여러 공동체용 'shared' */
const folder = (gbs: Gbs) => gbs.id.split('/')[0];
/** 이 나눔지를 받는 공동체들 */
export const gbsTargets = (gbs: Gbs): string[] =>
  folder(gbs) === 'shared' ? (gbs.data.communities ?? []) : [folder(gbs), ...(gbs.data.communities ?? [])];
/** 주소용 이름 (파일 이름) — 예: '2026-11-01' */
export const gbsSlug = (gbs: Gbs) => gbs.id.split('/').slice(1).join('/');
/** 공동체 안에서의 GBS 주소 — 예: '/gil/gbs/2026-11-01' */
export const gbsUrl = (gbs: Gbs, community: string) => `/${community}/gbs/${gbsSlug(gbs)}`;

/** 교역자 검수가 필요한 나눔지인지 */
export const isReview = (gbs: Gbs) => gbs.data.status === 'review';
/** 승인 기록 문서 ID (Firestore approvals 컬렉션) */
export const approvalId = (gbs: Gbs) => gbs.id.replace(/\//g, '__');
/** 검수 중이면, 승인된 공동체에만 보이도록 붙이는 표시 */
export const gate = (gbs: Gbs, community: string) =>
  isReview(gbs) ? { 'data-gate': approvalId(gbs), 'data-community': community } : {};

/** 한 공동체가 받은 나눔지를 최신순으로 (검수 중인 것도 포함 — 화면에서 승인 여부로 가려요) */
export async function getSortedGbs(community: string): Promise<Gbs[]> {
  const all = await getCollection('gbs', (gbs) => !gbs.data.draft && gbsSlug(gbs) !== '' && gbsTargets(gbs).includes(community));
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

/** 나눔방에서 쓸 질문 목록 — 나눔 탭의 질문을 그대로 가져와요 */
export interface RoomQuestion { id: string; section: string; num: number; text: string }
export function extractQuestions(gbs: Gbs): RoomQuestion[] {
  const out: RoomQuestion[] = gbs.data.share.questions.map((q, i) => ({ id: `q${i + 1}`, section: q.tag, num: 0, text: q.text }));
  if (!out.some((q) => q.section.includes('기도'))) {
    out.push({ id: 'pray', section: '함께 기도', num: 0, text: '서로의 기도제목을 나누고 함께 기도해요' });
  }
  return out;
}
