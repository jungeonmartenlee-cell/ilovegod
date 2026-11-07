// 교역자가 올린 설교 원고로 AI '스밈'이 GBS 나눔지를 만들어 주는 서버 함수
//
//  makeGbs   : 원고 → 나눔지 내용(JSON). 원고는 어디에도 저장하지 않고, 기록(로그)에도 남기지 않아요.
//  uploadGbs : 교역자가 확인한 나눔지를 GitHub에 올려요 → 사이트가 자동으로 다시 만들어지고 검수 목록에 나타나요.
//
//  필요한 비밀값 (Google Cloud → 보안 비밀 관리자에 등록)
//    ANTHROPIC_API_KEY : 스밈이 쓰는 AI(Anthropic) API 키
//    GH_TOKEN          : 이 저장소에만 파일을 쓸 수 있는 GitHub 토큰
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import Anthropic from '@anthropic-ai/sdk';
import { outputFormat, Submit, buildSystem, userContent, toMarkdown, commitGbs, readRepoFile, writeRepoFile, deleteRepoFile, readFront, GBS_DIR, romanize, RESERVED, SLUG_RE } from './core.js';
import { z } from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

initializeApp();
const db = getFirestore();
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const GH_TOKEN = defineSecret('GH_TOKEN');

const DAILY_LIMIT = 3;               // 교역자 한 사람이 하루에 만들 수 있는 횟수
const EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
// invoker: 'public' — 사이트에서 부를 수 있게 열어 둬요 (실제 사용 권한은 함수 안에서 교역자인지 확인해요)
const OPTS = { region: 'asia-northeast3', cors: true, invoker: 'public' };
const EXAMPLE = readFileSync(new URL('./example.yaml', import.meta.url), 'utf8');

// ── 공통: 로그인한 교역자인지, 맡은 공동체인지 확인
// allowNone: 아직 공동체가 없는 교역자도 나눔지 초안은 먼저 만들 수 있어요 (배포할 때 공동체가 필요해요)
async function checkStaff(req, communities, allowNone = false) {
  const t = req.auth?.token;
  if (!t?.email || !t.email_verified) throw new HttpsError('unauthenticated', '교역자 계정으로 로그인해 주세요.');
  const snap = await db.doc(`staff/${t.email}`).get();
  if (!snap.exists) throw new HttpsError('permission-denied', '교역자로 등록된 계정이 아니에요.');
  const staff = snap.data();
  if (!Array.isArray(communities) || communities.some((c) => typeof c !== 'string')) throw new HttpsError('invalid-argument', '공동체를 골라 주세요.');
  if (!communities.length && !allowNone) throw new HttpsError('invalid-argument', '배포할 공동체를 골라 주세요.');
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
  const { text, communities, note, pdf } = req.data ?? {};
  const email = await checkStaff(req, communities, true);
  // 원고는 글자(text) 또는 PDF 파일(pdf, base64) 중 하나로 받아요
  const usePdf = typeof pdf === 'string' && pdf.length > 0;
  if (usePdf) {
    if (pdf.length > 11_000_000 || !pdf.startsWith('JVBER')) throw new HttpsError('invalid-argument', 'PDF 파일이 너무 크거나 PDF가 아니에요. 8MB 이하의 PDF를 올려 주세요.');
  } else if (typeof text !== 'string' || text.trim().length < 200 || text.length > 60000)
    throw new HttpsError('invalid-argument', '원고는 200자에서 60,000자 사이로 넣어 주세요.');
  if (note != null && (typeof note !== 'string' || note.length > 1000)) throw new HttpsError('invalid-argument', '바라는 점은 1,000자까지 적어 주세요.');
  await countUse(email);

  // 만든 나눔지 초안은 drafts 에 잠시 보관해요 (원고는 보관하지 않아요).
  // 그래서 교역자가 기다리지 않고 화면을 떠나도, 나중에 첫 화면에서 이어서 확인할 수 있어요.
  await cleanOldDrafts(email);
  const draft = db.collection('drafts').doc();
  await draft.set({ by: email, communities, status: 'making', at: FieldValue.serverTimestamp() });
  const fail = async (msg) => { await draft.update({ status: 'failed', error: msg }).catch(() => {}); return msg; };

  const key = ANTHROPIC_API_KEY.value();
  if (EMULATOR && key === 'mock') {
    await new Promise((r) => setTimeout(r, Number(process.env.MOCK_DELAY_MS ?? 4000)));
    const gbs = await mockGbs();
    await draft.update({ status: 'ready', gbs });
    return { id: draft.id, gbs };
  }

  const client = new Anthropic({ apiKey: key });
  const user = userContent(text, note, usePdf ? pdf : null);
  try {
    const stream = client.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 32000,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
      output_config: { format: outputFormat() },
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new HttpsError('failed-precondition', await fail('이 원고로는 나눔지를 만들지 못했어요.'));
    if (!msg.parsed_output) throw new HttpsError('internal', await fail('나눔지를 만들지 못했어요. 원고를 다시 올려 주세요.'));
    // 비용 확인용으로 토큰 수만 남겨요 (원고 내용은 남기지 않아요)
    console.log('makeGbs usage', JSON.stringify(msg.usage));
    await draft.update({ status: 'ready', gbs: msg.parsed_output });
    return { id: draft.id, gbs: msg.parsed_output };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error('makeGbs error', e instanceof Anthropic.APIError ? `${e.status} ${e.name}` : String(e?.name));
    throw new HttpsError('unavailable', await fail('스밈이 지금 응답하지 않아요. 원고를 다시 올려 주세요.'));
  }
});

