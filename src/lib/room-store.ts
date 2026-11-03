// 나눔방 데이터 저장소
// 지금은 '시안용'으로 이 휴대폰(브라우저) 안에만 저장해요.
// 나중에 Firebase를 연결하면 이 파일의 FirebaseStore 로 바꿔 끼우면 돼요.

export interface RoomMessage {
  id: string;
  name: string;
  text: string;
  q: string;          // 어떤 질문에 대한 글인지
  prayer: boolean;    // 기도제목인지
  at: number;
}
export interface RoomState {
  current: string;            // 지금 강조된 질문 id
  members: string[];
  messages: RoomMessage[];
  closed: boolean;
  openedAt: number;
}
export interface RoomStore {
  get(): RoomState;
  subscribe(cb: (s: RoomState) => void): () => void;
  join(name: string): void;
  send(m: Omit<RoomMessage, 'id' | 'at'>): void;
  setCurrent(q: string): void;
  remove(id: string): void;
  close(): void;
}

const empty = (first: string): RoomState => ({ current: first, members: [], messages: [], closed: false, openedAt: Date.now() });

/** 오늘 자정이 지나면 지워지도록 */
const expired = (s: RoomState) => new Date(s.openedAt).toDateString() !== new Date().toDateString();

export class LocalStore implements RoomStore {
  private key: string;
  private ch: BroadcastChannel | null;
  private subs = new Set<(s: RoomState) => void>();
  constructor(roomKey: string, private firstQuestion: string) {
    this.key = `gbsroom:${roomKey}`;
    this.ch = 'BroadcastChannel' in window ? new BroadcastChannel(this.key) : null;
    this.ch?.addEventListener('message', () => this.emit());
    window.addEventListener('storage', (e) => { if (e.key === this.key) this.emit(); });
  }
  get(): RoomState {
    try {
      const s = JSON.parse(localStorage.getItem(this.key) || 'null') as RoomState | null;
      if (s && !expired(s)) return s;
    } catch { /* 저장소를 쓸 수 없는 환경 */ }
    return empty(this.firstQuestion);
  }
  private save(s: RoomState) {
    try { localStorage.setItem(this.key, JSON.stringify(s)); } catch { /* 무시 */ }
    this.ch?.postMessage('changed');
    this.emit(s);
  }
  private emit(s = this.get()) { this.subs.forEach((cb) => cb(s)); }
  subscribe(cb: (s: RoomState) => void) { this.subs.add(cb); cb(this.get()); return () => this.subs.delete(cb); }
  join(name: string) { const s = this.get(); if (!s.members.includes(name)) s.members.push(name); this.save(s); }
  send(m: Omit<RoomMessage, 'id' | 'at'>) {
    const s = this.get();
    s.messages.push({ ...m, id: Math.random().toString(36).slice(2), at: Date.now() });
    this.save(s);
  }
  setCurrent(q: string) { const s = this.get(); s.current = q; this.save(s); }
  remove(id: string) { const s = this.get(); s.messages = s.messages.filter((m) => m.id !== id); this.save(s); }
  close() { const s = this.get(); s.closed = true; this.save(s); }
  seed(s: RoomState) { this.save(s); }
}
