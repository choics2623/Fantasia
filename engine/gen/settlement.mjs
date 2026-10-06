// 정착지 틀 → 건물 배치 (24 §1.2, 25 §2). 정착지 id가 시드다: 같은 마을은 매 회차·매 플레이어에게 같은 모양.
import { seeded } from "./rng.mjs";

// '배치 규칙' 글에서 대략의 자리를 읽는다 (가운데·북·남·동·서, ~옆, ~에서 서쪽)
function anchor(rule, w, h, placed) {
  let x = 0.5, y = 0.5;
  if (/북/.test(rule)) y = 0.15; if (/남/.test(rule)) y = 0.82;
  if (/서/.test(rule)) x = 0.15; if (/동/.test(rule)) x = 0.85;
  if (/가운데에서 서/.test(rule)) { x = 0.33; y = 0.5; }
  if (/모서리/.test(rule)) { x = Math.min(x, 0.08); y = Math.min(y, 0.08); }
  const rel = /^(광장|우물)/.exec(rule);
  if (rel) {
    const base = placed.find((p) => p.role === (rel[1] === "광장" ? "square" : "well"));
    if (base) { x = base.xy[0] / w; y = base.xy[1] / h + (/남/.test(rule) ? 0.15 : 0.06); if (/옆/.test(rule)) x += 0.12; }
  }
  return [x * w, y * h];
}

export function generateSettlement(template, { id, name, node = null, size = 0.5 } = {}) {
  const r = seeded("settlement", id);
  const { w, h } = template.grid;
  const placed = [];
  // 가운데부터 놓아야 '광장 옆' 같은 규칙이 기준을 찾는다
  const order = Object.entries(template.roles).sort(([a], [b]) => (a === "square" ? -1 : b === "square" ? 1 : a === "well" ? -1 : b === "well" ? 1 : 0));
  for (const [role, spec] of order) {
    const [lo, hi] = spec.count;
    const n = Math.max(lo, Math.min(hi, Math.round(lo + (hi - lo) * size + (r.next() - 0.5))));
    for (let i = 0; i < n; i++) {
      let [x, y] = anchor(spec.place || "", w, h, placed);
      for (let tries = 0; tries < 30; tries++) {
        const cx = Math.max(10, Math.min(w - 10, x + (r.next() - 0.5) * w * 0.16 + i * 35));
        const cy = Math.max(10, Math.min(h - 10, y + (r.next() - 0.5) * h * 0.16));
        if (placed.every((p) => Math.hypot(p.xy[0] - cx, p.xy[1] - cy) > 35) || tries === 29) { x = cx; y = cy; break; }
      }
      const nm = (spec.name || role).replace("{주인}", name || "영주") + (n > 1 ? ` ${"북남동서"[i] || i + 1}` : "");
      placed.push({ id: `${id}_${role}${n > 1 ? i + 1 : ""}`, role, name: nm, xy: [Math.round(x), Math.round(y)], kind: role, access: spec.access || "public", ...(spec.locked ? { locked: spec.locked } : {}) });
    }
  }
  const outer = Object.entries(template.outer || {}).map(([role, spec]) => ({ id: `${id}__${role}`, role, name: `${name || id} ${spec.name}`, hours: +(spec.hours[0] + r.next() * (spec.hours[1] - spec.hours[0])).toFixed(1) }));
  return { id, name: name || id, node, kind: template.id, generated: true, grid: template.grid, locations: placed.map(({ role, ...l }) => l), outer: outer.map(({ role, ...o }) => o), roles: Object.fromEntries([...placed, ...outer].reduce((m, p) => m.set(p.role, [...(m.get(p.role) || []), p.id]), new Map())) };
}
