// 새 시대 — 잔향이 고를 사람 (06 캐릭터 생성 · §10 생성 화면). 출신 → 능력치 → 재능 → 혈통 → 결점·주사위 → 확인.
// 점수의 셈은 화면이 바로 한다 (누르는 대로 보이게). 주사위의 결과·탄생 서사·최종 검사는 서버가 한다 (/api/creation/preview)
// — 같은 시드로 미리 굴리므로, 미리보기에서 본 주사위가 시작한 판의 주사위다.

const STEPS = [["origin", "출신"], ["stats", "능력치"], ["talents", "재능"], ["blood", "혈통"], ["flaws", "결점·주사위"], ["confirm", "확인"]];
const SKW = (v) => (v < 12 ? "서툴다" : v < 20 ? "어설프다" : v < 30 ? "쓸 만하다" : v < 42 ? "제법이다" : v < 55 ? "능숙하다" : v < 70 ? "뛰어나다" : "경지에 닿았다");
const WORD = { 읽고쓰기: (v) => (v < 1 ? "글을 모른다" : v < 10 ? "숫자만 읽는다" : v < 30 ? "이름과 짧은 말을 읽는다" : "글을 읽는다"), 용언: (v) => (v < 1 ? "쇳소리로만 들린다" : v < 20 ? "아는 낱말만 들린다" : v < 50 ? "반쯤 알아듣는다" : "알아듣는다") };
const NARR = [["silent_god", "침묵하는 신 — 세계는 제 무게대로"], ["old_teller", "늙은 이야기꾼 — 쉬어 가며 하마"], ["ash_teller", "재의 화자 — 가장 나쁜 때에 불탄다"], ["dice", "주사위 — 뼈가 던져진 대로"]];
const DAYW = (hm) => { const h = Number(String(hm).slice(0, 2)); return h < 5 ? "새벽" : h < 10 ? "아침" : h < 16 ? "낮" : h < 21 ? "저녁" : "밤"; };
const HARD = (n) => ["", "순한 삶", "보통의 삶", "고된 삶", "가혹한 삶", "잔혹한 삶"][Math.max(1, Math.min(5, n || 3))];   // 어려움은 말로
let deps = null, D = null, S = null, timer = 0;
const $ = (id) => document.getElementById(id);
const narrow = () => matchMedia("(max-width: 760px)").matches;

export function initCreate(d) {
  deps = d;
  $("createClose").onclick = () => closeCreate();
  $("createPane").addEventListener("keydown", (e) => { if (e.key === "Escape" && S?.canClose) { e.stopPropagation(); closeCreate(); } });
}
export const createOpen = () => !$("create").hidden;
export function closeCreate() { if (!S?.canClose) return; $("create").hidden = true; S = null; }

export async function openCreate({ canClose = true, narrator = "silent_god", mode = "grim", reason = "" } = {}) {
  $("create").hidden = false;
  $("createBody").innerHTML = `<p class="cr-empty">잔향이 고를 사람들을 불러오는 중…</p>`;
  try { D = await deps.post("/api/creation"); } catch (e) { $("createBody").innerHTML = `<p class="cr-empty">못 불렀다 — ${deps.esc(e.message)}</p>`; return; }
  S = { seed: D.seed, step: 0, area: "전부", build: { origin: (D.origins.find((o) => o.canon && !o.locked) || D.origins.find((o) => !o.locked) || D.origins[0]).id, alloc: {}, talents: {}, traits: [], flaws: [], legacy: [], dice: false }, preview: null, canClose, narrator, mode, reason, error: null };
  $("createClose").hidden = !canClose;
  render(); refreshPreview();
  $("createPane").focus({ preventScroll: true });
}

