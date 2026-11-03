import { SITE, BRAND } from '../config';

const names = SITE.names.map((n) => n.trim()).filter(Boolean);

/** 대표 이름 (예: GIL) */
export const mainName = names[0] ?? BRAND;
/** 로고 아래 이름 줄 (예: GIL REMNANT ORYUN) */
export const namesLine = names.join(' ');
/** 대표 이름을 뺀 나머지 (예: REMNANT ORYUN) */
export const parentNames = names.slice(1).join(' ');
/** 로고 글자 */
export const brand = BRAND || mainName;
