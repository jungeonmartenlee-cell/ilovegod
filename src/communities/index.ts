// 이 폴더의 공동체 설정 파일을 자동으로 모아요. (수정하지 않아도 돼요)
// 새 공동체 추가: gil.ts 를 복사해서 이름을 바꾸면 (예: shalom.ts → 주소 /shalom) 끝!
import type { Community } from './types';

const files = {
  ...import.meta.glob<{ default: Community }>(['./*.ts', '!./index.ts', '!./types.ts', '!./_*.ts'], { eager: true }),
  // 교역자 화면에서 '새 공동체 만들기'로 만든 공동체 (이름만 있어요)
  ...import.meta.glob<{ default: Community }>('./*.json', { eager: true }),
};
// 교역자 화면에서 '공동체 소개 고치기'로 고친 내용 — 원래 설정 위에 덮어써요
type Edit = { name?: string; tagline?: string; intro?: string; worship?: Community['worship'] };
const edits = Object.fromEntries(
  Object.entries(import.meta.glob<{ default: Edit }>('./edits/*.json', { eager: true }))
    .map(([path, mod]) => [path.replace(/^\.\/edits\//, '').replace(/\.json$/, ''), mod.default]),
);
const applyEdit = (c: Community, e?: Edit): Community => {
  if (!e) return c;
  const names = [...c.names];
  if (e.name?.trim()) names[0] = e.name.trim();
  return {
    ...c, names,
    tagline: e.tagline === undefined ? c.tagline : e.tagline.trim() || undefined,
    intro: e.intro === undefined ? c.intro : e.intro.trim() || undefined,
    worship: e.worship === undefined ? c.worship : e.worship,
  };
};

export interface CommunityEntry extends Community {
  /** 주소에 쓰이는 이름 (파일 이름) */
  slug: string;
  mainName: string;
  namesLine: string;
  parentNames: string;
}

export const communities: CommunityEntry[] = Object.entries(files)
  .map(([path, mod]) => {
    const slug = path.replace(/^\.\//, '').replace(/\.(ts|json)$/, '');
    const base = applyEdit(mod.default, edits[slug]);
    const names = base.names.map((n) => n.trim()).filter(Boolean);
    return {
      ...base,
      slug,
      mainName: names[0] ?? slug.toUpperCase(),
      namesLine: names.join(' '),
      parentNames: names.slice(1).join(' '),
    };
  })
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.slug.localeCompare(b.slug));

export function getCommunity(slug: string): CommunityEntry | undefined {
  return communities.find((c) => c.slug === slug);
}
