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
import { outputFormat, Submit, buildSystem, userMessage, toMarkdown, commitGbs } from './core.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

initializeApp();
const db = getFirestore();
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const GH_TOKEN = defineSecret('GH_TOKEN');

const DAILY_LIMIT = 10;              // 교역자 한 사람이 하루에 만들 수 있는 횟수
const EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const OPTS = { region: 'asia-northeast3', cors: true };
const EXAMPLE = readFileSync(new URL('./example.yaml', import.meta.url), 'utf8');

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

const SYSTEM = buildSystem(EXAMPLE);

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
  const user = userMessage(text, note);
  try {
    const stream = client.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 32000,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
      output_config: { format: outputFormat() },
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

  try {
    return { slug: await commitGbs(GH_TOKEN.value(), md, { date, title: parsed.data.title, email }) };
  } catch (e) {
    console.error('submitGbs github', String(e?.message));
    throw new HttpsError('unavailable', '사이트에 올리지 못했어요. 잠시 뒤에 다시 해 주세요.');
  }
});
