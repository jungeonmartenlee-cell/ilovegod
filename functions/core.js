// 스밈(AI) 나눔지 만들기 — Firebase 함수(functions/index.js)와 Cloudflare 서버(worker/) 가 함께 쓰는 부분
import { z } from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { stringify } from 'yaml';

export const REPO = 'jungeonmartenlee-cell/ilovegod';
const BRANCH = 'main';
const DIR = 'src/content/gbs/shared';

// ── 나눔지 형식 (src/content.config.ts 와 같아요)
// strict=false: 스밈에게 줄 형식 / strict=true: 사이트에 올릴 때 글자 수까지 확인
const schema = (strict) => {
  const str = (max, min = 0) => (strict ? z.string().min(min).max(max) : z.string());
  const arr = (item, max, min = 0) => (strict ? z.array(item).min(min).max(max) : z.array(item));
  return z.object({
    title: str(80, 1).describe('설교 제목'),
    passage: str(80, 1).describe('본문 구절. 예: 창세기 22:4–14'),
    preacher: str(40, strict ? 1 : 0).describe('설교자 이름과 직분. 원고에서 찾을 수 없으면 빈 문자열'),
    service: str(40).describe('예배 이름. 원고에 예배 언급이 없으면 빈 문자열'),
    date: (strict ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/) : z.string()).describe('원고에 설교 날짜가 있으면 YYYY-MM-DD, 없으면 빈 문자열'),
    key: str(300).describe('핵심 메시지 한 문장'),
    summary: arr(str(500), 5, 1).describe('3줄 요약 (정확히 3개)'),
    verses: arr(z.object({ ref: str(80), text: str(800) }), 5).describe('핵심 구절 1~3개. text는 원고에 인용된 구절 문장을 그대로'),
    word: z.object({ original: str(60), word: str(60), meaning: str(500) }).nullable().describe('설교가 풀이한 원어 단어. 없으면 null'),
    flow: arr(z.object({ title: str(100), note: str(300) }), 10).describe('설교 흐름. 첫째는 도입, 다음부터 대지'),
    share: z.object({
      minutes: z.number().int(),
      questions: arr(z.object({ tag: str(20), text: str(800) }), 10, 1),
      practice: str(500),
    }),
    devotions: arr(z.object({ ref: str(80), title: str(80), body: str(1000), question: str(500) }), 7).describe('5일 묵상 (정확히 5개)'),
    prayers: arr(str(400), 10),
    songs: arr(str(80), 10),
  });
};
export const Gbs = schema(false);
export const Submit = schema(true);
/** 스밈이 돌려줄 형식 (구조화된 출력) */
export const outputFormat = () => zodOutputFormat(Gbs);

/** 스밈에게 주는 안내문 (example: 실제 나눔지 예시 yaml) */
export const buildSystem = (EXAMPLE) => `당신은 한국 교회 청년 공동체의 GBS(소그룹 성경공부) 나눔지를 만드는 사역자입니다.
교역자가 올린 설교 원고 하나로 나눔지 하나를 만듭니다.

원칙
- 오직 원고의 내용에 근거해 쓰세요. 원고에 없는 예화, 주장, 신학적 해석을 지어내지 마세요.
- 설교자(이름과 직분), 예배 이름, 날짜는 원고에 적혀 있을 때만 적고, 없으면 빈 문자열로 두세요. 추측하지 마세요.
- 제목과 본문 구절은 원고에서 찾으세요. 제목이 따로 없으면 설교의 핵심을 담은 짧은 제목을 지으세요.
- 성경 구절 본문(verses.text)은 원고에 인용된 문장만 그대로 옮기세요. 원고에 문장이 없는 구절은 넣지 마세요.
- 청년들이 읽기 쉬운 따뜻하고 간결한 존댓말로 쓰세요. 설교자의 표현과 예화를 살리세요.

구성
- summary: 설교 흐름을 따라 3줄
- flow: 첫째는 도입 예화, 다음은 대지들. note에는 한 줄 설명이나 관련 구절
- share.questions: 5개. tag는 순서대로 "마음 열기", "말씀 1", "말씀 2", "적용", "함께 기도"
  · 마음 열기는 원고의 도입 예화와 이어지는 가벼운 질문
  · 말씀 질문은 본문과 설교 내용을 함께 생각하게 하는 열린 질문 (예/아니오로 끝나지 않게)
  · 적용은 이번 주 삶에서 나눌 수 있는 구체적인 질문
- share.minutes: 40, share.practice: 이번 주 실천할 한 가지
- devotions: 설교 다음 날부터 5일 동안 묵상. 매일 다른 본문(설교 본문과 원고에 나온 관련 구절 중심), 짧은 묵상글, 오늘의 질문
- prayers: 4~5개. 설교 내용으로 드리는 기도. 공동체 기도제목이 원고에 있으면 포함
- songs: 원고에서 언급한 찬양이 있을 때만 적고, 없으면 빈 배열

아래는 이 공동체가 실제로 쓴 나눔지 예시입니다. 분량과 말투를 참고하세요. (예시의 내용을 가져오지는 마세요)
<example>
${EXAMPLE}
</example>`;

