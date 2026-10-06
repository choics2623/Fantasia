// 살아 있는 세계 (27_LIVING_WORLD.md) — 일과(24)와 목표 행동(26) 위에 얹는 '반응' 층.
//
// 일과는 싸고 예측 가능하다. 그러나 대본에 없는 일(플레이어가 하겐을 죽였다)에는 아무도 반응하지 않는다.
// 이 층은 '일어난 일'을 자극으로 세계에 뿌린다:
//   자극(살해·시체·물건을 보임·팔기) → 그 자리에 실제로 있는 사람만 지각 판정 → 믿음(본 것·들은 것·추론한 것)
//   → 성향(sim 프로필)과 마음(ties)으로 행동을 고른다 (보고·침묵·협박·복수·소문) → 그 행동이 다시 위치(덮어쓰기)와 자극이 된다.
// 소문은 사람이 모이는 곳에서 사람 사이로만 퍼진다. 시체는 누군가 그 자리에 가야 발견된다. 물건은 소유 이력을 끌고 다닌다.
// 결정적이다: 같은 회차 시드 + 같은 플레이어 행동 = 같은 결과. 플레이어가 아무것도 안 하면 이 층은 조용하다 (정본이 흔들리지 않는다).
import { fmt } from "./calendar.mjs";
import { josa } from "./text.mjs";