// 30일 지난 내 초안은 지워요
async function cleanOldDrafts(email) {
  const old = await db.collection('drafts').where('by', '==', email).get();
  const week = Date.now() - 30 * 86400_000;   // 30일 지난 초안
  await Promise.all(old.docs.filter((d) => (d.get('at')?.toMillis?.() ?? 0) < week).map((d) => d.ref.delete()));
}

// ── 확인한 나눔지를 사이트에 올리기
export const uploadGbs = onCall({ ...OPTS, secrets: [GH_TOKEN], timeoutSeconds: 60 }, async (req) => {
  try {
    return await submit(req);
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    // 예상하지 못한 오류 — 원인을 화면과 기록에 남겨요 (원고나 나눔지 내용은 남기지 않아요)
    const why = `${e?.name ?? 'Error'}: ${String(e?.message ?? '').slice(0, 120)}`;
    console.error('uploadGbs unexpected', why, e?.stack?.split('\n').slice(0, 4).join(' | '));
    throw new HttpsError('unknown', `올리지 못했어요 (${why})`);
  }
});

async function submit(req) {
  const { gbs, communities, draftId } = req.data ?? {};
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
    await removeDraft(draftId, email);
    return { slug: name };
  }

  try {
    const slug = await commitGbs(GH_TOKEN.value(), md, { date, title: parsed.data.title, email });
    await removeDraft(draftId, email);
    return { slug };
  } catch (e) {
    console.error('uploadGbs github', String(e?.message));
    throw new HttpsError('unavailable', `사이트에 올리지 못했어요 (${String(e?.message ?? '').slice(0, 60)}). 잠시 뒤에 다시 해 주세요.`);
  }
}

// 사이트에 올린 초안은 지워요 (본인 것만)
async function removeDraft(id, email) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(id)) return;
  const ref = db.doc(`drafts/${id}`);
  const snap = await ref.get();
  if (snap.exists && snap.get('by') === email) await ref.delete();
}

// ── 공동체 만들기 — 교역자는 이름만 적고, 주소(영어 이름)는 스밈이 정해요
const COMM_DIR = 'src/communities';
const cleanName = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

