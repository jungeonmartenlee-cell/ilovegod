// 교역자가 올린 설교 원고로 AI '스밈'이 GBS 나눔지를 만들어 주는 서버 함수
//
//  makeGbs   : 원고 → 나눔지 내용(JSON). 원고는 어디에도 저장하지 않고, 기록(로그)에도 남기지 않아요.
//  submitGbs : 교역자가 확인한 나눔지를 GitHub에 올려요 → 사이트가 자동으로 다시 만들어지고 검수 목록에 나타나요.
//
//  필요한 비밀값 (Google Cloud → 보안 비밀 관리자에 등록)
//    ANTHROPIC_API_KEY : 스밈이 쓰는 AI(Anthropic) API 키
//    GH_TOKEN          : 이 저장소에만 파일을 쓸 수 있는 GitHub 토큰
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod/v4';
import { stringify } from 'yaml';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

initializeApp();
const db = getFirestore();
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const GH_TOKEN = defineSecret('GH_TOKEN');

const REPO = 'jungeonmartenlee-cell/ilovegod';
const BRANCH = 'main';
const DIR = 'src/content/gbs/shared';
const DAILY_LIMIT = 10;              // 교역자 한 사람이 하루에 만들 수 있는 횟수
const EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const OPTS = { region: 'asia-northeast3', cors: true };
const EXAMPLE = readFileSync(new URL('./example.yaml', import.meta.url), 'utf8');

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
const Gbs = schema(false);
const Submit = schema(true);

// ── 공통: 로그인한 교역자인지, 맡은 공동체인지 확인
async function checkStaff(req, communities) {
  const t = req.auth?.token;
  if (!t?.email || !t.email_verified) throw new HttpsError('unauthenticated', '교역자 계정으로 로그인해 주세요.');
  const snap = await db.doc(`staff/${t.email}`).get();
  if (!snap.exists) throw new HttpsError('permission-denied', '교역자로 등록된 계정이 아니에요.');
  const staff = snap.data();
  if (!Array.isArray(communities) || !communities.length || communities.some((c) => typeof c !== 'string'))
    throw new HttpsError('invalid-argument', '공동체를 골라 주세요.');
  if (!staff.admin && !communities.every((c) => (staff.communities ?? []).includes(c)))
    throw new HttpsError('permission-denied', '맡은 공동체에만 만들 수 있어요.');
  return t.email;
}

const todayKST = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

// 하루 사용 횟수 제한 (원고 내용은 남기지 않고 횟수만 세요)
async function countUse(email) {
  const ref = db.doc(`usage/${email}_${todayKST()}`);
  await db.runTransaction(async (tx) => {
    const n = (await tx.get(ref)).data()?.count ?? 0;
    if (n >= DAILY_LIMIT) throw new HttpsError('resource-exhausted', `오늘은 ${DAILY_LIMIT}번까지 만들 수 있어요. 내일 다시 해 주세요.`);
    tx.set(ref, { count: n + 1, at: FieldValue.serverTimestamp() }, { merge: true });
  });
}

const SYSTEM = `당신은 한국 교회 청년 공동체의 GBS(소그룹 성경공부) 나눔지를 만드는 사역자입니다.
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

// 에뮬레이터 시험용: 실제 스밈(AI)을 부르지 않고 예시 나눔지를 돌려줘요
async function mockGbs() {
  const { parse } = await import('yaml');
  const e = parse(EXAMPLE);
  return { ...e, date: '', service: '', devotions: e.devotions.map(({ day, ...d }) => d) };
}

export const makeGbs = onCall({ ...OPTS, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 540, memory: '512MiB' }, async (req) => {
  const { text, communities, note } = req.data ?? {};
  const email = await checkStaff(req, communities);
  if (typeof text !== 'string' || text.trim().length < 200 || text.length > 60000)
    throw new HttpsError('invalid-argument', '원고는 200자에서 60,000자 사이로 넣어 주세요.');
  if (note != null && (typeof note !== 'string' || note.length > 1000)) throw new HttpsError('invalid-argument', '바라는 점은 1,000자까지 적어 주세요.');
  await countUse(email);

  const key = ANTHROPIC_API_KEY.value();
  if (EMULATOR && key === 'mock') return { gbs: await mockGbs() };

  const client = new Anthropic({ apiKey: key });
  const user = [
    note ? `교역자가 바라는 점: ${note}\n` : '',
    '<sermon>', text.trim(), '</sermon>',
    '\n위 설교 원고로 나눔지를 만들어 주세요.',
  ].join('\n');
  try {
    const stream = client.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 32000,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
      output_config: { format: zodOutputFormat(Gbs) },
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new HttpsError('failed-precondition', '이 원고로는 나눔지를 만들지 못했어요.');
    if (!msg.parsed_output) throw new HttpsError('internal', '나눔지를 만들지 못했어요. 다시 해 주세요.');
    // 비용 확인용으로 글자 수 대신 토큰 수만 남겨요 (원고 내용은 남기지 않아요)
    console.log('makeGbs usage', JSON.stringify(msg.usage));
    return { gbs: msg.parsed_output };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error('makeGbs error', e instanceof Anthropic.APIError ? `${e.status} ${e.name}` : String(e?.name));
    throw new HttpsError('unavailable', '스밈이 지금 응답하지 않아요. 잠시 뒤에 다시 해 주세요.');
  }
});

// ── 확인한 나눔지를 사이트에 올리기
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
function toMarkdown(g, communities) {
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

async function gh(path, init = {}) {
  return fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${GH_TOKEN.value()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ilovegod-site', ...init.headers },
  });
}

export const submitGbs = onCall({ ...OPTS, secrets: [GH_TOKEN], timeoutSeconds: 60 }, async (req) => {
  const { gbs, communities } = req.data ?? {};
  const email = await checkStaff(req, communities);
  const parsed = Submit.safeParse(gbs);
  if (!parsed.success) throw new HttpsError('invalid-argument', '제목, 본문, 설교자, 날짜를 확인해 주세요.');
  const md = toMarkdown(parsed.data, communities);
  const date = parsed.data.date;

  // 에뮬레이터 시험: GitHub 대신 내 컴퓨터 폴더에 써요
  if (EMULATOR && GH_TOKEN.value() === 'mock') {
    const dir = process.env.LOCAL_CONTENT_DIR ?? '/tmp/gbs-test';
    mkdirSync(dir, { recursive: true });
    let name = date; for (let n = 2; existsSync(`${dir}/${name}.md`); n++) name = `${date}-${n}`;
    writeFileSync(`${dir}/${name}.md`, md);
    return { slug: name };
  }

  for (let n = 1; n <= 20; n++) {
    const name = n === 1 ? date : `${date}-${n}`;
    const res = await gh(`${DIR}/${name}.md`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `나눔지 올림: ${parsed.data.title} (${email})`,
        content: Buffer.from(md, 'utf8').toString('base64'),
        branch: BRANCH,
      }),
    });
    if (res.status === 201) return { slug: name };
    // 같은 날짜 파일이 이미 있으면 (sha 없이 PUT → 422) 다음 이름으로
    if (res.status === 422) continue;
    console.error('submitGbs github', res.status);
    throw new HttpsError('unavailable', '사이트에 올리지 못했어요. 잠시 뒤에 다시 해 주세요.');
  }
  throw new HttpsError('already-exists', '같은 날짜의 나눔지가 너무 많아요.');
});