function hash(...parts) {
  let h = 2166136261 >>> 0;
  for (const ch of parts.join("|")) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const TICK = 30;              // 분. 지각·발견 판정 간격 (활성 고장만)
const NIGHT = (t) => { const m = ((t % 1440) + 1440) % 1440; return m >= 21 * 60 || m < 5 * 60; };

export function createLivingWorld({ world, state, agenda, inventories = {}, sim = {}, cards = {}, loopSeed = 1, active = null, startAt }) {
  const P = sim.profiles || {}, D = sim.defaults || {};
  const homeSettlement = (n) => world.loc.get(world.where(n, startAt).at)?.settlement || world.loc.get(n)?.settlement;
  const DS = sim.defaults_by_settlement || {};
  const profCache = new Map();
  const prof = (n) => {
    if (profCache.has(n)) return profCache.get(n);
    const home = DS[homeSettlement(n)] || {};   // 지역마다 기본값이 다르다 (회색여울 농노의 윗선은 즈닉)
    const p = { perception: 50, nerve: 50, talk: 0.4, greed: 0.4, duty: 0.4, report_to: [], ...D, ...home, ...(P[n] || {}), ties: { ...(P[n]?.ties || {}) } };
    profCache.set(n, p); return p;
  };
  const social = new Set(sim.social_places || []);
  let activeSet = active ? new Set(active) : null;
  let now = startAt, seq = 0;
  const queue = [];                      // {t, seq, fn}
  const beliefs = (state.beliefs ??= new Map());   // npc → Map(key → belief) — 세계 상태에 둔다: 목표 행동의 'believes' 조건과 LLM 장면이 같은 것을 읽는다
  const bodies = [];                     // {npc, at, t, hidden, found}
  const items = new Map();               // id → item (+ owner, provenance, at)
  const purse = { get: (n) => state.purse[n] || 0, set: (n, v) => { state.purse[n] = v; } };   // 목표 행동과 같은 지갑
  agenda?.stepTo(startAt);              // 목표 행동의 시계를 시작 시각에 맞춘다 (첫 30분을 건너뛰지 않게)
  state.wanted ??= {};                   // 'player' → {heat, by:Set, reasons:[]}
  state.threats ??= [];                  // 협박·추적 {by, target, kind, t}

  // ── 소지품 ──
  for (const [npc, inv] of Object.entries(inventories)) {
    if (!(npc in state.purse)) state.purse[npc] = inv.coin || 0;
    for (const it of inv.worn || []) items.set(it.id, { ...it, owner: npc, worn: true, provenance: [{ owner: npc, how: "원래 주인" }] });
    for (const it of inv.stash || []) items.set(it.id, { ...it, owner: npc, worn: false, provenance: [{ owner: npc, how: "원래 주인" }] });
  }
  const origOwner = (it) => it.provenance[0].owner;
  const holding = (owner) => [...items.values()].filter((i) => i.owner === owner);

  // ── 로그 ──
  function log(t, npc, text, vis = "public") { state.log.push({ t, npc, agenda: "sim", text: josa(text), vis }); }

  // ── 큐 ──
  function schedule(t, fn) { queue.push({ t, seq: seq++, fn }); }

  // ── 누가 어디에 ──
  // 세부 수준(LOD): 활성 고장에 사는 사람 + 일정으로 드나드는 사람만 위치를 계산한다. 같은 시각은 한 번만.
  let candidates = null;
  const computeCandidates = () => (candidates = world.npcs().filter((n) => !activeSet || activeSet.has(homeSettlement(n)) || (world.hasEvents?.(n))));
  const localNpcs = () => (candidates || computeCandidates()).filter((n) => !state.dead.has(n));
  let presentCache = { t: null, v: null };
  function present(t) {
    if (presentCache.t === t) return presentCache.v;
    const byPlace = new Map();
    for (const n of localNpcs()) {
      const w = world.where(n, t);
      if (w.kind !== "at" || !w.at) continue;
      if (activeSet && !activeSet.has(w.settlement)) continue;
      for (const key of new Set([w.at, world.loc.get(w.at)?.parent].filter(Boolean))) {
        if (!byPlace.has(key)) byPlace.set(key, []);
        byPlace.get(key).push({ npc: n, exact: key === w.at, w });
      }
    }
    presentCache = { t, v: byPlace };
    return byPlace;
  }
  const tie = (a, b) => (b === "player" ? Math.round((state.rel.get(`${a}>player`)?.like || 0) / 20) : prof(a).ties[b] || 0);

  // ── 믿음 ──
  const bkey = (b) => [b.kind, b.subject, b.object, b.item, b.content].join("|");
  function has(npc, kind, pred = () => true) { return [...(beliefs.get(npc)?.values() || [])].some((b) => b.kind === kind && pred(b)); }
  function believe(npc, t, b, { react = true } = {}) {
    if (state.dead.has(npc)) return false;
    if (!beliefs.has(npc)) beliefs.set(npc, new Map());
    const m = beliefs.get(npc), k = bkey(b);
    if (m.has(k)) return false;
    if (b.kind === "missing" && has(npc, "dead", (x) => x.object === b.object)) return false;   // 이미 죽은 줄 아는 사람에게 '안 보인다'는 소식은 새롭지 않다
    const nb = { heat: 1, ...b, holder: npc, t };
    m.set(k, nb);
    infer(npc, t, nb);
    if (react) schedule(t + 5 + Math.floor(hash(loopSeed, npc, k, "delay") * 25), (tt) => decide(npc, tt, nb));
    return true;
  }
  // 추론: "하겐이 죽었다" + "그 사람이 하겐의 칼을 차고 있다" → "그 사람이 하겐을 죽였다"
  function infer(npc, t, b) {
    const m = beliefs.get(npc);
    const deadOf = (v) => has(npc, "dead", (x) => x.object === v);
    if (b.kind === "saw_kill") believe(npc, t, { kind: "suspect", subject: b.subject, object: b.object, reason: "보았다", certainty: 1, source: b.source });
    if ((b.kind === "saw_item" || b.kind === "saw_loot") && deadOf(b.object))
      believe(npc, t, { kind: "suspect", subject: b.subject, object: b.object, reason: `${items.get(b.item)?.name || "물건"}을(를) 가지고 있었다`, certainty: 0.6, source: "inferred" });
    if (b.kind === "dead") for (const x of m.values())
      if ((x.kind === "saw_item" || x.kind === "saw_loot") && x.object === b.object)
        believe(npc, t, { kind: "suspect", subject: x.subject, object: b.object, reason: `${items.get(x.item)?.name || "물건"}을(를) 가지고 있었다`, certainty: 0.6, source: "inferred" });
  }

  // ── 자극 → 지각 ──
  function emit(stim) {
    const t = stim.t, here = present(t).get(stim.at) || [];
    const light = NIGHT(t) ? 0.45 : 1;
    const seen = [];
    for (const { npc, exact } of here) {
      if (npc === stim.actor || npc === stim.target) continue;
      const pr = prof(npc);
      const p = clamp((stim.vis ?? 1) * (0.4 + pr.perception / 100) * light * (exact ? 1 : stim.loud ? 0.5 : 0), 0.0, 0.97);
      if (hash(loopSeed, "see", seq++, npc, stim.kind) >= p) continue;
      seen.push(npc);
      perceive(npc, t, stim);
    }
    return seen;
  }
  function recognizes(npc, it, boost = 1) {
    if (!it.marks?.length) return false;
    const knowsIt = (it.recognizers || []).includes(npc) || tie(npc, origOwner(it)) >= 2;
    if (!knowsIt) return false;
    return hash(loopSeed, "rec", npc, it.id, seq++) < clamp((0.35 + prof(npc).perception / 100) * boost, 0, 0.97);
  }
  function perceive(npc, t, s) {
    if (s.kind === "kill") { believe(npc, t, { kind: "dead", object: s.target, source: "saw" }); believe(npc, t, { kind: "body", object: s.target, at: s.at, source: "saw" }); believe(npc, t, { kind: "saw_kill", subject: s.actor, object: s.target, at: s.at, source: "saw" }); }
    if (s.kind === "assault") believe(npc, t, { kind: "suspect", subject: s.actor, object: s.target, reason: "덤벼드는 것을 보았다", certainty: 1, at: s.at, source: "saw", assault: true });
    if (s.kind === "trespass") believe(npc, t, { kind: "trespass", subject: s.actor, at: s.at, source: "saw" });
    if (s.kind === "loot") believe(npc, t, { kind: "saw_loot", subject: s.actor, object: origOwner(items.get(s.item)), item: s.item, at: s.at, source: "saw" });
    if (s.kind === "show_item") {
      const it = items.get(s.item);
      if (recognizes(npc, it, s.boost || 1)) believe(npc, t, { kind: "saw_item", subject: s.actor, object: origOwner(it), item: it.id, at: s.at, source: "saw" });
      if (s.actor === "player" && it.tags?.includes("무기") && prof(npc).role === "authority")
        believe(npc, t, { kind: "illegal_weapon", subject: "player", item: it.id, at: s.at, source: "saw" });
    }
  }

  // ── 행동 고르기 (효용) ──
  function decide(npc, t, b) {
    if (state.dead.has(npc)) return;
    const pr = prof(npc);
    const victim = b.object, suspect = b.subject;
    const vt = victim === npc ? 3 : victim ? tie(npc, victim) : 0;   // 당한 사람 자신은 자기 편이다
    const noise = (k) => hash(loopSeed, "dec", npc, bkey(b), k) * 0.15;
    const opts = [];
    if (b.kind === "suspect" || b.kind === "illegal_weapon" || b.kind === "trespass") {
      const fear = (1 - pr.nerve / 100) * (b.certainty === 1 ? 0.5 : 0.25);
      if (pr.role === "authority") {
        // 윗선에게 이것은 자기 땅의 질서·재산 문제다 — 의무가 낮아도 확실한 범인이면 쫓는다. 덮는 건 범인에게 마음이 있을 때뿐
        opts.push(["pursue", pr.duty + 0.3 + (b.certainty === 1 ? 0.3 : 0)]);
        opts.push(["silence", (1 - pr.duty) * 0.3 + Math.max(0, tie(npc, suspect)) * 0.3]);
      } else {
        opts.push(["report", pr.duty + Math.max(0, vt) * 0.3 - fear]);
        opts.push(["silence", (1 - pr.duty) * 0.5 + fear + (vt < 0 ? 0.4 : 0) + Math.max(0, tie(npc, suspect)) * 0.3]);
      }
      if (suspect === "player") opts.push(["blackmail", pr.greed * 0.8 * (pr.nerve / 100) + (pr.role === "fence" ? 0.2 : 0)]);
      if (vt >= 2 || pr.role === "hunter") opts.push(["avenge", pr.role === "hunter" ? 0.6 + pr.nerve / 250 : (pr.nerve / 100) * 0.9]);
      opts.push(["gossip", pr.talk * 0.7]);
    } else if (b.kind === "body") {
      opts.push(["report", pr.duty + Math.max(0, vt) * 0.3 + 0.2]);
      if ((purse.get(b.object) || 0) > 0) opts.push(["rob_body", pr.greed * (1 - pr.duty) * (vt < 0 ? 1.4 : 0.6)]);
      opts.push(["silence", (1 - pr.duty) * 0.4 + (vt < 0 ? 0.3 : 0)]);
      opts.push(["flee", (1 - pr.nerve / 100) * 0.5]);
      if (pr.role === "authority") opts.push(["pursue", pr.duty + 0.3]);
    } else if (b.kind === "missing") {
      opts.push(["search", 0.3 + Math.max(0, vt) * 0.25]);
      opts.push(["gossip", pr.talk * 0.6]);
    } else return;
    let best = null;
    for (const [k, s] of opts) { const sc = s + noise(k); if (!best || sc > best[1]) best = [k, sc]; }
    act(npc, t, b, best[0]);
  }

  const NAME = (n) => (n === "player" ? "주인공" : cards[n]?.name || n);
  function authorityFor(npc, t) {
    // 윗선이 죽었으면 그 자리를 이은 사람에게 (23 승계 — state.heirs)
    const chain = [];
    for (let a of prof(npc).report_to || []) { let guard = 0; while (state.dead.has(a) && state.heirs?.[a] && guard++ < 5) a = state.heirs[a]; chain.push(a); }
    for (const a of chain) {
      if (a === npc || state.dead.has(a)) continue;
      const w = world.where(a, t);
      if (w.kind === "at" && w.at && (!activeSet || activeSet.has(w.settlement))) return { a, w };
    }
    return null;
  }
  function goTo(npc, t, at, minutes, doing) {
    const from = world.where(npc, t).at;
    const walk = from ? world.travelMinutes(from, at) : 10;
    world.override({ npc, from: t, to: t + walk, kind: "walking", at, fromAt: from, doing: `${world.loc.get(at)?.name || at}(으)로 서둘러 간다` });
    world.override({ npc, from: t + walk, to: t + walk + minutes, kind: "at", at, doing });
    return t + walk;
  }

  function act(npc, t, b, choice) {
    const crime = b.kind === "illegal_weapon" ? "칼을 지녔다" : b.kind === "trespass" ? "들어가면 안 되는 곳에 숨어들었다" : b.assault ? `${NAME(b.object)}에게 덤벼들었다` : `${NAME(b.object)}의 죽음`;
    b.choice = choice;
    if (choice === "report") {
      const auth = authorityFor(npc, t);
      if (auth && b.kind === "body" && has(auth.a, "dead", (x) => x.object === b.object)) { b.heat = 0.5; return; }   // 윗선이 이미 안다
      if (!auth) { log(t, npc, `${NAME(npc)}은(는) 알릴 사람을 찾지 못했다`, "secret"); return; }
      const arrive = goTo(npc, t, auth.w.at, 20, `${NAME(auth.a)}에게 무언가를 알린다`);
      schedule(arrive, (tt) => {
        log(tt, npc, b.kind === "body" ? `${NAME(npc)}이(가) ${NAME(auth.a)}에게 ${NAME(b.object)}의 시체를 알렸다` : `${NAME(npc)}이(가) ${NAME(auth.a)}에게 ${NAME(b.subject)}을(를) 고했다 — ${crime}`);
        tell(npc, auth.a, tt, b, 1);
        if (b.kind === "body") believe(auth.a, tt, { kind: "dead", object: b.object, source: "told" }, { react: false });
      });
    } else if (choice === "pursue") {
      if (b.kind === "body") {
        const day = Math.floor(t / 1440) + (NIGHT(t) ? 1 : 0);
        const at = b.at;
        schedule(Math.max(t, day * 1440 + 7 * 60), (tt) => {
          const arrive = goTo(npc, tt, at, 90, "현장을 뒤진다");
          schedule(arrive, (t2) => {
            log(t2, npc, `${NAME(npc)}이(가) ${world.loc.get(at)?.name || at}을(를) 조사한다`);
            searchScene(npc, t2, at, b.object);
            const body = bodies.find((x) => x.npc === b.object && !x.removed);
            if (body) { body.removed = true; world.override({ npc: b.object, from: t2 + 90, to: null, kind: "dead", at: sim.graveyard || at, doing: "묻혔다" }); log(t2 + 90, npc, `${NAME(b.object)}의 시체를 치웠다`); }
          });
        });
        return;
      }
      const w = (state.wanted[b.subject] ??= { heat: 0, by: new Set(), reasons: [] });
      w.since ??= t;
      w.heat += b.assault ? 2 : b.certainty === 1 ? 3 : b.kind === "illegal_weapon" ? 2 : 1; w.by.add(npc); w.reasons.push(`${crime} (${b.reason || b.source})`);
      state.vars[`${b.subject}_wanted`] = w.heat;
      log(t, npc, `${NAME(npc)}이(가) ${NAME(b.subject)}을(를) 쫓기 시작했다 — ${crime}${b.reason ? " · " + b.reason : ""} (수배 ${w.heat})`);
    } else if (choice === "silence") {
      b.heat = 0; log(t, npc, `${NAME(npc)}은(는) 본 것을 입 밖에 내지 않기로 했다 — ${crime}`, "secret");
    } else if (choice === "blackmail") {
      b.heat = 0.2; state.threats.push({ by: npc, target: b.subject, kind: "blackmail", about: b.object, t });
      log(t, npc, `${NAME(npc)}이(가) ${NAME(b.subject)}의 약점을 쥐었다 — 값을 부를 것이다 (${crime})`, "secret");
    } else if (choice === "avenge") {
      state.threats.push({ by: npc, target: b.subject, kind: "hunt", about: b.object, t });
      log(t, npc, `${NAME(npc)}이(가) ${NAME(b.subject)}을(를) 노리기 시작했다 — ${crime}`);
    } else if (choice === "gossip") {
      b.heat = 1.5; log(t, npc, `${NAME(npc)}은(는) 이 이야기를 하고 싶어 입이 근질거린다`, "secret");
    } else if (choice === "rob_body") {
      const coin = purse.get(b.object) || 0; purse.set(npc, (purse.get(npc) || 0) + coin); purse.set(b.object, 0);
      log(t, npc, `${NAME(npc)}이(가) ${NAME(b.object)}의 시체에서 ${coin}못을 챙기고 입을 다물었다`, "secret");
      b.heat = 0;
    } else if (choice === "flee") {
      log(t, npc, `${NAME(npc)}은(는) 시체를 보고 달아났다 — 아무에게도 말하지 않는다`, "secret");
      b.heat = 0.5;
    } else if (choice === "search") {
      const home = world.where(b.object, t - 1)?.at || null;
      const target = bodies.find((x) => x.npc === b.object)?.at || home;
      if (target) { const arrive = goTo(npc, t, target, 60, `${NAME(b.object)}을(를) 찾는다`); schedule(arrive, (tt) => findBodies(tt, [npc], 0.8)); log(t, npc, `${NAME(npc)}이(가) ${NAME(b.object)}을(를) 찾아 나섰다`); }
    }
  }
  function tell(from, to, t, b, heat = 0.6) {
    const told = { ...b, source: "told", from, heat };
    delete told.holder; delete told.choice; delete told.t;
    believe(to, t, told);
  }
  function searchScene(npc, t, at, victim) {
    // 현장 조사: 남긴 물건을 찾고, 그 일을 본 사람을 캐묻는다.
    // 침묵하기로 한 사람도 감독관 앞에서는 겁에 질려 입을 열 수 있다 (담력이 낮을수록).
    for (const it of items.values()) if (it.at === at && it.dropped) believe(npc, t, { kind: "saw_item", subject: it.droppedBy, object: origOwner(it), item: it.id, at, source: "found" }, { react: false });
    for (const [h, m] of beliefs) {
      if (h === npc || state.dead.has(h)) continue;
      for (const x of [...m.values()]) {
        if (x.at !== at || (x.kind !== "saw_kill" && x.kind !== "saw_loot") || (victim && x.object !== victim)) continue;
        const sus = m.get(bkey({ kind: "suspect", subject: x.subject, object: x.object }));
        const choice = sus?.choice;
        const hiding = choice === "silence" || choice === "blackmail" || choice === "flee";
        if (hiding && hash(loopSeed, "break", h, npc, bkey(x)) >= (1 - prof(h).nerve / 100) * 0.6) { log(t, h, `${NAME(h)}은(는) ${NAME(npc)}이(가) 캐물어도 모른다고 했다`, "secret"); continue; }
        log(t, h, hiding ? `${NAME(h)}이(가) ${NAME(npc)}의 추궁에 무너져 본 것을 말했다` : `${NAME(h)}이(가) ${NAME(npc)}에게 본 것을 말했다`);
        tell(h, npc, t, x, 1);
      }
    }
  }
  const authorityKnows = (v) => [...beliefs].some(([h, m]) => prof(h).role === "authority" && [...m.values()].some((b) => b.kind === "dead" && b.object === v));

  // ── 시체 ──
  function findBodies(t, onlyThese = null, boost = 1) {
    const where = present(t);
    for (const body of bodies) {
      if (body.removed) continue;
      for (const { npc, exact } of where.get(body.at) || []) {
        if (!exact || (onlyThese && !onlyThese.includes(npc))) continue;
        if (has(npc, "body", (x) => x.object === body.npc)) continue;   // 한 사람은 한 번만 발견한다. 다른 사람은 또 발견할 수 있다
        const p = clamp((body.hidden ? 0.06 : 0.9) * (0.4 + prof(npc).perception / 100) * boost, 0, 0.97);
        if (hash(loopSeed, "body", body.npc, npc, Math.floor(t / TICK)) >= p) continue;
        body.found ??= { by: npc, t };
        log(t, npc, `${NAME(npc)}이(가) ${world.loc.get(body.at)?.name || body.at}에서 ${NAME(body.npc)}의 시체를 발견했다`);
        believe(npc, t, { kind: "dead", object: body.npc, source: "found" }, { react: false });
        believe(npc, t, { kind: "body", object: body.npc, at: body.at, source: "found" });
      }
    }
  }
  function missingCheck(t) {
    for (const body of bodies) {
      if (body.removed || body.missingRaised || t - body.t < 36 * 60 || authorityKnows(body.npc)) continue;
      body.missingRaised = true;
      for (const n of localNpcs()) if (tie(n, body.npc) >= 1 || prof(n).searches)
        believe(n, t, { kind: "missing", object: body.npc, source: "noticed" });
    }
  }

  // ── 소문: 사람이 모인 곳에서, 사람 사이로 ──
  const GOSSIP_KINDS = new Set(["suspect", "dead", "body", "saw_item", "missing", "claim"]);
  const anyHot = () => { for (const m of beliefs.values()) for (const b of m.values()) if (GOSSIP_KINDS.has(b.kind) && b.heat > 0.3) return true; return false; };
  function gossip(t) {
    for (const [place, people] of present(t)) {
      if (!social.has(place)) continue;
      const exact = people.filter((x) => x.exact).map((x) => x.npc);
      for (const h of exact) {
        const pr = prof(h);
        for (const b of beliefs.get(h)?.values() || []) {
          if (!GOSSIP_KINDS.has(b.kind) || b.heat <= 0.3) continue;
          for (const l of exact) {
            if (l === h || (b.subject && l === b.subject)) continue;
            const p = pr.talk * b.heat * (tie(h, l) >= 0 ? 0.35 : 0.08);
            if (hash(loopSeed, "gos", h, l, bkey(b), Math.floor(t / 60)) >= p) continue;
            if (beliefs.get(l)?.has(bkey(b))) continue;
            tell(h, l, t, b, b.heat * 0.5);
            b.heat -= 0.15;
            log(t, h, `${NAME(h)}이(가) ${world.loc.get(place)?.name || place}에서 ${NAME(l)}에게 수군댔다 — ${describe(b)}`, "rumor");
          }
        }
      }
    }
  }
  function describe(b) {
    if (b.kind === "suspect") return `${NAME(b.subject)}이(가) ${NAME(b.object)}을(를) 죽였을지 모른다`;
    if (b.kind === "dead" || b.kind === "body") return `${NAME(b.object)}이(가) 죽었다`;
    if (b.kind === "saw_item") return `${NAME(b.subject)}이(가) ${items.get(b.item)?.name}을(를) 가지고 있다`;
    if (b.kind === "missing") return `${NAME(b.object)}이(가) 보이지 않는다`;
    return b.kind;
  }
  // 물건은 주인이 바뀐 뒤에도 보인다 — 장물을 차고 다니는 NPC도 의심받는다
  function showWornHot(t) {
    const where = present(t);
    for (const it of items.values()) {
      if (!it.worn || it.visibility !== "보임" || it.owner === origOwner(it) || it.owner === "player") continue;
      const w = world.where(it.owner, t); if (w.kind !== "at") continue;
      for (const { npc, exact } of where.get(w.at) || []) if (exact && npc !== it.owner && recognizes(npc, it, 0.5))
        believe(npc, t, { kind: "saw_item", subject: it.owner, object: origOwner(it), item: it.id, at: w.at, source: "saw" });
    }
  }

  // ── 시간 ──
  function advance(toT) {
    if (toT < now) throw new Error("시간은 거꾸로 가지 않는다");
    while (now < toT) {
      const next = Math.min(toT, Math.floor(now / TICK) * TICK + TICK);
      agenda?.stepTo(next);
      // 큐: 이 구간에 일어날 반응들을 시각 순서대로 (반응이 새 반응을 낳을 수 있다)
      for (;;) {
        queue.sort((a, b) => a.t - b.t || a.seq - b.seq);
        if (!queue.length || queue[0].t >= next) break;
        const q = queue.shift(); q.fn(Math.max(q.t, now));
      }
      // 할 일이 없으면 위치를 계산하지 않는다 — 플레이어가 아무것도 안 한 고장은 공짜다
      if (bodies.some((x) => !x.removed)) findBodies(next);
      if (next % 60 === 0) {
        if (anyHot()) gossip(next);
        if ([...items.values()].some((i) => i.worn && i.visibility === "보임" && i.owner !== origOwner(i) && i.owner !== "player")) showWornHot(next);
      }
      if (next % 1440 === 6 * 60) { missingCheck(next); for (const m of beliefs.values()) for (const b of m.values()) b.heat *= 0.85; }
      now = next;
    }
  }

  // ── 플레이어 행동 ── (모두 시각을 받는다. 그 시각까지 세계를 먼저 굴린다)
  const player = {
    kill(t, victim, { at, stealth = 0 } = {}) {
      advance(t);
      const place = at || world.where(victim, t).at;
      agenda?.intervene(t, "kill", victim);
      world.override({ npc: victim, from: t, to: null, kind: "dead", at: place, doing: "죽어 있다" });
      bodies.push({ npc: victim, at: place, t, hidden: false, found: null });
      const seen = emit({ kind: "kill", t, at: place, actor: "player", target: victim, vis: clamp(1 - stealth / 100, 0.05, 1), loud: true });
      log(t, "player", `주인공이 ${world.loc.get(place)?.name || place}에서 ${NAME(victim)}을(를) 죽였다${seen.length ? " — 본 사람: " + seen.join(", ") : " — 본 사람은 없다"}`, "player");
      return seen;
    },
    // 덤볐지만 죽이지 못했다 — 당한 사람이 살아서 안다
    assault(t, victim, { at } = {}) {
      advance(t);
      const place = at || world.where(victim, t).at;
      const seen = emit({ kind: "assault", t, at: place, actor: "player", target: victim, vis: 1, loud: true });
      believe(victim, t, { kind: "suspect", subject: "player", object: victim, reason: "나에게 덤벼들었다", certainty: 1, at: place, source: "saw", assault: true });
      log(t, "player", `주인공이 ${NAME(victim)}에게 덤볐지만 쓰러뜨리지 못했다`, "player");
      return seen;
    },
    // 들어가면 안 되는 곳에 들어갔다가 들켰다
    trespass(t, at, vis = 0.7) { advance(t); return emit({ kind: "trespass", t, at, actor: "player", vis }); },
    hideBody(t, victim, { to } = {}) {
      advance(t);
      const b = bodies.find((x) => x.npc === victim); if (!b) return;
      if (to) { b.at = to; world.override({ npc: victim, from: t, to: null, kind: "dead", at: to, doing: "죽어 있다" }); }
      b.hidden = true; log(t, "player", `주인공이 ${NAME(victim)}의 시체를 숨겼다`, "player");
    },
    loot(t, victim, what = "all") {
      advance(t);
      const at = bodies.find((x) => x.npc === victim)?.at || world.where(victim, t).at;
      const got = [];
      if (what === "all" || what === "coin") { const c = purse.get(victim) || 0; purse.set("player", purse.get("player") + c); purse.set(victim, 0); if (c) got.push(`${c}못`); }
      for (const it of holding(victim)) if (it.worn && (what === "all" || what === it.id)) {
        it.owner = "player"; it.worn = false; it.provenance.push({ owner: "player", how: "시체에서 가져감", t });
        got.push(it.name);
        emit({ kind: "loot", t, at, actor: "player", item: it.id, vis: 0.6 });
      }
      log(t, "player", `주인공이 ${NAME(victim)}에게서 가져갔다: ${got.join(", ") || "없음"}`, "player");
      return got;
    },
    takeFrom(t, at, itemId) {   // 은닉처·집에서 꺼내기
      advance(t);
      const it = items.get(itemId); if (!it || it.worn || it.at !== at) return false;
      it.owner = "player"; it.at = null; it.provenance.push({ owner: "player", how: "훔침", t });
      emit({ kind: "loot", t, at, actor: "player", item: it.id, vis: 0.4 });
      return true;
    },
    // 물건을 꺼내 보이거나 차고 다닌다 — 그 자리에 있는 사람이 알아볼 수 있다
    show(t, itemId, at) { advance(t); const it = items.get(itemId); it.worn = true; it.visibility = "보임"; return emit({ kind: "show_item", t, at, actor: "player", item: itemId, vis: 0.8 }); },
    drop(t, itemId, at) { advance(t); const it = items.get(itemId); Object.assign(it, { owner: null, worn: false, at, dropped: true, droppedBy: "player" }); it.provenance.push({ owner: null, how: `${at}에 떨어뜨림`, t }); },
    // 판다: 사는 사람은 가까이서 살핀다 (알아볼 확률 ↑). 장물아비는 알아봐도 값을 깎고 입을 다문다
    sell(t, itemId, buyer, at) {
      advance(t);
      const it = items.get(itemId), pr = prof(buyer);
      const knew = recognizes(buyer, it, 1.6);
      const price = Math.round((it.value || 0) * (pr.role === "fence" ? (knew ? 0.3 : 0.5) : knew ? 0 : 0.7));
      if (knew && pr.role !== "fence") {
        believe(buyer, t, { kind: "saw_item", subject: "player", object: origOwner(it), item: it.id, at, source: "saw" });
        log(t, buyer, `${NAME(buyer)}이(가) ${it.name}을(를) 알아보고 사지 않았다`);
        return { sold: false, knew };
      }
      if (knew) { believe(buyer, t, { kind: "saw_item", subject: "player", object: origOwner(it), item: it.id, at, source: "saw" }, { react: false }); state.threats.push({ by: buyer, target: "player", kind: "leverage", about: origOwner(it), t }); }
      it.owner = buyer; it.worn = !!it.slot && it.visibility === "보임"; it.provenance.push({ owner: buyer, how: "삼", t });
      purse.set("player", purse.get("player") + price);
      log(t, buyer, `${NAME(buyer)}이(가) ${it.name}을(를) ${price}못에 샀다${knew ? " — 누구 것인지 알면서" : ""}`, knew ? "secret" : "public");
      return { sold: true, knew, price };
    },
    // 표시 지우기: 대장장이·장물아비가 녹이거나 고친다. 맡기는 순간 그 사람이 먼저 본다
    alter(t, itemId, smith, at) {
      advance(t);
      const it = items.get(itemId);
      const knew = recognizes(smith, it, 1.6);
      if (knew) believe(smith, t, { kind: "saw_item", subject: "player", object: origOwner(it), item: it.id, at, source: "saw" });
      it.marks = []; it.recognizers = []; it.provenance.push({ owner: "player", how: `${NAME(smith)}이(가) 표시를 지움`, t });
      return { knew };
    },
  };

  // 새 물건 (산 것·만든 것) — 소유 이력이 '삼'으로 시작한다
  // 플레이어가 다른 고장으로 가면 그 고장이 '활성' — 그곳 사람들이 보고, 말하고, 반응한다 (LOD)
  function setActive(list) { activeSet = new Set(list); candidates = null; presentCache = { t: null, v: null }; }
  function give(owner, def) { const it = { ...def, owner, worn: false, provenance: [{ owner, how: "삼", t: now }] }; items.set(def.id, it); return it; }
  return {
    advance, player, emit, believe, items, purse, bodies, give, setActive,
    get now() { return now; },
    beliefs: (npc) => [...(beliefs.get(npc)?.values() || [])],
    knowsAbout: (npc, kind, subject) => has(npc, kind, (b) => !subject || b.subject === subject),
    fmtLog: (vis = null) => [...state.log].filter((l) => !vis || vis.includes(l.vis || "public")).sort((a, b) => a.t - b.t).map((l) => `${fmt(l.t)}  ${l.vis && l.vis !== "public" ? "[" + l.vis + "] " : ""}${l.text}`),
  };
}
