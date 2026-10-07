// 잔향의 장부 (SCENARIOS §6 · 06 §2·§3): 시대를 건너 남는 것. 영혼(soul)은 회귀를 건너고, 장부는 시대를 건넌다.
//   업적 — 한 번 새기면 끝 (같은 업적은 다시 점수를 주지 않는다). 업적의 점수가 다음 시대의 재능 포인트를 올린다 (10 → 40)
//   신재 — 그 재능의 스킬이 85에 닿았거나, 천재로 세 회차를 살았으면 열린다
//   유산 특질 — 업적이 여는 작은 특질 (생성 때 고른다)
//   정본 해금 — 장부의 canon이 켜져 있으면 SCENARIOS의 '업적' 출신과 혈통은 그 업적이 있어야 열린다 (기본은 꺼짐: 모두 열림 — CONTINUITY_LOG 5.20)
// 이 파일은 game.mjs를 부르지 않는다 (서버·생성 화면·엔진이 함께 쓴다). 장부는 판 밖에 저장한다 (원형: saves/ledger.json)
const creationOf = (content) => content?.game?.creation || { rules: {}, talents: [], traits: [], origins: [], legacy: [] };   // creation.mjs와 같은 것 (서로 부르지 않게)

export const emptyLedger = () => ({ v: 1, canon: false, eras: [], achievements: {}, peaks: {}, genius: {}, grafted: [], visited: [] });
export const ledgerOf = (x) => ({ ...emptyLedger(), ...(x || {}) });

// 다음 시대의 재능 포인트: 기본 + 장부에 새긴 업적의 점수 (끝은 tp_max)
export function ledgerTP(content, L) {
  const R = creationOf(content).rules;
  const extra = Object.values(ledgerOf(L).achievements).reduce((a, x) => a + (Number(x.tp) || 0), 0);
  return Math.min(R.tp_max ?? 40, (R.tp ?? 10) + extra);
}

// 신재가 열린 큰 재능: 장부의 최고 스킬·천재로 산 회차 (+ 이 시대 영혼의 것)
export function divineOpen(content, L, soul = null) {
  const C = creationOf(content), U = C.rules.divine_unlock || { skill: 85, genius_loops: 3 }, led = ledgerOf(L), out = new Set();
  for (const t of C.talents) {
    if (t.size !== "major") continue;
    const peak = (s) => Math.max(led.peaks[s] || 0, soul?.skills?.[s] || 0);
    const genius = (led.genius[t.id] || 0) + (soul?.genius?.[t.id] || 0);
    if ((t.grow || []).some((s) => peak(s) >= U.skill) || genius >= U.genius_loops) out.add(t.id);
  }
  return out;
}

// 업적이 연 유산 특질 · 정본 해금 (출신·혈통)
const has = (L, id) => !!ledgerOf(L).achievements[id];
export const legacyOpen = (content, L) => new Set((creationOf(content).legacy || []).filter((l) => !l.achievement || has(L, l.achievement)).map((l) => l.id));
export function canonOpen(content, L) {
  const C = creationOf(content), K = C.rules.canon || {}, led = ledgerOf(L);
  // 업적 id는 엔진이 정한다: canon:origin:<id> · canon:trait:<id> (조건은 rules.canon의 when)
  const origin = new Set(C.origins.map((o) => o.id).filter((id) => { const u = K.origins?.[id]; return !u || (u.eras && led.eras.filter((e) => e.ended).length >= u.eras) || has(led, `canon:origin:${id}`); }));
  const trait = new Set(C.traits.map((t) => t.id).filter((id) => { const u = K.traits?.[id]; return !u || led.grafted.includes(id) || has(led, `canon:trait:${id}`); }));
  return { origin, trait };
}

// 한 판(시대)이 장부에 남기는 것: 영혼의 업적·최고 스킬·천재로 산 회차·견뎌 낸 이식, 시대의 한 줄
// achievementsAll: 그 판의 업적 정의 [{id, tp, text}] — 영혼에 새겨진 id만 장부로 옮긴다
export function absorb(L0, { seed, origin, name, loop, ended, soul, achievementsAll = [] }) {
  const L = ledgerOf(JSON.parse(JSON.stringify(L0 || {})));
  for (const id of soul?.achievements || []) {
    if (L.achievements[id]) continue;
    const a = achievementsAll.find((x) => x.id === id);
    L.achievements[id] = { tp: a?.tp || 0, text: a?.text || id, era: seed };
  }
  for (const [s, v] of Object.entries(soul?.skills || {})) L.peaks[s] = Math.max(L.peaks[s] || 0, v);
  // 천재로 산 회차는 시대마다 한 번 옮긴다 (같은 시대를 다시 흡수해도 두 번 세지 않는다)
  const era = L.eras.find((e) => e.seed === seed) || (L.eras.push({ seed, origin, name: name || null, loops: 0, ended: null, genius: {} }), L.eras[L.eras.length - 1]);
  for (const [id, n] of Object.entries(soul?.genius || {})) { L.genius[id] = (L.genius[id] || 0) - (era.genius[id] || 0) + n; era.genius[id] = n; }
  L.grafted = [...new Set([...L.grafted, ...(soul?.grafted || [])])];
  L.visited = [...new Set([...L.visited, ...(soul?.visitedSettlements || [])])];
  Object.assign(era, { origin, name: name || era.name, loops: Math.max(era.loops, loop || 0), ended: ended || era.ended });
  return L;
}
