// 회색여울 — 링크로 하는 판 (claude.ai Artifact). 서버 없이 이 페이지 안에서 엔진이 돈다.
// - 화면(ui/app.js)은 서버판과 같다: 화면이 부르는 /api/*를 여기서 가로채 엔진 세션에 넘긴다 (서술은 SSE 모양 그대로 흘린다)
// - 서술·자유 입력 해석·기록관: claude.use("sample") — 보는 사람의 Claude 계정으로 (첫 호출 때 허락을 묻는다)
// - 저장: claude.use("db")의 내 칸(data/users/<id>/…)과 이 브라우저(localStorage) 두 곳에. gzip으로 줄여 문서 하나 256KB 아래로 쪼갠다
// - 이 파일은 정적 import가 없다: 엔진을 못 불러와도 가로채기는 먼저 서서, 화면에 까닭을 보인다
// tools/build_web.mjs가 __BUILD__를 판본 표시로 바꾼다.

const BUILD = "__BUILD__";
const LSP = "fantasia:";
const ls = {
  get: (k) => { try { return localStorage.getItem(LSP + k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(LSP + k, v); return true; } catch { return false; } },
  keys: () => { try { return Object.keys(localStorage).filter((k) => k.startsWith(LSP)).map((k) => k.slice(LSP.length)); } catch { return []; } },
};
document.documentElement.lang = "ko";

// ── 줄이기 (gzip → base64). 압축을 못 하는 브라우저면 그대로 ──
async function pack(obj) {
  const json = JSON.stringify(obj);
  if (typeof CompressionStream === "undefined") return "j:" + json;
  const u = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return "z:" + btoa(s);
}
async function unpack(str) {
  if (!str) return null;
  if (str.startsWith("j:")) return JSON.parse(str.slice(2));
  const bin = atob(str.slice(2)), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return JSON.parse(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
}

// ── 능력 (claude.ai 안에서만 — 밖에서 열면 null) ──
const cap = (name) => (window.claude?.use
  ? Promise.race([window.claude.use(name).catch(() => null), new Promise((r) => setTimeout(() => r(null), 12000))])
  : Promise.resolve(null));
const sampleP = cap("sample");

// ── 저장소: 계정(db) + 이 브라우저. 읽을 때는 더 새것을 ──
const CHUNK = 200000;
const hex = (s) => [...new TextEncoder().encode(String(s))].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (h) => new TextDecoder().decode(new Uint8Array((h.match(/../g) || []).map((x) => parseInt(x, 16))));
function makeStore(db, uid) {
  const col = db && uid ? `data/users/${uid}` : null;
  const ref = (key) => db.doc(`${col}/${key}`);
  async function dbPut(key, z, at) {
    const parts = [];
    for (let i = 0; i < z.length; i += CHUNK) parts.push(z.slice(i, i + CHUNK));
    for (let i = 1; i < parts.length; i++) await ref(`${key}~${i}`).set({ z: parts[i] });   // 조각을 먼저, 머리를 나중에 — 반쯤 쓴 판을 읽지 않게
    await ref(key).set({ v: 1, at, n: Math.max(1, parts.length), z: parts[0] || "" });
  }
  async function dbGet(key) {
    const s = await ref(key).get(); if (!s.exists) return null;
    const d = s.data(); let z = d.z || "";
    for (let i = 1; i < (d.n || 1); i++) { const p = await ref(`${key}~${i}`).get(); if (!p.exists) return null; z += p.data().z || ""; }
    return { at: d.at || 0, z };
  }
  return {
    durable: !!col,
    async put(key, obj) {
      const at = Date.now(), z = await pack(obj);
      ls.set(key, JSON.stringify({ at, z }));
      if (col) await dbPut(key, z, at);
    },
    async get(key) {
      let local = null; try { local = JSON.parse(ls.get(key) || "null"); } catch { /* 깨진 칸은 없는 것으로 */ }
      const remote = col ? await dbGet(key).catch(() => null) : null;
      for (const c of [local, remote].filter(Boolean).sort((a, b) => b.at - a.at)) { try { return await unpack(c.z); } catch { /* 다음 것 */ } }
      return null;
    },
    async slots() {
      const ids = new Set(ls.keys().filter((k) => /^slot-[0-9a-f]+$/.test(k)));
      if (col) { try { for (const d of (await db.collection(col).get()).docs) if (/^slot-[0-9a-f]+$/.test(d.id)) ids.add(d.id); } catch { /* 목록은 이 브라우저 것만 */ } }
      return [...ids].map((k) => unhex(k.slice(5))).sort();
    },
  };
}
// 같은 문서에는 한 번에 하나씩, 몰아서 (db 규칙: 쓰기 폭주 금지)
function writer(store, key) {
  let timer = null, latest = null, chain = Promise.resolve();
  const go = () => { const o = latest; latest = null; timer = null; if (o) chain = chain.then(() => store.put(key, o)).catch((e) => console.warn("저장 실패", key, e)); return chain; };
  return {
    save(obj) { latest = obj; clearTimeout(timer); timer = setTimeout(go, 700); },
    // 창을 숨길 때: 줄이지 않은 채로 이 브라우저에 먼저 (비동기 압축을 기다리지 못할 수 있다), 그다음 평소대로
    flush() { if (latest) ls.set(key, JSON.stringify({ at: Date.now(), z: "j:" + JSON.stringify(latest) })); clearTimeout(timer); return go(); },
  };
}

// ── LLM: sample. 시스템 글이 따로 없으니 지시와 장면을 한 글로 ──
const tierOf = (role) => (role === "narr" ? (ls.get("tier") === "quick" ? "quick" : "default") : "quick");
const WHY = {
  not_granted: "이 페이지가 Claude를 쓰도록 허락하지 않았다 — 페이지를 새로 열고 허락하면 이어진다",
  sampling_disabled: "이 계정에서는 페이지가 Claude를 부를 수 없다", capability_disabled: "이 화면에서는 페이지가 Claude를 부를 수 없다",
  not_declared: "이 판본은 Claude를 부를 수 없다", capability_removed: "이 앱 판본에서는 페이지가 Claude를 부를 수 없다",
  rate_limited: "Claude 사용량이 잠시 막혔다 — 조금 쉬었다가 다시", session_expired: "claude.ai에 다시 로그인해야 한다",
  refused: "Claude가 이 장면을 쓰지 않았다 — 다른 선택을 해 보라", prompt_too_large: "장면 자료가 너무 길다",
  empty_completion: "Claude가 아무것도 쓰지 않았다 — 다시 시도", cancelled: "멈췄다",
};
function sampleProvider(role) {
  const usage = { calls: 0, failures: 0, ms: 0, outTokens: 0, since: Date.now() };
  return {
    kind: "sample", usage,
    get model() { return tierOf(role); },
    async complete(system, prompt, { onText } = {}) {
      const sample = await sampleP;
      if (!sample) throw new Error("Claude에 닿지 않는다 — 이 페이지는 claude.ai 안에서 열어야 이야기가 이어진다");
      const t0 = Date.now(); usage.calls++;
      try {
        const r = await sample(`${system}\n\n━━━━━━━━\n\n${prompt}`, { modelTier: tierOf(role), cache: false, ...(onText ? { onText: ({ text, delta }) => onText(delta, text) } : {}) });
        usage.ms += Date.now() - t0;
        return r.text;
      } catch (e) {
        usage.failures++;
        throw new Error(`${WHY[e?.code] || "Claude와의 연결이 잠깐 끊겼다 — 다시 시도"}${e?.code ? ` (${e.code})` : ""}`);
      }
    },
  };
}

// ── 엔진과 세션 ──
let S = null, store = null, auto = null, ledgerW = null, mapView = null;
// 새 판본을 받을 때 넘길 것 (claude.ai의 hot 고리 — 없으면 그냥 저장에서)
const hot = window.claude?.hot;
try { hot?.snapshot?.(() => (S ? { run: S.run } : null)); } catch { /* 고리가 없으면 저장으로 충분하다 */ }
const hotData = new Promise((res) => {
  setTimeout(() => res(null), 3000);
  try { if (hot?.ready) hot.ready((d) => res(d || null)); else res(hot?.data ?? null); } catch { res(null); }
});
const ready = (async () => {
  const [game, sess, content] = await Promise.all([
    import("../engine/game/game.js"), import("../engine/game/session.js"),
    Promise.all(["whereabouts", "cards", "game"].map((n) => fetch(`content/${n}.json`).then((r) => { if (!r.ok) throw new Error(`콘텐츠(${n})를 못 불렀다`); return r.json(); }))),
  ]);
  mapView = game.mapView;
  const [bundle, cards, gameData] = content;
  const C = game.prepareContent({ bundle, cards, game: gameData });
  const [db, user] = await Promise.all([cap("db"), cap("user")]);
  const uid = user ? await user.id().catch(() => null) : null;
  store = makeStore(db, uid);
  auto = writer(store, "auto"); ledgerW = writer(store, "ledger");
  // 판이 열려 있는 채로 새 판본이 오면 (claude.ai가 조용한 틈에 다시 연다): 넘겨받은 판이 저장보다 앞서 있으면 그것으로
  const [saved, ledger0, carried] = await Promise.all([store.get("auto"), store.get("ledger"), hotData]);
  const run0 = carried?.run?.journal && (!saved || carried.run.journal.length >= (saved.journal?.length || 0)) ? carried.run : saved;
  const opts = { fast: sampleProvider("quick"), onSave: (run) => auto.save(run), ledgerStore: { load: () => ledger0, save: (L) => ledgerW.save(L) } };
  try { S = sess.createSession(C, sampleProvider("narr"), { ...opts, run: run0 }); }
  catch (e) {
    console.error("저장을 열지 못했다 — 새 판으로", e);
    if (run0) ls.set(`auto.broken-${Date.now()}`, JSON.stringify(run0));
    S = sess.createSession(C, sampleProvider("narr"), { ...opts, run: null });
  }
  return S;
})();
ready.catch((e) => console.error("엔진을 열지 못했다", e));
// 창을 닫거나 숨기면 기다리던 저장을 바로 — 적어도 이 브라우저에는 남게
addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { auto?.flush(); ledgerW?.flush(); } });

