// 영역 (09): 은닉처 → 비밀 거점 → 숨은 마을 → 해방구. 열흘마다 보고, 관리자, 드러남과 수색대.
// 세계 변수와 묶인다: 늑대굴의 머릿수 = sigrid_group (볼크의 대수색이 줄인다).
const STAGES = [[5, "은닉처", 5], [30, "비밀 거점", 15], [200, "숨은 마을", 30], [2000, "해방구", 60], [Infinity, "인간의 도시", 85]];
export const THRESHOLD = 60;   // 레이번가의 경계 임계값 (10 §5)
const stageOf = (pop) => STAGES.findIndex(([max]) => pop <= max);

export function popOf(g, D) { return D.popVar ? Math.max(0, g.S.vars[D.popVar] ?? 0) : D.pop; }
export function exposureOf(g, D, H) {
  const site = H.sites()[D.at] || {}, fac = H.facilities();
  const st = stageOf(popOf(g, D));
  const sk = H.stewards()[D.steward]?.skill || 0;
  let e = STAGES[st][2] + popOf(g, D) * 0.05 + (D.policy === "open" ? 6 : 0) + (D.expMod || 0) - (site.conceal || 0) * 0.5 - sk * 0.1;
  for (const f of D.built) e += fac[f]?.exposure || 0;
  for (const f of D.built) e -= (fac[f]?.conceal || 0) * 0.5;
  return Math.max(0, Math.round(e));
}
export function canFound(g, H) {
  if (g.domain) return null;
  for (const [at, s] of Object.entries(H.sites())) if (H.atPlace(g, at) && H.storyWhen(g, s.needs)) return at;
  return null;
}
export function found(g, at, H) {
  const s = H.sites()[at];
  g.domain = { at, popVar: s.pop_var || null, pop: s.pop || 0, steward: s.steward, food: Math.round(s.food_days * (s.pop || g.S.vars[s.pop_var] || 1) * 0.4), defense: s.defense || 0, morale: s.morale || 40, order: 50, literacy: 0, built: [], policy: "close", delegation: "direct", since: g.t, nextReport: g.t + 10 * 1440, alarm: 0, lost: false };
}
export function loyaltyOf(g, D, H) { return (H.stewards()[D.steward]?.loyalty || 0) + Math.round(H.relOf(g, D.steward).trust / 2); }

// 하루: 먹을 것, 들어오는 사람, 사기, 드러남. 드러남이 임계값을 이틀 넘으면 수색대
export function domainDay(g, day, H) {
  const D = g.domain; if (!D || D.lost) return null;
  const pop = popOf(g, D);
  if (pop <= 0) { D.lost = true; return "empty"; }
  const winter = day * 1440 >= H.winterStart;
  D.food = Math.max(0, D.food - pop * (winter ? 0.7 : 0.4));
  if (D.policy === "open" && H.hash(g.seed, "inflow", day) < 0.5) addPop(g, D, 1);
  if (D.food <= 0) { D.morale = Math.max(0, D.morale - 4); if (H.hash(g.seed, "starve", day) < 0.3) addPop(g, D, -1); }
  if (D.built.includes("school")) D.literacy = Math.min(100, D.literacy + 0.3);
  // 관리자가 만드는 이야기 (§6.3): 맡겼다면 관리자의 신념대로
  const S = H.stewards()[D.steward] || {}, loy = loyaltyOf(g, D, H);
  if (D.delegation === "full") { D.policy = S.belief === "생존" && exposureOf(g, D, H) > THRESHOLD - 15 ? "close" : S.belief === "해방" ? "open" : D.policy; }
  if (loy < 0 && (S.ambition || 0) >= 50 && !D.usurped) { D.usurped = true; return "usurp"; }
  const E = exposureOf(g, D, H);
  D.alarm = E >= THRESHOLD ? D.alarm + 1 : 0;
  if (D.alarm >= 2) { D.alarm = 0; return "raid"; }
  if (g.t >= D.nextReport) { D.nextReport += 10 * 1440; return "report"; }
  return null;
}
export function addPop(g, D, n) { if (D.popVar) g.S.vars[D.popVar] = Math.max(0, (g.S.vars[D.popVar] || 0) + n); else D.pop = Math.max(0, D.pop + n); }
export function stageName(g, D) { return D.chartered ? "공인 영지" : D.open ? "해방구" : STAGES[stageOf(popOf(g, D))][1]; }
export function domainView(g, H) {
  const D = g.domain; if (!D) return null;
  const fac = H.facilities();
  return { at: H.placeName(g, D.at), stage: stageName(g, D), pop: popOf(g, D), foodDays: Math.round(D.food / Math.max(1, popOf(g, D) * 0.4)), defense: D.defense + D.built.reduce((a, f) => a + (fac[f]?.defense || 0), 0),
    conceal: (H.sites()[D.at]?.conceal || 0) + D.built.reduce((a, f) => a + (fac[f]?.conceal || 0), 0), morale: Math.round(D.morale), order: D.order, literacy: Math.round(D.literacy),
    exposure: D.open ? 100 : exposureOf(g, D, H), threshold: THRESHOLD, steward: H.displayName(g, D.steward), loyalty: loyaltyOf(g, D, H), delegation: D.delegation, policy: D.policy,
    built: D.built.map((f) => fac[f]?.name || f), lost: D.lost };
}
