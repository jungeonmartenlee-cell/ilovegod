// 이 폴더의 공동체 설정 파일을 자동으로 모아요. (수정하지 않아도 돼요)
// 새 공동체 추가: gil.ts 를 복사해서 이름을 바꾸면 (예: shalom.ts → 주소 /shalom) 끝!
import type { Community } from './types';

const files = import.meta.glob<{ default: Community }>(['./*.ts', '!./index.ts', '!./types.ts', '!./_*.ts'], { eager: true });

export interface CommunityEntry extends Community {
  /** 주소에 쓰이는 이름 (파일 이름) */
  slug: string;
  mainName: string;
  namesLine: string;
  parentNames: string;
}

export const communities: CommunityEntry[] = Object.entries(files)
  .map(([path, mod]) => {
    const slug = path.replace(/^\.\//, '').replace(/\.ts$/, '');
    const names = mod.default.names.map((n) => n.trim()).filter(Boolean);
    return {
      ...mod.default,
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