// ── 화면이 부르는 것 (server.mjs의 handle과 같은 표) ──
const nameKey = (name) => `slot-${hex(String(name || "auto").replace(/[^\w가-힣-]/g, "").slice(0, 40) || "auto")}`;
async function handle(path, body, onText) {
  const o = { onText };
  switch (path) {
    case "/api/state": return S.start(o);
    case "/api/act": return S.act(body, o);
    case "/api/regress": return S.regress(o);
    case "/api/new": return S.newGame(body?.seed, o, body?.mode === "story" ? "story" : "grim", body?.narrator || "silent_god", body?.build || null);
    case "/api/creation": return S.creation();
    case "/api/creation/preview": return S.creationPreview(body?.build, body?.seed);
    case "/api/ledger": return S.ledger();
    case "/api/ledger/canon": return S.setCanon(!!body?.on);
    case "/api/narrator": return S.narrator(body?.id);
    case "/api/rewind": return S.rewind(o);
    case "/api/release": return S.release();
    case "/api/save": await store.put(nameKey(body?.name), S.run); return { ok: true, saves: await store.slots() };
    case "/api/load": { const run = await store.get(nameKey(body?.name)); if (!run) return { ...(await S.start(o)), broken: "그 칸이 비어 있다" }; S.load(run); auto.save(S.run); return S.start(o); }
    case "/api/saves": return { saves: await store.slots() };
    case "/api/map": return mapView(S.game);
    case "/api/memo": return S.memo(body?.npc, body?.text);
    case "/api/codex": return S.codex();
    case "/api/codex/entry": return { ...S.codexEntry(String(body?.id || "")), image: null };
    // 링크판에만: 저장 파일로 받기 · 저장 파일에서 이어 하기 (서버판의 saves/auto.json과 같은 모양)
    case "/api/export": {
      const dl = await cap("downloads");
      if (!dl) return { error: "이 화면에서는 파일을 받을 수 없다" };
      try { await dl.save({ filename: `fantasia-${new Date().toISOString().slice(0, 10)}.json`, data: JSON.stringify(S.run) }); return { ok: true }; }
      catch (e) { return { error: e?.code === "declined" ? "받지 않았다" : "파일을 만들지 못했다" }; }
    }
    case "/api/import": {
      const run = body?.run;
      if (!run || typeof run !== "object" || !Array.isArray(run.journal)) return { ...(await S.start(o)), broken: "저장 파일이 아니다 (seed와 journal이 있는 .json)" };
      S.load(run); auto.save(S.run); return S.start(o);
    }
  }
  throw new Error("모르는 요청 " + path);
}
// LLM이 막힌 까닭을 화면의 한 줄에 붙인다 (허락·사용량·로그인 — 다시 시도로는 풀리지 않는 것도 있다)
function explain(out) {
  if (out?.broken) { const why = (out.debug || []).find((d) => d.kind === "error")?.error; if (why && !out.broken.includes(why)) out.broken += ` — ${why}`; }
  return out;
}

