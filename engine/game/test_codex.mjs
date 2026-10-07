// node engine/game/test_codex.mjs — 백과: 아는 만큼만 보이는 카드, 서술에서 들은 이름, 회귀해도 남는 앎, 그리고 돈의 이름
import { loadContent } from "./load.mjs";
import * as G from "./game.mjs";
import * as X from "./codex.mjs";
import { createSession } from "./session.mjs";
import { coinText } from "../sim/text.mjs";
const C = loadContent();
let fail = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); if (!ok) fail++; };
const fresh = (seed = 7) => G.boot(C, G.newRun({ seed, opening: false }));
const lv = (idx, id) => idx.entries.find((e) => e.id === id)?.level || 0;

// ── 돈: 동화·은화·금화 ──
check("돈의 이름: 동화·은화·금화 (은화 = 동화 12, 금화 = 은화 20)", coinText(3) === "동화 3닢" && coinText(24) === "은화 2닢" && coinText(250) === "금화 1닢 동화 10닢" && coinText(0) === "동화 0닢");
{ const g = fresh(); g.at = "gf_rooster"; G.act(g, { id: "talk:npc_bram" });
  const buy = G.options(g).find((o) => o.id.startsWith("buy:"));
  check("물건 값도 금속 이름으로", buy && /동화 1닢에 산다/.test(buy.label) && !/못/.test(buy.label), buy?.label); }

// ── 처음 아는 것 ──
{ const g = fresh(); const idx = X.codexIndex(g);
  check("나고 자란 마을의 이름난 사람은 처음부터 안다 (브람·헨릭·즈닉)", lv(idx, "npc:npc_bram") === 2 && lv(idx, "npc:npc_henrik") === 2 && lv(idx, "npc:npc_znik") >= 2);
  check("먼 고장 사람은 모른다 (목록에 없다)", !idx.entries.some((e) => e.id === "npc:npc_mara"));
  check("세상: 동화·인간은 안다, 엘다르는 들어 본 이름(?)", lv(idx, "gl:gl_copper") === 2 && lv(idx, "gl:gl_human") === 2 && lv(idx, "gl:gl_eldar") === 1);
  check("숨은 것은 목록에도 없다 (돌아옴·잔향 — 첫 회차)", !lv(idx, "gl:gl_return") && !lv(idx, "gl:gl_echo"));
  check("세력: 용제국은 알고, 바르그 조합은 들어 본 이름", lv(idx, "fac:fac_drakmar_empire") === 2 && lv(idx, "fac:fac_barg") === 1);
  check("말: '크릭'은 알고 '하르벡'은 소리뿐", lv(idx, "word:크릭") === 2 && lv(idx, "word:하르벡") === 1);
  check("장소: 회색여울의 곳들은 안다, 바알카르는 이름만", lv(idx, "loc:gf_rooster") === 2 && lv(idx, "node:baalkar") === 1);
  check("같은 곳은 한 번만 (레이번 성채 — 고장의 장소로)", idx.entries.filter((e) => e.name === "레이번 성채").length === 1); }

// ── 카드: 모르는 것은 ?로 ──
{ const g = fresh(); g.at = "gf_rooster"; G.act(g, { id: "ration" });
  const bram = X.codexEntry(g, "npc:npc_bram");
  check("사람 카드: 겉모습·마음·어디쯤", bram.sections.some((s) => s.title === "겉모습") && bram.sections.some((s) => s.title === "지금 어디쯤"), bram.sections.map((s) => s.title).join(","));
  const unk = bram.sections.find((s) => s.title === "모르는 것");
  check("숨긴 것은 ?로 (세 줄까지)", unk && unk.lines.every((l) => l.unknown) && unk.lines.length <= 3 && unk.lines.length >= 1);
  const w = X.codexEntry(g, "word:하르벡");
  check("모르는 낱말은 뜻 대신 ?", w.sections[0].lines[0].unknown);
  const none = X.codexEntry(g, "npc:npc_mara");
  check("모르는 사람의 카드를 열어도 아무것도 새지 않는다", none.name === "?" && none.sections[0].lines[0].unknown); }