// ── 셈 ──
const T = (id) => D.talents.find((t) => t.id === id);
const TR = (id) => D.traits.find((t) => t.id === id);
const F = (id) => D.flaws.find((t) => t.id === id);
const LG = (id) => (D.legacy || []).find((t) => t.id === id);
const O = () => D.origins.find((o) => o.id === S.build.origin) || D.origins[0];
// 출신이 정한 결점·피 (노예 낙인, 반용의 잠든 비늘): 고를 수도 뺄 수도 없다. 결점은 점수를 돌려준다
const fixF = (o = O()) => o.flaws || [];
const fixT = (o = O()) => o.traits || [];
const tCost = (id, o = O()) => Math.max(0, (TR(id)?.cost || 0) - (o.discount?.[id] || 0));   // 반용은 용심이 싸다
const myTraits = () => [...new Set([...fixT(), ...S.build.traits])];
const myFlaws = () => [...new Set([...fixF(), ...S.build.flaws, ...(S.build.dice && S.preview?.dice?.flaw ? [S.preview.dice.flaw] : [])])];   // 주사위가 준 결점까지
function tp() {
  const R = D.rules, b = S.build; let spent = 0, refund = 0;
  for (const [id, t] of Object.entries(b.talents)) spent += T(id)?.cost[t - 1] || 0;
  for (const id of b.traits) if (!fixT().includes(id)) spent += tCost(id);
  for (const id of b.legacy || []) spent += LG(id)?.cost || 0;
  for (const id of new Set([...fixF(), ...b.flaws])) refund += F(id)?.refund || 0;
  const r = Math.min(R.flaw_max, refund), dice = b.dice ? R.dice_refund : 0;
  return { base: R.tp, refund: r, refundRaw: refund, dice, spent, left: R.tp + r + dice - spent };
}
const used = () => Object.values(S.build.alloc).reduce((a, v) => a + v, 0);
// 능력치의 몫: 바탕(출신 + 배분 — 생성의 상한은 여기까지만 본다) · 피(몸의 특질) · 결점
function statParts(k) {
  const base = O().stats?.[k] ?? 9, add = S.build.alloc[k] || 0, fl = myFlaws();
  let blood = 0; for (const id of myTraits()) blood += Number(TR(id)?.stats?.[k]) || 0;
  const flaw = (k === "체질" && fl.includes("frail") ? -2 : 0) + (k === "감각" && fl.includes("one_eye") ? -2 : 0);
  return { base, add, blood, flaw, v: base + add + blood + flaw };
}
const geniusCount = () => Object.values(S.build.talents).filter((t) => t === 3).length;
const divineCount = () => Object.values(S.build.talents).filter((t) => t === 4).length;
// 피를 더 고를 수 있나: 고른 것은 둘까지 · 함께 들지 않는 피 · 점수
function traitState(t) {
  const R = D.rules, max = R.trait_max ?? 2;
  if (fixT().includes(t.id)) return { on: true, fixed: true };
  if (S.build.traits.includes(t.id)) return { on: true };
  if (t.locked) return { why: `잠겨 있다 — ${t.locked}`, lock: true };
  const mine = new Set(myTraits());
  for (const [a, b] of R.trait_exclusive || []) { const other = t.id === a ? b : t.id === b ? a : null; if (other && mine.has(other)) return { why: `함께 들지 않는 피 — ${TR(other)?.name || other}` }; }
  if (S.build.traits.filter((id) => !fixT().includes(id)).length >= max) return { why: `고르는 피는 ${max}개까지`, quiet: true };   // 위의 '고른 피 n/n'이 말한다 — 칸마다 되풀이하지 않는다
  if (tp().left < tCost(t.id)) return { why: "점수가 모자란다" };
  return {};
}

// ── 그리기 ──
function render() {
  const P = tp();
  $("createSteps").innerHTML = STEPS.map(([k, l], i) => `<button type="button" class="cr-step${i === S.step ? " on" : ""}${i < S.step ? " done" : ""}" data-step="${i}" aria-current="${i === S.step ? "step" : "false"}"><i>${i + 1}</i><span>${l}</span></button>`).join("");
  $("createSteps").querySelectorAll("[data-step]").forEach((b) => (b.onclick = () => go(Number(b.dataset.step))));
  const body = $("createBody"), k = STEPS[S.step][0];
  body.innerHTML = k === "origin" ? originHTML() : k === "stats" ? statsHTML() : k === "talents" ? talentsHTML() : k === "blood" ? bloodHTML() : k === "flaws" ? flawsHTML() : confirmHTML();
  bind();
  const free = D.rules.free_stats - used();
  $("createFoot").innerHTML = `<div class="cr-meters">
      <span class="cr-tp${P.left < 0 ? " over" : ""}" title="재능 포인트 — 기본 ${P.base}${P.refund ? ` + 결점 ${P.refund}` : ""}${P.dice ? ` + 주사위 ${P.dice}` : ""}"><b>재능 포인트</b><em>${P.left}</em><small>/ ${P.base + P.refund + P.dice}</small></span>
      <span class="cr-tp sm${free < 0 ? " over" : ""}"><b>능력치</b><em>${free}</em><small>점 남음</small></span></div>
    <div class="cr-nav">${S.step > 0 ? `<button type="button" class="btn" id="crPrev">‹ 이전</button>` : ""}${S.step < STEPS.length - 1 ? `<button type="button" class="btn primary" id="crNext">다음 ›</button>` : `<button type="button" class="btn primary" id="crStart"${P.left < 0 || free < 0 || O().locked ? " disabled" : ""}>이 삶을 시작한다</button>`}</div>`;
  $("crPrev")?.addEventListener("click", () => go(S.step - 1));
  $("crNext")?.addEventListener("click", () => go(S.step + 1));
  $("crStart")?.addEventListener("click", start);
  $("createTitle").textContent = S.reason || "새 시대 — 잔향이 고를 사람";
}
function go(i) { S.step = Math.max(0, Math.min(STEPS.length - 1, i)); render(); $("createBody").scrollTop = 0; }

