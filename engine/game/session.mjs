// 한 판 (서버가 들고 있는 것): 엔진 + LLM + 저장. 턴은 원자적이다 — 서술까지 성공해야 기록이 남는다.
//
// LLM 호출을 아끼는 규칙 (한도에 걸리면 게임이 멈추므로 — 28 §3):
//   - 부르는 때: 대화 중, 대화를 끝낼 때(기억도 같은 호출로), 사람에게 덤빌 때, 그 자리에 사람이 있는 새 장면, 주변에서 일이 일어났을 때
//   - 부르지 않는 때: 아무도 없는 곳으로 걷기, 아무 일 없이 기다리기·자기 → 엔진의 짧은 문장
//   - 자유 입력은 해석 호출이 하나 더 든다
import * as G from "./game.mjs";
import { SYSTEM, turnPrompt, parseTurn, validateTurn, interpretPrompt, parseInterpret, mockTurn, RECORDER_SYSTEM, recorderPrompt, parseRecords } from "./prompts.mjs";
import { fmt } from "../sim/calendar.mjs";
import { josa } from "../sim/text.mjs";

export function createSession(content, provider, { run = null, onSave = null, recorder = provider, mockRecords = null } = {}) {
  let g = G.boot(content, run || G.newRun());
  let transcript = g.run.transcript || [];
  const save = () => { g.run.transcript = transcript.slice(-40); onSave?.(g.run); };
  // ── 기록관: 끝난 대화를 뒤에서 처리한다. 결과는 턴 사이에만 기록에 넣는다 (되돌리기와 섞이지 않게) ──
  const jobs = [], pending = [];
  let busy = false, working = null, recDebug = [];
  function enqueue(npc, conv) { jobs.push({ npc, transcript: conv, t: g.t, time: fmt(g.t), tries: 0 }); kick(); }
  function kick() {
    if (working || !jobs.length) return working;
    working = (async () => {
      while (jobs.length) {
        const batch = jobs.splice(0, 4);   // 여러 대화를 한 번에
        try {
          const out = await recorder.complete(RECORDER_SYSTEM, recorderPrompt(g, batch), { mock: () => JSON.stringify({ records: mockRecords ? mockRecords(batch) : [] }) });
          const recs = parseRecords(out);
          if (!recs) throw new Error("기록관 출력을 읽지 못했다");
          for (const j of batch) pending.push({ job: j, recs: recs.filter((r) => r.npc === j.npc) });
        } catch (e) {
          recDebug.push({ kind: "recorder-error", error: String(e.message || e) });
          for (const j of batch) if (++j.tries < 3) jobs.push(j); else recDebug.push({ kind: "recorder-drop", npc: j.npc });
          if (jobs.length) await new Promise((r) => setTimeout(r, 2000 * batch[0].tries));
        }
      }
      working = null; flush();
    })();
    return working;
  }
  function flush() {
    if (busy) return;
    let any = false;
    while (pending.length) {
      const { job, recs } = pending.shift();
      const { accepted, rejected } = G.validateMemories(g, job.npc, job.transcript, recs, { t: job.t });
      G.recordMemories(g, job.npc, accepted);
      recDebug.push({ kind: "recorder", npc: job.npc, accepted, rejected });
      any = true;
    }
    if (any) save();
  }
  const peopleKey = () => G.view(g).people.map((p) => p.id).sort().join(",");

  function needsLLM(res, beforePeople) {
    if (!res) return true;
    if (g.convo || res.convoEnded) return true;
    if (res.id.startsWith("attack:") || res.id.startsWith("loot:")) return true;
    if (res.feed?.length) return true;
    if (g.ended) return true;
    if (res.kind === "move" && G.view(g).people.length) return true;
    if (res.id === "routine_day") return true;   // 하루를 건너뛴 뒤의 짧은 몽타주 — 한 번의 호출
    if (peopleKey() !== beforePeople && G.view(g).people.length) return true;
    return false;
  }
  function engineBeats(res) {
    const v = G.view(g);
    const b = [josa(`${res.label.replace(/\s*\(\d+분\)|\s*— 몰래/g, "")}. ${v.hm}${v.night ? ", 어둡다" : ""}${v.rain ? ", 비가 온다" : ""}.`)];
    if (!v.people.length) b.push(`${v.place.name}에는 아무도 없다.`);
    for (const n of res.notes) b.push(n);
    return b;
  }

  async function narrate(res, opts, { onText, free, memories }) {
    const prompt = turnPrompt(g, res, opts, { transcript, memories });
    let lastProblems = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      let streamed = "";
      const text = await provider.complete(SYSTEM, prompt, {
        // 서술 부분만 흘려보낸다 (<선택지> 이후는 보내지 않는다)
        onText: onText && ((d) => { streamed += d; const cut = streamed.indexOf("</서술>"); const body = streamed.replace(/^[\s\S]*?<서술>\s*/, ""); if (streamed.includes("<서술>") && (cut < 0 || streamed.length - d.length < cut)) onText(body.slice(0, cut < 0 ? undefined : body.indexOf("</서술>"))); }),
        mock: () => mockTurn(g, res, opts, { memories }),
      });
      const parsed = parseTurn(text);
      const v = validateTurn(g, parsed, opts, { res, free, prompt });
      lastProblems = v.problems;
      if (v.ok && !parsed.bad) return { ...v, memories: parsed.memories };
    }
    throw Object.assign(new Error("쓸 수 있는 서술이 없다"), { problems: lastProblems });
  }

  // 한 턴. 실패하면 기록을 되돌리고 { broken } — 같은 행동을 다시 보내면 같은 주사위로 다시 한다
  async function turn(input = null, opts2 = {}) {
    busy = true;
    try { return await turnInner(input, opts2); } finally { busy = false; flush(); }
  }
  async function turnInner(input = null, { onText } = {}) {
    const debug = recDebug.splice(0);
    const keep = g.run.journal.length, keepT = transcript.length;
    try {
      let res = null, opts;
      if (input) {
        let id = input.id, tags = [], text = input.text || null;
        const before = G.options(g);
        if (input.free) {
          const out = await provider.complete(SYSTEM, interpretPrompt(g, input.free, before), { mock: () => JSON.stringify({ id: before.find((o) => o.id === "small_talk")?.id || before[0].id, tags: [] }) });
          const it = parseInterpret(g, out, before);
          if (!it) throw new Error("자유 입력을 해석하지 못했다");
          id = it.id; tags = it.tags; text = input.free; debug.push({ kind: "interpret", ...it });
        }
        if (!before.some((o) => o.id === id)) return { error: "지금은 할 수 없는 행동", ...payload(null, null, debug) };
        const beforePeople = peopleKey();
        transcript.push({ who: "player", text: text || before.find((o) => o.id === id).label });
        res = G.act(g, { id, tags, text });
        res.text = text;
        debug.push({ kind: "engine", id, tier: res.tier, P: Math.round(res.P * 100), roll: +res.roll.toFixed(3), notes: res.notes, reveal: res.reveal });
        opts = G.options(g);
        if (!needsLLM(res, beforePeople)) { const beats = engineBeats(res); transcript.push(...beats.map((b) => ({ who: "narr", text: b }))); save(); return payload(res, { beats, choices: opts.map((o) => ({ ...o, text: o.label })) }, debug, true); }
      } else opts = G.options(g);
      const n = await narrate(res, opts, { onText, free: input?.free, memories: false });
      if (n.problems.length) debug.push({ kind: "validate", problems: n.problems });
      transcript.push(...n.beats.map((b) => ({ who: "narr", text: b })));
      if (res?.convoEnded) {
        enqueue(res.convoEnded.npc, transcript.slice(-(res.convoEnded.turns * 2 + 6)));   // 기록관에게 — 기다리지 않는다
        transcript = [];
      }
      save();
      return payload(res, n, debug);
    } catch (e) {
      // 되돌리기: 기록을 빼고 재생한다. 주사위는 기록 번호로 정해지므로 다시 시도해도 같다
      g = G.boot(content, { ...g.run, journal: g.run.journal.slice(0, keep) });
      transcript = transcript.slice(0, keepT);
      debug.push({ kind: "error", error: String(e.message || e), problems: e.problems });
      return { broken: "잿빛 실이 끊겼다 — LLM이 응답하지 않는다. 이 박자는 일어나지 않았다.", retry: input, ...payload(null, null, debug) };
    }
  }

  function payload(res, n, debug, engineOnly = false) {
    const v = G.view(g);
    const choices = (n?.choices || G.options(g).map((o) => ({ ...o, text: o.label }))).map((c) => {
      const o = G.odds(g, c);
      return { id: c.id, text: c.text, kind: c.kind, skill: c.skill || null, band: o ? G.band(o.P) : null, p: o ? Math.round(o.P * 100) : null, risk: c.risk || null };
    });
    return { view: v, beats: n?.beats || [], choices, result: res ? { tier: res.tier, skill: res.skill, p: Math.round(res.P * 100) } : null, engineOnly, debug, usage: provider.usage, provider: provider.kind };
  }

  return {
    start: (o) => turn(null, o),
    act: (input, o) => turn(input, o),
    async regress(o) { g = G.boot(content, G.regressRun(g)); transcript = []; save(); return turn(null, o); },
    async newGame(seed, o) { g = G.boot(content, G.newRun({ seed: seed ?? Math.floor(Math.random() * 1e6) })); transcript = []; save(); return turn(null, o); },
    drain: () => kick() || Promise.resolve(),   // 검사용: 기록관이 끝날 때까지
    load(run) { g = G.boot(content, run); transcript = run.transcript || []; },
    get run() { return g.run; }, get game() { return g; },
  };
}
