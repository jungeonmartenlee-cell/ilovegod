// 설교 원고 → 나눔지 (스밈 서버를 불러요)
//  - SUMIM_URL 이 있으면 Cloudflare 서버(worker/)를, 없으면 Firebase 함수(functions/)를 써요.
//  - 시험할 때는 주소에 ?sumim=http://127.0.0.1:8787 처럼 서버 주소를 붙일 수 있어요.
import { getFunctions, httpsCallable, connectFunctionsEmulator, FunctionsError } from 'firebase/functions';
import { app, auth } from './firebase';
import { SUMIM_URL } from '../config';

const params = new URLSearchParams(location.search);
const BASE = (params.get('sumim') ?? SUMIM_URL).replace(/\/$/, '');
const fns = getFunctions(app, 'asia-northeast3');
if (params.has('emulator')) connectFunctionsEmulator(fns, '127.0.0.1', 5001);

export type MadeGbs = {
  title: string; passage: string; preacher: string; service: string; date: string; key: string;
  summary: string[]; verses: { ref: string; text: string }[]; word: { original: string; word: string; meaning: string } | null;
  flow: { title: string; note: string }[];
  share: { minutes: number; questions: { tag: string; text: string }[]; practice: string };
  devotions: { ref: string; title: string; body: string; question: string }[];
  prayers: string[]; songs: string[];
};

/** 사람이 읽을 수 있는 안내가 담긴 오류 */
class SumimError extends Error {}

/** 서버가 보낸 안내 문구 (없으면 기본 문구) */
export const aiError = (e: unknown, fallback: string) => {
  if (e instanceof SumimError) return e.message;
  if (e instanceof FunctionsError) {
    const code = String(e.code).replace('functions/', '');
    if (code !== 'internal' && e.message && !/^[a-z-]+$/.test(e.message)) return e.message;
    return `${fallback} (${code})`;
  }
  return fallback;
};

async function post(path: string, body: object): Promise<Response> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new SumimError('교역자 계정으로 로그인해 주세요.');
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch { throw new SumimError('스밈과 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'); }
  if (!res.ok) {
    const msg = await res.json().then((j) => j.error).catch(() => null);
    throw new SumimError(msg || '스밈이 지금 응답하지 않아요. 잠시 뒤에 다시 해 주세요.');
  }
  return res;
}

/** 스밈이 쓰는 과정을 받아 모아요. onProgress 에는 지금까지 쓴 글자 수가 와요. */
async function readStream(res: Response, onProgress?: (chars: number) => void): Promise<MadeGbs> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '', out = '', stop = '';
  const handle = (data: string) => {
    let ev: any; try { ev = JSON.parse(data); } catch { return; }
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { out += ev.delta.text; onProgress?.(out.length); }
    else if (ev.type === 'message_delta' && ev.delta?.stop_reason) stop = ev.delta.stop_reason;
    else if (ev.type === 'error') throw new SumimError('스밈이 잠시 바빠요. 조금 뒤에 다시 해 주세요.');
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += value;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data) handle(data);
    }
    if (done) break;
  }
  if (stop === 'refusal') throw new SumimError('이 원고로는 나눔지를 만들지 못했어요.');
  if (stop === 'max_tokens') throw new SumimError('원고가 너무 길어 다 쓰지 못했어요. 원고를 조금 줄여서 다시 해 주세요.');
  let gbs: MadeGbs;
  try { gbs = JSON.parse(out); } catch { throw new SumimError('나눔지를 다 받지 못했어요. 다시 해 주세요.'); }
  if (!gbs || typeof gbs.title !== 'string' || !Array.isArray(gbs.summary) || !gbs.share?.questions?.length)
    throw new SumimError('나눔지 형식이 맞지 않아요. 다시 해 주세요.');
  return gbs;
}

/** 나눔지를 만들어요. id 는 서버에 잠시 보관된 초안 번호예요 (Firebase 서버일 때만). */
export async function makeGbs(text: string, communities: string[], note: string, onProgress?: (chars: number) => void, pdf?: string): Promise<{ gbs: MadeGbs; id?: string }> {
  if (BASE) {
    if (pdf) throw new SumimError('이 서버에서는 PDF를 그대로 보낼 수 없어요. 내용을 복사해 붙여 넣어 주세요.');
    return { gbs: await readStream(await post('/make', { text, communities, note }), onProgress) };
  }
  const call = httpsCallable<object, { gbs: MadeGbs; id: string }>(fns, 'makeGbs', { timeout: 540_000 });
  return (await call({ text: pdf ? '' : text, communities, note, ...(pdf ? { pdf } : {}) })).data;
}

export async function submitGbs(gbs: MadeGbs, communities: string[], draftId?: string): Promise<string> {
  if (BASE) return (await (await post('/submit', { gbs, communities })).json()).slug;
  const call = httpsCallable<object, { slug: string }>(fns, 'uploadGbs', { timeout: 60_000 });
  return (await call({ gbs, communities, draftId })).data.slug;
}
