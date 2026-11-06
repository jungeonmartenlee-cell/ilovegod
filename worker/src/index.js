// 스밈(AI) 서버 — Cloudflare Workers
//
//  POST /make   : 설교 원고 → 스밈이 나눔지를 쓰는 과정을 그대로 흘려보내요 (원고는 저장하지 않고 기록에도 남기지 않아요)
//  POST /submit : 교역자가 확인한 나눔지를 GitHub에 올려요 → 사이트가 다시 만들어지고 검수 목록에 나타나요
//
//  두 곳 모두 로그인한 교역자(Firestore staff 문서가 있는 구글 계정)만, 맡은 공동체로만 쓸 수 있어요.
//  비밀값: ANTHROPIC_API_KEY, GH_TOKEN (Cloudflare 화면에서 넣어요)
import Anthropic from '@anthropic-ai/sdk';
import { outputFormat, Submit, buildSystem, userMessage, toMarkdown, commitGbs, parseYaml } from '../../functions/core.js';
import EXAMPLE from '../../functions/example.yaml';

const PROJECT = 'ilovegod-intl';
const ORIGINS = ['https://ilovegod-intl.web.app', 'https://ilovegod-intl.firebaseapp.com'];
const SYSTEM = buildSystem(EXAMPLE);

class Oops extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') ?? '';
    const local = env.LOCAL_TEST === '1';
    const allowed = ORIGINS.includes(origin) || (local && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin));
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    try {
      if (!allowed) throw new Oops(403, '허용되지 않은 곳에서 온 요청이에요.');
      if (req.method !== 'POST') throw new Oops(405, 'POST만 받아요.');
      const path = new URL(req.url).pathname;
      const body = await req.json().catch(() => ({}));
      const user = await verifyUser(req, env);
      const email = await checkStaff(user, body.communities, env);

      if (path === '/make') {
        const { text, note } = body;
        if (typeof text !== 'string' || text.trim().length < 200 || text.length > 60000)
          throw new Oops(400, '원고는 200자에서 60,000자 사이로 넣어 주세요.');
        if (note != null && (typeof note !== 'string' || note.length > 1000)) throw new Oops(400, '바라는 점은 1,000자까지 적어 주세요.');
        if (local && env.ANTHROPIC_API_KEY === 'mock') return mockStream(cors);
        const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
        let res;
        try {
          // 스밈이 쓰는 과정을 그대로 흘려보내요 (서버는 내용을 읽거나 저장하지 않아요)
          res = await client.messages.create({
            model: 'claude-opus-5-5',
            max_tokens: 32000,
            system: SYSTEM,
            messages: [{ role: 'user', content: userMessage(text, note) }],
            output_config: { format: outputFormat() },
            stream: true,
          }).asResponse();
        } catch (e) {
          console.error('make', e instanceof Anthropic.APIError ? `${e.status} ${e.name}` : String(e?.name));
          throw new Oops(503, '스밈이 지금 응답하지 않아요. 잠시 뒤에 다시 해 주세요.');
        }
        return new Response(res.body, { headers: { ...cors, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' } });
      }

      if (path === '/submit') {
        const parsed = Submit.safeParse(body.gbs);
        if (!parsed.success) throw new Oops(400, '제목, 본문, 설교자, 날짜를 확인해 주세요.');
        const md = toMarkdown(parsed.data, body.communities);
        if (local && env.GH_TOKEN === 'mock') return json({ slug: parsed.data.date, markdown: md });
        try {
          return json({ slug: await commitGbs(env.GH_TOKEN, md, { date: parsed.data.date, title: parsed.data.title, email }) });
        } catch (e) {
          console.error('submit', String(e?.message));
          throw new Oops(503, '사이트에 올리지 못했어요. 잠시 뒤에 다시 해 주세요.');
        }
      }
      throw new Oops(404, '없는 주소예요.');
    } catch (e) {
      if (e instanceof Oops) return json({ error: e.message }, e.status);
      console.error('worker', String(e?.name));
      return json({ error: '처리하지 못했어요. 잠시 뒤에 다시 해 주세요.' }, 500);
    }
  },
};

// ── 로그인 확인: Firebase 로그인 표(ID 토큰)의 서명과 내용을 확인해요
let keyCache = { at: 0, keys: [] };
async function googleKeys() {
  if (Date.now() - keyCache.at < 3600_000 && keyCache.keys.length) return keyCache.keys;
  const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  keyCache = { at: Date.now(), keys: (await r.json()).keys ?? [] };
  return keyCache.keys;
}
const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const part = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

async function verifyUser(req, env) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const bits = token.split('.');
  if (bits.length !== 3) throw new Oops(401, '교역자 계정으로 로그인해 주세요.');
  const head = part(bits[0]);
  const p = part(bits[1]);
  const now = Date.now() / 1000;
  // 내 컴퓨터에서 시험할 때만: 흉내 로그인(서명 없는 표)을 받아요
  const emulated = env.LOCAL_TEST === '1' && head.alg === 'none';
  if (!emulated) {
    const jwk = (await googleKeys()).find((k) => k.kid === head.kid);
    if (head.alg !== 'RS256' || !jwk) throw new Oops(401, '로그인이 만료됐어요. 다시 로그인해 주세요.');
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(bits[2]), new TextEncoder().encode(`${bits[0]}.${bits[1]}`));
    if (!ok) throw new Oops(401, '로그인을 확인하지 못했어요. 다시 로그인해 주세요.');
  }
  if (p.aud !== PROJECT || p.iss !== `https://securetoken.google.com/${PROJECT}` || !(p.exp > now) || !(p.iat <= now + 300) || !p.sub)
    throw new Oops(401, '로그인이 만료됐어요. 다시 로그인해 주세요.');
  if (!p.email || p.email_verified !== true) throw new Oops(401, '교역자 계정으로 로그인해 주세요.');
  return { email: p.email, token };
}

