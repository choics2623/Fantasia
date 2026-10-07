// node engine/game/test_gear.mjs — 장비의 질·닳음·짐 (02 §1 · §3②④⑤), 성장의 눈금 (03 §3 · 19 §8)
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const fresh = (seed = 7) => G.boot(C, G.newRun({ seed, opening: false }));
let n = 0;
const give = (g, gid, extra = {}) => g.L.give("player", { ...C.game.economy.goods[gid], id: `it_${gid}_t${++n}`, gid, ...extra });
const ids = (g) => G.options(g).map((o) => o.id);
const item = (g, id) => G.view(g).player.items.find((i) => i.id === id);
const attackOpt = (g) => G.options(g).find((o) => o.id.startsWith("attack:"));

// ── 질 ──
{ const g = fresh();
  const k = give(g, "knife"), h = give(g, "hook"), m = give(g, "knife", { name: "드워프 단검", quality: "명품" });
  check("이름이 낡은 물건은 조악 (녹슨 접이칼)", item(g, k.id).quality === "조악");
  check("보통 물건은 보통, 정해 준 질은 그대로", item(g, h.id).quality === "보통" && item(g, m.id).quality === "명품"); }

// ── 칼의 질이 싸움을 바꾼다 ──
{ const bare = fresh(), rusty = fresh(), fine = fresh();
  give(rusty, "knife"); give(fine, "knife", { name: "드워프 단검", quality: "명품" });
  const S0 = G.odds(bare, attackOpt(bare)).S, S1 = G.odds(rusty, attackOpt(rusty)), S2 = G.odds(fine, attackOpt(fine)).S;
  check("녹슨 칼: 맨손보다 낫지만 날이 무디다 (+10 −5)", S1.S - S0 === 5 && S1.parts.some((p) => p.text.includes("날이 무디다")), `${S0} → ${S1.S}`);
  check("명품 칼: 훨씬 낫다 (+10 +6)", S2 - S0 === 16, `${S0} → ${S2}`);
  check("판정에 쓴 장비가 기록된다", S1.gear?.some((x) => x.kind === "weapon")); }

// ── 닳음: 20 이하면 한 단계 아래, 0이면 부서진다 ──
{ const g = fresh(), base = fresh();
  const k = give(g, "knife", { name: "쇠칼", quality: "보통" });
  const S0 = G.odds(base, attackOpt(base)).S, S1 = G.odds(g, attackOpt(g)).S;
  k.condition = 15;
  const S2 = G.odds(g, attackOpt(g)).S;
  check("망가지기 직전이면 한 단계 낮게 친다 (보통 → 조악)", S1 - S0 === 10 && S2 - S0 === 5, `${S1 - S0} → ${S2 - S0}`);
  check("화면: 상태는 말로", item(g, k.id).conditionWord === "망가지기 직전" && item(g, k.id).effQuality === "조악");
  k.condition = 0;
  const o = G.odds(g, attackOpt(g));
  check("부서진 칼은 맨손이나 다름없다", o.S === S0 && o.parts.some((p) => p.text.includes("부러졌다")), o.parts.map((p) => p.text).join(" / "));
  check("부서진 칼로는 '칼이 있다'고 하지 않는다", /맨손/.test(attackOpt(g).label), attackOpt(g).label); }

// ── 쓰면 닳는다 (싸움) ──
{ const g = fresh();
  const k = give(g, "knife", { name: "쇠칼", quality: "보통" });
  const r = G.act(g, { id: attackOpt(g).id });
  const c = g.L.items.get(k.id)?.condition;
  check("칼을 휘두르면 닳는다 (4·6·8·15 가운데 하나)", g.ended || [96, 94, 92, 85].includes(c), `${r.tier} → ${c}`); }

// ── 불빛은 탄다: 어두운 곳에서 네 번 뒤지면 양초가 다 탄다 ──
{ const g = fresh();
  const cd = give(g, "candle");
  g.t = Math.ceil(g.t / 1440) * 1440 - 120;   // 밤 열 시
  const notes = [];
  for (let i = 0; i < 6 && g.L.items.has(cd.id); i++) { if (!ids(g).includes("search")) break; const r = G.act(g, { id: "search" }); notes.push(...(r.notes || [])); }
  check("양초가 다 타서 없어진다", !g.L.items.has(cd.id) && notes.some((x) => x.includes("다 타 버렸다")), notes.filter((x) => /양초/.test(x)).join(" / "));
  check("양초가 없으면 어둠이 다시 판정을 누른다", G.odds(g, G.options(g).find((o) => o.id === "search")).parts.some((p) => p.text.includes("어둡다"))); }

