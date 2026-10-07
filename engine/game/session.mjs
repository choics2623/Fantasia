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

const INK = new Set(["ink", "drift", "grow", "voice", "dayend", "echo", "recap"]);   // 기억 잉크 — 엔진이 쓴 줄을 화면이 그대로 보인다 (LLM이 다시 쓰지 않는다)
// provider: 서술(플레이어가 읽는 글 — 좋은 모델), fast: 자유 입력 해석(구조화 — 빠른 모델), recorder: 기록관(뒤에서 — 빠른 모델)
export function createSession(content, provider, { run = null, onSave = null, fast = provider, recorder = fast, mockRecords = null } = {}) {
  let g = G.boot(content, run || G.newRun());
  let transcript = g.run.transcript || [];
  // 서술의 기억 (화면용 — 재생에 쓰지 않는다): 줄기(오늘 한 일), 사람마다 지난 대화의 요지, 최근 서술의 꼬리(되풀이 검사)
  let thread = g.run.thread || [], talkLog = g.run.talkLog || {}, tail = g.run.tail || [];
  const resetMemory = (run) => { thread = run?.thread || []; talkLog = run?.talkLog || {}; tail = run?.tail || []; };
  const save = () => { g.run.transcript = transcript.slice(-40); g.run.thread = thread.slice(-16); g.run.talkLog = talkLog; g.run.tail = tail.slice(-12); g.run.lastPlayedAt = Date.now(); onSave?.(waiting ? { ...g.run, journal: g.run.journal.slice(0, waiting.keep) } : g.run); };   // 서술을 기다리는 박자는 저장하지 않는다
  // ── 기록관: 끝난 대화를 뒤에서 처리한다. 결과는 턴 사이에만 기록에 넣는다 (되돌리기와 섞이지 않게) ──
  // 시간선: 회귀·새 판·불러오기는 새 시간선이다. 되돌리기는 그 아침 뒤의 대화만 지운다 — 지워진 시간선의 기억이 새 기록에 섞이지 않게
  const jobs = [], pending = [], live = new Set();
  let busy = false, working = null, recDebug = [], timeline = {};
  function enqueue(npc, conv) { const j = { npc, transcript: conv, t: g.t, time: fmt(g.t), tries: 0, tl: timeline, at: g.run.journal.length }; jobs.push(j); live.add(j); kick(); }
  function newTimeline() { waiting = null; timeline = {}; for (const j of live) j.dead = true; live.clear(); jobs.length = 0; pending.length = 0; }
  function cutTimeline(mark) { for (const j of live) if (j.at > mark) { j.dead = true; live.delete(j); } }
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
          for (const j of batch) if (j.dead) continue; else if (++j.tries < 3) jobs.push(j); else { live.delete(j); recDebug.push({ kind: "recorder-drop", npc: j.npc }); }
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
      live.delete(job);
      if (job.dead || job.tl !== timeline) { recDebug.push({ kind: "recorder-stale", npc: job.npc }); continue; }
      const { accepted, rejected } = G.validateMemories(g, job.npc, job.transcript, recs, { t: job.t });
      G.recordMemories(g, job.npc, accepted);
      recDebug.push({ kind: "recorder", npc: job.npc, accepted, rejected });
      any = true;
    }
    if (any) save();
  }
  const peopleKey = () => G.view(g).people.map((p) => p.id).sort().join(",");
  // 한 박자가 끝나면: 줄기에 한 줄, 서술 꼬리에 박자들, 대화가 끝났으면 그 사람의 지난 대화 요지
  function remember(res, beats, conv = null) {
    if (res) {
      const v = G.view(g);
      const what = String(res.text || res.label || "").replace(/\s*\(\d+분\)|\s*— 몰래/g, "").slice(0, 60);
      const how = res.skill && res.tier ? ` (${res.tier})` : "";
      const note = res.reveal ? " — 숨긴 것을 들었다" : res.notes?.[0] ? ` — ${String(res.notes[0]).slice(0, 50)}` : "";
      thread.push({ t: g.t, hm: v.hm, at: g.run.journal.length, text: `${what}${how}${note}` });
      if (thread.length > 16) thread = thread.slice(-16);
    }
    tail.push(...beats.filter(Boolean)); if (tail.length > 12) tail = tail.slice(-12);
    if (conv) {
      const asked = conv.lines.filter((x) => x.who === "player" && !/말을 건다$|이야기를 끝낸다$/.test(x.text)).map((x) => x.text.slice(0, 40)).slice(-3);   // 여닫는 인사는 빼고
      const last = conv.lines.filter((x) => x.who === "narr").pop()?.text.slice(0, 120) || "";
      talkLog = { ...talkLog, [conv.npc]: [...(talkLog[conv.npc] || []), { t: g.t, when: fmt(g.t).slice(7), asked, last }].slice(-3) };
    }
  }

  function needsLLM(res, beforePeople) {
    if (!res) return !g.story;                       // 대본 장면은 손으로 쓴 글 그대로 — LLM을 부르지 않는다
    if (res.storyText != null || g.story) return false;
    if (g.convo || res.convoEnded) return true;
    if (res.id.startsWith("attack:") || res.id.startsWith("loot:") || res.id.startsWith("fight_") || g.fight || res.id.startsWith("op_")) return true;
    if (res.feed?.some((f) => !INK.has(f.kind))) return true;
    if (g.ended) return true;
    if (res.kind === "move" && G.view(g).people.length) return true;
    if (res.id === "routine_day") return true;   // 하루를 건너뛴 뒤의 짧은 몽타주 — 한 번의 호출
    if (peopleKey() !== beforePeople && G.view(g).people.length) return true;
    return false;
  }
  function engineBeats(res) {
    // 대본 장면: 그 글 그대로 (+ 그 사이 새로 열린 장면의 글)
    if (res.storyText != null || g.story) {
      const parts = [res.storyText || "", ...(res.feed || []).filter((f) => f.kind === "story").map((f) => f.text)];
      return parts.join("\n\n").split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
    }
    const v = G.view(g);
    const b = [josa(`${res.label.replace(/\s*\(\d+분\)|\s*— 몰래/g, "")}. ${v.hm}${v.night ? ", 어둡다" : ""}${v.rain ? ", 비가 온다" : ""}.`)];
    if (!v.people.length) b.push(`${v.place.name}에는 아무도 없다.`);
    for (const n of res.notes) b.push(n);
    return b;
  }

  let lastScene = null;
  async function narrate(res, opts, { onText, free, memories }) {
    const sceneKey = `${g.at}|${g.convo?.npc || ""}`;
    const sceneNew = !res || lastScene !== sceneKey && !(res.convoEnded && lastScene?.startsWith(g.at)) || res.kind === "move";
    const introduced = new Set(g.run.introduced || []);
    const ctx = { transcript, memories, sceneNew: sceneNew && !g.convo, introduced, thread, talkLog, tail };
    let prompt = turnPrompt(g, res, opts, ctx);
    lastScene = sceneKey;
    let lastProblems = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      let streamed = "";
      if (attempt === 2 && lastProblems.some((p) => p.startsWith("반복"))) prompt = turnPrompt(g, res, opts, { ...ctx, retry: "방금 쓴 글이 앞의 서술을 거의 되풀이했다. 같은 일을 다른 문장, 다른 몸짓, 다른 감각으로 다시 써라." });
      const text = await provider.complete(SYSTEM, prompt, {
        // 서술 부분만 흘려보낸다 (<선택지> 이후는 보내지 않는다)
        onText: onText && ((d) => { streamed += d; const cut = streamed.indexOf("</서술>"); const body = streamed.replace(/^[\s\S]*?<서술>\s*/, ""); if (streamed.includes("<서술>") && (cut < 0 || streamed.length - d.length < cut)) onText(body.slice(0, cut < 0 ? undefined : body.indexOf("</서술>"))); }),
        mock: () => mockTurn(g, res, opts, { memories }),
      });
      const parsed = parseTurn(text);
      const v = validateTurn(g, parsed, opts, { res, free, prompt, tail });
      lastProblems = v.problems;
      // 되풀이는 한 번만 다시 쓰게 한다 — 두 번째에도 닮았으면 그대로 받는다 (턴을 깨지는 않는다)
      if (v.ok && !parsed.bad && (!v.repeat || attempt === 2)) {
        // 이번 서술에 나온 사람은 '소개됐다' — 다음부터는 이름만 (화면용 기록, 재생에 쓰지 않는다)
        const text = v.beats.join(" ");
        g.run.introduced = [...new Set([...(g.run.introduced || []), ...G.view(g).people.filter((p) => text.includes(p.name)).map((p) => p.id)])];
        return { ...v, memories: parsed.memories };
      }
    }
    throw Object.assign(new Error("쓸 수 있는 서술이 없다"), { problems: lastProblems });
  }

  // 한 턴. 실패하면 기록을 되돌리고 { broken } — 같은 행동을 다시 보내면 같은 주사위로 다시 한다
  async function turn(input = null, opts2 = {}) {
    busy = true;
    try { return await turnInner(input, opts2); } finally { busy = false; flush(); }
  }
  // 서술만 실패한 박자: 엔진은 이미 굴렀다 (주사위는 기록 번호로 정해진다 — 다시 해도 같다).
  // 같은 행동으로 다시 시도하면 재생 없이 서술만 다시 부른다. 다른 행동을 고르면 그때 되돌린다 (재생)
  let waiting = null;
  const sameInput = (a, b) => !!a && !!b && a.id === b.id && (a.text || null) === (b.text || null) && (a.free || null) === (b.free || null);
  async function turnInner(input = null, { onText } = {}) {
    const debug = recDebug.splice(0);
    if (waiting && sameInput(input, waiting.input)) {
      const P = waiting;
      try {
        transcript.push({ who: "player", text: P.res.text || P.res.label });
        const n = await narrate(P.res, P.opts, { onText, free: input?.free, memories: false });
        waiting = null;
        if (n.problems.length) debug.push({ kind: "validate", problems: n.problems });
        transcript.push(...n.beats.map((b) => ({ who: "narr", text: b })));
        const conv0 = P.res?.convoEnded ? { npc: P.res.convoEnded.npc, lines: transcript.slice(-(P.res.convoEnded.turns * 2 + 6)) } : null;
        remember(P.res, n.beats, conv0);
        if (conv0) { enqueue(conv0.npc, conv0.lines); transcript = []; }
        save();
        return payload(P.res, n, [...debug, { kind: "renarrate" }]);
      } catch (e) {
        transcript = transcript.slice(0, P.keepT);
        debug.push({ kind: "error", error: String(e.message || e), problems: e.problems });
        return { broken: "잿빛 실이 끊겼다 — LLM이 응답하지 않는다. 이 박자는 일어나지 않았다.", retry: input, ...payload(null, null, debug), ...(P.view ? { view: P.view } : {}) };
      }
    }
    if (waiting) { g = G.boot(content, { ...g.run, journal: g.run.journal.slice(0, waiting.keep) }); transcript = transcript.slice(0, waiting.keepT); waiting = null; }
    const keep = g.run.journal.length, keepT = transcript.length;
    let acted = null, actedOpts = null, preView = null;
    try {
      let res = null, opts;
      if (input) {
        let id = input.id, tags = [], text = input.text || null;
        const before = G.options(g);
        if (input.free) {
          const out = await fast.complete(SYSTEM, interpretPrompt(g, input.free, before), { mock: () => JSON.stringify({ id: before.find((o) => o.id === "small_talk")?.id || before[0].id, tags: [] }) });
          const it = parseInterpret(g, out, before);
          if (!it) throw new Error("자유 입력을 해석하지 못했다");
          id = it.id; tags = it.tags; text = input.free; debug.push({ kind: "interpret", ...it });
        }
        if (!before.some((o) => o.id === id)) return { error: "지금은 할 수 없는 행동", ...payload(null, null, debug) };
        preView = G.view(g);   // 서술이 실패하면 이 화면을 보인다 — 그 박자는 일어나지 않았다
        const beforePeople = peopleKey();
        transcript.push({ who: "player", text: text || before.find((o) => o.id === id).label });
        res = G.act(g, { id, tags, text });
        res.text = text; acted = res;
        debug.push({ kind: "engine", id, tier: res.tier, P: Math.round(res.P * 100), roll: +res.roll.toFixed(3), notes: res.notes, reveal: res.reveal });
        opts = G.options(g); actedOpts = opts;
        if (!needsLLM(res, beforePeople)) { const beats = engineBeats(res); transcript.push(...beats.map((b) => ({ who: "narr", text: b }))); remember(res, []); save(); return payload(res, { beats, choices: opts.map((o) => ({ ...o, text: o.label })) }, debug, true); }
      } else {
        opts = G.options(g);
        if (g.story) { const beats = (G.storyIntro(g) || "").split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean); return payload(null, { beats, choices: opts.map((o) => ({ ...o, text: o.label })) }, debug, true); }
      }
      const n = await narrate(res, opts, { onText, free: input?.free, memories: false });
      if (n.problems.length) debug.push({ kind: "validate", problems: n.problems });
      transcript.push(...n.beats.map((b) => ({ who: "narr", text: b })));
      const conv = res?.convoEnded ? { npc: res.convoEnded.npc, lines: transcript.slice(-(res.convoEnded.turns * 2 + 6)) } : null;
      remember(res, n.beats, conv);
      if (conv) {
        enqueue(conv.npc, conv.lines);   // 기록관에게 — 기다리지 않는다
        transcript = [];
      }
      save();
      return payload(res, n, debug);
    } catch (e) {
      if (acted && g.run.journal.length === keep + 1) {
        // 엔진은 굴렀고 서술만 실패했다 — 되돌리지 않고 기다린다 (같은 행동으로 다시 시도하면 서술만, 다른 행동이면 그때 되돌린다)
        waiting = { input, keep, keepT, res: acted, opts: actedOpts || G.options(g), view: preView };
        transcript = transcript.slice(0, keepT);
        debug.push({ kind: "error", error: String(e.message || e), problems: e.problems });
        return { broken: "잿빛 실이 끊겼다 — LLM이 응답하지 않는다. 이 박자는 일어나지 않았다.", retry: input, ...payload(null, null, debug), ...(preView ? { view: preView } : {}) };
      }
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
      const o = G.optionOdds(g, c);
      // 화면엔 체감 등급(01 §4.2 — 서툴수록 과신하고 틀린다)과 캐릭터가 아는 근거(▲▼?)만. 진짜 확률은 엔진 기록에만
      return { id: c.id, text: c.text, kind: c.kind, skill: c.skill || null, band: o ? G.band(G.perceived(g, o.P, c.skill, c.id)) : null, why: o?.parts || [], p: o ? Math.round(o.P * 100) : null, risk: c.risk || null, input: c.input || null, more: c.more || false, memory: c.memory || null };
    });
    const ink = [...(n?.recap || []).map((text) => ({ kind: "recap", text })), ...(res?.feed || []).filter((f) => INK.has(f.kind)).map((f) => ({ kind: f.kind, text: f.text, buzz: f.buzz || null, who: f.who || null, card: f.card || null }))];
    return { view: v, beats: n?.beats || [], ink, choices, locked: G.lockedOptions(g), result: res ? { tier: res.tier, skill: res.skill, p: Math.round(res.P * 100) } : null, engineOnly, debug, usage: provider.usage, provider: provider.kind };
  }

  return {
    // 다시 열었을 때: 얼마나 비웠는지에 따라 지난 이야기 (18 §5.4)
    async start(o) {
      const gap = g.run.lastPlayedAt ? (Date.now() - g.run.lastPlayedAt) / 3600e3 : 0;
      const out = await turn(null, o);
      const rc = G.recap(g, gap);
      if (rc.length && !out.broken) out.ink = [...rc.map((text) => ({ kind: "recap", text })), ...(out.ink || [])];
      return out;
    },
    memo(npc, text) { g.run.memos = { ...(g.run.memos || {}), [npc]: String(text || "").slice(0, 200) }; save(); return { ok: true }; },
    act: (input, o) => turn(input, o),
    async regress(o) {
      const next = G.regressRun(g);
      if (!next) return { epilogue: G.epilogue(g), view: G.view(g), choices: [], beats: [] };   // 진짜 죽음 — 시대가 끝난다
      newTimeline(); g = G.boot(content, next); transcript = []; resetMemory(null); save(); return turn(null, o);
    },
    // 회귀를 놓는다 (03 §4.6): 다음 회차가 마지막 — 그 회차의 죽음은 돌아오지 않는다
    release() { g.run.release = true; save(); return { ok: true }; },
    async newGame(seed, o, mode = "grim", narrator = "silent_god") { newTimeline(); g = G.boot(content, { ...G.newRun({ seed: seed ?? Math.floor(Math.random() * 1e6) }), mode, narrator }); transcript = []; resetMemory(null); save(); return turn(null, o); },
    narrator(id) { G.setNarrator(g, id); save(); return { ok: true, view: G.view(g) }; },
    // 이야기 모드 (03 §6): 마지막 아침으로 — 회차당 세 번. 그림다크(기본)에는 없다
    async rewind(o) {
      if (g.run.mode !== "story") return { error: "그림다크에서는 되돌릴 수 없다" };
      const used = g.run.rewinds?.[g.run.loop] || 0;
      if (used >= 3) return { error: "이번 회차의 되돌리기를 다 썼다" };
      const mark = G.morningMark(g);
      if (mark == null) return { error: "되돌아갈 아침이 아직 없다" };
      cutTimeline(mark); waiting = null;
      g = G.boot(content, { ...g.run, journal: g.run.journal.slice(0, mark), rewinds: { ...(g.run.rewinds || {}), [g.run.loop]: used + 1 } });
      transcript = []; thread = thread.filter((x) => x.at <= mark); tail = []; save(); return turn(null, o);
    },
    drain: () => kick() || Promise.resolve(),   // 검사용: 기록관이 끝날 때까지
    load(run) { newTimeline(); g = G.boot(content, run); transcript = run.transcript || []; resetMemory(run); },
    // 서술을 기다리는 박자는 아직 일어나지 않았다 — 밖에서 보는 기록에는 없다
    get run() { return waiting ? { ...g.run, journal: g.run.journal.slice(0, waiting.keep) } : g.run; }, get game() { return g; },
  };
}
