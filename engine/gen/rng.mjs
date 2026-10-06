// 결정적 난수 — 같은 문자열 시드면 언제나 같은 수열 (회귀해도 같은 마을, 같은 사람)
export function seeded(...parts) {
  let h = 1779033703 ^ parts.join("|").length;
  for (const ch of parts.join("|")) { h = Math.imul(h ^ ch.codePointAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted: (items, w = (x) => x.weight ?? 1) => { const tot = items.reduce((s, x) => s + w(x), 0); let r = next() * tot; for (const x of items) { r -= w(x); if (r <= 0) return x; } return items[items.length - 1]; },
    shuffle: (arr) => { const a2 = arr.slice(); for (let i = a2.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a2[i], a2[j]] = [a2[j], a2[i]]; } return a2; },
  };
}
