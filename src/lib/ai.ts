// 설교 원고 → 나눔지 (서버 함수 functions/index.js 를 불러요)
import { getFunctions, httpsCallable, connectFunctionsEmulator, FunctionsError } from 'firebase/functions';
import { app } from './firebase';

const fns = getFunctions(app, 'asia-northeast3');
if (new URLSearchParams(location.search).has('emulator')) connectFunctionsEmulator(fns, '127.0.0.1', 5001);

export type MadeGbs = {
  title: string; passage: string; preacher: string; service: string; date: string; key: string;
  summary: string[]; verses: { ref: string; text: string }[]; word: { original: string; word: string; meaning: string } | null;
  flow: { title: string; note: string }[];
  share: { minutes: number; questions: { tag: string; text: string }[]; practice: string };
  devotions: { ref: string; title: string; body: string; question: string }[];
  prayers: string[]; songs: string[];
};

/** 서버가 보낸 안내 문구 (없으면 기본 문구) */
export const aiError = (e: unknown, fallback: string) =>
  e instanceof FunctionsError && e.code !== 'internal' && e.message && !/^[a-z-]+$/.test(e.message) ? e.message : fallback;

export async function makeGbs(text: string, communities: string[], note: string): Promise<MadeGbs> {
  const call = httpsCallable<object, { gbs: MadeGbs }>(fns, 'makeGbs', { timeout: 540_000 });
  return (await call({ text, communities, note })).data.gbs;
}

export async function submitGbs(gbs: MadeGbs, communities: string[]): Promise<string> {
  const call = httpsCallable<object, { slug: string }>(fns, 'submitGbs', { timeout: 60_000 });
  return (await call({ gbs, communities })).data.slug;
}
