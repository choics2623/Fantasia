// 지도 (19 §6 · 07): 양피지에 그린 대륙 에오르와 고장 지도.
// - 대륙: 손으로 그린 해안선과 물결, 산맥·숲·늪·초원·재의 땅, 가늘어지는 강, 길의 종류와 위험, 정착지 그림, 지역 이름, 나침반·제목·축척
// - 안개: 아는 곳 둘레만 걷힌다 (엔진의 knownNodes). 모르는 곳은 이름도 그림도 없다
// - 고장: 강, 흙길(최소 신장 트리), 밭과 나무, 갈래마다 다른 건물 그림, 아는 사람의 '아마 거기'(확신 점), 고장 밖으로 나가는 길
// - 내가 선 자리: 복셀 체스말 (piece.js) — 확대해도 화면에서 같은 크기
import { pawnMarker, PAWN_UNITS } from "./piece.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const f1 = (n) => (Math.round(n * 10) / 10).toString();
export function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const strHash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// ── 선 다듬기 ──
// 중점 변위로 거칠게 (손으로 그린 해안선)
function roughen(pts, seed, rough, iters, closed = true) {
  const r = rng(seed); let P = pts.map((p) => [p[0], p[1]]);
  for (let k = 0; k < iters; k++) {
    const out = [], n = closed ? P.length : P.length - 1;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, off = (r() - 0.5) * len * rough;
      out.push(a, [(a[0] + b[0]) / 2 - (dy / len) * off, (a[1] + b[1]) / 2 + (dx / len) * off]);
    }
    if (!closed) out.push(P[P.length - 1]);
    P = out; rough *= 0.6;
  }
  return P;
}
// Catmull-Rom → 베지어
function spline(P, closed = true) {
  const n = P.length; if (n < 2) return "";
  const at = (i) => (closed ? P[(i + n) % n] : P[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${f1(P[0][0])} ${f1(P[0][1])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d + (closed ? "Z" : "");
}
// 열린 곡선을 촘촘한 점으로 (강을 굵기별로 자르려고)
function sample(P, per = 8) {
  const at = (i) => P[Math.max(0, Math.min(P.length - 1, i))], out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  out.push(P[P.length - 1]);
  return out;
}
const scatter = (r, cx, cy, rad, flat = 0.8) => { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad; return [cx + Math.cos(a) * d, cy + Math.sin(a) * d * flat]; };

// ── 종이 결: 캔버스로 한 번 만든 타일 (필터보다 가볍다 — 끌고 확대해도 다시 그리지 않는다) ──
let PAPER = null;
function paperTile() {
  if (PAPER) return PAPER;
  if (typeof document === "undefined") return (PAPER = "");
  const S = 256, cv = document.createElement("canvas"); cv.width = cv.height = S;
  const c = cv.getContext("2d"), r = rng(77);
  const wrap = (fn) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { c.save(); c.translate(ox, oy); fn(); c.restore(); } };
  for (let i = 0; i < 14; i++) { const x = r() * S, y = r() * S, rad = 18 + r() * 50; wrap(() => { const gr = c.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(110,72,30,${0.035 + r() * 0.04})`); gr.addColorStop(1, "rgba(110,72,30,0)"); c.fillStyle = gr; c.fillRect(x - rad, y - rad, rad * 2, rad * 2); }); }
  for (let i = 0; i < 2600; i++) { const x = r() * S, y = r() * S, rad = 0.3 + r() * 0.9, a = 0.03 + r() * 0.1; wrap(() => { c.fillStyle = `rgba(80,52,22,${a})`; c.beginPath(); c.arc(x, y, rad, 0, 7); c.fill(); }); }
  for (let i = 0; i < 140; i++) { const x = r() * S, y = r() * S, l = 5 + r() * 16, ang = r() * Math.PI, bend = (r() - 0.5) * 6; wrap(() => { c.strokeStyle = `rgba(90,60,28,${0.05 + r() * 0.05})`; c.lineWidth = 0.4 + r() * 0.4; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(ang) * l / 2 + bend, y + Math.sin(ang) * l / 2 - bend, x + Math.cos(ang) * l, y + Math.sin(ang) * l); c.stroke(); }); }
  return (PAPER = cv.toDataURL("image/png"));
}
const paperDefs = (id) => `<pattern id="${id}" width="256" height="256" patternUnits="userSpaceOnUse"><image href="${paperTile()}" width="256" height="256"/></pattern>`;

// ── 대륙 그림 조각 ──
const TYPE_KO = { city: "도시", fort: "요새", wild: "황야", mine: "광산·농장", ruin: "폐허", temple: "성소", secret: "숨은 곳", village: "마을", port: "나루·항구", site: "유적", island: "섬" };
const ROAD_KO = { imperial: "제국 가도", road: "큰길", trail: "오솔길", secret: "숨은 길", sea: "뱃길", river: "물길" };
export { TYPE_KO, ROAD_KO };

// 산 하나: 빛 받는 왼쪽, 그늘진 오른쪽, 높으면 눈
function mountain(x, y, h, r, snow) {
  const w = h * (0.85 + r() * 0.3), px = x + (r() - 0.5) * h * 0.25, py = y - h;
  const L = `M${f1(x - w)} ${f1(y)} L${f1(px)} ${f1(py)} L${f1(px + w * 0.08)} ${f1(y)}Z`;
  const R = `M${f1(px)} ${f1(py)} L${f1(x + w)} ${f1(y)} L${f1(px + w * 0.08)} ${f1(y)}Z`;
  const hatch = Array.from({ length: 3 }, (_, i) => { const t = 0.35 + i * 0.18; return `M${f1(px + (x + w - px) * t)} ${f1(py + (y - py) * t)} l${f1(-w * 0.18)} ${f1(h * 0.2)}`; }).join("");
  const cap = snow ? `<path class="m-snow" d="M${f1(px - w * 0.22)} ${f1(py + h * 0.26)} L${f1(px)} ${f1(py)} L${f1(px + w * 0.24)} ${f1(py + h * 0.26)} l${f1(-w * 0.09)} ${f1(-h * 0.06)} l${f1(-w * 0.08)} ${f1(h * 0.07)} l${f1(-w * 0.08)} ${f1(-h * 0.07)}Z"/>` : "";
  return `<path class="m-mt-l" d="${L}"/><path class="m-mt-d" d="${R}"/><path class="m-mt-h" d="${hatch}"/>${cap}<path class="m-mt-o" d="M${f1(x - w)} ${f1(y)} L${f1(px)} ${f1(py)} L${f1(x + w)} ${f1(y)}"/>`;
}
function tree(x, y, s, r, dark) {
  if (dark || r() < 0.35) {   // 침엽수
    const h = 7 * s, w = 3.4 * s;
    return `<path class="${dark ? "m-tree-dk" : "m-tree"}" d="M${f1(x)} ${f1(y - h)} L${f1(x + w)} ${f1(y - h * 0.15)} L${f1(x - w)} ${f1(y - h * 0.15)}Z"/><path class="m-tree-sh" d="M${f1(x)} ${f1(y - h)} L${f1(x + w)} ${f1(y - h * 0.15)} L${f1(x)} ${f1(y - h * 0.15)}Z"/><path class="m-trunk" d="M${f1(x)} ${f1(y - h * 0.15)} v${f1(2 * s)}"/>`;
  }
  const rad = 3.3 * s;   // 활엽수
  return `<path class="m-trunk" d="M${f1(x)} ${f1(y)} v${f1(-3 * s)}"/><circle class="m-tree" cx="${f1(x)}" cy="${f1(y - 3 * s - rad * 0.7)}" r="${f1(rad)}"/><path class="m-tree-sh" d="M${f1(x)} ${f1(y - 3 * s - rad * 1.7)} a${f1(rad)} ${f1(rad)} 0 0 1 0 ${f1(rad * 2)}Z"/>`;
}
// 정착지 그림 (가운데 아래가 기준점)
function settlementGlyph(type, major) {
  const s = major ? 1.25 : 1;
  const g = {
    city: `<path class="m-ico-w" d="M-9 0v-8h18v8Z"/><path class="m-ico-w" d="M-8 -8v-6h4v6M-2 -8v-10h4v10M4 -8v-7h4v7"/><path class="m-ico-r" d="M-8.6 -14l2.6 -4 2.6 4ZM-2.6 -18l2.6 -5 2.6 5ZM3.4 -15l2.6 -4 2.6 4Z"/><path class="m-ico-d" d="M-1.5 0v-3.5a1.5 1.5 0 0 1 3 0V0Z"/>`,
    fort: `<path class="m-ico-w" d="M-6 0v-12h12v12Z"/><path class="m-ico-w" d="M-7 -12v-3h2v1.5h2V-15h2v1.5h2V-15h2v1.5h2V-15h2v3Z"/><path class="m-ico-d" d="M-1.6 0v-4a1.6 1.6 0 0 1 3.2 0V0Z"/><path class="m-ico-o" d="M0 -15v-7"/><path class="m-ico-f" d="M0 -22l6 2 -6 2Z"/>`,
    village: `<path class="m-ico-w" d="M-8 0v-5h7v5ZM1 0v-6h7v6Z"/><path class="m-ico-t" d="M-9 -5l4.5 -4 4.5 4ZM0 -6l4.5 -4.5 4.5 4.5Z"/>`,
    port: `<path class="m-ico-w" d="M-7 0v-6h8v6Z"/><path class="m-ico-r" d="M-8 -6l5 -4 5 4Z"/><path class="m-ico-o" d="M6 -9v8M3 -6h6M3 -2.5q3 3 6 0"/>`,
    temple: `<path class="m-ico-w" d="M-5 0v-9h10v9Z"/><path class="m-ico-r" d="M-6 -9l6 -5 6 5Z"/><path class="m-ico-o" d="M0 -14v-6M-2 -18h4"/><circle class="m-ico-g" cx="0" cy="-5" r="1.4"/>`,
    mine: `<path class="m-ico-w" d="M-8 0a8 8 0 0 1 16 0Z"/><path class="m-ico-d" d="M-3.5 0a3.5 3.5 0 0 1 7 0Z"/><path class="m-ico-o" d="M-9 -10l7 7M-11 -8.5q2 -3.5 4.5 -3.5"/>`,
    ruin: `<path class="m-ico-w" d="M-7 0v-9h3v9ZM-1.5 0v-5h3v5ZM4 0v-11l3 2v9Z"/><path class="m-ico-o" d="M-9 0h18M-8 -9.5h4.5"/>`,
    secret: `<path class="m-ico-s" d="M0 -12l2.2 4.6 5 .7-3.6 3.5.9 5L0 -.6l-4.5 2.4.9-5-3.6-3.5 5-.7Z"/>`,
    wild: `<path class="m-ico-w" d="M-8 0l8 -11 8 11Z"/><path class="m-ico-d" d="M-2 0l2 -5 2 5Z"/>`,
    site: `<path class="m-ico-w" d="M-8 0v-7h3v7ZM-1.5 0v-10h3v10ZM5 0v-6h3v6Z"/><path class="m-ico-o" d="M-9 -10.5h18"/>`,
    island: `<path class="m-ico-w" d="M-8 0q4 -9 8 -9t8 9Z"/>`,
  }[type] || `<circle class="m-ico-w" cx="0" cy="-4" r="4"/>`;
  return `<g transform="scale(${s})">${g}</g>`;
}
function compass(x, y, R) {
  const pt = (a, r) => [x + Math.cos(a) * r, y + Math.sin(a) * r];
  let s = `<g class="m-compass"><circle cx="${x}" cy="${y}" r="${R * 1.02}" class="m-cmp-ring"/><circle cx="${x}" cy="${y}" r="${R * 0.78}" class="m-cmp-ring2"/>`;
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 4, long = i % 2 === 0, r = long ? R : R * 0.55, w = long ? R * 0.16 : R * 0.12;
    const tip = pt(a, r), l = pt(a - Math.PI / 2, w), rr = pt(a + Math.PI / 2, w);
    s += `<path class="m-cmp-a" d="M${f1(x)} ${f1(y)} L${f1(l[0])} ${f1(l[1])} L${f1(tip[0])} ${f1(tip[1])}Z"/><path class="m-cmp-b" d="M${f1(x)} ${f1(y)} L${f1(rr[0])} ${f1(rr[1])} L${f1(tip[0])} ${f1(tip[1])}Z"/>`;
  }
  return s + `<circle cx="${x}" cy="${y}" r="${R * 0.09}" class="m-cmp-b"/><text x="${x}" y="${f1(y - R * 1.16)}" class="m-cmp-n" text-anchor="middle">북</text></g>`;
}

// ── 대륙 지도 ──
// W = mapView().world. 돌려주는 것: { svg, base } (base = 처음 viewBox)
export const WORLD_BASE = { x: -10, y: -14, w: 1060, h: 800 };
export function worldSVG(W, { mini = false, idp = "w" } = {}) {
  const T = W.terrain || {}, N = new Map(W.nodes.map((n) => [n.id, n]));
  const known = W.nodes.filter((n) => n.known);
  const coastP = roughen(T.continent || [], 11, 0.34, 4), coast = spline(coastP);
  const islands = (T.islands || []).map((isl, i) => spline(roughen(isl, 30 + i, 0.4, 3)));
  const ice = spline(roughen(T.ice || [], 5, 0.28, 3));
  const r = rng(3);
  const base = WORLD_BASE;
  const I = (k) => `${idp}${k}`;   // 한 쪽에 지도가 둘(곁칸의 약도·온 화면)이어도 id가 겹치지 않게
  let s = `<defs>${paperDefs(I("Paper"))}
    <pattern id="${I("Wave")}" width="44" height="26" patternUnits="userSpaceOnUse"><path class="m-wave" d="M3 9q4 -4 8 0t8 0M25 21q4 -4 8 0t8 0"/></pattern>
    <pattern id="${I("IceH")}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><path class="m-ice-h" d="M0 3.5h7"/></pattern>
    <clipPath id="${I("Land")}"><path d="${coast}"/>${islands.map((d) => `<path d="${d}"/>`).join("")}</clipPath>
    <radialGradient id="${I("Vig")}" cx="50%" cy="48%" r="70%"><stop offset="60%" stop-color="#3a2410" stop-opacity="0"/><stop offset="100%" stop-color="#3a2410" stop-opacity=".38"/></radialGradient>
    <radialGradient id="${I("Hole")}"><stop offset="0" stop-color="#000" stop-opacity="1"/><stop offset=".55" stop-color="#000" stop-opacity=".9"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <radialGradient id="${I("-ash")}"><stop offset="0" class="m-ash-s" stop-opacity=".55"/><stop offset="1" class="m-ash-s" stop-opacity="0"/></radialGradient>
    <radialGradient id="${I("-rust")}"><stop offset="0" class="m-rust-s" stop-opacity=".32"/><stop offset="1" class="m-rust-s" stop-opacity="0"/></radialGradient>
    <radialGradient id="${I("-forest")}"><stop offset="0" class="m-forest-s" stop-opacity=".28"/><stop offset="1" class="m-forest-s" stop-opacity="0"/></radialGradient>
    <mask id="${I("Fog")}" maskUnits="userSpaceOnUse" x="${base.x - 400}" y="${base.y - 400}" width="${base.w + 800}" height="${base.h + 800}">
      <rect x="${base.x - 400}" y="${base.y - 400}" width="${base.w + 800}" height="${base.h + 800}" fill="#fff"/>
      ${known.map((n) => { const rad = n.here ? 120 : n.visited ? 105 : n.remembered ? 85 : n.heard ? 62 : 72; return `<circle cx="${n.x}" cy="${n.y}" r="${rad}" fill="url(#${I("Hole")})"/>`; }).join("")}
    </mask></defs>`;
  // 바다 · 물결 · 해안의 겹줄
  s += `<rect class="m-sea" x="${base.x - 400}" y="${base.y - 400}" width="${base.w + 800}" height="${base.h + 800}"/>`;
  s += `<rect x="${base.x - 400}" y="${base.y - 400}" width="${base.w + 800}" height="${base.h + 800}" fill="url(#${I("Wave")})" opacity=".55"/>`;
  for (const w of [30, 20, 11]) s += `<path class="m-ripple" d="${coast}" style="stroke-width:${w}"/><path class="m-ripple-gap" d="${coast}" style="stroke-width:${w - 1.5}"/>${islands.map((d) => `<path class="m-ripple" d="${d}" style="stroke-width:${w * 0.6}"/><path class="m-ripple-gap" d="${d}" style="stroke-width:${w * 0.6 - 1.5}"/>`).join("")}`;
  // 땅
  s += `<path class="m-land" d="${coast}"/>${islands.map((d) => `<path class="m-land" d="${d}"/>`).join("")}`;
  s += `<g clip-path="url(#${I("Land")})"><path class="m-rim" d="${coast}"/>${islands.map((d) => `<path class="m-rim" d="${d}" style="stroke-width:8"/>`).join("")}`;
  for (const b of T.blobs || []) s += `<circle cx="${b.x}" cy="${b.y}" r="${b.r}" fill="url(#${I("-" + b.kind)})"/>`;
  s += `</g>`;
  s += `<path class="m-ice" d="${ice}"/><path d="${ice}" fill="url(#${I("IceH")})" opacity=".6"/><path class="m-coast" d="${ice}" style="stroke-dasharray:3 2"/>`;
  s += `<path class="m-coast" d="${coast}"/>${islands.map((d) => `<path class="m-coast" d="${d}"/>`).join("")}`;
  // 재의 땅: 갈라진 금과 점묘
  for (const w of T.wastes || []) {
    let g = "";
    for (let i = 0; i < 260; i++) { const [x, y] = scatter(r, w.x, w.y, w.r, 0.85); g += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(0.5 + r() * 0.7)}"/>`; }
    s += `<g class="m-stipple">${g}</g>`;
    let cr = "";
    for (let i = 0; i < 16; i++) { let x = w.x + (r() - 0.5) * w.r * 0.5, y = w.y + (r() - 0.5) * w.r * 0.5, a = (i / 16) * Math.PI * 2 + r() * 0.3, d = `M${f1(x)} ${f1(y)}`; for (let k = 0; k < 5; k++) { a += (r() - 0.5) * 0.9; const st = (w.r / 6) * (0.6 + r() * 0.6); x += Math.cos(a) * st; y += Math.sin(a) * st * 0.85; d += `L${f1(x)} ${f1(y)}`; } cr += `<path d="${d}"/>`; }
    s += `<g class="m-crack">${cr}</g>`;
  }
  // 초원: 풀 포기
  for (const st of T.steppes || []) { let g = ""; for (let i = 0; i < st.n; i++) { const [x, y] = scatter(r, st.x, st.y, st.r, 0.75); g += `M${f1(x - 2)} ${f1(y)}l1 -3M${f1(x)} ${f1(y)}v-3.6M${f1(x + 2)} ${f1(y)}l-1 -3`; } s += `<path class="m-grass" d="${g}"/>`; }
  // 늪: 물줄과 갈대
  for (const sw of T.swamps || []) { let g = ""; for (let i = 0; i < sw.n; i++) { const [x, y] = scatter(r, sw.x, sw.y, sw.r, 0.7); g += `M${f1(x - 5)} ${f1(y)}h10M${f1(x - 2)} ${f1(y - 1)}v-4M${f1(x + 0.5)} ${f1(y - 1)}v-5.5M${f1(x + 3)} ${f1(y - 1)}v-3.5`; } s += `<path class="m-reed" d="${g}"/>`; }
  // 강: 하구로 갈수록 굵어진다
  for (const pts of T.rivers || []) {
    const P = sample(roughen(pts, strHash(pts.join()), 0.2, 2, false), 10), K = 8, per = Math.ceil(P.length / K);
    for (let k = 0; k < K; k++) { const seg = P.slice(k * per, (k + 1) * per + 1); if (seg.length < 2) continue; s += `<path class="m-river" style="stroke-width:${f1(0.8 + (k / (K - 1)) * 2.6)}" d="M${seg.map((p) => `${f1(p[0])} ${f1(p[1])}`).join("L")}"/>`; }
  }
  // 숲과 산: 위에서 아래로 (앞의 것이 뒤의 것을 가린다)
  const glyphs = [];
  for (const fo of T.forests || []) for (let i = 0; i < fo.n; i++) { const [x, y] = scatter(r, fo.x, fo.y, fo.r, 0.8); glyphs.push([y, tree(x, y, 0.85 + r() * 0.35, r, fo.dark)]); }
  for (const line of T.ridges || []) for (let i = 0; i < line.length - 1; i++) {
    const [x1, y1] = line[i], [x2, y2] = line[i + 1], len = Math.hypot(x2 - x1, y2 - y1), steps = Math.max(1, Math.floor(len / 15));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, x = x1 + (x2 - x1) * t + (r() - 0.5) * 9, y = y1 + (y2 - y1) * t + (r() - 0.5) * 7, h = 10 + r() * 9;
      glyphs.push([y, mountain(x, y, h, r, h > 15)]);
      if (r() < 0.55) { const ox = (r() - 0.5) * 22, oy = 6 + r() * 6; glyphs.push([y + oy, mountain(x + ox, y + oy, 5 + r() * 4, r, false)]); }
    }
  }
  glyphs.sort((a, b) => a[0] - b[0]);
  s += `<g class="m-relief">${glyphs.map((x) => x[1]).join("")}</g>`;
  // 지역 이름 (안개 밑 — 모르는 땅의 이름은 흐리다)
  s += `<g class="m-regions">${(W.regions || []).map((rg) => {
    const y0 = rg.y + (rg.labelDy || -60), L = Math.max(70, rg.name.length * 17);
    const anyKnown = known.some((n) => n.region === rg.id);
    return `<path id="rg${rg.id}" d="M${f1(rg.x - L / 2)} ${f1(y0 + 6)} Q${rg.x} ${f1(y0 - 8)} ${f1(rg.x + L / 2)} ${f1(y0 + 6)}" fill="none"/><text class="m-region${anyKnown ? "" : " dim"}"><textPath href="#rg${rg.id}" startOffset="50%" text-anchor="middle">${esc(rg.name)}</textPath></text>`;
  }).join("")}</g>`;
  // 길: 아는 길만. 종류마다 다른 선, 위험한 길목엔 붉은 표
  const rr = rng(9);
  s += `<g class="m-roads">${W.edges.filter((e) => e.known).map((e) => {
    const a = N.get(e.from), b = N.get(e.to); if (!a || !b) return "";
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, bend = ((strHash(e.from + e.to) % 100) / 100 - 0.5) * 0.22 * len;
    const cx = (a.x + b.x) / 2 - (dy / len) * bend, cy = (a.y + b.y) / 2 + (dx / len) * bend;
    const d = `M${a.x} ${a.y}Q${f1(cx)} ${f1(cy)} ${b.x} ${b.y}`, mx = 0.25 * a.x + 0.5 * cx + 0.25 * b.x, my = 0.25 * a.y + 0.5 * cy + 0.25 * b.y;
    let out = e.road === "imperial" ? `<path class="m-rd-imp" d="${d}"/><path class="m-rd-imp2" d="${d}"/>` : `<path class="m-rd-${e.road}" d="${d}"/>`;
    if (e.road === "sea") out += `<path class="m-ship" transform="translate(${f1(mx)} ${f1(my)})" d="M-4 0h8l-1.6 2.4h-4.8ZM0 0v-6l3.4 4.4Z"/>`;
    if (e.danger >= 4) out += `<path class="m-danger" transform="translate(${f1(mx)} ${f1(my)})" d="M-2.2 -2.2l4.4 4.4M2.2 -2.2l-4.4 4.4"/>`;
    return out;
  }).join("")}</g>`;
  // 안개
  if (!mini) {
    let clouds = "";
    for (let i = 0; i < 70; i++) { const x = base.x + r() * base.w, y = base.y + r() * base.h, rad = 30 + r() * 70; clouds += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rad)}"/>`; }
    s += `<g mask="url(#${I("Fog")})"><rect class="m-fog" x="${base.x - 400}" y="${base.y - 400}" width="${base.w + 800}" height="${base.h + 800}"/><g class="m-cloud">${clouds}</g><rect x="${base.x - 400}" y="${base.y - 400}" width="${base.w + 800}" height="${base.h + 800}" fill="url(#${I("Paper")})" opacity=".7"/></g>`;
  }
  // 종이 결 + 가장자리 그을음
  s += `<rect x="${base.x - 400}" y="${base.y - 400}" width="${base.w + 800}" height="${base.h + 800}" fill="url(#${I("Paper")})" class="m-paper"/>`;
  // 정착지: 아는 곳만 (그림 — 크기는 확대에 맞춰 화면에서 같게). 이름은 따로 (labelsWorld)
  const clsOf = (n) => (n.here ? " here" : n.visited ? " visited" : n.remembered ? " remembered" : n.heard ? " heard" : "");
  s += `<g class="m-nodes">${known.sort((a, b) => a.y - b.y).map((n) => `<g class="m-node${clsOf(n)}" data-node="${esc(n.id)}" transform="translate(${n.x} ${n.y})" tabindex="0" role="button" aria-label="${esc(n.name)}">
      <g class="m-ico${n.major ? " major" : ""}"><circle class="m-hit" r="12" cy="-6"/>${settlementGlyph(n.type, false)}</g></g>`).join("")}</g>`;
  s += `<g class="m-labels label-layer"></g>`;
  s += `<g class="m-route route-layer"></g>`;
  // 장식: 나침반 · 제목 · 축척 (바다 위)
  if (!mini) {
    const rates = W.edges.filter((e) => ["road", "trail", "imperial"].includes(e.road)).map((e) => { const a = N.get(e.from), b = N.get(e.to); return a && b ? Math.hypot(a.x - b.x, a.y - b.y) / e.hours : null; }).filter(Boolean).sort((a, b) => a - b);
    const ph = rates.length ? rates[Math.floor(rates.length / 2)] : 3, day = ph * 12;
    s += compass(985, 712, 34);
    s += `<g class="m-cartouche" transform="translate(132 718)"><path class="m-scroll" d="M-96 -26h192q10 0 10 10v32q0 10 -10 10h-192q-10 0 -10 -10v-32q0 -10 10 -10Z"/><path class="m-scroll-curl" d="M-106 -16q-12 0 -12 12t12 12M106 -16q12 0 12 12t-12 12"/>
      <text class="m-title" y="2" text-anchor="middle">에오르</text><text class="m-subtitle" y="19" text-anchor="middle">${esc(W.home || "회색여울")}에서 본 대륙 · 붕괴력 312년</text></g>`;
    s += `<g class="m-scale" transform="translate(${f1(985 - day)} 768)">${[0, 1, 2, 3].map((i) => `<rect x="${f1((i * day) / 4)}" y="0" width="${f1(day / 4)}" height="4" class="${i % 2 ? "m-sc-l" : "m-sc-d"}"/>`).join("")}<text x="0" y="-4" class="m-sc-t">0</text><text x="${f1(day / 2)}" y="-4" class="m-sc-t" text-anchor="middle">반나절</text><text x="${f1(day)}" y="-4" class="m-sc-t" text-anchor="end">하루 걸음</text></g>`;
  }
  s += `<rect x="${base.x - 400}" y="${base.y - 400}" width="${base.w + 800}" height="${base.h + 800}" fill="url(#${I("Vig")})" pointer-events="none"/>`;
  // 내가 선 자리
  const here = N.get(W.here);
  if (here) s += `<g class="pawn-layer">${pawnMarker(here.x, here.y, { label: "내가 있는 곳" })}</g>`;
  // 이름표 자료: 확대할 때마다 화면 크기 그대로, 겹치지 않게 다시 놓는다
  const labels = known.map((n) => ({ x: n.x, y: n.y, text: n.name, cls: `m-label${n.major ? " major" : ""}${clsOf(n)}`, size: n.major ? 14 : 12, w: n.major ? 24 : 20, h: n.major ? 24 : 20, prio: n.here ? 3 : n.major ? 2 : n.visited ? 1 : 0, id: n.id }));
  return { svg: s, base, here: here ? [here.x, here.y] : null, labels, icon: { cls: "m-ico", px: 20, units: 16, majorPx: 25 } };
}

// 계획한 길을 지도에 긋는다
export function routePath(W, path) {
  const N = new Map(W.nodes.map((n) => [n.id, n]));
  const pts = path.map((id) => N.get(id)).filter(Boolean).map((n) => [n.x, n.y]);
  if (pts.length < 2) return "";
  return `<path class="m-route-glow" d="${spline(pts, false)}"/><path class="m-route-line" d="${spline(pts, false)}"/>${pts.slice(1, -1).map(([x, y]) => `<circle class="m-route-stop" cx="${x}" cy="${y}" r="2.6"/>`).join("")}`;
}

// ── 고장 지도 ──
// 건물 그림 (가운데 아래 기준): 갈래와 이름으로 고른다
function building(l) {
  const n = l.name || "", k = l.kind || "";
  const house = (w, h, roof = "t-roof") => `<rect class="t-wall" x="${-w / 2}" y="${-h}" width="${w}" height="${h}"/><path class="${roof}" d="M${-w / 2 - 3} ${-h}L0 ${-h - w * 0.42}L${w / 2 + 3} ${-h}Z"/><rect class="t-dark" x="-2" y="-6" width="4" height="6"/>`;
  if (k === "keep") return `<rect class="t-wall" x="-22" y="-24" width="44" height="24"/><path class="t-wall" d="M-22 -24v-3h3v2h3v-2h3v2h3v-2h3v2h3v-2h3v2h3v-2h3v2h3v-2h3v2h3v-2h3v3Z"/>
    <rect class="t-wall" x="-28" y="-36" width="10" height="36"/><rect class="t-wall" x="18" y="-36" width="10" height="36"/><rect class="t-wall" x="-7" y="-46" width="14" height="46"/>
    <path class="t-slate" d="M-29 -36l6 -10 6 10ZM17 -36l6 -10 6 10ZM-8 -46l8 -12 8 12Z"/><path class="t-dark" d="M-5 0v-9a5 5 0 0 1 10 0v9Z"/><rect class="t-dark" x="-25" y="-28" width="3" height="5"/><rect class="t-dark" x="22" y="-28" width="3" height="5"/><rect class="t-dark" x="-1.5" y="-38" width="3" height="6"/>
    <path class="t-pole" d="M0 -58v-10"/><path class="t-flag" d="M0 -68l10 3 -10 3Z"/>`;
  if (/물레방아/.test(n)) return `${house(26, 16)}<circle class="t-wheel" cx="17" cy="-8" r="9"/><path class="t-pole" d="M17 -17v18M8 -8h18M10.6 -14.4l12.8 12.8M23.4 -14.4l-12.8 12.8"/>`;
  if (/대장간/.test(n)) return `${house(24, 14)}<rect class="t-wall" x="5" y="-27" width="5" height="10"/><path class="t-smoke" d="M7.5 -28q-3 -4 0 -7t0 -7"/><path class="t-dark" d="M-17 0h8v-2h-2v-2h3v-2h-9v2h3v2h-3Z"/><circle class="t-glow" cx="0" cy="-3" r="2"/>`;
  if (/마구간/.test(n)) return `<rect class="t-wall" x="-20" y="-12" width="40" height="12"/><path class="t-roof" d="M-23 -12l5 -8h36l5 8Z"/><rect class="t-dark" x="-14" y="-8" width="5" height="8"/><rect class="t-dark" x="-3" y="-8" width="5" height="8"/><rect class="t-dark" x="8" y="-8" width="5" height="8"/>`;
  if (/무두|도살/.test(n)) return `${house(22, 13)}<path class="t-pole" d="M14 0v-14M26 0v-14M13 -13h14"/><path class="t-hide" d="M16 -13v7l2 2 2-2v-7ZM21 -13v6l2 2 2-2v-6Z"/>`;
  if (/직조/.test(n)) return `<rect class="t-wall" x="-18" y="-12" width="36" height="12"/><path class="t-roof" d="M-20 -12l6 -7v7l6 -7v7l6 -7v7l6 -7v7l6 -7v7l6 -7v7Z"/><rect class="t-dark" x="-2" y="-6" width="4" height="6"/>`;
  if (/우물/.test(n) || (k === "square" && /우물/.test(n))) return `<ellipse class="t-plaza" cx="0" cy="-4" rx="26" ry="12"/><circle class="t-wellw" cx="0" cy="-5" r="5"/><path class="t-pole" d="M-6 -5v-9M6 -5v-9"/><path class="t-roof" d="M-9 -14l9 -6 9 6Z"/>`;
  if (k === "square") return `<ellipse class="t-plaza" cx="0" cy="-4" rx="28" ry="13"/><path class="t-pole" d="M0 -4v-22M-6 -22h12"/><path class="t-rope" d="M-5 -22v6M5 -22v6"/>`;
  if (k === "canteen") return `<rect class="t-wall" x="-22" y="-15" width="44" height="15"/><path class="t-roof" d="M-25 -15l7 -10h36l7 10Z"/><rect class="t-wall" x="10" y="-31" width="5" height="8"/><path class="t-smoke" d="M12.5 -32q-3 -4 0 -7t0 -7"/><rect class="t-dark" x="-3" y="-9" width="6" height="9"/><rect class="t-win" x="-16" y="-11" width="5" height="4"/><rect class="t-win" x="11" y="-11" width="5" height="4"/>`;
  if (k === "chapel") return `<rect class="t-wall" x="-12" y="-16" width="24" height="16"/><path class="t-roof" d="M-14 -16l14 -10 14 10Z"/><rect class="t-wall" x="-4.5" y="-34" width="9" height="18"/><path class="t-slate" d="M-6 -34l6 -12 6 12Z"/><circle class="t-glow" cx="0" cy="-27" r="2.2"/><path class="t-dark" d="M-3 0v-6a3 3 0 0 1 6 0v6Z"/>`;
  if (k === "barracks") return `<rect class="t-wall" x="-26" y="-11" width="52" height="11"/><path class="t-thatch" d="M-29 -11l5 -8h48l5 8Z"/>${[-18, -6, 6, 18].map((x) => `<rect class="t-dark" x="${x - 2}" y="-6" width="4" height="6"/>`).join("")}`;
  if (k === "home") return house(16, 10, "t-thatch");
  if (k === "office") return `${house(24, 15)}<path class="t-pole" d="M14 -15v-12"/><path class="t-banner" d="M14 -27h9v8l-4.5 -2.5 -4.5 2.5Z"/><circle class="t-glow" cx="18.5" cy="-23" r="1.6"/>`;
  if (k === "store") return `<rect class="t-wall" x="-14" y="-20" width="28" height="20"/><path class="t-roof" d="M-17 -20l5 -9h24l5 9Z"/><path class="t-dark" d="M-6 0v-12h12v12Z"/><path class="t-x" d="M-6 -12l12 12M6 -12l-12 12"/>`;
  if (k === "lodging") return `<rect class="t-wall" x="-16" y="-14" width="32" height="14"/><path class="t-thatch" d="M-19 -14l19 -11 19 11Z"/><path class="t-dark" d="M-5 0v-9h10v9Z"/>`;
  if (k === "graveyard") return `<rect class="t-fence" x="-24" y="-18" width="48" height="18"/>${[[-15, -4], [-5, -9], [5, -4], [15, -9], [-10, -13], [10, -14]].map(([x, y]) => `<path class="t-stone" d="M${x - 2.5} ${y + 3}v-4a2.5 2.5 0 0 1 5 0v4Z"/>`).join("")}`;
  if (k === "checkpoint") return `<rect class="t-deck" x="-22" y="-6" width="44" height="8"/><rect class="t-wall" x="-20" y="-20" width="8" height="16"/><rect class="t-wall" x="12" y="-20" width="8" height="16"/><path class="t-slate" d="M-21 -20l5 -7 5 7ZM11 -20l5 -7 5 7Z"/><path class="t-bar" d="M-12 -12h24"/>`;
  if (k === "kennel") return `<path class="t-wall" d="M-8 0v-8l8 -7 8 7v8Z"/><path class="t-dark" d="M-3 0v-4a3 3 0 0 1 6 0v4Z"/><path class="t-fence2" d="M-20 0v-6M-16 0v-6M12 0v-6M16 0v-6M20 0v-6M-22 -4h10M10 -4h12"/>`;
  if (k === "outdoor") return `${[[-12, 0], [0, -4], [12, 0]].map(([x, y]) => `<path class="t-trunk" d="M${x} ${y}v-8"/><circle class="t-willow" cx="${x}" cy="${y - 12}" r="7"/><path class="t-droop" d="M${x - 6} ${y - 10}q0 6 -1 9M${x - 2} ${y - 7}v8M${x + 3} ${y - 7}v7M${x + 6} ${y - 10}q0 6 1 9"/>`).join("")}`;
  if (k === "work") return `${house(22, 13)}<rect class="t-wall" x="4" y="-25" width="4" height="8"/>`;
  if (/움막|오두막|헛간/.test(n)) return house(16, 10, "t-thatch");
  return house(18, 11);
}

// 최소 신장 트리 (프림) — 장소들을 잇는 흙길
function mst(P) {
  const n = P.length, inT = new Array(n).fill(false), best = new Array(n).fill(Infinity), par = new Array(n).fill(-1), E = [];
  if (!n) return E;
  best[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1; for (let i = 0; i < n; i++) if (!inT[i] && (u < 0 || best[i] < best[u])) u = i;
    inT[u] = true; if (par[u] >= 0) E.push([par[u], u]);
    for (let v = 0; v < n; v++) if (!inT[v]) { const d = Math.hypot(P[u][0] - P[v][0], P[u][1] - P[v][1]); if (d < best[v]) { best[v] = d; par[v] = u; } }
  }
  return E;
}
const segDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
const confDots = (c) => (c >= 0.85 ? "●●●" : c >= 0.65 ? "●●○" : "●○○");

// S = mapView().settlement
export function townBase(S, mini = false) { const Wd = S.grid?.w || 600, Hd = S.grid?.h || 450, pad = mini ? 30 : 70; return { x: -pad, y: -pad, w: Wd + pad * 2, h: Hd + pad * 2 + (mini ? 0 : 10) }; }
export function townSVG(S, { mini = false, idp = mini ? "tm" : "t" } = {}) {
  const Wd = S.grid?.w || 600, Hd = S.grid?.h || 450, r = rng(strHash(S.id || "town"));
  const locs = S.locations || [], go = new Set(S.goable || []);
  const pad = mini ? 30 : 70, base = townBase(S, mini);
  const P = locs.map((l) => l.xy);
  // 강: 자료에 그려 둔 강, 없으면 물가 이름(강·둑·나루·다리·물레방아)으로 짐작
  let river = S.features?.river || null;
  if (!river) {
    const wet = locs.filter((l) => /강|둑|나루|다리|여울|물레방아|부두|항/.test(l.name)).sort((a, b) => a.xy[0] - b.xy[0]);
    if (wet.length >= 2) river = [[-pad, wet[0].xy[1] + 28], ...wet.map((l) => [l.xy[0], l.xy[1] + (/다리/.test(l.name) ? 6 : 28)]), [Wd + pad, wet[wet.length - 1].xy[1] + 28]];
  }
  // 길: 장소들의 최소 신장 트리 + 가까운 짝 몇 개 더 (마을 길은 나무 모양이 아니다)
  const edges = mst(P);
  for (let i = 0; i < P.length; i++) {
    let bj = -1, bd = Infinity;
    for (let j = 0; j < P.length; j++) if (j !== i && !edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) { const d = Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]); if (d < bd) { bd = d; bj = j; } }
    if (bj >= 0 && bd < 95 && r() < 0.5) edges.push([i, bj]);
  }
  const segs = edges.map(([a, b]) => [P[a], P[b], locs[a].access === "public" && locs[b].access === "public"]);
  // 고장 밖으로 나가는 길: 방향마다 가장자리로
  const cx = Wd / 2, cy = Hd / 2;
  const exitPt = (ang) => { const a = (ang * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a), tx = dx ? (dx > 0 ? (Wd + 26 - cx) / dx : (-26 - cx) / dx) : Infinity, ty = dy ? (dy > 0 ? (Hd + 26 - cy) / dy : (-26 - cy) / dy) : Infinity, t = Math.min(tx, ty); return [cx + dx * t, cy + dy * t]; };
  const groups = [];
  for (const o of S.outer || []) { if (o.angle == null) continue; let gq = groups.find((x) => Math.abs(((x.angle - o.angle + 540) % 360) - 180) < 22); if (!gq) groups.push((gq = { angle: o.angle, items: [] })); gq.items.push(o); }
  for (const gq of groups) {
    gq.pt = exitPt(gq.angle);
    let bi = 0, bd = Infinity; P.forEach((p, i) => { const d = Math.hypot(p[0] - gq.pt[0], p[1] - gq.pt[1]); if (d < bd) { bd = d; bi = i; } });
    if (P.length) segs.push([P[bi], gq.pt, true]);
  }
  const I = (k) => `${idp}${k}`;
  let s = `<defs>${paperDefs(I("Paper"))}<pattern id="${I("Rows")}" width="6" height="6" patternUnits="userSpaceOnUse"><path class="t-row" d="M0 3h6"/></pattern>
    <radialGradient id="${I("Vig")}" cx="50%" cy="50%" r="72%"><stop offset="62%" stop-color="#3a2410" stop-opacity="0"/><stop offset="100%" stop-color="#3a2410" stop-opacity=".35"/></radialGradient></defs>`;
  s += `<rect class="t-ground" x="${base.x - 300}" y="${base.y - 300}" width="${base.w + 600}" height="${base.h + 600}"/>`;
  // 밭: 장소·길·강에서 떨어진 빈 땅에
  if (!mini) {
    const fields = [];
    for (let i = 0; i < 160 && fields.length < 9; i++) {
      const p = [-40 + r() * (Wd + 80), -40 + r() * (Hd + 60)];
      if (P.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 62)) continue;
      if (segs.some(([a, b]) => segDist(p, a, b) < 26)) continue;
      if (river && river.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 46)) continue;
      if (fields.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 74)) continue;
      fields.push(p);
    }
    s += fields.map(([x, y], i) => { const w = 44 + r() * 26, h = 28 + r() * 14, rot = (r() - 0.5) * 40, kind = ["t-field-a", "t-field-b", "t-field-c"][i % 3]; return `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)})"><rect class="${kind}" x="${f1(-w / 2)}" y="${f1(-h / 2)}" width="${f1(w)}" height="${f1(h)}" rx="2"/><rect x="${f1(-w / 2)}" y="${f1(-h / 2)}" width="${f1(w)}" height="${f1(h)}" fill="url(#${I("Rows")})" opacity=".7"/><rect class="t-hedge" x="${f1(-w / 2)}" y="${f1(-h / 2)}" width="${f1(w)}" height="${f1(h)}" rx="2"/></g>`; }).join("");
  }
  // 강
  if (river) {
    const d = spline(river, false);
    s += `<path class="t-bank" d="${d}"/><path class="t-water" d="${d}"/><path class="t-ripple" d="${d}"/>`;
    if (!mini && S.features?.river_name) { const m = river[Math.floor(river.length / 2) - 1]; s += `<text class="t-rivername" x="${m[0] - 40}" y="${m[1] + 26}">${esc(S.features.river_name)}</text>`; }
  }
  // 흙길
  const sd = segs.map(([a, b]) => { const mx = (a[0] + b[0]) / 2 + (r() - 0.5) * 12, my = (a[1] + b[1]) / 2 + (r() - 0.5) * 12; return `M${f1(a[0])} ${f1(a[1])}Q${f1(mx)} ${f1(my)} ${f1(b[0])} ${f1(b[1])}`; });
  s += `<path class="t-road-o" d="${sd.join("")}"/><path class="t-road" d="${sd.join("")}"/>`;
  // 나무: 빈 자리에
  if (!mini) {
    const trees = [];
    for (let i = 0; i < 260 && trees.length < 70; i++) {
      const p = [-50 + r() * (Wd + 100), -50 + r() * (Hd + 90)];
      if (P.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 36)) continue;
      if (segs.some(([a, b]) => segDist(p, a, b) < 12)) continue;
      if (river && sample(river, 4).some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 16)) continue;
      trees.push(p);
    }
    s += trees.sort((a, b) => a[1] - b[1]).map(([x, y]) => tree(x, y, 1.3 + r() * 0.5, r, r() < 0.3)).join("");
  }
  // 건물 (이름과 사람은 따로 — labelsTown)
  const sorted = locs.slice().sort((a, b) => a.xy[1] - b.xy[1]);
  s += sorted.map((l) => {
    const [x, y] = l.xy, cls = `t-bld${l.here ? " here" : ""}${go.has(l.id) ? " go" : ""} acc-${l.access || "public"}`;
    return `<g class="${cls}" data-loc="${esc(l.id)}" transform="translate(${x} ${y})" tabindex="0" role="button" aria-label="${esc(l.name)}"><g class="t-ico"><ellipse class="t-hit" cx="0" cy="-14" rx="28" ry="22"/>${building(l)}${["owner", "staff", "locked"].includes(l.access) ? `<path class="t-lock" transform="translate(${l.kind === "keep" ? 30 : 18} -6)" d="M-3 0h6v-4h-6ZM-2 -4v-1.6a2 2 0 0 1 4 0V-4"/>` : ""}</g></g>`;
  }).join("");
  s += `<g class="t-labels label-layer"></g>`;
  // 고장 밖으로: 가장자리의 화살표 (이름은 labelsTown이 화살표 옆에)
  if (!mini) for (const gq of groups) s += `<g class="t-exit-arrow" transform="translate(${f1(gq.pt[0])} ${f1(gq.pt[1])}) rotate(${gq.angle})"><path d="M-9 -6L5 0L-9 6L-5 0Z"/></g>`;
  if (!mini) {
    s += `<rect x="${base.x - 300}" y="${base.y - 300}" width="${base.w + 600}" height="${base.h + 600}" fill="url(#${I("Paper")})" class="m-paper" pointer-events="none"/>`;
    s += compass(Wd + pad - 34, Hd + pad - 30, 20);
    s += `<g class="m-cartouche" transform="translate(${f1(base.x + 104)} ${f1(base.y + 30)})"><path class="m-scroll" d="M-90 -18h180q8 0 8 8v20q0 8 -8 8h-180q-8 0 -8 -8v-20q0 -8 8 -8Z"/><text class="m-title small" y="6" text-anchor="middle">${esc(S.name || "")}</text></g>`;
  }
  s += `<rect x="${base.x - 300}" y="${base.y - 300}" width="${base.w + 600}" height="${base.h + 600}" fill="url(#${I("Vig")})" pointer-events="none"/>`;
  // 내가 선 자리: 지금 있는 건물의 문 앞, 없으면 고장 밖의 그 길목
  const hereL = locs.find((l) => l.here), hereO = groups.find((gq) => gq.items.some((o) => o.here));
  const hp = hereL ? [hereL.xy[0] - 14, hereL.xy[1] + 6] : hereO ? hereO.pt : null;
  if (hp) s += `<g class="pawn-layer">${pawnMarker(hp[0], hp[1], { label: "내가 있는 곳" })}</g>`;
  // 이름표 자료
  const labels = mini ? [] : [
    ...locs.map((l) => {
      const ppl = (S.people || []).filter((p) => (l.people || []).includes(p.name));
      const sub = ppl.length ? ppl.slice(0, 3).map((p) => `${p.name} ${confDots(p.conf)}`).join("  ") + (ppl.length > 3 ? `  외 ${ppl.length - 3}` : "") : null;
      return { x: l.xy[0], y: l.xy[1], text: l.name.replace(/\s*'.*'$/, "").replace(/·.*$/, ""), cls: `t-label${l.here ? " here" : ""}${l.access === "public" ? "" : " restricted"}`, size: 14, w: l.kind === "keep" ? 52 : 40, h: l.kind === "keep" ? 56 : 34, prio: l.here ? 3 : l.access === "public" ? 1 : 0, sub, subCls: "t-people", id: l.id };
    }),
    ...groups.map((gq) => { const c = Math.cos((gq.angle * Math.PI) / 180); return { x: gq.pt[0], y: gq.pt[1], lines: gq.items.map((o) => ({ text: `${o.name} · ${o.hours}시간`, cls: `t-exit${go.has(o.id) ? " go" : ""}${o.here ? " here" : ""}`, id: o.id })), size: 12, w: 18, h: 14, prio: 2, side: c >= 0.35 ? "left" : c <= -0.35 ? "right" : Math.sin((gq.angle * Math.PI) / 180) > 0 ? "above" : "below" }; }),
  ];
  return { svg: s, base, here: hp, labels, icon: { cls: "t-ico", px: 40, units: 34 } };
}

