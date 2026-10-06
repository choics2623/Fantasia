// 회색여울 — 진짜 엔진(24·26·27·28) 위에서 한 판. 내 PC에서 서버를 띄우고, PC와 폰(같은 와이파이)에서 한다.
//   node prototypes/greyford/server.mjs            (Claude Code 구독 — 기본)
//   LLM_PROVIDER=api ANTHROPIC_API_KEY=… node …     (종량제)
//   LLM_PROVIDER=mock node …                        (테스트 전용 가짜 LLM)
// LLM은 필수다 (21 §1): 응답이 없으면 그 턴은 일어나지 않은 것으로 되돌리고 다시 시도를 기다린다.
// 저장: saves/auto.json (시드 + 행동 기록). 다른 칸으로 저장·불러오기도 된다.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadContent } from "../../engine/game/load.mjs";
import { createSession } from "../../engine/game/session.mjs";
import { mapView } from "../../engine/game/game.mjs";
import { createProvider } from "../../engine/llm/provider.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const PORT = Number(process.env.PORT || 5174);
const HOST = process.env.LOCAL_ONLY ? "127.0.0.1" : "0.0.0.0";
const KEY_FILE = join(HERE, ".access-key");
const ACCESS_KEY = process.env.ACCESS_KEY || (existsSync(KEY_FILE) ? readFileSync(KEY_FILE, "utf8").trim() : (() => { const k = randomBytes(6).toString("hex"); writeFileSync(KEY_FILE, k); return k; })());
const SAVES = join(HERE, "saves");
mkdirSync(SAVES, { recursive: true });

// 콘텐츠 묶음이 없거나 낡았으면 만든다
if (!existsSync(join(ROOT, "content/build/game.json"))) execFileSync("python3", [join(ROOT, "tools/build_content.py")], { stdio: "inherit" });
const content = loadContent();
// 서술은 좋은 모델(기본 sonnet — 인물의 말투 카드를 따라 쓰는 힘이 다르다), 해석·기록관은 빠른 모델(기본 haiku)
const provider = createProvider({ model: process.env.LLM_MODEL || (process.env.LLM_PROVIDER === "api" ? "claude-sonnet-5-5" : "sonnet") });
const fast = createProvider({ model: process.env.LLM_FAST_MODEL || (process.env.LLM_PROVIDER === "api" ? "claude-haiku-4-5" : "haiku") });
const slot = (name) => join(SAVES, `${String(name || "auto").replace(/[^\w가-힣-]/g, "")}.json`);
const autosave = (run) => { mkdirSync(SAVES, { recursive: true }); writeFileSync(slot("auto"), JSON.stringify(run)); };   // 저장 폴더가 지워져도 다시 만든다
const session = createSession(content, provider, { fast, run: existsSync(slot("auto")) ? JSON.parse(readFileSync(slot("auto"), "utf8")) : null, onSave: autosave });

function allowed(req, url) {
  const ip = req.socket.remoteAddress || "";
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return true;
  const cookie = /(?:^|; )fkey=([^;]+)/.exec(req.headers.cookie || "")?.[1];
  return url.searchParams.get("key") === ACCESS_KEY || cookie === ACCESS_KEY;
}

async function handle(path, body, onText) {
  if (path === "/api/state") return session.start({ onText });
  if (path === "/api/act") return session.act(body, { onText });
  if (path === "/api/regress") return session.regress({ onText });
  if (path === "/api/new") return session.newGame(body?.seed, { onText });
  if (path === "/api/save") { writeFileSync(slot(body?.name), JSON.stringify(session.run)); return { ok: true, saves: listSaves() }; }
  if (path === "/api/load") { session.load(JSON.parse(readFileSync(slot(body?.name), "utf8"))); return session.start({ onText }); }
  if (path === "/api/saves") return { saves: listSaves() };
  if (path === "/api/map") return mapView(session.game);
  if (path === "/api/memo") return session.memo(body?.npc, body?.text);
  throw new Error("unknown " + path);
}
const listSaves = () => readdirSync(SAVES).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (!allowed(req, url)) { res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }); return res.end("접속 키가 필요합니다. PC의 서버 창에 나온 주소(…?key=…)로 여세요."); }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const headers = { "content-type": "text/html; charset=utf-8" };
      if (url.searchParams.get("key") === ACCESS_KEY) headers["set-cookie"] = `fkey=${ACCESS_KEY}; Path=/; Max-Age=31536000; SameSite=Strict`;
      res.writeHead(200, headers); return res.end(await readFile(join(HERE, "index.html")));
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/")) {
      let raw = ""; for await (const c of req) raw += c;
      const body = raw ? JSON.parse(raw) : {};
      // 스트리밍: 서술이 오는 대로 보낸다 (Server-Sent Events)
      if ((req.headers.accept || "").includes("text/event-stream")) {
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
        const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
        const out = await handle(url.pathname, body, (text) => send("text", text));
        send("done", out); return res.end();
      }
      const out = await handle(url.pathname, body);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" }); return res.end(JSON.stringify(out));
    }
    res.writeHead(404); res.end("not found");
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\n포트 ${PORT}을(를) 이미 다른 프로그램이 쓰고 있다 — 아마 전에 띄운 이 서버가 아직 켜져 있다.`);
    console.error(`  그 창에서 Ctrl+C로 끄거나:  lsof -ti :${PORT} | xargs kill`);
    console.error(`  아니면 다른 포트로:          PORT=${PORT + 1} node prototypes/greyford/server.mjs\n`);
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, HOST, () => {
  console.log(`회색여울 → 이 PC: http://localhost:${PORT}`);
  if (HOST === "0.0.0.0") for (const ip of Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address))
    console.log(`         → 폰(같은 와이파이): http://${ip}:${PORT}/?key=${ACCESS_KEY}`);
  console.log(`LLM: ${provider.kind}${provider.kind === "mock" ? " — 테스트 전용 가짜" : ` (서술 ${provider.model} · 해석·기록관 ${fast.model})`} · 저장: ${SAVES}`);
});
