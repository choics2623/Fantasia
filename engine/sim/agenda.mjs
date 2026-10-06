// NPC 목표 행동 (26_AGENDAS.md). 하루씩 세계를 굴린다 — 플레이어가 없어도.
// 각 목표는 조건(when)이 맞는 날, 정해진 시각·장소에 NPC를 보내고(위치 엔진 덮어쓰기), 끝나면 세계 상태를 바꾼다(effects).
// 같은 회차 시드 = 같은 하루. 플레이어가 조건을 깨면(하겐을 죽인다, 에길을 옮긴다) 그 뒤의 사슬이 달라진다.
import { parseClock, parseDate, toMinutes, fromMinutes, weekday, fmt } from "./calendar.mjs";

function hash(...parts) {
  let h = 2166136261 >>> 0;
  for (const ch of parts.join("|")) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export function createState({ cards = {}, vars = {} } = {}) {
  const knows = new Map();       // fact → Set(npc)
  for (const c of Object.values(cards)) {
    for (const f of [...(c.knows || []), ...((c.hides || []).map((h) => h.fact))]) {
      if (!knows.has(f)) knows.set(f, new Set());
      knows.get(f).add(c.id);
    }
  }
  return { knows, vars: { ...vars }, rel: new Map(), dead: new Set(), log: [], done: new Set() };
}

export function createAgenda(world, state, agendaData, { loopSeed = 1 } = {}) {
  const agendas = agendaData.agendas || [];
  const v = (x) => (typeof x === "string" && x.startsWith("var:") ? state.vars[x.slice(4)] : isNaN(Number(x)) ? (x === "true" ? true : x === "false" ? false : x) : Number(x));
  const knowsF = (npc, fact) => state.knows.get(fact)?.has(npc) || false;
  const present = (npc, t) => { const w = world.where(npc, t); return w.kind !== "away" && w.kind !== "dead"; };

  function cond(c, t) {
    let neg = false;
    if (c.startsWith("not ")) { neg = true; c = c.slice(4); }
    const [k, a, b, d] = c.split(/\s+/);
    let r;
    if (k === "alive") r = !state.dead.has(a);
    else if (k === "dead") r = state.dead.has(a);
    else if (k === "present") r = present(a, t);
    else if (k === "knows") r = knowsF(a, b);
    else if (k === "date") { const { y, m, d: dd } = parseDate(b); const x = toMinutes(y, m, dd); r = a === ">=" ? t >= x : a === "<" ? t < x : Math.floor(t / 1440) === Math.floor(x / 1440); }
    else if (k === "var") {
      const L = state.vars[a], R = v(d);
      r = { "==": L === R, "!=": L !== R, ">=": L >= R, "<=": L <= R, ">": L > R, "<": L < R }[b];
    } else throw new Error("모르는 조건: " + c);
    return neg ? !r : r;
  }

  function effect(e, ag, t, end) {
    if (e.startsWith("if ")) {
      const body = e.slice(3), cut = body.indexOf(": ");   // "if <조건>: <효과> ; <효과>" — 조건 안의 var:이름 콜론과 구분
      const head = body.slice(0, cut), rest = body.slice(cut + 2);
      const yes = cond(head, t);
      state._lastIf = yes;
      if (yes) rest.split(/\s*;\s*/).forEach((x) => effect(x, ag, t, end));
      return;
    }
    if (e.startsWith("else:")) { if (!state._lastIf) e.slice(5).trim().split(/\s*;\s*/).forEach((x) => effect(x, ag, t, end)); return; }
    const parts = e.split(/\s+/);
    const k = parts[0];
    if (k === "var") {
      const [, name, op, val] = parts; const R = v(val);
      if (op === "=") state.vars[name] = R; else if (op === "+=") state.vars[name] += R; else if (op === "-=") state.vars[name] -= R;
    } else if (k === "learn") {
      const [, npc, fact] = parts;
      if (!state.knows.has(fact)) state.knows.set(fact, new Set());
      state.knows.get(fact).add(npc);
    } else if (k === "rel") {
      const [, pair, field, delta] = parts;
      const r = state.rel.get(pair) || { like: 0, trust: 0 }; r[field] += Number(delta); state.rel.set(pair, r);
    } else if (k === "capture") {
      const [, npc, , place] = parts;
      world.override({ npc, from: end, to: null, kind: "captive", at: place, doing: "붙잡혔다" });
    } else if (k === "punish") {
      const [, npc, , place, , days] = parts;
      world.override({ npc, from: end, to: end + Number(days) * 1440, kind: "at", at: place, doing: "채찍 기둥에 묶여 있다" });
    } else if (k === "kill") {
      const [, npc] = parts; state.dead.add(npc);
      world.override({ npc, from: end, to: null, kind: "dead", at: null, doing: "죽었다" });
    } else if (k === "log") {
      const text = e.slice(4).replace(/\{(\w+)\}/g, (_, n) => state.vars[n]);
      state.log.push({ t: end, agenda: ag.id, npc: ag.npc, text });
    } else throw new Error("모르는 효과: " + e);
  }

  function due(ag, day) {
    if (ag.every === "once") return !state.done.has(ag.id);
    if (ag.every === "daily") return true;
    const m = /^weekday:(\d)$/.exec(ag.every || ""); if (m) return weekday(day) === Number(m[1]);
    const n = /^every:(\d+)$/.exec(ag.every || ""); if (n) return day % Number(n[1]) === 0;
    return false;
  }

  // 하루를 굴린다: 그날 해당하는 목표를 시각 순서대로 처리
  function runDay(day) {
    const todays = agendas.filter((ag) => due(ag, day)).sort((a, b) => parseClock(a.at.from) - parseClock(b.at.from));
    for (const ag of todays) {
      const start = day * 1440 + parseClock(ag.at.from);
      let end = day * 1440 + parseClock(ag.at.to); if (end <= start) end += 1440;
      if (ag.chance != null && hash(loopSeed, ag.id, day) >= ag.chance) continue;
      if (!(ag.when || []).every((c) => cond(c, start))) continue;
      // NPC를 실제로 그 자리에 보낸다
      world.override({ npc: ag.npc, from: start, to: end, kind: "at", at: ag.at.place, doing: ag.at.doing, agenda: ag.id });
      for (const e of ag.effects || []) effect(e, ag, start, end);
      state.done.add(ag.id);
    }
  }

  function run(fromT, toT) { for (let d = Math.floor(fromT / 1440); d < Math.floor(toT / 1440); d++) runDay(d); return state; }

  // 플레이어 개입 — 죽임, 옮김, 변수 바꾸기
  function intervene(t, kind, ...args) {
    if (kind === "kill") { state.dead.add(args[0]); world.override({ npc: args[0], from: t, to: null, kind: "dead", doing: "죽었다" }); state.log.push({ t, npc: "player", text: `플레이어: ${args[0]}을(를) 죽였다` }); }
    if (kind === "set") { state.vars[args[0]] = args[1]; state.log.push({ t, npc: "player", text: `플레이어: ${args[0]} = ${args[1]}` }); }
  }

  return { run, runDay, intervene, state, fmtLog: () => [...state.log].sort((a, b) => a.t - b.t).map((l) => `${fmt(l.t)}  ${l.text}`) };
}
