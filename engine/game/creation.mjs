// 캐릭터 생성 (06 캐릭터 생성과 재능 · content/base/creation) — 출신 → 능력치 → 재능 → 특질 → 결점 → 운명의 주사위.
// 판 하나(시대)에 한 번 정하고, 회귀해도 그대로다. 저장은 시드 + 기록 + build — build는 여기서 검증하고 마무리한다.
//   build = { origin, alloc: {능력치: 더한 점}, talents: {id: 등급 1~3}, traits: [id], flaws: [id], dice: bool,
//             diceResult: {talent, tier, flaw}, hidden: [id] }   ← 뒤의 둘은 finalizeBuild가 시드로 정해 적는다
// 엔진(game.mjs)은 build를 읽기만 한다. 이 파일은 game.mjs를 부르지 않는다 (서버와 화면이 직접 쓴다).

export const DEFAULT_ORIGIN = "serf";
const EMPTY = { rules: { tp: 10, flaw_max: 8, free_stats: 4, stat_min: 6, stat_max: 15, genius_max: 3, dice_refund: 2, dice_flaw: 0.3, hidden: 2, tier_names: ["소질", "수재", "천재"], cost: { major: [2, 4, 7], minor: [1, 2, 4] }, growth: [1.25, 1.5, 2], practice: [5, 10, 20], body: [3, 5, 8], stats: [], areas: [] }, talents: [], traits: [], flaws: [], origins: [] };
export const creationOf = (content) => content?.game?.creation || EMPTY;
export const STAT_KEYS = ["근력", "민첩", "체질", "지능", "감각", "의지"];

