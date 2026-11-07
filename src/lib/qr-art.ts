// 이름이 들어간 QR — 가운데에 공동체 이름(또는 하트)을 넣어 QR만 봐도 어디인지 알 수 있게 해요.
// QR은 30%까지 가려져도 읽히는 단계(H)로 만들고, 가운데 이름 칸은 그보다 훨씬 작게 둬요.
import QRCode from 'qrcode';

const HEART = 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.2 0 3.7 1.2 5.3 3.1 1.6-1.9 3.1-3.1 5.3-3.1 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z';
const INK = '#111111';

type Box = { x: number; y: number; w: number; h: number };
/** label 이 없으면 가운데에 하트를 넣어요 */
function layout(url: string, label?: string) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const n = qr.modules.size;
  const odd = (v: number) => (Math.round(v) % 2 === n % 2 ? Math.round(v) : Math.round(v) + 1);
  // 가운데 칸: 글자 한 개(공동체 첫 글자) 또는 하트 — 정사각형
  const w = odd(n * 0.22);
  const h = w;
  const box: Box = { x: (n - w) / 2, y: (n - h) / 2, w, h };
  const cells: [number, number][] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!qr.modules.get(x, y)) continue;
    if (x >= box.x - 0.5 && x < box.x + box.w + 0.5 && y >= box.y - 0.5 && y < box.y + box.h + 0.5) continue;
    cells.push([x, y]);
  }
  return { n, cells, box };
}
/** 공동체 QR 가운데 글자 — 주소 이름의 첫 영문자 (예: hason → H, gil → G) */
export const qrInitial = (slug: string) => (slug.match(/[a-z0-9]/i)?.[0] ?? '').toUpperCase();
// 하트 그림의 실제 범위 (가운데 정렬용)
const HEART_CX = 12, HEART_CY = 12.75, HEART_W = 22.2;

/** 화면에 넣을 SVG */
export function qrSvg(url: string, label?: string): string {
  const { n, cells, box } = layout(url, label);
  const d = cells.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join('');
  let mid = '';
  if (label) {
    const fs = box.h * 0.8;
    mid = `<text x="${n / 2}" y="${n / 2}" dy="0.355em" text-anchor="middle" font-size="${fs}" font-weight="800" fill="${INK}" font-family="Pretendard Variable, Pretendard, -apple-system, sans-serif">${label.replace(/[&<>]/g, '')}</text>`;
  } else {
    const s = (box.w * 0.84) / HEART_W;
    mid = `<path d="${HEART}" fill="${INK}" transform="translate(${n / 2 - HEART_CX * s} ${n / 2 - HEART_CY * s}) scale(${s})"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="${INK}"/>${mid}</svg>`;
}

/** 주보·PPT용 이미지(PNG)를 저장해요 — 위에 큰 이름, 가운데 QR, 아래 안내 */
export async function saveQrPoster(url: string, title: string, label?: string) {
  const { n, cells, box } = layout(url, label);
  const W = 1600, Q = 1100, top = 300, H = top + Q + 330;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  await document.fonts?.ready;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  // 이름
  g.fillStyle = INK; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  let fs = 132; g.font = `800 ${fs}px ${font}`;
  while (g.measureText(title).width > W - 160 && fs > 60) { fs -= 6; g.font = `800 ${fs}px ${font}`; }
  g.fillText(title, W / 2, 205);
  // QR
  const ox = (W - Q) / 2, oy = top, m = Q / n;
  g.fillStyle = INK;
  for (const [x, y] of cells) g.fillRect(Math.floor(ox + x * m), Math.floor(oy + y * m), Math.ceil(m), Math.ceil(m));
  const bx = ox + box.x * m, by = oy + box.y * m, bw = box.w * m, bh = box.h * m;
  if (label) {
    // 글자의 실제 크기를 재서 정확히 가운데에 놓아요
    g.font = `800 ${bh * 0.8}px ${font}`; g.fillStyle = INK; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    const mt = g.measureText(label);
    const asc = mt.actualBoundingBoxAscent, desc = mt.actualBoundingBoxDescent;
    const left = mt.actualBoundingBoxLeft, right = mt.actualBoundingBoxRight;
    g.fillText(label, bx + bw / 2 - (right - left) / 2 + left, by + bh / 2 + (asc - desc) / 2);
    g.textAlign = 'center';
  } else {
    const s = (bw * 0.84) / HEART_W;
    g.save(); g.translate(bx + bw / 2 - HEART_CX * s, by + bh / 2 - HEART_CY * s); g.scale(s, s);
    g.fillStyle = INK; g.fill(new Path2D(HEART)); g.restore();
  }
  // 안내
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#6e6e73'; g.font = `600 58px ${font}`; g.fillText('휴대폰 카메라로 QR을 비춰 주세요', W / 2, top + Q + 140);
  g.fillStyle = '#9a9aa0'; g.font = `500 44px ${font}`; g.fillText(url.replace(/^https?:\/\//, '').replace(/\/$/, ''), W / 2, top + Q + 225);
  const a = document.createElement('a');
  a.download = `${title.replace(/[\\/:*?"<>|\s]+/g, '')}-QR.png`;
  a.href = c.toDataURL('image/png');
  document.body.append(a); a.click(); a.remove();
}