// ── fetch 가로채기: '/api/…'만. 나머지(콘텐츠 JSON 등)는 그대로 ──
const realFetch = window.fetch.bind(window);
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
window.fetch = function (input, init = {}) {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";
  const m = /^(?:https?:\/\/[^/]+)?\/?api\/([\w/]+)/.exec(raw);
  if (!m) return realFetch(input, init);
  const path = "/api/" + m[1];
  let body = {}; try { body = init.body ? JSON.parse(init.body) : {}; } catch { /* 빈 몸 */ }
  const accept = String(init.headers?.accept || init.headers?.Accept || "");
  if (accept.includes("text/event-stream")) {
    const enc = new TextEncoder();
    return Promise.resolve(new Response(new ReadableStream({
      async start(ctrl) {
        const send = (ev, data) => ctrl.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`));
        let out;
        try {
          if (!S) send("text", "장부를 펴는 중…");
          await ready;
          out = explain(await handle(path, body, (t) => send("text", t)));
        } catch (e) { out = { broken: String(e?.message || e), retry: body }; }
        send("done", out); ctrl.close();
      },
    }), { headers: { "content-type": "text/event-stream; charset=utf-8" } }));
  }
  return ready.then(() => handle(path, body)).then((out) => json(out), (e) => json({ error: String(e?.message || e) }, 500));
};

// 화면(app.js)이 보는 링크판 표시 — 설정의 '이 페이지에서 하는 판' 칸
window.FANTASIA_WEB = {
  build: BUILD,
  tier: () => tierOf("narr"),
  setTier: (t) => ls.set("tier", t === "quick" ? "quick" : "default"),
  storage: () => (store ? (store.durable ? "account" : "browser") : "loading"),
};
