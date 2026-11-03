// 공동체 설정의 형식 (수정하지 않아도 돼요)
// 항목 끝에 ? 가 붙은 것은 없어도 되는 항목이에요. 비워 두면 그 칸은 화면에서 숨겨져요.
export interface Community {
  /** 공동체 이름들 — 첫 번째가 대표 이름 (예: ['GIL', 'REMNANT', 'ORYUN']) */
  names: string[];
  tagline: string;
  intro: string;
  attendance?: string;
  description?: string;
  /** 메인 페이지 공동체 목록에서의 순서 (작을수록 앞) */
  order?: number;
  /** 예배·모임 — order 는 예배 순서 (예: '찬양 → 설교 → 기도') */
  worship: { label: string; time: string; place: string; order?: string }[];
  /** 네이버 지도에서 검색할 장소 이름 (예: '오륜교회') */
  mapQuery?: string;
  about: {
    /** 공동체 이름의 뜻 / 비전 */
    vision?: {
      title?: string;
      subtitle?: string;
      verse: string;
      ref: string;
      points: { title: string; text?: string }[];
    };
    /** 마스코트 */
    mascot?: { name: string; text: string };
    /** 소그룹 안내 */
    smallGroup?: { intro: string; steps: string[]; notes: string[] };
    /** 소속 조직도 */
    org?: {
      title: string;
      groups: { name: string; desc: string; children?: string[]; current?: string }[];
      note?: string;
    };
    /** 공동체 활동 */
    activities?: {
      items: string[];
      programs?: { title: string; text: string; items?: string[] }[];
    };
    /** 섬기는 사람들 — photo 는 public/images/ 안의 파일 이름, featured 는 크게 보이기 */
    peopleTitle?: string;
    people: { role: string; name?: string; note?: string; photo?: string; featured?: boolean }[];
    /** 소개 페이지 맨 아래 마무리 문구 */
    closing?: { title: string; text: string; verse?: string; ref?: string };
    meetings?: { name: string; desc: string }[];
    welcome?: { title: string; text: string };
  };
  form?: { url: string; label: string; note?: string };
  contact?: { instagram?: string; kakao?: string };
}

export function defineCommunity(c: Community): Community {
  return c;
}
