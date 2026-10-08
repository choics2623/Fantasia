// 링크로 하는 판 (claude.ai Artifact)을 dist/web/에 만든다 — 서버 없이 브라우저에서 엔진이 돈다.
//   node tools/build_web.mjs
// 만드는 것:
//   index.html        페이지 (Artifact가 doctype·head를 씌운다 — 여기엔 title·글꼴·본문만)
//   ui/*.js, app.css  화면 (서버판과 같은 파일)
//   web/boot.js       이음: /api/* 가로채기 · sample(서술) · db(저장)
//   engine/**.js      엔진 — session.mjs에서 import를 따라간 모듈만, .mjs → .js (Artifact가 형식을 알아보게)
//   content/*.json    콘텐츠 묶음 (줄바꿈 없이)
//   art/*.svg         삽화
//   files.json        Artifact에 함께 올릴 파일 목록 (index.html 빼고)
// 올리기: Artifact publish — file_path dist/web/index.html, root dist/web, files = files.json의 목록,
//         capabilities {sample:{}, db:{}, user:{}, downloads:true}. 링크는 prototypes/greyford/README.md에 적어 둔다.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, posix } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "dist/web");
const GF = "prototypes/greyford";
const files = [];
const put = (rel, data) => { const f = join(OUT, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, data); if (rel !== "index.html") files.push(rel); };
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(ROOT, "content/build/game.json"))) execFileSync("python3", [join(ROOT, "tools/build_content.py")], { stdio: "inherit" });
let build = "dev";
try { build = `${execFileSync("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim()} · ${new Date().toISOString().slice(0, 10)}`; } catch { /* git이 없으면 dev */ }

// 1. 엔진: 세션이 닿는 모듈만 (테스트·node 전용 load.mjs·provider.mjs는 빠진다)
const seen = new Set();
function walk(rel) {
  if (seen.has(rel)) return;
  seen.add(rel);
  const src = read(rel);
  for (const m of src.matchAll(/(?:import|export)\s[^;"']*?from\s*["'](\.{1,2}\/[^"']+)["']/g)) walk(posix.normalize(posix.join(posix.dirname(rel), m[1])));
  if (/from\s*["']node:/.test(src)) throw new Error(`브라우저에서 못 도는 모듈: ${rel}`);
  put(rel.replace(/\.mjs$/, ".js"), src.replace(/(from\s*["'])(\.{1,2}\/[^"']+)\.mjs(["'])/g, "$1$2.js$3"));
}
walk("engine/game/session.mjs");
walk("engine/game/game.mjs");

// 2. 화면과 이음
for (const f of readdirSync(join(ROOT, GF, "ui"))) if (/\.(js|css)$/.test(f)) put(`ui/${f}`, read(`${GF}/ui/${f}`));
put("web/boot.js", read(`${GF}/web/boot.js`).replace(/const BUILD = "__BUILD__";/, `const BUILD = ${JSON.stringify(build)};`));

// 3. 콘텐츠 (load.mjs와 같은 세 묶음 — 카드는 cards만)
const min = (x) => JSON.stringify(x);
put("content/whereabouts.json", min(JSON.parse(read("content/build/whereabouts.json"))));
put("content/cards.json", min(JSON.parse(read("content/base/npcs/cards.json")).cards));
put("content/game.json", min(JSON.parse(read("content/build/game.json"))));

// 4. 삽화
for (const f of readdirSync(join(ROOT, "assets/illustrations"))) if (f.endsWith(".svg")) put(`art/${f}`, read(`assets/illustrations/${f}`));

// 5. 페이지: 서버판 index.html의 글꼴·본문 그대로, 경로는 상대로, 이음(web/boot.js)을 화면보다 먼저
const html = read(`${GF}/index.html`);
const title = /<title>[\s\S]*?<\/title>/.exec(html)[0];
const fonts = [...html.matchAll(/<link rel="(?:preconnect|stylesheet)" href="https:\/\/fonts\.[^>]+>/g)].map((m) => m[0]).join("\n");
let body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)[1];
body = body.replace(/<script type="module" src="\/ui\/app\.js"><\/script>/, '<script type="module" src="web/boot.js"></script>\n<script type="module" src="ui/app.js"></script>');
if (!body.includes("web/boot.js")) throw new Error("index.html의 app.js 줄을 찾지 못했다");
put("index.html", `${title}
<meta name="color-scheme" content="dark light">
${fonts}
<link rel="stylesheet" href="ui/app.css">
${body.replace(/(["'(])\/ui\//g, "$1ui/").trim()}
`);

writeFileSync(join(OUT, "files.json"), JSON.stringify(files, null, 1));
const size = files.reduce((n, f) => n + readFileSync(join(OUT, f)).length, 0) + readFileSync(join(OUT, "index.html")).length;
console.log(`dist/web — 판본 ${build} · 파일 ${files.length + 1}개 · ${(size / 1048576).toFixed(1)}MB`);