async function suggestSlug(name) {
  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    const msg = await client.messages.parse({
      model: 'claude-haiku-5-5',
      max_tokens: 1000,
      messages: [{ role: 'user', content: `교회 청년 공동체 이름: "${name}"\n이 공동체의 웹 주소에 쓸 짧은 영어 이름을 하나 정해 주세요. 소문자 영어·숫자·하이픈만, 3~12자. 이름의 소리나 뜻이 잘 드러나고 외우기 쉽게 (예: 하손내빚 → hason, 샬롬 → shalom, GIL → gil).` }],
      output_config: { format: zodOutputFormat(z.object({ slug: z.string() })) },
    });
    const s = String(msg.parsed_output?.slug ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (SLUG_RE.test(s)) return s;
  } catch (e) { console.error('suggestSlug', String(e?.name)); }
  return null;
}

export const createCommunity = onCall({ ...OPTS, secrets: [ANTHROPIC_API_KEY, GH_TOKEN], timeoutSeconds: 60 }, async (req) => {
  const email = await checkStaff(req, [], true);
  const name = cleanName(req.data?.name);
  if (name.length < 1 || name.length > 20) throw new HttpsError('invalid-argument', '공동체 이름은 1~20자로 적어 주세요.');
  const ref = db.doc(`staff/${email}`);
  const mine = (await ref.get()).get('communities') ?? [];
  if (mine.length >= 10) throw new HttpsError('resource-exhausted', '공동체는 한 사람이 10개까지 만들 수 있어요.');

  // 주소 정하기 → 겹치면 -2, -3 …
  let base = (EMULATOR && GH_TOKEN.value() === 'mock') ? romanize(name) : (await suggestSlug(name)) ?? romanize(name);
  if (!SLUG_RE.test(base)) base = `c${Date.now().toString(36).slice(-6)}`;
  const token = GH_TOKEN.value();
  const mock = EMULATOR && token === 'mock';
  let slug = '';
  for (let n = 1; n <= 20 && !slug; n++) {
    const s = n === 1 ? base : `${base.slice(0, 17)}-${n}`;
    if (RESERVED.has(s)) continue;
    if (mock) { slug = s; break; }
    const [ts, js] = await Promise.all([readRepoFile(token, `${COMM_DIR}/${s}.ts`), readRepoFile(token, `${COMM_DIR}/${s}.json`)]);
    if (!ts && !js) slug = s;
  }
  if (!slug) throw new HttpsError('already-exists', '주소를 정하지 못했어요. 다른 이름으로 해 주세요.');

  const file = JSON.stringify({ names: [name], order: 50 }, null, 2) + '\n';
  try {
    if (mock) {
      const dir = process.env.LOCAL_COMMUNITY_DIR ?? '/tmp/community-test';
      mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/${slug}.json`, file);
    } else {
      await writeRepoFile(token, `${COMM_DIR}/${slug}.json`, file, `공동체 만들기: ${name} (/${slug})`);
    }
  } catch (e) {
    console.error('createCommunity github', String(e?.message));
    throw new HttpsError('unavailable', '공동체를 만들지 못했어요. 잠시 뒤에 다시 해 주세요.');
  }
  await ref.update({ communities: FieldValue.arrayUnion(slug) });
  return { slug, name };
});

// ── 공동체 소개 고치기 — 맡은 공동체만 (운영자는 모두)
const Worship = z.object({ label: z.string().max(20), time: z.string().max(40), place: z.string().max(60) });
const CommunityEdit = z.object({
  name: z.string().trim().min(1).max(20),
  parents: z.string().trim().max(60).default(''),
  tagline: z.string().trim().max(60),
  intro: z.string().trim().max(400),
  worship: z.array(Worship).max(6),
});
export const saveCommunity = onCall({ ...OPTS, secrets: [GH_TOKEN], timeoutSeconds: 60 }, async (req) => {
  const slug = req.data?.slug;
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) throw new HttpsError('invalid-argument', '공동체를 확인해 주세요.');
  const email = await checkStaff(req, [slug]);
  const p = CommunityEdit.safeParse(req.data?.edit);
  if (!p.success) throw new HttpsError('invalid-argument', '글자 수를 확인해 주세요.');
  const e = p.data;
  const edit = { name: e.name, parents: e.parents, tagline: e.tagline, intro: e.intro, worship: e.worship.filter((w) => w.label || w.time || w.place) };
  const text = JSON.stringify(edit, null, 2) + '\n';
  const token = GH_TOKEN.value();
  try {
    if (EMULATOR && token === 'mock') {
      const dir = (process.env.LOCAL_COMMUNITY_DIR ?? '/tmp/community-test') + '/edits';
      mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/${slug}.json`, text);
      return { ok: true };
    }
    const path = `${COMM_DIR}/edits/${slug}.json`;
    const old = await readRepoFile(token, path);
    await writeRepoFile(token, path, text, `공동체 소개 고침: ${e.name} (/${slug})`, old?.sha);
  } catch (err) {
    console.error('saveCommunity github', String(err?.message));
    throw new HttpsError('unavailable', '저장하지 못했어요. 잠시 뒤에 다시 해 주세요.');
  }
  return { ok: true };
});