// ── 이름표: 확대 배율 k(화면 px / 지도 단위)에 맞춰 화면에서 같은 크기로, 서로·그림과 겹치지 않게 놓는다 ──
// 후보 자리: 아래 → 위 → 오른쪽 → 왼쪽. 그림(아이콘)과 체스말도 장애물로 친다
export function layoutLabels(items, k, { pawn = null, iconPx = 20 } = {}) {
  const boxes = [], out = [];
  const hit = (b) => boxes.some((q) => b[0] < q[0] + q[2] && b[0] + b[2] > q[0] && b[1] < q[1] + q[3] && b[1] + b[3] > q[1]);
  const icons = items.map((it) => { const w = (it.w ?? iconPx), h = (it.h ?? iconPx); return [it.x * k - w / 2, it.y * k - h, w, h]; });
  icons.forEach((b) => boxes.push(b));
  if (pawn) boxes.push([pawn[0] * k - 13, pawn[1] * k - 50, 26, 54]);
  const tw = (t, sz) => [...t].reduce((a, ch) => a + (/[가-힣]/.test(ch) ? sz * 0.98 : /\s/.test(ch) ? sz * 0.32 : sz * 0.58), 0);
  const order = items.map((it, i) => i).sort((a, b) => (items[b].prio || 0) - (items[a].prio || 0));
  for (const i of order) {
    const it = items[i], sz = it.size || 12, X = it.x * k, Y = it.y * k, w = it.w ?? iconPx, h = it.h ?? iconPx;
    const lines = it.lines || [{ text: it.text, cls: it.cls, id: it.id }, ...(it.sub ? [{ text: it.sub, cls: it.subCls, small: true }] : [])];
    const lh = (ln) => (ln.small ? sz * 0.86 : sz) * 1.22;
    const W = Math.max(...lines.map((ln) => tw(ln.text, ln.small ? sz * 0.86 : sz))) + 6, H = lines.reduce((a, ln) => a + lh(ln), 0);
    const self = icons[i];
    boxes.splice(boxes.indexOf(self), 1);
    const cands = {
      below: [X - W / 2, Y + 3, "middle", X], above: [X - W / 2, Y - h - H - 2, "middle", X],
      right: [X + w / 2 + 4, Y - h / 2 - H / 2, "start", X + w / 2 + 7], left: [X - w / 2 - 4 - W, Y - h / 2 - H / 2, "end", X - w / 2 - 7],
    };
    const tryOrder = it.side ? [it.side, "below", "above", "right", "left"] : ["below", "above", "right", "left"];
    let pick = null;
    for (const c of tryOrder) { const [bx, by] = cands[c]; const b = [bx, by, W, H]; if (!hit(b)) { pick = c; break; } }
    pick ||= tryOrder[0];
    const [bx, by, anchor, ax] = cands[pick];
    boxes.push(self, [bx, by, W, H]);
    let yy = by;
    for (const ln of lines) {
      const fs = ln.small ? sz * 0.86 : sz; yy += lh(ln);
      out.push(`<text class="${ln.cls}"${ln.id && it.lines ? ` data-loc="${esc(ln.id)}" tabindex="0" role="button"` : ""} x="${f1(ax / k)}" y="${f1((yy - fs * 0.26) / k)}" text-anchor="${anchor}" style="font-size:${f1(fs / k * 10) / 10}px;stroke-width:${f1(3.2 / k * 10) / 10}px">${esc(ln.text)}</text>`);
    }
  }
  return out.join("");
}