// ── 교역자 확인: 본인의 로그인으로 Firestore 의 staff 문서를 읽어요 (본인 문서만 읽을 수 있는 규칙)
async function checkStaff(user, communities, env) {
  if (!Array.isArray(communities) || !communities.length || communities.some((c) => typeof c !== 'string' || !/^[a-z0-9-]{1,30}$/.test(c)))
    throw new Oops(400, '공동체를 골라 주세요.');
  const base = env.FIRESTORE_URL || 'https://firestore.googleapis.com';
  const r = await fetch(`${base}/v1/projects/${PROJECT}/databases/(default)/documents/staff/${encodeURIComponent(user.email)}`, {
    headers: { Authorization: `Bearer ${user.token}` },
  });
  if (r.status === 404 || r.status === 403) throw new Oops(403, '교역자로 등록된 계정이 아니에요.');
  if (!r.ok) throw new Oops(503, '교역자 정보를 확인하지 못했어요. 잠시 뒤에 다시 해 주세요.');
  const f = (await r.json()).fields ?? {};
  const mine = (f.communities?.arrayValue?.values ?? []).map((v) => v.stringValue);
  if (f.admin?.booleanValue !== true && !communities.every((c) => mine.includes(c)))
    throw new Oops(403, '맡은 공동체에만 만들 수 있어요.');
  return user.email;
}

// ── 내 컴퓨터 시험용: 실제 스밈 대신 예시 나눔지를 같은 방식으로 흘려보내요
async function mockStream(cors) {
  const e = parseYaml(EXAMPLE);
  const gbs = { ...e, date: '', service: '', devotions: e.devotions.map(({ day, ...d }) => d) };
  const text = JSON.stringify(gbs);
  const enc = new TextEncoder();
  const ev = (type, data) => enc.encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const stream = new ReadableStream({
    async start(c) {
      c.enqueue(ev('message_start', { message: { usage: {} } }));
      c.enqueue(ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }));
      for (let i = 0; i < text.length; i += 400) {
        c.enqueue(ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 400) } }));
        await new Promise((r) => setTimeout(r, 30));
      }
      c.enqueue(ev('content_block_stop', { index: 0 }));
      c.enqueue(ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: {} }));
      c.enqueue(ev('message_stop', {}));
      c.close();
    },
  });
  return new Response(stream, { headers: { ...cors, 'Content-Type': 'text/event-stream; charset=utf-8' } });
}