function hash(...parts) {
  let h = 2166136261 >>> 0;
  for (const ch of parts.join("|")) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function originDef(content, id) {
  const O = creationOf(content).origins;
  return O.find((o) => o.id === id) || O.find((o) => o.id === DEFAULT_ORIGIN) || O[0] || null;
}
export const talentDef = (content, id) => creationOf(content).talents.find((t) => t.id === id) || null;
export const traitDef = (content, id) => creationOf(content).traits.find((t) => t.id === id) || null;
export const flawDef = (content, id) => creationOf(content).flaws.find((t) => t.id === id) || null;
// 등급의 누적 비용 (큰 재능 2·4·7, 작은 재능 1·2·4)
export function tierCost(content, id, tier) {
  const T = talentDef(content, id), C = creationOf(content).rules.cost;
  return T && tier >= 1 ? (C[T.size] || C.major)[Math.min(3, tier) - 1] : 0;
}

// 출신이 정한 결점·특질 (노예 낙인, 반용의 잠든 비늘): 고를 수도 뺄 수도 없다. 결점은 환급에 든다
export const fixedFlaws = (content, build) => originDef(content, build?.origin)?.flaws || [];
export const fixedTraits = (content, build) => originDef(content, build?.origin)?.traits || [];
const allTraits = (content, build) => [...new Set([...fixedTraits(content, build), ...(build?.traits || [])])];
// 특질의 값: 출신이 깎아 주는 것이 있다 (반용은 용심이 4점 싸다)
export function traitCost(content, build, id) {
  const t = traitDef(content, id); if (!t) return 0;
  return Math.max(0, (t.cost || 0) - (originDef(content, build?.origin)?.trait_discount?.[id] || 0));
}
// 능력치: 출신의 바탕 + 자유 배분 (여기까지가 생성의 상한 15) + 몸의 특질(거인의 뼈 근력 +3 …) + 결점(허약 체질 −2 체질, 외눈 −2 감각)
export function baseStats(content, build) {
  const o = originDef(content, build?.origin), out = {};
  for (const k of STAT_KEYS) out[k] = (o?.stats?.[k] ?? 9) + (Number(build?.alloc?.[k]) || 0);
  return out;
}
export function statsOf(content, build) {
  const out = baseStats(content, build);
  for (const id of allTraits(content, build)) for (const [k, v] of Object.entries(traitDef(content, id)?.stats || {})) if (k in out) out[k] += Number(v) || 0;
  const F = new Set([...buildFlaws(build), ...fixedFlaws(content, build)]);   // 주사위가 준 결점, 출신의 결점까지
  if (F.has("frail")) out.체질 -= 2;
  if (F.has("one_eye")) out.감각 -= 2;
  return out;
}

// 검사: 틀린 곳과 점수의 셈을 함께 돌려준다 (화면은 이것으로 그리고, 서버는 이것으로 막는다)
export function checkBuild(content, build = {}) {
  const C = creationOf(content), R = C.rules, errors = [];
  const origin = originDef(content, build.origin);
  if (build.origin && origin?.id !== build.origin) errors.push(`모르는 출신: ${build.origin}`);
  // 능력치
  let used = 0;
  for (const [k, v] of Object.entries(build.alloc || {})) {
    if (!STAT_KEYS.includes(k)) { errors.push(`모르는 능력치: ${k}`); continue; }
    if (!Number.isInteger(v) || v < 0) errors.push(`${k}: 더하는 점은 0 이상의 정수`);
    used += Math.max(0, Number(v) || 0);
  }
  if (used > R.free_stats) errors.push(`능력치 점수가 넘친다 (${used}/${R.free_stats})`);
  const stats = statsOf(content, build), base = baseStats(content, build);
  for (const k of STAT_KEYS) if (base[k] > R.stat_max) errors.push(`${k}은(는) ${R.stat_max}까지`);
  // 재능
  let spent = 0, genius = 0;
  for (const [id, tier] of Object.entries(build.talents || {})) {
    const T = talentDef(content, id);
    if (!T) { errors.push(`모르는 재능: ${id}`); continue; }
    if (!Number.isInteger(tier) || tier < 1 || tier > 3) { errors.push(`${T.name}: 등급은 소질·수재·천재`); continue; }
    if (tier === 3) genius++;
    spent += tierCost(content, id, tier);
  }
  if (genius > R.genius_max) errors.push(`천재는 ${R.genius_max}개까지`);
  // 몸의 특질: 고른 것은 둘까지 (출신이 정한 것은 세지 않는다) · 함께 가질 수 없는 피 · 출신만의 특질은 고를 수 없다
  const fixT = new Set(fixedTraits(content, build)), chosenT = [...new Set((build.traits || []).filter((id) => !fixT.has(id)))];
  for (const id of chosenT) { const t = traitDef(content, id); if (!t) errors.push(`모르는 특질: ${id}`); else if (t.origin_only) errors.push(`${t.name}은(는) 고를 수 없다 — 그 피로 태어나야 한다`); else spent += traitCost(content, build, id); }
  if (chosenT.length > (R.trait_max ?? 2)) errors.push(`몸의 특질은 ${R.trait_max ?? 2}개까지`);
  const TT = new Set([...fixT, ...chosenT]);
  for (const [a, b] of R.trait_exclusive || []) if (TT.has(a) && TT.has(b)) errors.push(`${traitDef(content, a)?.name}과(와) ${traitDef(content, b)?.name}은(는) 한 몸에 들지 않는다`);
  const flaws = build.flaws || [];
  if (new Set(flaws).size !== flaws.length) errors.push("같은 결점을 두 번 고를 수 없다");
  let refundRaw = 0;
  for (const id of new Set([...fixedFlaws(content, build), ...flaws])) { const f = flawDef(content, id); if (!f) errors.push(`모르는 결점: ${id}`); else refundRaw += f.refund || 0; }
  const refund = Math.min(R.flaw_max, refundRaw), dice = build.dice ? R.dice_refund : 0;
  const left = R.tp + refund + dice - spent;
  if (left < 0) errors.push(`재능 포인트가 모자란다 (${-left}점)`);
  return { ok: !errors.length, errors, origin: origin?.id || null, stats, tp: { base: R.tp, refund, refundRaw, dice, spent, left, used, free: R.free_stats - used } };
}

// 마무리: 운명의 주사위와 숨은 재능을 시드로 정해 적는다 (같은 시드·같은 고름이면 같은 결과 — 화면의 미리보기와 같다)
export function finalizeBuild(content, build = {}, seed = 7) {
  const C = creationOf(content), R = C.rules;
  const out = {
    origin: originDef(content, build.origin)?.id || DEFAULT_ORIGIN,
    alloc: Object.fromEntries(Object.entries(build.alloc || {}).filter(([k, v]) => STAT_KEYS.includes(k) && Number(v) > 0).map(([k, v]) => [k, Number(v)])),
    talents: Object.fromEntries(Object.entries(build.talents || {}).filter(([id, t]) => talentDef(content, id) && t >= 1).map(([id, t]) => [id, Math.min(3, Number(t))])),
    traits: [...new Set([...fixedTraits(content, build), ...(build.traits || [])].filter((id) => traitDef(content, id)))],
    flaws: [...new Set([...fixedFlaws(content, build), ...(build.flaws || [])].filter((id) => flawDef(content, id)))],
    dice: !!build.dice,
  };
  if (out.dice) out.diceResult = rollDice(content, out, seed);
  const owned = new Set([...Object.keys(out.talents), out.diceResult?.talent].filter(Boolean));
  const pool = C.talents.filter((t) => (t.grow || []).length && !owned.has(t.id)).map((t) => t.id).sort((a, b) => hash(seed, "hidden", a) - hash(seed, "hidden", b));
  out.hidden = pool.slice(0, R.hidden || 0);
  return out;
}
export function rollDice(content, build, seed) {
  const C = creationOf(content), R = C.rules, T = C.talents;
  if (!T.length) return null;
  let i = Math.floor(hash(seed, "dice") * T.length), res = null;
  for (let n = 0; n < T.length && !res; n++, i = (i + 1) % T.length) {
    const t = T[i], cur = build.talents?.[t.id] || 0;
    if (cur < 3) res = { talent: t.id, tier: cur + 1, from: cur };
  }
  if (res && hash(seed, "dice", "flaw") < (R.dice_flaw ?? 0.3)) {
    const have = new Set([...(build.flaws || []), ...fixedFlaws(content, build)]);
    const F = C.flaws.filter((f) => !have.has(f.id));
    if (F.length) res.flaw = F[Math.floor(hash(seed, "dice", "which") * F.length)].id;
  }
  return res;
}

// 재능의 최종 등급 (생성 + 주사위). 회차 안의 깨어남·드러남은 엔진이 더한다
export function buildTalents(build) {
  const out = { ...(build?.talents || {}) };
  const d = build?.diceResult;
  if (d?.talent) out[d.talent] = Math.max(out[d.talent] || 0, d.tier || 1);
  return out;
}
export const buildFlaws = (build) => [...new Set([...(build?.flaws || []), ...(build?.diceResult?.flaw ? [build.diceResult.flaw] : [])])];

// 탄생 서사 한 줄 (06 §10): 출신의 별칭 + 가장 높은 재능 둘의 한 줄
export function birthLine(content, build) {
  const o = originDef(content, build?.origin);
  const tl = Object.entries(buildTalents(build)).map(([id, t]) => ({ T: talentDef(content, id), t })).filter((x) => x.T?.line).sort((a, b) => b.t - a.t || tierCost(content, b.T.id, b.t) - tierCost(content, a.T.id, a.t));
  const bits = tl.slice(0, 2).map((x) => x.T.line);
  const flaw = buildFlaws(build).map((id) => flawDef(content, id)?.name).filter(Boolean)[0];
  return `${o?.title || "회색여울의 아이"}.${bits.length ? ` ${bits.join(". ")}.` : ""}${flaw ? ` 그리고 — ${flaw}.` : ""}`;
}

// 화면이 받는 것: 규칙·출신(고를 때 보이는 것만)·재능·특질·결점
export function creationView(content) {
  const C = creationOf(content);
  return {
    rules: C.rules,
    origins: C.origins.map((o) => ({ id: o.id, name: o.name, title: o.title, canon: !!o.canon, difficulty: o.difficulty, blurb: o.blurb, start: o.start, stats: o.stats, skills: o.skills, perks: o.perks || [], burdens: o.burdens || [], presets: o.presets || [], items: (o.items || []).map((i) => i.name || content?.game?.economy?.goods?.[i.gid]?.name || i.gid), coin: o.coin ?? 0,
      region: o.region || "회색여울", branch: (o.settlement || "greyford") === "greyford" && o.family !== false, scenario: o.scenario || null, age: o.age || 17, time: o.time || "18:00", place: o.place || null, call: o.call || "셋째",
      flaws: o.flaws || [], traits: o.traits || [], discount: o.trait_discount || {} })),
    talents: C.talents.map((t) => ({ id: t.id, name: t.name, area: t.area, size: t.size, skills: t.skills || {}, grow: t.grow || [], tiers: t.tiers || [], line: t.line || "", cost: (C.rules.cost[t.size] || C.rules.cost.major) })),
    traits: C.traits, flaws: C.flaws,
  };
}
