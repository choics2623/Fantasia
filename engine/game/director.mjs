// 연출가 (18): 확정·인과는 건드리지 않고, 선택적 장면(소품·전조·결핍·기회·위협)만 고른다.
// 긴장도 T = 위험 D + 결핍 H + 위협 W + 상실 L + 시계 C + 여진 A (§3.3), 목표 곡선 다섯 단계 (§3.5), 화자 넷 (§4).
// 연출 난수는 판정 난수와 따로 굴린다 — 화자를 바꿔도 주사위는 같다.
// game.mjs가 도우미(H)를 넘긴다: 이 파일은 세계 상태를 직접 만들지 않는다.

export const NARRATORS = {
  silent_god: { name: "침묵하는 신", base: 30, peak: 75, calmDays: 4, buildDays: 6, breather: 0.6, dip: 10, slots: 2, hookRate: 0.6, buffer: 2,
    mult: { threat: 1.0, lack: 1.4, opportunity: 0.8, bond: 0.9, omen: 0.6, calm: 1.2 } },
  ash_teller: { name: "재의 화자", base: 25, peak: 90, calmDays: 2, buildDays: 3, breather: 0.4, dip: 5, slots: 3, hookRate: 0.85, buffer: 1,
    mult: { threat: 1.6, lack: 0.8, opportunity: 1.2, bond: 1.0, omen: 1.5, calm: 0.5 } },
  old_teller: { name: "늙은 이야기꾼", base: 20, peak: 65, calmDays: 5, buildDays: 4, breather: 1.2, dip: 15, slots: 3, hookRate: 0.7, buffer: 5,
    mult: { threat: 0.6, lack: 0.8, opportunity: 1.4, bond: 1.6, omen: 1.2, calm: 1.0 } },
  dice: { name: "주사위", base: null, peak: null, slots: 2, hookRate: 0.7, buffer: 0,
    mult: { threat: 1, lack: 1, opportunity: 1, bond: 1, omen: 1, calm: 1 } },
};
export const narratorOf = (g) => NARRATORS[g.narrator || g.run.narrator || "silent_god"] || NARRATORS.silent_god;
const RAISE = new Set(["threat", "lack", "omen"]), LOWER = new Set(["calm", "bond", "opportunity"]);

// ── 긴장도 (§3.3) — 플레이어에게 숫자로 보이지 않는다 ──
export function tensionRaw(g, H) {
  const p = g.P.status;
  const D = Math.min(30, (p.pain >= 75 ? 22 : p.pain >= 50 ? 12 : p.pain >= 30 ? 4 : 0) + [0, 0, 2, 5, 8, 8][p.fear || 0] + (Object.values(g.nem || {}).some((x) => x.track >= 3) ? 10 : 0));
  const Hh = Math.min(20, (p.hunger >= 4 ? 12 : p.hunger >= 3 ? 6 : 0) + (p.fatigue >= 85 ? 6 : p.fatigue >= 60 ? 3 : 0));
  const W = Math.min(20, (g.S.wanted?.player?.heat || 0) * 3 + (g.hide && !g.hide.lost && g.hide.exposure > 0.6 ? 5 : 0));
  const L = Math.min(15, (g.dir?.losses || []).reduce((a, x) => a + x.w * Math.max(0, 1 - (g.t - x.t) / (30 * 1440)), 0));
  let C = 0;
  for (const x of H.goals(g)) if (x.days != null && x.days <= 7) C = Math.max(C, 15 * (1 - x.days / 7));
  const last = H.soul(g).records?.slice(-1)[0];
  if (last && last.kind !== "alive") { const d = (last.endT - g.t) / 1440; if (d > 0 && d <= 7) C = Math.max(C, 15 * (1 - d / 7)); }
  const lc = g.dir?.lastCrisis;
  const A = lc ? 15 * (lc.sev / 5) * Math.exp(-((g.t - lc.t) / 1440) / 2) : 0;
  return Math.max(0, Math.min(100, Math.round(D + Hh + W + L + C + A)));
}
// 장면이 끝날 때마다 반감 평활
export function updateTension(g, H) { const d = (g.dir ??= newDir(g)); d.T = Math.round(d.T + 0.5 * (tensionRaw(g, H) - d.T)); return d.T; }
const newDir = (g) => ({ phase: "calm", since: Math.floor(g.t / 1440), T: 10, lastCrisis: null, losses: [], used: {} });

// ── 목표 곡선 (§3.5): 고요 → 쌓임 → 정점 → 여진 → 숨 고르기 → 고요 ──
export function targetT(g) {
  const N = narratorOf(g), d = g.dir; if (N.base == null || !d) return null;
  const days = Math.floor(g.t / 1440) - d.since;
  if (d.phase === "calm") return N.base;
  if (d.phase === "build") return Math.round(N.base + (N.peak - N.base) * Math.min(1, days / N.buildDays));
  if (d.phase === "peak") return N.peak;
  if (d.phase === "aftershock") return d.T;
  return N.base - N.dip;   // breather
}
export function directorDay(g, day) {
  const N = narratorOf(g), d = (g.dir ??= newDir(g));
  if (N.base == null) return;
  const days = day - d.since, go = (ph) => { d.phase = ph; d.since = day; };
  if (d.phase === "calm" && days >= N.calmDays) go("build");
  else if (d.phase === "build" && days >= N.buildDays) go("peak");
  else if (d.phase === "peak" && days >= N.buildDays) go("calm");     // 정점 대기 상한 — 세계가 조용하면 조용한 것이다
  else if (d.phase === "aftershock" && days >= 1) go("breather");
  else if (d.phase === "breather" && days >= Math.ceil(N.breather * (d.lastCrisis?.sev || 3))) go("calm");
}
// 위기 (§3.4): 심각도 3 이상이 끝나면 여진 → 숨 고르기. 자초한 위험도 정점이다
export function crisis(g, sev) {
  const d = (g.dir ??= newDir(g));
  if (sev >= 3) { d.lastCrisis = { t: g.t, sev }; d.phase = "aftershock"; d.since = Math.floor(g.t / 1440); }
}
export function loss(g, w) { (g.dir ??= newDir(g)).losses.push({ t: g.t, w }); }