// ── 올린 나눔지 고치기 · 지우기 — 그 나눔지를 받는 공동체의 교역자만 (운영자는 모두)
async function ownGbs(req, slug) {
  if (typeof slug !== 'string' || !/^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(slug)) throw new HttpsError('invalid-argument', '나눔지를 확인해 주세요.');
  const token = GH_TOKEN.value();
  const mock = EMULATOR && token === 'mock';
  const path = mock ? `${process.env.LOCAL_CONTENT_DIR ?? '/tmp/gbs-test'}/${slug}.md` : `${GBS_DIR}/${slug}.md`;
  const file = mock ? (existsSync(path) ? { sha: 'mock', text: readFileSync(path, 'utf8') } : null) : await readRepoFile(token, path);
  if (!file) throw new HttpsError('not-found', '이미 지워졌거나 없는 나눔지예요.');
  const communities = readFront(file.text).communities ?? [];
  const t = req.auth?.token;
  if (!t?.email || !t.email_verified) throw new HttpsError('unauthenticated', '교역자 계정으로 로그인해 주세요.');
  const staff = (await db.doc(`staff/${t.email}`).get()).data();
  if (!staff) throw new HttpsError('permission-denied', '교역자로 등록된 계정이 아니에요.');
  if (!staff.admin && !communities.some((c) => (staff.communities ?? []).includes(c)))
    throw new HttpsError('permission-denied', '맡은 공동체의 나눔지만 고칠 수 있어요.');
  return { token, path, file, communities, mock };
}

export const updateGbs = onCall({ ...OPTS, secrets: [GH_TOKEN], timeoutSeconds: 60 }, async (req) => {
  const { slug, gbs } = req.data ?? {};
  const parsed = Submit.safeParse(gbs);
  if (!parsed.success) throw new HttpsError('invalid-argument', '제목, 본문, 설교자, 날짜를 확인해 주세요.');
  const { token, path, file, communities, mock } = await ownGbs(req, slug);
  if (mock) { writeFileSync(path, toMarkdown(parsed.data, communities)); return { ok: true }; }
  try {
    await writeRepoFile(token, path, toMarkdown(parsed.data, communities), `나눔지 고침: ${parsed.data.title}`, file.sha);
  } catch (e) {
    console.error('updateGbs', String(e?.message));
    throw new HttpsError('unavailable', '저장하지 못했어요. 잠시 뒤에 다시 해 주세요.');
  }
  return { ok: true };
});

export const deleteGbs = onCall({ ...OPTS, secrets: [GH_TOKEN], timeoutSeconds: 60 }, async (req) => {
  const { slug } = req.data ?? {};
  const { token, path, file, mock } = await ownGbs(req, slug);
  try {
    if (mock) (await import('node:fs')).unlinkSync(path); else await deleteRepoFile(token, path, `나눔지 지움: ${slug}`, file.sha);
  } catch (e) {
    console.error('deleteGbs', String(e?.message));
    throw new HttpsError('unavailable', '지우지 못했어요. 잠시 뒤에 다시 해 주세요.');
  }
  // 배포 기록도 함께 지워요
  const id = `shared__${slug}`;
  const ap = await db.collection('approvals').where('gbs', '==', id).get();
  await Promise.all(ap.docs.map((d) => d.ref.delete()));
  return { ok: true };
});
