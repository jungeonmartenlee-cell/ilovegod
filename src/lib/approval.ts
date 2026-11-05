// 교역자 승인 기록 — Firestore 'approvals' 컬렉션
// 문서 하나 = 나눔지 하나를 공동체 하나에 배포한 기록
//   문서 ID: {나눔지ID}~{공동체}   내용: { gbs, community, title, by, at }

/** 승인된 나눔지 → 배포된 공동체 목록 */
export async function loadApprovals(): Promise<Record<string, string[]>> {
  const [{ collection, getDocs }, { db }] = await Promise.all([import('firebase/firestore'), import('./firebase')]);
  const snap = await getDocs(collection(db, 'approvals'));
  const out: Record<string, string[]> = {};
  snap.forEach((d) => {
    const { gbs, community } = d.data() as { gbs: string; community: string };
    (out[gbs] ??= []).push(community);
  });
  return out;
}

/** 페이지 안의 [data-gate] 요소를 승인 여부에 따라 보여 주기 */
export async function applyGates(root: ParentNode = document) {
  const gated = Array.from(root.querySelectorAll<HTMLElement>('[data-gate]'));
  let approvals: Record<string, string[]> = {};
  if (gated.length) { try { approvals = await loadApprovals(); } catch { /* 연결 실패 → 검수 중으로 취급 */ } }
  for (const el of gated) {
    el.classList.toggle('gate-open', (approvals[el.dataset.gate!] ?? []).includes(el.dataset.community!));
  }
  const groups = new Map<string, HTMLElement[]>();
  root.querySelectorAll<HTMLElement>('[data-first-of]').forEach((el) => {
    const k = el.dataset.firstOf!; groups.set(k, [...(groups.get(k) ?? []), el]);
  });
  for (const [k, list] of groups) {
    let shown = false;
    for (const el of list) {
      const visible = !el.hasAttribute('data-gate') || el.classList.contains('gate-open');
      el.classList.toggle('first-hidden', !visible || shown);
      if (visible) shown = true;
    }
    root.querySelectorAll<HTMLElement>(`[data-empty-of="${k}"]`).forEach((e) => (e.hidden = shown));
  }
  document.documentElement.classList.add('gates-ready');
  return approvals;
}