// ── 끌기·확대 (마우스 휠, 두 손가락, 단추) ──
// 화면 배율 k에 맞춰: 아이콘 크기(--ic), 체스말 크기, 이름표 자리
export function fitToScreen(svg, built, { pawnPx = 58 } = {}) {
  const m = svg.getScreenCTM(); if (!m) return;
  const k = m.a;
  const ic = built.icon ? Math.max(0.35, Math.min(2.4, built.icon.px / (built.icon.units * k))) : 1;
  svg.style.setProperty("--ic", ic.toFixed(3));
  svg.style.setProperty("--icM", built.icon?.majorPx ? Math.max(0.35, Math.min(2.6, built.icon.majorPx / (built.icon.units * k))).toFixed(3) : ic.toFixed(3));
  const pawn = svg.querySelector(".pawn-layer .pawn-mark");
  if (pawn) pawn.setAttribute("transform", pawn.getAttribute("transform").replace(/scale\([^)]*\)/, `scale(${(pawnPx / (PAWN_UNITS * k)).toFixed(3)})`));
  const L = svg.querySelector(".label-layer");
  if (L && built.labels) L.innerHTML = layoutLabels(built.labels, k, { pawn: built.here, iconPx: built.icon?.px || 20 });
  return k;
}
export function panZoom(svg, base, { min = 1, max = 6, onZoom } = {}) {
  let vb = { ...base }, raf = 0;
  const apply = () => {
    const z = base.w / vb.w;
    svg.setAttribute("viewBox", `${f1(vb.x)} ${f1(vb.y)} ${f1(vb.w)} ${f1(vb.h)}`);
    cancelAnimationFrame(raf); raf = requestAnimationFrame(() => onZoom?.(z));
  };
  const clampVb = () => {
    const z = base.w / vb.w;
    if (z < min) { vb.w = base.w / min; vb.h = base.h / min; }
    if (z > max) { vb.w = base.w / max; vb.h = base.h / max; }
    const mx = base.w * 0.15, my = base.h * 0.15;
    vb.x = Math.max(base.x - mx, Math.min(base.x + base.w + mx - vb.w, vb.x));
    vb.y = Math.max(base.y - my, Math.min(base.y + base.h + my - vb.h, vb.y));
  };
  const toMap = (cxp, cyp) => { const m = svg.getScreenCTM(); if (!m) return [vb.x + vb.w / 2, vb.y + vb.h / 2]; const p = new DOMPoint(cxp, cyp).matrixTransform(m.inverse()); return [p.x, p.y]; };
  const zoomAt = (f, mx, my) => {
    const nw = Math.max(base.w / max, Math.min(base.w / min, vb.w / f)), k = nw / vb.w;
    vb.x = mx - (mx - vb.x) * k; vb.y = my - (my - vb.y) * k; vb.w = nw; vb.h = vb.h * k;
    clampVb(); apply();
  };
  svg.addEventListener("wheel", (e) => { e.preventDefault(); const [mx, my] = toMap(e.clientX, e.clientY); zoomAt(Math.exp(-e.deltaY * 0.0015), mx, my); }, { passive: false });
  const pts = new Map(); let last = null, moved = 0, pinch = null;
  svg.addEventListener("pointerdown", (e) => { pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; last = [e.clientX, e.clientY]; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) }; } });
  svg.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), [mx, my] = toMap((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      zoomAt(d / pinch.d, mx, my); pinch.d = d; moved += 10; return;
    }
    const m = svg.getScreenCTM(); if (!m || !last) return;
    const dx = (e.clientX - last[0]) / m.a, dy = (e.clientY - last[1]) / m.d;
    moved += Math.abs(e.clientX - last[0]) + Math.abs(e.clientY - last[1]);
    if (moved > 4) { svg.setPointerCapture?.(e.pointerId); svg.classList.add("dragging"); }
    vb.x -= dx; vb.y -= dy; last = [e.clientX, e.clientY]; clampVb(); apply();
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) { svg.classList.remove("dragging"); last = null; } else last = [...pts.values()][0]; };
  svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up); svg.addEventListener("pointerleave", up);
  // 끌다가 놓은 것은 누른 것이 아니다
  svg.addEventListener("click", (e) => { if (moved > 6) { e.stopPropagation(); e.preventDefault(); } }, true);
  apply();
  return {
    zoomBy: (f) => zoomAt(f, vb.x + vb.w / 2, vb.y + vb.h / 2),
    center: (x, y, z) => { if (z) { vb.w = base.w / z; vb.h = base.h / z; } vb.x = x - vb.w / 2; vb.y = y - vb.h / 2; clampVb(); apply(); },
    reset: () => { vb = { ...base }; apply(); },
    get zoom() { return base.w / vb.w; },
  };
}