/** 스밈에게 보내는 메시지 — PDF 를 그대로 보낼 때는 문서와 안내를 함께 보내요 */
export const userContent = (text, note, pdf) => pdf
  ? [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
      { type: 'text', text: `${note ? `교역자가 바라는 점: ${note}\n\n` : ''}위 PDF는 설교 원고입니다. 이 설교 원고로 나눔지를 만들어 주세요.` },
    ]
  : userMessage(text, note);

/** 스밈에게 보내는 메시지 */
export const userMessage = (text, note) => [
  note ? `교역자가 바라는 점: ${note}\n` : '',
  '<sermon>', text.trim(), '</sermon>',
  '\n위 설교 원고로 나눔지를 만들어 주세요.',
].join('\n');

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
export function toMarkdown(g, communities) {
  const start = new Date(`${g.date}T00:00:00Z`);
  const day = (i) => DAYS[new Date(start.getTime() + (i + 1) * 86400_000).getUTCDay()];
  const data = {
    date: g.date,
    ...(g.service.trim() ? { service: g.service.trim() } : {}),
    title: g.title, passage: g.passage, preacher: g.preacher, key: g.key,
    communities, status: 'review',
    summary: g.summary,
    verses: g.verses,
    ...(g.word ? { word: g.word } : {}),
    flow: g.flow,
    share: g.share,
    devotions: g.devotions.map((d, i) => ({ day: day(i), ...d })),
    prayers: g.prayers,
    songs: g.songs,
  };
  return `---\n# 스밈(AI)이 설교 원고로 만든 나눔지 — 교역자 검수 후 공개돼요\n${stringify(data, { lineWidth: 0 })}---\n`;
}

async function gh(token, path, init = {}) {
  return fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ilovegod-site', ...init.headers },
  });
}

/** 나눔지 파일을 GitHub에 올려요 (같은 날짜가 있으면 -2, -3 …). 올린 이름을 돌려줘요. */
export async function commitGbs(token, md, { date, title, email }) {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(md)));
  for (let n = 1; n <= 20; n++) {
    const name = n === 1 ? date : `${date}-${n}`;
    const res = await gh(token, `${DIR}/${name}.md`, {
      method: 'PUT',
      body: JSON.stringify({ message: `나눔지 올림: ${title}`, content: b64, branch: BRANCH }),
    });
    if (res.status === 201) return name;
    if (res.status === 422) continue;          // 같은 날짜 파일이 이미 있어요
    throw new Error(`github ${res.status}`);
  }
  throw new Error('too many files');
}
export { parse as parseYaml } from 'yaml';

// ── 공동체 파일 (GitHub) ─────────────────────────────────────
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
/** 파일이 있으면 { sha, text }, 없으면 null */
export async function readRepoFile(token, path) {
  const r = await gh(token, path);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`github ${r.status}`);
  const j = await r.json();
  return { sha: j.sha, text: new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\n/g, '')), (c) => c.charCodeAt(0))) };
}
/** 파일을 만들거나 고쳐요 (sha 가 있으면 고치기) */
export async function writeRepoFile(token, path, text, message, sha) {
  const r = await gh(token, path, { method: 'PUT', body: JSON.stringify({ message, content: b64(text), branch: BRANCH, ...(sha ? { sha } : {}) }) });
  if (r.status !== 200 && r.status !== 201) throw new Error(`github ${r.status}`);
}

/** 한글 이름을 로마자로 (국어의 로마자 표기법을 간단히) — 스밈이 주소를 못 정할 때 씀 */
export function romanize(name) {
  name = name.replace(/\s*(공동체|청년부|청년회|청년|공동|모임|팀)$/u, '') || name;
  const I = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
  // 샤·쇼·슈 처럼 ㅅ+ㅑ/ㅕ/ㅛ/ㅠ 는 sh 로 (샬롬 → shallom 이 아니라 shalom 에 가깝게)
  const V = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
  const F = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
  let out = '';
  for (const ch of name) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c >= 0 && c < 11172) {
      let i = I[Math.floor(c / 588)], v = V[Math.floor((c % 588) / 28)];
      if (i === 's' && /^y/.test(v)) { i = 'sh'; v = v.slice(1); }
      const f = F[c % 28];
      out += (out.endsWith('l') && i === 'r' ? 'l' : i) + v + f;
    }
    else if (/[a-z0-9]/i.test(ch)) out += ch.toLowerCase();
    else if (/\s|-/.test(ch)) out += '-';
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
}
/** 주소로 쓸 수 없는 이름 (사이트의 다른 페이지와 겹쳐요) */
export const RESERVED = new Set(['staff', 'guide', 'privacy', 'terms', 'gbs', 'qr', 'api', 'admin', 'index', 'images', 'pdfjs', 'favicon', '404', 'types', 'edits', 'about', 'share', 'login']);
export const SLUG_RE = /^[a-z][a-z0-9-]{1,19}$/;
