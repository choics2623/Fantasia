// 체스말 — 복셀(3D 도트)로 쌓은 폰. 지도 위 '내가 선 자리'의 표식.
// 층마다 원판을 쌓아 회전체(넓은 받침 → 금빛 고리 → 가늘어지는 몸통 → 금빛 깃 → 목 → 둥근 머리)를 만들고,
// 2:1 등각 투영으로 보이는 면 셋(윗면·왼면·오른면)만 칠한다. 뒤에서 앞으로(x+y+z 순) 그리는 화가 알고리즘.
// 가려지는 면은 처음부터 빼고, 한 번 그린 그림은 캔버스 이미지로 굳혀 둔다 — 지도에서는 이미지 하나만 움직인다.

// [층, 반지름, 재질]
const PROFILE = [
  [0, 6.4, "base"], [1, 6.4, "base"], [2, 6.0, "base"], [3, 5.2, "rim"], [4, 4.5, "body"],
  ...Array.from({ length: 13 }, (_, i) => { const z = 5 + i, f = (17 - z) / 12; return [z, 2.1 + 2.1 * Math.pow(f, 1.7), "body"]; }),
  [18, 3.9, "collar"], [19, 3.5, "collar"], [20, 1.9, "body"],
  [21, 2.4, "head"], [22, 3.3, "head"], [23, 3.8, "head"], [24, 4.0, "head"], [25, 4.0, "head"], [26, 3.7, "head"], [27, 3.1, "head"], [28, 2.2, "head"], [29, 1.0, "head"],
];
const N = 14, C = N / 2, TOP = PROFILE[PROFILE.length - 1][0] + 1, ZS = 1.25;   // ZS: 한 층의 높이 (반폭 u의 배수) — 폰답게 늘씬하게

// 면 색: [윗면, 왼면(+y), 오른면(+x)] — 빛은 왼쪽 위에서
export const PALETTES = {
  crimson: { base: ["#c4473c", "#97291f", "#5f1914"], rim: ["#f0c46a", "#c38f34", "#80591d"], body: ["#e0574a", "#b3342a", "#7a201b"],
    collar: ["#f6d07a", "#cf9a3a", "#8e6420"], head: ["#e9675a", "#ba3a2f", "#80241d"], shine: "#ffc2b6", outline: "#22100c" },
  bone: { base: ["#cbbd9f", "#9e9078", "#6e6352"], rim: ["#c9a35c", "#9d7c3d", "#6c5427"], body: ["#efe3c8", "#c9bb9c", "#948770"],
    collar: ["#d8b26a", "#a8843f", "#6f5629"], head: ["#f5ead2", "#cfc1a3", "#998c74"], shine: "#ffffff", outline: "#2a2219" },
};

// 보이는 면 목록 (u=1 기준 좌표). 받침 밑 가운데가 원점
let FACES = null;
function faces() {
  if (FACES) return FACES;
  const V = new Set(), key = (x, y, z) => `${x},${y},${z}`, list = [];
  for (const [z, r, mat] of PROFILE)
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++)
      if ((x + 0.5 - C) ** 2 + (y + 0.5 - C) ** 2 <= r * r) { V.add(key(x, y, z)); list.push({ x, y, z, mat }); }
  const has = (x, y, z) => V.has(key(x, y, z));
  const pt = (x, y, z) => [(x - C) - (y - C), ((x - C) + (y - C)) * 0.5 - z * ZS];
  list.sort((a, b) => a.x + a.y + a.z - (b.x + b.y + b.z) || a.z - b.z);
  const out = [];
  for (const { x, y, z, mat } of list) {
    const shine = mat === "head" && z >= TOP - 4 && (x + 0.5 - C + 1.2) ** 2 + (y + 0.5 - C + 0.6) ** 2 <= 1.3;
    if (!has(x, y, z + 1)) out.push({ p: [pt(x, y, z + 1), pt(x + 1, y, z + 1), pt(x + 1, y + 1, z + 1), pt(x, y + 1, z + 1)], mat, side: 0, shine });
    if (!has(x, y + 1, z)) out.push({ p: [pt(x, y + 1, z + 1), pt(x + 1, y + 1, z + 1), pt(x + 1, y + 1, z), pt(x, y + 1, z)], mat, side: 1 });
    if (!has(x + 1, y, z)) out.push({ p: [pt(x + 1, y, z + 1), pt(x + 1, y + 1, z + 1), pt(x + 1, y + 1, z), pt(x + 1, y, z)], mat, side: 2 });
  }
  return (FACES = out);
}
// 경계: 가로 반폭 N, 위로 TOP*ZS + N*0.5, 아래로 N*0.5 (u=1)
export const BOUNDS = { w: 2 * N, up: TOP * ZS + N * 0.5, down: N * 0.5 };
const colorOf = (P, f) => (f.shine ? P.shine : P[f.mat][f.side]);

