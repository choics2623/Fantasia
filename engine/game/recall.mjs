// 떠올리기 (21 §6.4 보강): 글이 닮았는지, 어떤 기억을 먼저 꺼낼지.
// - 닮음: 한글 두 글자 묶음(바이그램)의 자카드 — 형태소 분석 없이도 '약속한 대로 왔다'와 '약속대로 왔다'를 같은 줄로 본다
// - 꺼낼 순서: 중요도 + 갈래(약속·위협이 먼저) + 지금 화제와 닮은 정도 + 최근일수록 — 그리고 서로 너무 닮은 것은 하나만 (MMR)
// 순수 함수만 둔다 — 엔진(기억 병합)과 프롬프트(대화 카드·반복 검사)가 같이 쓴다.

export function bigrams(s) {
  const x = String(s || "").replace(/[\s\p{P}\p{S}]/gu, "");
  const B = new Set();
  for (let i = 0; i < x.length - 1; i++) B.add(x.slice(i, i + 2));
  return B;
}
export function jaccard(A, B) {
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n);
}
export const similar = (a, b) => jaccard(bigrams(a), bigrams(b));

const KIND_W = { promise: 1.5, threat: 1.4, debt: 1.2, suspicion: 1.2, claim: 1.0, learned: 0.9, emotion: 0.8, impression: 0.6, summary: 0.2 };
const DAY = 1440;

// 지금 꺼낼 기억 k개. topic = 이번 박자의 행동·화제 글, now = 지금 시각(분)
export function rankMemories(mems, { topic = "", now = 0, k = 6 } = {}) {
  const T = bigrams(topic);
  const pool = (mems || []).map((m) => {
    const B = bigrams(m.text);
    const s = ((m.salience || 1) / 5) * 2 + (KIND_W[m.kind] ?? 0.7) + (T.size ? jaccard(T, B) * 4 : 0) + (m.t != null ? Math.exp(-Math.max(0, now - m.t) / (7 * DAY)) : 0);
    return { m, s, B };
  }).sort((a, b) => b.s - a.s);
  const out = [];
  for (const p of pool) {
    if (out.length >= k) break;
    if (out.some((q) => jaccard(q.B, p.B) >= 0.6)) continue;   // 같은 말을 두 번 꺼내지 않는다
    out.push(p);
  }
  return out.map((p) => p.m);
}

// 새 기억이 이미 있는 기억과 거의 같은가 (같은 갈래·같은 태그, 사흘 안, 글이 70% 넘게 닮음) — 같으면 그 기억을 돌려준다
export function nearDuplicate(mems, mem, now = 0) {
  if (mem.kind === "promise" || mem.promise || mem.claim) return null;   // 약속·주장은 하나하나가 따로 판정된다
  const B = bigrams(mem.text);
  for (let i = mems.length - 1; i >= 0; i--) {
    const x = mems[i];
    if (x.kind !== mem.kind || (x.tag || null) !== (mem.tag || null)) continue;
    if (x.t != null && now - x.t > 3 * DAY) continue;
    if (jaccard(B, bigrams(x.text)) >= 0.7) return x;
  }
  return null;
}

// 서술의 반복 (19 §3 보강): 새 박자가 최근 박자와 얼마나 닮았나, 자꾸 쓰는 낱말과 문장 첫머리
export function repetition(beats, recent) {
  const R = recent.map((x) => bigrams(x));
  return beats.map((b) => { const B = bigrams(b); return R.reduce((m, r) => Math.max(m, jaccard(B, r)), 0); });
}
const STOP = new Set(["당신", "당신은", "당신의", "당신을", "그리고", "그러나", "하지만", "있다", "없다", "한다", "했다", "것이", "것을", "그는", "그가", "그의", "그녀", "다시", "아직", "이미", "조금", "같은", "하고", "듯이", "위에", "아래", "앞에", "뒤에", "모두"]);
export function crutches(texts, { min = 3, top = 6 } = {}) {
  const words = new Map(), openers = new Map();
  for (const t of texts) {
    for (const w of String(t).split(/[\s"“”'‘’.,!?…—\-()]+/)) if (w.length >= 2 && !STOP.has(w)) words.set(w, (words.get(w) || 0) + 1);
    for (const s of String(t).split(/(?<=[.!?…])\s+/)) { const o = s.trim().slice(0, 6); if (o.length >= 4) openers.set(o, (openers.get(o) || 0) + 1); }
  }
  return {
    words: [...words].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1]).slice(0, top).map(([w]) => w),
    openers: [...openers].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([o]) => o),
  };
}