// ── 짐: 근력이 정한 한도를 넘으면 몸놀림이 둔해진다 ──
{ const light = fresh(), heavy = fresh();
  for (const g of [light, heavy]) { give(g, "rope"); give(g, "hook"); }
  for (let i = 0; i < 3; i++) give(heavy, "rope");
  const L = G.view(heavy).load;
  const gl = G.options(light).find((o) => o.id === "go:gf_granary"), gh = G.options(heavy).find((o) => o.id === "go:gf_granary");
  const ol = G.odds(light, gl), oh = G.odds(heavy, gh);
  check("짐의 무게 (밧줄 넷 + 갈고리 = 9, 한도 6)", L.total === 9 && L.cap === 6 && L.word === "무겁다", JSON.stringify(L));
  check("짐이 무거우면 은신이 둔해진다", oh.S < ol.S && oh.parts.some((p) => p.text.includes("짐이 무겁다")), `${ol.S} → ${oh.S}`);
  check("가벼우면 그런 말이 없다", !ol.parts.some((p) => p.text.includes("짐이"))); }

// ── 끊어진 밧줄로는 넘지 못한다 ──
{ const g = fresh(); const r = give(g, "rope"); give(g, "hook");
  const o = G.options(g).find((x) => x.id === "go:gf_granary");
  check("도구의 이름으로 근거를 말한다 (갈고리와 밧줄이 있다)", !!o && G.odds(g, o).parts.some((p) => p.text === "갈고리와 밧줄이 있다"), o && G.odds(g, o).parts.map((p) => p.text).join(" / "));
  r.condition = 0;
  check("끊어진 밧줄로는 곡창 지붕 길이 열리지 않는다", !ids(g).includes("go:gf_granary")); }

// ── 화면: 물건 하나의 말 · 숨겨 둔 것 ──
{ const g = fresh();
  const b = give(g, "bread"), k = give(g, "knife");
  const it = item(g, k.id);
  check("물건: 자리·부피·값·금지·쓰임 설명", it.slot === "품" && it.bulk === 1 && it.value === "은화 6닢" && it.illegal && /칼이다/.test(it.desc || ""), JSON.stringify(it));
  check("먹을 것에는 닳음이 없다", item(g, b.id).condition === null && item(g, b.id).eat);
  G.act(g, { id: `stash:${b.id}` });
  const st = G.view(g).stash;
  check("숨겨 둔 것은 어디에 두었는지와 함께", st.length === 1 && st[0].id === b.id && st[0].where === G.view(g).place.name, JSON.stringify(st[0]?.where)); }

// ── 성장의 눈금 ──
{ const g = fresh();
  const V = () => Object.fromEntries(G.view(g).skills.map((k) => [k.name, k]));
  const s = V();
  check("다음 이름과 거기까지의 거리 (화술 22: 쓸 만하다 → 제법이다)", s.화술.word === "쓸 만하다" && s.화술.next === "제법이다" && s.화술.progress > 0 && s.화술.progress < 1, JSON.stringify(s.화술));
  check("글은 글의 말로 (읽고쓰기: 글을 모른다 → 숫자만 읽는다)", s.읽고쓰기.word === "글을 모른다" && s.읽고쓰기.next === "숫자만 읽는다");
  g.P.gain.화술 = 39 - g.P.skills.화술;
  check("잡담으로는 더 늘지 않는 자리에 오면 알려 준다", V().화술.notes.some((x) => x.text.includes("스승")));
  g.P.idle = { 기만: 31 };
  check("오래 쓰지 않으면 무뎌진다는 말", V().기만.notes.some((x) => x.text.includes("무뎌지고")));
  g.P.talent = "shadow";
  check("재능이 있으면 빨리 는다는 말", V().은신.notes.some((x) => x.sign === "▲"));
  G.act(g, { id: "talk:npc_bram" });
  const m = V().통찰.mentors.find((x) => x.npc === "npc_bram");
  check("만난 스승은 '가르칠 사람'으로 (브람 — 아직 믿지 않는다)", m && m.ready === false && m.name, JSON.stringify(m));
  check("몸의 단련도 말로", typeof G.view(g).body.train === "string" && G.view(g).body.weak === true); }

// ── 재생: 닳음도 기록에서 같은 값으로 ──
{ const g = fresh();
  G.act(g, { id: "go:gf_smithy" }); G.act(g, { id: "talk:npc_bran" });
  const buy = G.options(g).find((o) => o.id === "buy:candle");
  if (buy) { G.act(g, { id: "buy:candle" }); if (ids(g).includes("leave")) G.act(g, { id: "leave" }); }
  for (let i = 0; i < 6 && !G.view(g).night; i++) G.act(g, { id: "wait:60" });
  if (ids(g).includes("search")) G.act(g, { id: "search" });
  const mineC = () => G.view(g).player.items.find((i) => i.tags.includes("광원"))?.condition;
  const c1 = mineC();
  const again = G.boot(C, JSON.parse(JSON.stringify(g.run)));
  const c2 = G.view(again).player.items.find((i) => i.tags.includes("광원"))?.condition;
  check("산 양초가 밤에 뒤지는 데 쓰여 닳는다", !!buy && c1 === 75, `${buy ? "샀다" : "못 샀다"} · ${c1}`);
  check("다시 재생해도 닳은 만큼 같다", c1 === c2, `${c1} / ${c2}`); }

console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
