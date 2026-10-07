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
  e -= (D.literacy || 0) * 0.05;   // 글을 아는 마을은 쪽지로 말한다 — 시끄러운 전령이 준다
  if ((D.order ?? 50) < 30) e += 5; // 질서가 무너지면 입이 가볍다
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
export function loyaltyOf(g, D, H) { if (!D.steward) return 0; return (H.stewards()[D.steward]?.loyalty || 0) + Math.round(H.relOf(g, D.steward).trust / 2); }
// 질서 (09 §4): 관리자의 솜씨와 원칙, 사기, 글
export function orderOf(g, D, H) {
  const S = H.stewards()[D.steward] || {};
  return Math.max(0, Math.min(100, Math.round(25 + (S.skill || 0) * 0.4 + (S.principle === "냉혹" ? 10 : 0) + ((D.morale ?? 50) - 50) * 0.4 + (D.literacy || 0) * 0.1 + (D.orderMod || 0))));
}
export function defenseOf(g, D, H) { const fac = H.facilities(); return (D.defense || 0) + D.built.reduce((a, f) => a + (fac[f]?.defense || 0), 0); }
// 관리자가 죽으면 후임 다툼 (09 §6.3): 살아 있고 너를 믿는 후보 가운데 솜씨가 가장 나은 사람. 없으면 비어 있다
export function successorOf(g, D, H) {
  return Object.entries(H.stewards()).filter(([n]) => n !== D.steward && !g.S.dead.has(n) && H.relOf(g, n).trust >= 10).sort((a, b) => (b[1].skill || 0) - (a[1].skill || 0))[0]?.[0] || null;
}

// 하루: 먹을 것, 들어오는 사람, 사기, 드러남. 드러남이 임계값을 이틀 넘으면 수색대
export function domainDay(g, day, H) {
  const D = g.domain; if (!D || D.lost) return null;
  const pop = popOf(g, D);
  if (pop <= 0) { D.lost = true; return "empty"; }
  const winter = day * 1440 >= H.winterStart, fac = H.facilities();
  D.food = Math.max(0, D.food - pop * (winter ? 0.7 : 0.4) + D.built.reduce((a, f) => a + (fac[f]?.food || 0), 0));
  // 공사 (09 §5 노동): 짓는 데 날이 든다 — 다 지으면 다음 보고에 올라온다
  if (D.building && g.t >= D.building.until) { const f = D.building.id; D.built.push(f); D.morale = Math.min(100, D.morale + (fac[f]?.morale || 0)); (D.news ??= []).push(`${fac[f]?.name || f}을(를) 다 지었다`); D.building = null; }
  // 관리자가 죽었다
  if (D.steward && g.S.dead.has(D.steward)) {
    const dead = D.steward, next = successorOf(g, D, H);
    D.steward = next; D.delegation = "direct"; D.morale = Math.max(0, D.morale - 12);
    (D.news ??= []).push(next ? `${H.displayName(g, dead)}이(가) 죽었다. 후임 다툼 끝에 ${H.displayName(g, next)}이(가) 맡았다` : `${H.displayName(g, dead)}이(가) 죽었다. 맡을 사람이 없다 — 네가 직접 정해야 한다`);
    return "steward";
  }
  D.order = orderOf(g, D, H);
  if (D.order < 30 && H.hash(g.seed, "desert", day) < 0.15) { addPop(g, D, -1); (D.news ??= []).push("질서가 무너졌다 — 밤사이 하나가 떠났다"); }
  if (D.policy === "open" && H.hash(g.seed, "inflow", day) < 0.5) addPop(g, D, 1);
  if (D.food <= 0) { D.morale = Math.max(0, D.morale - 4); if (H.hash(g.seed, "starve", day) < 0.3) addPop(g, D, -1); }
  if (D.built.includes("school")) D.literacy = Math.min(100, D.literacy + 0.3 + (fac.school?.literacy || 0) * 0.05);
  // 관리자가 만드는 이야기 (§6.3): 맡겼다면 관리자의 신념대로
  const S = H.stewards()[D.steward] || {}, loy = loyaltyOf(g, D, H);
  if (D.delegation === "full") { D.policy = S.belief === "생존" && exposureOf(g, D, H) > THRESHOLD - 15 ? "close" : S.belief === "해방" ? "open" : D.policy; }
  if (loy < (D.kinship ? -20 : 0) && (S.ambition || 0) >= 50 && !D.usurped) { D.usurped = true; return "usurp"; }   // 연좌제: 배신이 훨씬 어려워진다
  if (D.orderMod) D.orderMod = Math.max(0, D.orderMod - 0.2);   // 본보기의 효과는 천천히 옅어진다
  // 관리자가 만드는 이야기 (09 §6.3) — 이레에 한 번, 신념과 원칙대로. 흔들리는 선택: 지난 회차와 같다는 보장이 없다
  if (D.steward && day % 7 === 3 && H.hash(g.seed, "steward", D.steward, day) < 0.6) {
    const E0 = exposureOf(g, D, H), news = (D.news ??= []);
    if (S.belief === "생존" && S.principle === "신중함" && E0 > THRESHOLD - 10) {
      if (loy < 20) { H.wantedAdd?.(g, 2, `${H.displayName(g, D.steward)}이(가) 공동체를 지키려고 너를 밀고했다`); news.push(`${H.displayName(g, D.steward)}이(가) 초소에 다녀왔다. 언덕을 지키려고 — 너를 팔았다`); }
      else { addPop(g, D, -2); D.expMod = (D.expMod || 0) - 6; news.push(`${H.displayName(g, D.steward)}이(가) 새로 온 둘을 내쫓았다. 발자국을 줄이려고`); }
    } else if (S.belief === "복수" && S.principle === "대담함") {
      D.expMod = (D.expMod || 0) + 15; D.morale = Math.min(100, D.morale + 5); news.push(`${H.displayName(g, D.steward)}이(가) 허락 없이 감독관 초소를 쳤다. 언덕이 환호한다. 언덕이 너무 잘 보인다`);
    } else if (S.belief === "이익" && loy < 0) {
      D.expMod = (D.expMod || 0) + 8; D.food += 20; news.push(`${H.displayName(g, D.steward)}이(가) 용인 상인과 몰래 거래했다. 곡식이 늘었다. 누가 무엇을 팔았는지는 모른다`);
    } else if ((S.skill || 0) >= 60 && loy >= 40 && D.delegation === "full") {
      addPop(g, D, 3); D.expMod = (D.expMod || 0) + 2; news.push(`${H.displayName(g, D.steward)}이(가) 네가 없는 동안 셋을 더 들였다. 잘 해냈다. 너무 잘`);
    }
  }
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
  return { at: H.placeName(g, D.at), stage: stageName(g, D), pop: popOf(g, D), foodDays: Math.round(D.food / Math.max(1, popOf(g, D) * 0.4)), defense: defenseOf(g, D, H),
    building: D.building ? { name: fac[D.building.id]?.name || D.building.id, days: Math.max(0, Math.ceil((D.building.until - g.t) / 1440)) } : null,
    conceal: (H.sites()[D.at]?.conceal || 0) + D.built.reduce((a, f) => a + (fac[f]?.conceal || 0), 0), morale: Math.round(D.morale), order: D.order, literacy: Math.round(D.literacy),
    exposure: D.open ? 100 : exposureOf(g, D, H), threshold: THRESHOLD, steward: D.steward ? H.displayName(g, D.steward) : "(비어 있다)", loyalty: loyaltyOf(g, D, H), delegation: D.delegation, policy: D.policy,
    built: D.built.map((f) => fac[f]?.name || f), lost: D.lost };
}