// 출신: 고장마다 묶은 목록 + 고른 사람의 자세한 면 (넓은 화면은 옆에, 폰은 고른 줄 바로 밑에)
function originHTML() {
  const esc = deps.esc, o = O(), groups = [], LD = D.ledger || {};
  for (const x of D.origins) {
    const key = x.branch ? "branch" : x.region;
    let g = groups.find((y) => y.key === key);
    if (!g) groups.push((g = { key, label: x.branch ? `${x.region} — 게르다의 셋째, 다섯 갈래` : x.region, items: [] }));
    g.items.push(x);
  }
  const row = (x) => `<button type="button" class="cr-orow${x.id === o.id ? " on" : ""}${x.locked ? " locked" : ""}" role="radio" aria-checked="${x.id === o.id}" data-origin="${esc(x.id)}">
      <span class="cr-orn"><b>${esc(x.name)}</b>${x.canon ? `<span class="cr-badge">정본</span>` : ""}<span class="cr-diff">${x.locked ? "잠김" : HARD(x.difficulty)}</span></span>
      <span class="cr-ors">${esc([`${DAYW(x.time)} ${x.time}`, x.place || x.settlementName, `${x.age}살`].filter(Boolean).join(" · "))}</span></button>${x.id === o.id ? `<div class="cr-odetail inline">${detailHTML(x)}</div>` : ""}`;
  // 잔향의 장부: 지난 시대가 남긴 것 (첫 시대에는 없다)
  const led = LD.eras ? [`지난 시대 ${LD.eras}`, `새긴 업적 ${LD.achievements}`, LD.tp ? `재능 포인트 +${LD.tp}` : null, LD.canon ? "정본 해금 켬" : null].filter(Boolean) : [];
  return `<p class="cr-lead">잔향은 한 시대에 한 사람에게 깃든다. 고른 사람이 <b>붕괴력 312년 9월 1일</b>에 서 있던 자리와 시각이 회귀점이 된다.</p>
    ${led.length ? `<div class="cr-ledger" title="잔향의 장부 — 시대를 건너 남는 것">${led.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}
    <div class="cr-ogrid"><div class="cr-olist" role="radiogroup" aria-label="출신 — ${D.origins.length}명">${groups.map((g) => `<div class="cr-og" role="group" aria-label="${esc(g.label)}"><h4 class="cr-h">${esc(g.label)}</h4>${g.items.map(row).join("")}</div>`).join("")}</div>
      <div class="cr-odetail side">${detailHTML(o)}</div></div>`;
}
function detailHTML(x) {
  const esc = deps.esc;
  const top = Object.entries(x.skills || {}).filter(([k]) => !WORD[k]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const lit = Object.entries(x.skills || {}).filter(([k, v]) => WORD[k] && v > 0);
  const fixed = [
    ...(x.flaws || []).map((id) => { const f = F(id); return f ? `<span class="cr-chip bad" title="${esc(f.desc)}">${esc(f.name)}${x.flawNote?.[id] ? ` — ${esc(x.flawNote[id])}` : ""} <em>+${f.refund}</em></span>` : ""; }),
    ...(x.traits || []).map((id) => { const t = TR(id); return t ? `<span class="cr-chip gold" title="${esc(t.desc)}">${esc(t.name)}</span>` : ""; }),
  ].filter(Boolean);
  const disc = Object.entries(x.discount || {}).filter(([id]) => TR(id)).map(([id, n]) => `${TR(id).name}이(가) ${n}점 싸다`);
  return `<div class="cr-oh"><b>${esc(x.name)}</b>${x.canon ? `<span class="cr-badge">정본</span>` : ""}<span class="cr-diff">${HARD(x.difficulty)}</span></div>
    <div class="cr-ot">${esc(x.title)}</div>
    ${x.locked ? `<div class="cr-lock">잠겨 있다 — ${esc(x.locked)}. 정본 해금을 끄면(수첩 · 설정 · 잔향의 장부) 지금 고를 수 있다.</div>` : ""}
    <dl class="cr-ofacts"><dt>회귀점</dt><dd>9월 1일 ${DAYW(x.time)} ${esc(x.time)} — ${esc(x.place || x.region)}${x.settlementName && !String(x.place || "").includes(x.settlementName) ? ` <span class="faint">(${esc(x.settlementName)})</span>` : ""}</dd>
      <dt>나이</dt><dd>${x.age}살</dd><dt>불리는 이름</dt><dd>${esc(x.call)}</dd>${x.free ? `<dt>매인 곳</dt><dd>없다 — 자유민. 떠나도 탈주가 아니다</dd>` : ""}</dl>
    <p class="cr-ob">${esc(x.blurb)}</p>
    <div class="cr-skills">${top.map(([k, v]) => `<span>${esc(k)} <em>${SKW(v)}</em></span>`).join("")}${lit.map(([k, v]) => `<span>${esc(k)} <em>${WORD[k](v)}</em></span>`).join("")}</div>
    <div class="cr-pb">${(x.perks || []).length ? `<span class="up"><span class="k">이 삶이 준 것</span>${x.perks.map((p) => `<span>${esc(p)}</span>`).join("")}</span>` : ""}${(x.burdens || []).length ? `<span class="down"><span class="k">이 삶의 짐</span>${x.burdens.map((p) => `<span>${esc(p)}</span>`).join("")}</span>` : ""}</div>
    ${fixed.length ? `<div class="cr-fixed"><span class="cr-fl">출신이 정한 것 — 뺄 수 없다</span><span>${fixed.join("")}</span>${disc.length ? `<small>${esc(disc.join(" · "))}</small>` : ""}</div>` : ""}
    <div class="cr-oi">${x.items.length ? `지닌 것 — ${esc(x.items.join(", "))} · ` : ""}돈 — ${esc(coin(x.coin))}</div>
    <button type="button" class="btn primary cr-pick" data-next${x.locked ? " disabled" : ""}>이 사람으로 — 능력치 ›</button>`;
}
const coin = (n) => { if (!n) return "없다"; const parts = [[Math.floor(n / 240), "금화"], [Math.floor((n % 240) / 12), "은화"], [n % 12, "동화"]].filter(([v]) => v); return parts.map(([v, k]) => `${k} ${v}닢`).join(" "); };

function statsHTML() {
  const esc = deps.esc, o = O(), R = D.rules, free = R.free_stats - used();
  const anyBlood = R.stats.some((s) => statParts(s.id).blood), anyFlaw = R.stats.some((s) => statParts(s.id).flaw);
  return `<p class="cr-lead">인간의 바탕은 모두 9. ${esc(o.name)}의 ${o.age}해가 남긴 것 위에 <b>${R.free_stats}점</b>을 더한다. 생성 때는 ${R.stat_max}까지 — 피(혈통)가 더하는 것은 그 위에 따로 붙는다.</p>
    <div class="cr-stats">${R.stats.map((s) => {
      const x = statParts(s.id);
      return `<div class="cr-stat"><div class="cr-sn"><b>${esc(s.id)}</b><small>${esc(s.desc)}</small></div>
        <div class="cr-sv"><button type="button" class="btn" data-stat="${esc(s.id)}" data-d="-1" aria-label="${esc(s.id)} 빼기"${x.add <= 0 ? " disabled" : ""}>−</button>
        <span class="cr-num"><b>${x.v}</b>${x.add ? `<em>+${x.add}</em>` : ""}${x.blood ? `<em class="blood" title="피가 더한 것">${x.blood > 0 ? "+" : ""}${x.blood} 피</em>` : ""}${x.flaw ? `<em class="bad" title="결점이 깎은 것">${x.flaw}</em>` : ""}</span>
        <button type="button" class="btn" data-stat="${esc(s.id)}" data-d="1" aria-label="${esc(s.id)} 더하기"${free <= 0 || x.base + x.add >= R.stat_max ? " disabled" : ""}>＋</button></div>
        <span class="cr-bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, Math.round(((x.v - 4) / 11) * 100)))}%"></i><i class="base" style="left:${Math.round(((9 - 4) / 11) * 100)}%"></i></span></div>`;
    }).join("")}</div>
    <p class="cr-note">숫자는 이 화면에서만 보인다. 판에서는 몸의 말로 — "팔에 힘이 없다", "눈이 밝다".${anyBlood ? " '피'는 몸의 특질이 더하거나 깎은 것." : ""}${anyFlaw ? " 붉은 숫자는 결점이 깎은 것." : ""}</p>`;
}

function talentsHTML() {
  const esc = deps.esc, R = D.rules, P = tp(), o = O();
  const areas = ["전부", ...R.areas];
  const list = D.talents.filter((t) => S.area === "전부" || t.area === S.area);
  const anyDivine = D.talents.some((t) => t.divineOpen);
  return `<p class="cr-lead">재능은 처음의 힘이 아니라 <b>얼마나 빨리, 얼마나 높이</b> 자라는지를 정한다 — 소질·수재·천재${anyDivine ? ", 그리고 장부가 연 재능의 신재" : ""}. 남긴 점수는 첫 회귀 때 어둠 속에서 재능을 깨운다.</p>
    ${o.presets?.length ? `<div class="cr-presets"><span>추천 — ${esc(o.name)}</span>${o.presets.map((p, i) => `<button type="button" class="btn" data-preset="${i}">${esc(p.name)}</button>`).join("")}<button type="button" class="btn" data-preset="clear">비우기</button></div>` : ""}
    <div class="cr-areas" role="tablist" aria-label="재능의 분야">${areas.map((a) => `<button type="button" role="tab" aria-selected="${a === S.area}" data-area="${esc(a)}">${esc(a)}<small>${a === "전부" ? D.talents.length : D.talents.filter((t) => t.area === a).length}</small>${a !== "전부" && D.talents.some((t) => t.area === a && S.build.talents[t.id]) ? "<i></i>" : ""}</button>`).join("")}</div>
    <div class="cr-talents">${list.map((t) => {
      const cur = S.build.talents[t.id] || 0, max = t.max || R.tier_names.length - 1;
      const tiers = R.tier_names.slice(0, max).map((nm, i) => {
        const k = i + 1, cost = t.cost[i], delta = cost - (cur ? t.cost[cur - 1] : 0);
        const why = k === 4 && !t.divineOpen ? "신재 — 잔향의 장부가 아직 열지 않았다" : k === 4 && cur !== 4 && divineCount() >= (R.divine_max ?? 1) ? `신재는 ${R.divine_max ?? 1}개까지` : k === 3 && cur !== 3 && geniusCount() >= R.genius_max ? `천재는 ${R.genius_max}개까지` : k !== cur && P.left - delta < 0 ? "점수가 모자란다" : "";
        return `<button type="button" class="cr-tier${k <= cur ? " on" : ""}${k === 4 ? " divine" : ""}" data-talent="${esc(t.id)}" data-tier="${k}" aria-pressed="${k === cur}" title="${esc(nm)} — 누적 ${cost}점${why ? ` · ${why}` : ""}"${why && k !== cur ? " disabled" : ""}><span>${esc(nm)}</span><small>${cost}</small></button>`;
      }).join("");
      const eff = cur === 4 && t.divine ? `${t.divine.name} — ${t.divine.text}` : t.tiers[Math.max(0, Math.min(cur, 3) - 1)] || "";
      const gr = t.grow.length ? `${t.grow.join("·")} — 성장 ×${R.growth[Math.max(0, cur - 1)]}${Object.keys(t.skills).length ? ` · 처음부터 ${Object.entries(t.skills).map(([k, v]) => `${k} +${Math.round(v * [1, 1.5, 2, 2.5][Math.max(0, cur - 1)])}`).join(", ")}` : ""}` : "";
      // 비기: 고른 재능에만 — 무엇이, 무엇을 얼마나 익히면 열리나
      const arts = cur && (t.arts || []).length ? `<div class="cr-arts"><span class="k">비기</span>${t.arts.map((a) => `<span class="a${(a.tier <= 4 ? cur >= a.tier : cur >= 4) ? " on" : ""}" title="${esc(a.desc)}">${esc(a.name)} (${a.tier === 5 ? "오의 · 신재" : R.tier_names[a.tier - 1]} · ${esc(a.skill)} ${a.req})</span>`).join("")}</div>` : "";
      return `<div class="cr-talent${cur ? " on" : ""}"><div class="cr-tn"><b>${esc(t.name)}</b><span class="cr-size">${t.size === "major" ? "큰" : "작은"}</span><span class="cr-area">${esc(t.area)}</span>${t.divineOpen ? `<span class="cr-badge" title="잔향의 장부가 신재를 열었다">신재</span>` : ""}</div>
        <div class="cr-tiers">${tiers}${cur ? `<button type="button" class="cr-tier off" data-talent="${esc(t.id)}" data-tier="0" aria-label="${esc(t.name)} 빼기">✕</button>` : ""}</div>
        <div class="cr-te">${cur ? "" : "<span class='faint'>소질이면 — </span>"}${cur === 4 ? `<span class="dv">${esc(eff)}</span>` : esc(eff)}${gr ? `<small>${esc(gr)}</small>` : ""}</div>${arts}</div>`;
    }).join("")}</div>
    <p class="cr-note">비기는 재능의 등급과 그 스킬이 함께 차면 판에서 열린다. ${anyDivine ? "" : "신재는 잔향의 장부가 연다 — 그 재능의 스킬이 85에 닿았거나, 천재로 세 회차를 살았으면. "}피에 새겨진 것은 다음 차례, 혈통에서.</p>`;
}

// 혈통: 몸의 특질 — 같은 몸으로 돌아오므로 시대 내내 그대로. 그 아래 유산 (장부의 업적이 연 작은 특질)
function bloodHTML() {
  const esc = deps.esc, R = D.rules, o = O(), max = R.trait_max ?? 2;
  const shown = D.traits.filter((t) => !t.origin_only || fixT().includes(t.id)).sort((a, b) => fixT().includes(b.id) - fixT().includes(a.id));
  const chosen = S.build.traits.filter((id) => !fixT().includes(id)).length;
  const excl = (R.trait_exclusive || []).map(([a, b]) => `${TR(a)?.name} · ${TR(b)?.name}`);
  const LGs = D.legacy || [], P = tp(), lockedN = D.ledger?.legacyLocked || 0;
  return `<p class="cr-lead">피는 같은 몸으로 돌아오므로 <b>시대 내내 그대로</b>다. ${max === 2 ? "둘" : `${max}개`}까지 고르고${fixT().length ? " (출신이 정한 피는 세지 않는다)" : ""}, 값은 재능과 같은 점수에서 나간다. <span class="cr-count">고른 피 <b>${chosen}/${max}</b></span></p>
    <div class="cr-flaws">${shown.map((t) => {
      const st = traitState(t), full = t.cost || 0, cost = tCost(t.id);
      const price = st.fixed ? `<em class="fix">출신</em>` : `<em>${cost < full ? `<s>${full}</s> ` : ""}${cost}점</em>`;
      const inner = `<b>${esc(t.name)}</b>${price}<small>${esc(t.desc)}</small>${st.fixed ? `<span class="cr-why">${esc(o.name)}의 피 — 뺄 수 없다</span>` : st.why && !st.quiet ? `<span class="cr-why${st.lock ? " lock" : ""}">${esc(st.why)}</span>` : ""}`;
      return st.fixed ? `<div class="cr-flaw trait on fixed">${inner}</div>`
        : `<button type="button" class="cr-flaw trait${st.on ? " on" : ""}" data-trait="${esc(t.id)}" aria-pressed="${!!st.on}"${!st.on && st.why ? ` disabled title="${esc(st.why)}"` : ""}>${inner}</button>`;
    }).join("")}</div>
    ${excl.length ? `<p class="cr-note">한 몸에 들지 않는 피 — ${esc(excl.join(" / "))}.</p>` : ""}
    <p class="cr-note">피가 더하는 능력치는 생성의 상한(${R.stat_max})과 따로 센다. 피를 고르지 않아도 된다 — 평범한 인간의 몸으로 산다.</p>
    ${LGs.length || lockedN ? `<h4 class="cr-h">유산 — 지난 시대의 업적이 연 것</h4>
    ${LGs.length ? `<div class="cr-flaws">${LGs.map((l) => { const on = (S.build.legacy || []).includes(l.id), poor = !on && P.left < (l.cost || 0);
      return `<button type="button" class="cr-flaw trait${on ? " on" : ""}" data-legacy="${esc(l.id)}" aria-pressed="${on}"${poor ? " disabled" : ""}><b>${esc(l.name)}</b><em>${l.cost}점</em><small>${esc(l.desc)}</small>${poor ? `<span class="cr-why">점수가 모자란다</span>` : ""}</button>`; }).join("")}</div>` : ""}
    ${lockedN ? `<p class="cr-note">아직 잠긴 유산 ${lockedN}개 — 회차와 시대를 건너 업적을 새기면 열린다.</p>` : ""}` : ""}`;
}
function flawsHTML() {
  const esc = deps.esc, R = D.rules, P = tp(), pv = S.preview, o = O();
  const fixed = fixF().map(F).filter(Boolean), rest = D.flaws.filter((f) => !fixF().includes(f.id));
  return `<p class="cr-lead">결점은 점수를 돌려준다 — 합쳐서 <b>${R.flaw_max}점</b>까지. 돌려받은 점수: ${P.refund}${P.refundRaw > R.flaw_max ? ` <span class="bad">(${P.refundRaw}점어치 — ${R.flaw_max}점까지만)</span>` : ""}</p>
    <div class="cr-flaws">${fixed.map((f) => `<div class="cr-flaw on fixed"><b>${esc(f.name)}</b><em>+${f.refund}</em><small>${esc(f.desc)}</small><span class="cr-why">${esc(o.name)} — ${esc(o.flawNote?.[f.id] || "출신이 정한 것")} · 뺄 수 없다</span></div>`).join("")}
      ${rest.map((f) => { const on = S.build.flaws.includes(f.id); return `<button type="button" class="cr-flaw${on ? " on" : ""}" data-flaw="${esc(f.id)}" aria-pressed="${on}"><b>${esc(f.name)}</b><em>+${f.refund}</em><small>${esc(f.desc)}</small></button>`; }).join("")}</div>
    <h4 class="cr-h">운명의 주사위</h4>
    <button type="button" class="cr-dice${S.build.dice ? " on" : ""}" id="crDice" aria-pressed="${S.build.dice}"><span class="die" aria-hidden="true">⚄</span><span><b>운명에 맡긴다</b><small>무작위 재능 하나(가진 것이면 한 등급 위) + ${R.dice_refund}점. 셋에 하나꼴로 결점도 하나 — 그 결점은 점수를 돌려주지 않는다.</small></span></button>
    ${S.build.dice ? `<div class="cr-roll" aria-live="polite">${pv?.dice ? `주사위 — <b>${esc(T(pv.dice.talent)?.name || pv.dice.talent)} ${esc(R.tier_names[pv.dice.tier - 1])}</b>${pv.dice.flaw ? ` · 결점 <b class="bad">${esc(F(pv.dice.flaw)?.name)}</b>` : " · 결점은 없다"}` : "주사위를 굴리는 중…"} <button type="button" class="btn ghost" id="crReroll" title="다른 시드로 — 숨은 재능도 바뀐다">다시 굴린다</button></div>` : ""}
    <h4 class="cr-h">숨은 재능</h4>
    <p class="cr-note">게임이 몰래 ${R.hidden}개를 심는다 — 고르지 않은 분야에. 위태로운 판정에서 크게 성공하거나 스승에게 처음 배울 때 드러나고, 드러나면 회귀해도 남는다.</p>`;
}

function confirmHTML() {
  const esc = deps.esc, R = D.rules, o = O(), P = tp(), pv = S.preview;
  const tl = Object.entries(S.build.talents).sort((a, b) => b[1] - a[1]);
  const errs = pv?.check?.errors || [], TT = myTraits(), FF = myFlaws();
  return `<div class="cr-names">
      <label class="cr-name"><span>진짜 이름</span><input id="crName" maxlength="8" autocomplete="off" value="${esc(S.build.name || "")}" placeholder="비워 두면 첫 장면에서"><small>${o.family ? "어머니만 부르는 이름" : "이 삶에서 아는 사람이 드문 이름"}. 회귀해도 남는다.</small></label>
      ${o.family ? `<div class="cr-name"><span>키트에게 너는</span><span class="seg" id="crSib">${["형", "누나"].map((x) => `<button type="button" data-sib="${x}" aria-pressed="${(S.build.sibling || "형") === x}">${x}</button>`).join("")}</span></div>` : ""}
      <label class="cr-name"><span>불리는 이름</span><input id="crCall" maxlength="8" autocomplete="off" value="${esc(S.build.call || "")}" placeholder="${esc(o.call)}"><small>세상이 너를 부르는 이름. 비워 두면 '${esc(o.call)}'.</small></label>
    </div>
    <div class="cr-sum">
      <p class="cr-birth">${esc(pv?.line || "…")}</p>
      <dl>
        <dt>출신</dt><dd><span><b>${esc(o.name)}</b> — ${esc(o.title)}</span></dd>
        <dt>회귀점</dt><dd>9월 1일 ${DAYW(o.time)} ${esc(o.time)} — ${esc(o.place || o.region)}</dd>
        <dt>능력치</dt><dd class="cr-sline">${R.stats.map((s) => `<span>${esc(s.id)} <b>${statParts(s.id).v}</b></span>`).join("")}</dd>
        <dt>재능</dt><dd>${tl.length ? tl.map(([id, t]) => `<span class="cr-chip${t === 4 ? " gold" : ""}">${esc(t === 4 && T(id)?.divine ? T(id).divine.name : T(id)?.name)} <em>${esc(R.tier_names[t - 1])}</em></span>`).join("") : pv?.dice ? "" : "<span class='faint'>없다 — 평범한 인간처럼 자란다</span>"}${pv?.dice ? `<span class="cr-chip dice">주사위 — ${esc(T(pv.dice.talent)?.name)} <em>${esc(R.tier_names[pv.dice.tier - 1])}</em></span>` : ""}</dd>
        ${TT.length ? `<dt>혈통</dt><dd>${TT.map((id) => `<span class="cr-chip gold">${esc(TR(id)?.name)}</span>`).join("")}</dd>` : ""}
        ${(S.build.legacy || []).length ? `<dt>유산</dt><dd>${S.build.legacy.map((id) => `<span class="cr-chip gold">${esc(LG(id)?.name || id)}</span>`).join("")}</dd>` : ""}
        ${FF.length ? `<dt>결점</dt><dd>${FF.map((id) => `<span class="cr-chip bad">${esc(F(id)?.name)}</span>`).join("")}</dd>` : ""}
        <dt>남긴 점수</dt><dd>${P.left > 0 ? `${P.left}점 — 첫 회귀 때 잔향에 남는다` : "없다"}</dd>
        <dt>숨은 재능</dt><dd>${pv?.hidden ?? R.hidden}개 — 하다 보면 알게 된다</dd>
      </dl>
      ${S.build.name ? "" : `<p class="cr-note">진짜 이름을 비워 두면 첫 장면에서 정한다 — 그 삶에서 그 이름을 아는 사람이 부른다.</p>`}
      ${errs.length ? `<div class="cr-err">${errs.map((e) => `<div>${esc(e)}</div>`).join("")}</div>` : ""}
      ${S.error ? `<div class="cr-err">${esc(S.error)}</div>` : ""}
    </div>
    <h4 class="cr-h">이야기의 결</h4>
    <div class="cr-mode"><span class="seg" id="crMode">${[["grim", "그림다크"], ["story", "이야기 — 아침으로 되돌리기 3번"]].map(([k, l]) => `<button type="button" data-mode="${k}" aria-pressed="${S.mode === k}">${l}</button>`).join("")}</span>
      <select id="crNarr" aria-label="화자">${NARR.map(([id, lab]) => `<option value="${id}"${S.narrator === id ? " selected" : ""}>${lab}</option>`).join("")}</select></div>`;
}

function bind() {
  const body = $("createBody");
  body.querySelectorAll("[data-origin]").forEach((b) => (b.onclick = () => {
    const id = b.dataset.origin;
    if (S.build.origin === id) return;
    S.build.origin = id; S.build.alloc = {};   // 바탕이 바뀌면 배분을 다시
    if (!D.origins.find((x) => x.id === id)?.family) delete S.build.sibling;
    const o = O();   // 새 출신이 정한 결점·피는 고른 목록에서 뺀다 (저절로 든다) · 그 피로 태어나야 하는 특질은 못 가져간다
    S.build.flaws = S.build.flaws.filter((f) => !fixF(o).includes(f));
    S.build.traits = S.build.traits.filter((t) => !fixT(o).includes(t) && !TR(t)?.origin_only);
    render(); refreshPreview();
    const on = body.querySelector(".cr-orow.on");
    on?.focus({ preventScroll: true });
    if (narrow()) on?.scrollIntoView({ block: "start", behavior: "smooth" });
  }));
  body.querySelectorAll("[data-next]").forEach((b) => (b.onclick = () => go(S.step + 1)));
  body.querySelectorAll("[data-stat]").forEach((b) => (b.onclick = () => {
    const k2 = b.dataset.stat, d = Number(b.dataset.d), cur = S.build.alloc[k2] || 0, x = statParts(k2);
    if (d > 0 && (used() >= D.rules.free_stats || x.base + x.add >= D.rules.stat_max)) return;
    S.build.alloc[k2] = Math.max(0, cur + d); if (!S.build.alloc[k2]) delete S.build.alloc[k2];
    render(); body.querySelector(`[data-stat="${CSS.escape(k2)}"][data-d="${d}"]`)?.focus();
  }));
  body.querySelectorAll("[data-area]").forEach((b) => (b.onclick = () => { S.area = b.dataset.area; render(); body.querySelector(`[data-area="${CSS.escape(S.area)}"]`)?.focus(); }));
  body.querySelectorAll("[data-talent]").forEach((b) => (b.onclick = () => {
    const id = b.dataset.talent, k2 = Number(b.dataset.tier);
    if (!k2 || S.build.talents[id] === k2) delete S.build.talents[id]; else S.build.talents[id] = k2;
    render(); refreshPreview();
  }));
  body.querySelectorAll("[data-trait]").forEach((b) => (b.onclick = () => {
    const id = b.dataset.trait;
    S.build.traits = S.build.traits.includes(id) ? S.build.traits.filter((x) => x !== id) : [...S.build.traits, id];
    render(); refreshPreview(); body.querySelector(`[data-trait="${CSS.escape(id)}"]`)?.focus();
  }));
  body.querySelectorAll("[data-legacy]").forEach((b) => (b.onclick = () => {
    const id = b.dataset.legacy, cur = S.build.legacy || [];
    S.build.legacy = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    render(); refreshPreview(); body.querySelector(`[data-legacy="${CSS.escape(id)}"]`)?.focus();
  }));
  body.querySelectorAll("[data-flaw]").forEach((b) => (b.onclick = () => {
    const id = b.dataset.flaw;
    S.build.flaws = S.build.flaws.includes(id) ? S.build.flaws.filter((x) => x !== id) : [...S.build.flaws, id];
    render(); refreshPreview(); body.querySelector(`[data-flaw="${CSS.escape(id)}"]`)?.focus();
  }));
  body.querySelectorAll("[data-preset]").forEach((b) => (b.onclick = () => {
    if (b.dataset.preset === "clear") { S.build.talents = {}; S.build.traits = []; S.build.alloc = {}; S.build.legacy = []; }
    else { const p = O().presets[Number(b.dataset.preset)]; S.build.talents = { ...(p.talents || {}) }; S.build.traits = (p.traits || []).filter((id) => !fixT().includes(id)); S.build.alloc = { ...(p.stats || {}) }; }
    render(); refreshPreview();
  }));
  const dice = $("crDice"); if (dice) dice.onclick = () => { S.build.dice = !S.build.dice; render(); refreshPreview(); };
  const rr = $("crReroll"); if (rr) rr.onclick = () => { S.seed = Math.floor(Math.random() * 1e6); S.preview = null; render(); refreshPreview(); };
  body.querySelectorAll("#crMode [data-mode]").forEach((b) => (b.onclick = () => { S.mode = b.dataset.mode; render(); }));
  const nr = $("crNarr"); if (nr) nr.onchange = () => { S.narrator = nr.value; };
  for (const [id, k] of [["crName", "name"], ["crCall", "call"]]) { const el = $(id); if (el) el.oninput = () => { const v = el.value.trim(); if (v) S.build[k] = v; else delete S.build[k]; refreshPreview(); }; }
  body.querySelectorAll("#crSib [data-sib]").forEach((b) => (b.onclick = () => { S.build.sibling = b.dataset.sib; body.querySelectorAll("#crSib [data-sib]").forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
}

// 서버의 미리보기: 주사위·탄생 서사·검사 (멈춘 뒤 한 번)
function refreshPreview() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!S) return;
    const want = JSON.stringify([S.build, S.seed]);
    try {
      const pv = await deps.post("/api/creation/preview", { build: S.build, seed: S.seed });
      if (!S || JSON.stringify([S.build, S.seed]) !== want) return;
      S.preview = pv;
      if (["flaws", "confirm"].includes(STEPS[S.step][0])) {
        // 이름을 쓰는 중이면 다시 그리지 않는다 (글자가 끊긴다) — 탄생 서사 한 줄만 바꾼다
        if (document.activeElement?.closest?.(".cr-names")) { const bl = document.querySelector(".cr-birth"); if (bl) bl.textContent = pv?.line || "…"; }
        else render();
      }
    } catch { /* 미리보기가 없어도 시작은 서버가 다시 검사한다 */ }
  }, 180);
}

async function start() {
  const btn = $("crStart"); if (btn) { btn.disabled = true; btn.textContent = "시간이 접힌다…"; }
  S.error = null;
  const body = { build: S.build, seed: S.seed, mode: S.mode, narrator: S.narrator };
  const keep = S;
  $("create").hidden = true;
  const d = await deps.start(body);
  if (d?.error) { S = keep; S.error = d.error; S.step = STEPS.length - 1; $("create").hidden = false; render(); return; }
  S = null;
}