// SVG 문자열 (검사·대체용). 받침 밑 가운데가 (0,0)
export function pawnSVG({ u = 2, palette = "crimson", outline = true } = {}) {
  const P = PALETTES[palette] || PALETTES.crimson, F = faces();
  const poly = (p) => p.map(([a, b]) => `${(a * u).toFixed(2)},${(b * u).toFixed(2)}`).join(" ");
  const lw = Math.max(0.9, u * 0.75);
  const under = outline ? `<g fill="${P.outline}" stroke="${P.outline}" stroke-width="${(lw * 2).toFixed(2)}" stroke-linejoin="round">${F.map((f) => `<polygon points="${poly(f.p)}"/>`).join("")}</g>` : "";
  return under + F.map((f) => { const c = colorOf(P, f); return `<polygon points="${poly(f.p)}" fill="${c}" stroke="${c}" stroke-width="${(u * 0.2).toFixed(2)}" stroke-linejoin="round"/>`; }).join("");
}

// 캔버스로 굳힌 이미지 (브라우저). 돌려주는 것: { url, w, h, ax, ay } — (ax, ay)가 받침 밑 가운데 (이미지 안 픽셀 좌표, u 단위 크기 기준)
const IMG = new Map();
export function pawnImage({ u = 1.4, palette = "crimson", scale = 3 } = {}) {
  const k = `${u}|${palette}|${scale}`;
  if (IMG.has(k)) return IMG.get(k);
  if (typeof document === "undefined") return null;
  const P = PALETTES[palette] || PALETTES.crimson, F = faces(), pad = 3;
  const w = BOUNDS.w * u + pad * 2, h = (BOUNDS.up + BOUNDS.down) * u + pad * 2, ax = w / 2, ay = BOUNDS.up * u + pad;
  const cv = document.createElement("canvas"); cv.width = Math.ceil(w * scale); cv.height = Math.ceil(h * scale);
  const c = cv.getContext("2d"); c.scale(scale, scale); c.translate(ax, ay); c.lineJoin = "round";
  const path = (p) => { c.beginPath(); p.forEach(([a, b], i) => (i ? c.lineTo(a * u, b * u) : c.moveTo(a * u, b * u))); c.closePath(); };
  const lw = Math.max(0.9, u * 0.75);
  c.fillStyle = c.strokeStyle = P.outline; c.lineWidth = lw * 2;
  for (const f of F) { path(f.p); c.fill(); c.stroke(); }
  c.lineWidth = u * 0.2;
  for (const f of F) { path(f.p); c.fillStyle = c.strokeStyle = colorOf(P, f); c.fill(); c.stroke(); }
  const out = { url: cv.toDataURL("image/png"), w, h, ax, ay };
  IMG.set(k, out);
  return out;
}

// '내 자리' 표식: 맥박 고리 + 그림자 + 흔들리는 폰. 지도 좌표 (x, y)에, 배율 s (지도가 확대될 때마다 화면 크기가 같도록 다시 정한다)
export const PAWN_UNITS = BOUNDS.up + BOUNDS.down + 6;   // u=1일 때 그림 높이 (여백 포함)
export function pawnMarker(x, y, { s = 1, u = 1, palette = "crimson", label = "" } = {}) {
  const im = pawnImage({ u, palette, scale: 4 });
  const r = 6.4 * u;
  const body = im
    ? `<image class="pawn-bob" href="${im.url}" x="${(-im.ax).toFixed(2)}" y="${(-im.ay).toFixed(2)}" width="${im.w.toFixed(2)}" height="${im.h.toFixed(2)}" style="image-rendering:auto"/>`
    : `<g class="pawn-bob">${pawnSVG({ u, palette })}</g>`;
  return `<g class="pawn-mark" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(3)})" role="img" aria-label="${label}">
    <ellipse class="pawn-pulse" cx="0" cy="0" rx="${(r * 1.6).toFixed(1)}" ry="${(r * 0.8).toFixed(1)}" fill="none" stroke="#e0574a" stroke-width="${(u * 1.1).toFixed(2)}"/>
    <ellipse class="pawn-shadow" cx="0" cy="${(u * 0.8).toFixed(1)}" rx="${(r * 1.1).toFixed(1)}" ry="${(r * 0.52).toFixed(1)}" fill="#120806" opacity=".4"/>
    ${body}
  </g>`;
}

// 단독 아이콘 (윗막대 등): <img> 태그
export function pawnIconHTML(px = 22, palette = "crimson") {
  const im = pawnImage({ u: 1, palette, scale: 4 });
  if (!im) return "";
  const hpx = px, wpx = Math.round((im.w / im.h) * hpx);
  return `<img class="pawn-icon" src="${im.url}" width="${wpx}" height="${hpx}" alt="" aria-hidden="true">`;
}
