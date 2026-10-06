// NPC 실시간 위치 (24_PLACES_AND_WHEREABOUTS.md §3).
//
// 위치는 "시간의 함수"다. 세계를 1분씩 돌리지 않는다 — 어느 시각이든 바로 계산한다.
//   where(npc, t) = 덮어쓰기(죽음·포로·장면) > 날짜 일정(+이동) > 체류 기간 밖(부재) > 일과(+표류·날씨·걷기) > 집
// 같은 회차 시드 → 같은 답. 회귀하면 시드만 바뀌어 작은 일이 어긋난다 (03 표류).
import { fromMinutes, parseClock, parseDate, toMinutes, isSabbath, weekday } from "./calendar.mjs";

// ── 결정적 난수 ──
function hash(...parts) {
  let h = 2166136261 >>> 0;
  for (const ch of parts.join("|")) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const WALK_M_PER_MIN = 80;

export function createWorld(bundle, { loopSeed = 1, flags = {} } = {}) {
  const { settlements, routines, events, map } = bundle;
  const overrides = new Map();   // npc → [덮어쓰기…] (사람별 색인 — 수천 명이 되어도 where()가 느려지지 않게)
  let condFn = null;             // 일정의 when 조건을 판정할 함수 (목표 행동 엔진이 넣어 준다)
  const eventsByNpc = new Map();
  for (const ev of events) for (const n of ev.npcs) { if (!eventsByNpc.has(n)) eventsByNpc.set(n, []); eventsByNpc.get(n).push(ev); }

  // ── 장소 색인 ──
  const loc = new Map();      // id → { id, name, settlement, xy, node, outerHours, parent }
  const nodeIds = new Set(map.nodes.map((n) => n.id));
  for (const s of Object.values(settlements)) {
    for (const l of s.locations || []) loc.set(l.id, { ...l, settlement: s.id, node: s.node });
    for (const l of s.locations || []) if (!l.xy && l.parent) loc.get(l.id).xy = loc.get(l.parent)?.xy;
    for (const o of s.outer || []) loc.set(o.id, { ...o, settlement: s.id, outer: true, node: o.node || s.node, outerHours: o.hours });
  }
  for (const n of map.nodes) if (!loc.has(n.id)) loc.set(n.id, { id: n.id, name: n.name, node: n.id, region: true });
  const exists = (id) => loc.has(id);
  const nodeOf = (id) => loc.get(id)?.node || (nodeIds.has(id) ? id : null);

  // ── 지역 경로 (다익스트라, 시간 단위) ──
  const adj = new Map();
  for (const e of map.edges) {
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push({ to: b, hours: e.hours });
    }
  }
  const routeCache = new Map();
  function route(a, b) {
    const key = a + ">" + b;
    if (routeCache.has(key)) return routeCache.get(key);
    const dist = new Map([[a, 0]]), prev = new Map(), todo = new Set([a]);
    while (todo.size) {
      let u = null; for (const x of todo) if (u === null || dist.get(x) < dist.get(u)) u = x;
      todo.delete(u); if (u === b) break;
      for (const { to, hours } of adj.get(u) || []) {
        const d = dist.get(u) + hours;
        if (d < (dist.get(to) ?? Infinity)) { dist.set(to, d); prev.set(to, u); todo.add(to); }
      }
    }
    const path = [b]; while (path[0] !== a && prev.has(path[0])) path.unshift(prev.get(path[0]));
    const r = path[0] === a ? { path, hours: dist.get(b) } : null;
    routeCache.set(key, r);
    return r;
  }

  // 두 장소 사이를 걷는 시간(분)
  function travelMinutes(a, b) {
    if (!a || !b || a === b) return 0;
    const A = loc.get(a), B = loc.get(b);
    if (!A || !B) return 0;
    if (A.parent === b || B.parent === a || (A.parent && A.parent === B.parent)) return 2;
    if (A.xy && B.xy && A.settlement === B.settlement) return Math.round(Math.hypot(A.xy[0] - B.xy[0], A.xy[1] - B.xy[1]) / WALK_M_PER_MIN);
    if (A.settlement && A.settlement === B.settlement) {
      const ha = A.outerHours || 0, hb = B.outerHours || 0;
      return Math.round((A.node === B.node ? Math.abs(ha - hb) + 0.5 : ha + hb) * 60);
    }
    const r = route(nodeOf(a), nodeOf(b));
    return r ? Math.round(r.hours * 60) : 0;
  }

  // ── 날씨 (간단한 결정적 모델) ──
  const RAIN_P = { 9: 0.35, 10: 0.3, 11: 0.25, 12: 0.2, 1: 0.3, 2: 0.3, 3: 0.35, 4: 0.3, 5: 0.2, 6: 0.15, 7: 0.15, 8: 0.2, 13: 0.1 };
  function rainy(day) {
    const c = fromMinutes(day * 1440);
    if (c.y === 312 && c.m === 9 && c.d <= 3) return true; // 정본: "비가 사흘째" — 회귀점의 사실
    return hash(loopSeed, "rain", day) < (RAIN_P[c.m] ?? 0.2);
  }

  // ── 일과 ──
  function dayApplies(spec, day) {
    const c = fromMinutes(day * 1440);
    if (spec === "all") return true;
    if (spec === "workday") return !isSabbath(day);
    if (spec === "sabbath") return isSabbath(day);
    if (spec === "odd") return c.d % 2 === 1 && !isSabbath(day);
    if (spec === "even") return c.d % 2 === 0 && !isSabbath(day);
    const m = /^(weekday|monthday):\[(.*)\]$/.exec(spec);
    if (m) { const list = m[2].split(",").map(Number); return m[1] === "weekday" ? list.includes(weekday(day)) : list.includes(c.d); }
    return false;
  }
  const SPECIFIC = (spec) => (spec.startsWith("monthday") ? 5 : spec.startsWith("weekday") || spec === "odd" || spec === "even" ? 4 : spec === "sabbath" ? 3 : spec === "workday" ? 2 : 1);

  // 그 분(minute)을 덮는 일과 블록들 중 가장 구체적인 것. 자정을 넘는 블록은 전날 것을 본다.
  function coveringBlock(r, day, m) {
    let best = null;
    (r.blocks || []).forEach((b, idx) => {
      const f = parseClock(b.from), to = parseClock(b.to);
      let hit = null;
      if (to > f) { if (m >= f && m < to && dayApplies(b.days, day)) hit = { start: day * 1440 + f, end: day * 1440 + to }; }
      else {
        if (m >= f && dayApplies(b.days, day)) hit = { start: day * 1440 + f, end: (day + 1) * 1440 + to };
        else if (m < to && dayApplies(b.days, day - 1)) hit = { start: (day - 1) * 1440 + f, end: day * 1440 + to };
      }
      if (!hit) return;
      const score = SPECIFIC(b.days) * 1000 + idx; // 같은 구체성이면 뒤에 적은 것이 이긴다
      if (!best || score > best.score) best = { b, idx, score, ...hit };
    });
    return best;
  }

  // 승계(23): 자리를 이은 사람은 그 시각부터 전임자의 일과를 산다 (오웬이 남작이 되면 서재와 판결이 오웬의 것)
  const inherits = new Map();   // npc → [{from, routineOf}]
  function routineFor(npc, t) {
    const list = inherits.get(npc); let id = npc;
    if (list) for (const x of list) if (t >= x.from) id = x.routineOf;
    return routines[id];
  }
  function routineAt(npc, t, depth = 0) {
    const r = routineFor(npc, t);
    if (!r) return null;
    const day = Math.floor(t / 1440);
    // 사람마다 하루가 조금씩 이르거나 늦다 (표류). fixed 블록은 흔들리지 않는다.
    const shift = Math.round((hash(loopSeed, npc, day, "shift") * 2 - 1) * 10);
    let t2 = t - shift, d2 = Math.floor(t2 / 1440), m2 = t2 - d2 * 1440;
    let hit = coveringBlock(r, d2, m2);
    const plain = coveringBlock(r, day, t - day * 1440);
    if (plain && plain.b.fixed) hit = plain;
    if (!hit) return { at: r.home, doing: "집에 있다", source: "routine-home" };
    let { at, doing } = hit.b, note = null;
    const blockDay = Math.floor(hit.start / 1440);
    if (hit.b.alt && !hit.b.fixed && hash(loopSeed, npc, blockDay, hit.idx, "alt") < hit.b.alt.p) { at = hit.b.alt.at; doing = hit.b.alt.doing; note = "표류"; }
    if (hit.b.rain && rainy(blockDay)) { at = hit.b.rain.at; doing = hit.b.rain.doing; note = "비"; }
    const out = { at, doing, source: "routine", from: hit.start, to: hit.end, note };
    // 블록이 막 시작했다면, 앞 장소에서 걸어오는 중이다
    if (depth === 0) {
      const prev = routineAt(npc, hit.start - 1, 1);
      if (prev && prev.at !== at) {
        const walk = Math.min(travelMinutes(prev.at, at), Math.max(5, Math.floor((hit.end - hit.start) / 4)));
        if (t < hit.start + walk) return { kind: "walking", at, fromAt: prev.at, doing: `${loc.get(at)?.name || at}(으)로 가는 중`, source: "routine", from: hit.start, to: hit.start + walk, progress: (t - hit.start) / walk };
      }
    }
    return out;
  }

  // ── 날짜 일정 (+ 그 일정 전후의 이동) ──
  function eventInstances(ev, t) {
    // t 근처(전날·당일·다음날)의 발생만 만든다
    const day = Math.floor(t / 1440), out = [];
    const days = [];
    if (ev.date) { const { y, m, d } = parseDate(ev.date); days.push(Math.floor(toMinutes(y, m, d) / 1440)); }
    else if (ev.repeat === "monthly") {
      for (const dd of [day - 1, day, day + 1]) { const c = fromMinutes(dd * 1440); if (c.m <= 12 && c.d === ev.day) days.push(dd); }
    }
    for (const dd of days) {
      const f = parseClock(ev.from), to = parseClock(ev.to);
      const start = dd * 1440 + f, end = dd * 1440 + (to > f ? to : to + 1440);
      out.push({ start, end });
    }
    return out;
  }

  // 일정은 목록 순서대로 본다 — 먼저 맞는 것이 이긴다 (이어지는 일정은 뒤의 것을 앞에 적는다).
  // travel_from: 일정 전에 그곳에서 출발한다. return_to: 일정이 끝나면 그곳으로 돌아간다. mounted: 말을 탄다(×0.35).
  function eventAt(npc, t) {
    for (const ev of eventsByNpc.get(npc) || []) {
      if (ev.if && !flags[ev.if]) continue;
      if (flags[ev.id + ":off"]) continue;
      // 조건부 일정: 세계 상태가 바뀌면 일어나지 않는다 (호송이 습격당했으면 바알카르 도착도 없다)
      if (ev.when && condFn && !ev.when.every((c) => condFn(c, t))) continue;
      const speed = ev.mounted ? 0.35 : 1;
      for (const { start, end } of eventInstances(ev, t)) {
        if (t >= start && t < end) return { at: ev.at, doing: ev.doing, source: "event", event: ev.id, from: start, to: end };
        if (ev.travel_from) {
          const pre = Math.round(travelMinutes(ev.travel_from, ev.at) * speed);
          if (t >= start - pre && t < start) return travelState(ev.travel_from, ev.at, start - pre, start, t, `${ev.doing} — 가는 길`, ev.id);
        }
        if (ev.return_to) {
          const post = Math.round(travelMinutes(ev.at, ev.return_to) * speed);
          if (t >= end && t < end + post) return travelState(ev.at, ev.return_to, end, end + post, t, "돌아가는 길", ev.id);
        }
      }
    }
    return null;
  }

  function travelState(a, b, start, end, t, doing, eventId) {
    const r = route(nodeOf(a), nodeOf(b));
    const progress = Math.max(0, Math.min(1, (t - start) / Math.max(1, end - start)));
    let leg = null;
    if (r && r.path.length > 1) {
      // 경로의 어느 구간에 있나
      let acc = 0, total = r.hours, here = progress * total;
      for (let i = 0; i < r.path.length - 1; i++) {
        const e = map.edges.find((x) => (x.from === r.path[i] && x.to === r.path[i + 1]) || (x.to === r.path[i] && x.from === r.path[i + 1]));
        if (acc + e.hours >= here) { leg = { from: r.path[i], to: r.path[i + 1], progress: (here - acc) / e.hours }; break; }
        acc += e.hours;
      }
    }
    return { kind: "travel", at: progress < 0.5 ? a : b, fromAt: a, toAt: b, doing, source: "event", event: eventId, from: start, to: end, progress, leg };
  }

  // ── 체류 기간 ──
  function presenceAt(npc, t) {
    const r = routines[npc];
    if (!r?.presence) return null;
    for (const p of r.presence) {
      const a = parseDate(p.from), b = parseDate(p.to);
      if (t >= toMinutes(a.y, a.m, a.d) && t < toMinutes(b.y, b.m, b.d) + 1440) return null;
    }
    return { kind: "away", at: r.away?.at || null, doing: r.away?.doing || "이 고장에 없다", source: "presence" };
  }

  // ── 공개 API ──
  function where(npc, t) {
    const list = overrides.get(npc) || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i];
      if (t >= o.from && (o.to == null || t < o.to)) return finish(npc, t, { kind: o.kind || "at", at: o.at ?? null, doing: o.doing, source: "override" });
    }
    const ev = eventAt(npc, t);
    if (ev) return finish(npc, t, { kind: "at", ...ev });
    const away = presenceAt(npc, t);
    if (away) return finish(npc, t, away);
    const r = routineAt(npc, t);
    if (r) return finish(npc, t, { kind: "at", ...r });
    return finish(npc, t, { kind: "unknown", at: null, doing: "알 수 없다", source: "none" });
  }
  function finish(npc, t, w) {
    const L = w.at ? loc.get(w.at) : null;
    return { npc, t, ...w, place: L?.name || w.at, settlement: L?.settlement || null, node: w.at ? nodeOf(w.at) : null };
  }
  function whoIsAt(place, t, npcs = Object.keys(routines)) {
    return npcs.map((n) => where(n, t)).filter((w) => w.kind !== "travel" && w.kind !== "walking" && (w.at === place || loc.get(w.at)?.parent === place));
  }
  function timeline(npc, fromT, toT, step = 15) {
    const segs = [];
    for (let t = fromT; t < toT; t += step) {
      const w = where(npc, t);
      const key = `${w.kind}|${w.at}|${w.doing}`;
      if (segs.length && segs[segs.length - 1].key === key) segs[segs.length - 1].to = t + step;
      else segs.push({ key, from: t, to: t + step, w });
    }
    return segs;
  }
  // 장면이 바꾼 것: 죽음, 포로, 플레이어가 데려감… (세이브에 남는다. 회귀하면 비운다)
  function override(o) { if (!overrides.has(o.npc)) overrides.set(o.npc, []); overrides.get(o.npc).push(o); }
  function setCond(fn) { condFn = fn; }
  function inherit(npc, routineOf, from) { if (!routines[routineOf]) return; if (!inherits.has(npc)) inherits.set(npc, []); inherits.get(npc).push({ from, routineOf }); }
  const npcs = () => [...new Set([...Object.keys(routines), ...eventsByNpc.keys()])];

  return { where, whoIsAt, timeline, override, setCond, inherit, npcs, hasEvents: (n) => eventsByNpc.has(n), travelMinutes, route, rainy, exists, loc };
}