// ── 표면화 (§3.6): 슬롯이 남았고, 목표와의 차이가 가리키는 쪽의 장면을, 화자의 배율로 ──
export function pickScene(g, t, H) {
  const N = narratorOf(g), d = (g.dir ??= newDir(g));
  const day = Math.floor(t / 1440);
  if ((d.used[day] || 0) >= N.slots) return null;
  // 되감김 완충 (§6.3): 회귀 직후 며칠은 연출 기원 사건이 없다
  if (g.run.loop >= 2 && t < H.START + N.buffer * 1440 && N.buffer) return null;
  const T = d.T, T0 = targetT(g);
  const gap = T0 == null ? 0 : T0 - T;
  if (d.phase === "aftershock") return null;
  const hm = ((t % 1440) + 1440) % 1440;
  const cands = [];
  for (const st of g.content.game.storylets || []) {
    const tr = st.trigger || {};
    if (!(tr.vignette || tr.director) || g.storyDone.has(st.id) || !H.atPlace(g, tr.at)) continue;
    if (H.storyFor && !H.storyFor(g, st)) continue;   // 다른 출신의 장면 · 출신이 뺀 장면 · 셋째의 가족 장면
    if (tr.hours && !(hm >= H.parseClock(tr.hours[0]) && hm < H.parseClock(tr.hours[1]))) continue;
    if (tr.rain && !g.W.rainy(day)) continue;
    if (tr.night && !H.isNight(t)) continue;
    if (!H.storyWhen(g, tr.when, t)) continue;
    const cat = tr.category || "calm";
    let w = (tr.chance ?? 0.3) * (N.mult[cat] ?? 1);
    if (T0 != null) {
      if (gap > 10 && LOWER.has(cat) && cat !== "opportunity") w *= 0.4;
      if (gap > 10 && RAISE.has(cat)) w *= 1.5;
      if (gap < -10 && RAISE.has(cat)) w *= cat === "omen" ? 0.5 : 0.15;   // 숨 고르기: 위협은 거의 없다
      if (d.phase === "breather" && (cat === "bond" || cat === "opportunity")) w *= 1.5;
      if (cat === "calm" && T >= 40) w *= 0.3;
    }
    cands.push({ st, w: Math.min(0.95, w) });
  }
  // 고르기: 후보마다 따로 굴리면 콘텐츠 앞쪽 장면이 늘 이긴다. 그래서 '이 반시간에 무슨 일이든 일어날 확률'은
  // 그대로 두고 (1 − Π(1 − w)), 무엇이 일어날지는 가중 추첨으로 정한다.
  // 신선함: 이틀 안에 같은 갈래가 나왔으면 ×0.5, 닷새 넘게 안 나온 갈래는 ×1.3, 사흘 안에 같은 자리에서 나왔으면 ×0.7
  if (!cands.length) return null;
  const slot = Math.floor(t / 30);
  const pAny = 1 - cands.reduce((a, c) => a * (1 - c.w), 1);
  if (H.hash(g.seed, "director", slot) >= pAny) return null;
  const recent = d.recent || [];
  const catOf = (st) => st.trigger?.category || "calm", atOf = (st) => [].concat(st.trigger?.at || [])[0] || null;
  const fresh = (st) => {
    const lc = recent.filter((r) => r.cat === catOf(st)).pop(), la = atOf(st) && recent.filter((r) => r.at === atOf(st)).pop();
    let f = lc && t - lc.t < 2 * 1440 ? 0.5 : !lc || t - lc.t > 5 * 1440 ? 1.3 : 1;
    if (la && t - la.t < 3 * 1440) f *= 0.7;
    return f;
  };
  const ws = cands.map((c) => c.w * fresh(c.st)), sum = ws.reduce((a, b) => a + b, 0);
  let r = H.hash(g.seed, "director-pick", slot) * sum, pick = cands[cands.length - 1];
  for (const [i, c] of cands.entries()) { r -= ws[i]; if (r <= 0) { pick = c; break; } }
  d.used[day] = (d.used[day] || 0) + 1;
  (d.recent ??= []).push({ id: pick.st.id, cat: catOf(pick.st), at: atOf(pick.st), t });
  if (d.recent.length > 12) d.recent.shift();
  return pick.st;
}
// 갈고리 비율 (§4.2): 화자마다 갈고리가 나오는 밤의 비율이 다르다
export const hookAllowed = (g, H, day) => H.hash(g.seed, "hookrate", day) < narratorOf(g).hookRate;
// 지난 이야기의 목소리 (§4.3)
export function recapVoice(g, lines, H) {
  const id = g.narrator || g.run.narrator || "silent_god";
  if (id === "old_teller") { const t = H.threads(g)[0]; if (t) lines.push(`할 수 있는 일 — ${t.text}`); }
  if (id === "ash_teller" && lines.length > 1) lines.splice(1, 0, "불길한 것부터 말하마.");
  return lines;
}
