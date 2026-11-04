// 나눔방 — Firebase(Firestore) 실시간 저장소
import {
  doc, collection, writeBatch, onSnapshot, setDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, Timestamp, serverTimestamp, getDoc,
} from 'firebase/firestore';
import { db, ensureUser } from './firebase';
import type { RoomState, RoomStore, RoomMessage } from './room-store';

/** 한국 시간 기준 오늘 자정 — 이 시각이 지나면 방과 글을 볼 수 없고, 자동 삭제 대상이 돼요 */
export function nextMidnightKST(now = Date.now()): Timestamp {
  const KST = 9 * 3600_000;
  const day = Math.floor((now + KST) / 86_400_000) + 1;
  return Timestamp.fromMillis(day * 86_400_000 - KST);
}

export class RoomError extends Error {}

/** 리더가 방 열기 — 비밀번호가 틀리면 Firestore 규칙이 거절해요 */
export async function openRoom(opts: { gbsKey: string; group: string; pin: string; first: string }): Promise<string> {
  const user = await ensureUser();
  const code = Math.random().toString(36).slice(2, 6).toUpperCase();
  const roomId = `${opts.group}-${code}`;
  const expireAt = nextMidnightKST();
  const b = writeBatch(db);
  b.set(doc(db, 'rooms', roomId), {
    gbsKey: opts.gbsKey, group: opts.group, leaderUid: user.uid,
    current: opts.first, closed: false, createdAt: serverTimestamp(), expireAt,
  });
  b.set(doc(db, 'rooms', roomId, 'private', 'leader'), { uid: user.uid, pin: opts.pin, expireAt });
  b.set(doc(db, 'rooms', roomId, 'members', user.uid), { name: `${opts.group} 리더`, expireAt });
  try {
    await b.commit();
  } catch (e: any) {
    if (e?.code === 'permission-denied') throw new RoomError('리더 비밀번호가 맞지 않아요.');
    throw new RoomError('방을 열지 못했어요. 인터넷 연결을 확인해 주세요.');
  }
  return roomId;
}

/** 방이 있는지 확인 (없거나 자정이 지났으면 false) */
export async function roomExists(roomId: string): Promise<boolean> {
  await ensureUser();
  try { return (await getDoc(doc(db, 'rooms', roomId))).exists(); } catch { return false; }
}

export class FirebaseStore implements RoomStore {
  uid = '';
  private state: RoomState;
  private expireAt: Timestamp | null = null;
  private subs = new Set<(s: RoomState) => void>();
  private unsubs: (() => void)[] = [];
  private uidToName = new Map<string, string>();
  leaderUid = '';

  constructor(private roomId: string, first: string, private onError: (msg: string) => void = () => {}) {
    this.state = { current: first, members: [], messages: [], closed: false, openedAt: Date.now() };
  }

  async start() {
    this.uid = (await ensureUser()).uid;
    const roomRef = doc(db, 'rooms', this.roomId);
    const fail = () => this.onError('연결이 끊겼어요. 잠시 후 다시 시도해 주세요.');
    this.unsubs.push(onSnapshot(roomRef, (s) => {
      if (!s.exists()) return;
      const d = s.data();
      this.leaderUid = d.leaderUid; this.expireAt = d.expireAt;
      this.state = { ...this.state, current: d.current, closed: d.closed };
      this.emit();
    }, fail));
    this.unsubs.push(onSnapshot(collection(roomRef, 'members'), (s) => {
      this.uidToName = new Map(s.docs.map((m) => [m.id, m.data().name as string]));
      this.state = { ...this.state, members: [...this.uidToName.values()] };
      this.emit();
    }, fail));
    this.unsubs.push(onSnapshot(query(collection(roomRef, 'messages'), orderBy('at')), (s) => {
      this.state = {
        ...this.state,
        messages: s.docs.map((m) => {
          const d = m.data();
          return { id: m.id, uid: d.uid, name: d.name, text: d.text, q: d.q, prayer: d.prayer, at: d.at?.toMillis?.() ?? Date.now() } as RoomMessage;
        }),
      };
      this.emit();
    }, fail));
    const first = await getDoc(roomRef).catch(() => null);
    if (!first?.exists()) { this.stop(); throw new RoomError('방을 찾을 수 없어요. 방 코드를 확인하거나 리더에게 QR을 다시 보여 달라고 해 주세요.'); }
    this.expireAt = first.data().expireAt;
    this.leaderUid = first.data().leaderUid;
  }

  get isLeader() { return !!this.uid && this.uid === this.leaderUid; }
  get() { return this.state; }
  private emit() { this.subs.forEach((cb) => cb(this.state)); }
  subscribe(cb: (s: RoomState) => void) { this.subs.add(cb); cb(this.state); return () => this.subs.delete(cb); }
  stop() { this.unsubs.forEach((u) => u()); }

  private run(p: Promise<unknown>) { p.catch(() => this.onError('보내지 못했어요. 다시 시도해 주세요.')); }
  join(name: string) {
    this.run(setDoc(doc(db, 'rooms', this.roomId, 'members', this.uid), { name, expireAt: this.expireAt }));
  }
  send(m: Omit<RoomMessage, 'id' | 'at'>) {
    this.run(addDoc(collection(db, 'rooms', this.roomId, 'messages'), {
      uid: this.uid, name: m.name, text: m.text, q: m.q, prayer: m.prayer, at: serverTimestamp(), expireAt: this.expireAt,
    }));
  }
  setCurrent(q: string) { this.run(updateDoc(doc(db, 'rooms', this.roomId), { current: q })); }
  remove(id: string) { this.run(deleteDoc(doc(db, 'rooms', this.roomId, 'messages', id))); }
  close() { this.run(updateDoc(doc(db, 'rooms', this.roomId), { closed: true })); }
}