// ── 알게 되면 밝혀진다 ──
{ const g = fresh();
  const before = X.codexIndex(g);
  g.P.knows.add("fact_gf_greyash_route"); g.P.knows.add("fact_gb_kit_on_first_list");
  const after = X.codexIndex(g);
  check("사실을 알면 세력이 열린다 (잿빛 실: ? → 안다)", lv(before, "fac:fac_grey_thread") === 1 && lv(after, "fac:fac_grey_thread") >= 2);
  check("매각 명단: 들은 소문 → 안다", lv(before, "gl:gl_sale_list") === 1 && lv(after, "gl:gl_sale_list") === 2);
  check("표지가 바뀐다 (화면이 다시 받는다)", before.sig !== after.sig);
  g.P.knows.add("fact_gf_bram_pays_henrik");
  const bram = X.codexEntry(g, "npc:npc_bram");
  check("숨긴 것 하나를 알면 그 사람은 '깊이 안다'", bram.level === 3, `level ${bram.level}`); }

// ── 서술에서 들은 이름 ──
{ const g = fresh();
  const h = X.heardIn(g, ["울지 마라. 손가락을 센다. 볼크가 바르그 노예사냥 조합의 송곳니들과 왔다. 카스파르는 말이 없다. 잔향이라는 말."]);
  check("들은 이름: 볼크·카스파르·조합·잔향", ["npc:npc_volk", "npc:npc_kaspar", "fac:fac_barg", "gl:gl_echo"].every((x) => h.includes(x)), h.join(","));
  check("흔한 낱말은 이름이 아니다 ('…하지 마라', '손가락', '노예사냥'의 '노예')", !h.includes("npc:npc_mara") && !h.some((x) => /glass_fingers|dp_jan/.test(x)));
  const idx = X.codexIndex(g, { heard: h });
  check("들은 이름은 ?로 목록에 (잔향)", lv(idx, "gl:gl_echo") === 1); }

// ── 회귀해도 아는 것은 남는다 (세션) ──
{ // 서술 검사(아직 모르는 이름 누설)를 지나는 글 — 사람 이름 대신 세력·곳·낱말
  const scripted = "<서술>\n바르그 노예사냥 조합의 개들이 까마귀 문 쪽에서 짖는다. 잔향이라는 낱말이 사제의 입에서 떨어졌다.\n</서술>\n<선택지>\n{\"choices\": []}\n</선택지>";
  const prov = { kind: "mock", usage: { calls: 0, failures: 0 }, async complete() { this.usage.calls++; return scripted; } };
  const S = createSession(C, prov, { run: G.newRun({ seed: 7, opening: false }) });
  await S.start();
  S.game.at = "gf_rooster";
  const r = await S.act({ id: "talk:npc_bram" });
  check("서술에서 들은 이름이 기록된다", !r.broken && ["gl:gl_echo", "fac:fac_barg", "node:crow_gate"].every((x) => (S.run.heard || []).includes(x)), `${r.broken || ""} ${(S.run.heard || []).join(",")}`);
  check("화면에 백과 표지가 간다", typeof r.codexSig === "string" && r.codexSig.length > 0);
  check("세션의 백과 목록·카드", S.codex().entries.length > 50 && S.codexEntry("gl:gl_echo").level === 1);
  // 죽고 돌아온다
  S.game.ended = { kind: "dead", why: "시험", t: S.game.t };
  await S.regress();
  check("회귀해도 들은 이름은 남는다", (S.run.heard || []).includes("gl:gl_echo"), `loop ${S.run.loop}`);
  const idx = S.codex();
  check("회귀하면 '돌아옴'을 안다", lv(idx, "gl:gl_return") === 2);
  check("지난 회차에 만난 사람은 계속 안다 (영혼)", lv(idx, "npc:npc_bram") >= 2); }

console.log(fail ? `\n실패 ${fail}개` : "\n모두 통과"); process.exit(fail ? 1 : 0);
