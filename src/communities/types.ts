// 공동체 설정의 형식 (수정하지 않아도 돼요)
export interface Community {
  /** 공동체 이름들 — 첫 번째가 대표 이름 (예: ['GIL', 'REMNANT', 'ORYUN']) */
  names: string[];
  tagline: string;
  intro: string;
  attendance?: string;
  description?: string;
  /** 메인 페이지 공동체 목록에서의 순서 (작을수록 앞) */
  order?: number;
  worship: { label: string; time: string; place: string }[];
  about: {
    vision: { verse: string; ref: string; points: { title: string; text: string }[] };
    people: { role: string; name: string; note?: string }[];
    meetings: { name: string; desc: string }[];
    welcome?: { title: string; text: string };
  };
  form?: { url: string; label: string; note?: string };
  contact?: { instagram?: string; kakao?: string };
}

export function defineCommunity(c: Community): Community {
  return c;
}
