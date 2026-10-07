// 백과 (화면 쪽): 이야기 속 이름을 잇고, 마우스를 올리면 미리보기, 누르면 카드. 수첩의 '백과' 칸.
// 아는 정도: 1 = 들어 본 이름 (점선 밑줄 + ?), 2 = 안다, 3 = 깊이 안다 (숨은 사정을 하나라도 안다).
// 서버(engine/game/codex.mjs)가 정한 것만 보인다 — 화면은 아는 것보다 더 보여 주지 않는다.

const KIND = { npc: "사람", loc: "장소", node: "장소", reg: "땅", fac: "세력", word: "말", gl: "세상" };
const JOSA1 = new Set([..."이가은는을를의에와과도만로으께랑야아처보까부마조뿐한씨들"]);
let deps = null, index = { sig: "", entries: [] }, names = [], byId = new Map(), loading = null;
let enabled = true, tipTimer = 0, history = [];

export function initCodex(d) {
  deps = d;
  enabled = d.store.get("links", true);
  // 이야기 안의 이름: 누르기 / 키보드 / 마우스 올리기 (위임)
  document.addEventListener("click", (e) => { const t = e.target.closest?.(".ent"); if (t) { e.preventDefault(); openCard(t.dataset.ent); } });
  document.addEventListener("keydown", (e) => { const t = e.target.closest?.(".ent"); if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openCard(t.dataset.ent); } });
  if (window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) {
    document.addEventListener("mouseover", (e) => { const t = e.target.closest?.(".ent"); if (!t) return; clearTimeout(tipTimer); tipTimer = setTimeout(() => showTip(t), 260); });
    document.addEventListener("mouseout", (e) => { if (e.target.closest?.(".ent")) { clearTimeout(tipTimer); hideTip(); } });
  }
  document.getElementById("cardClose").onclick = closeCard;
  document.getElementById("cardBack").onclick = () => { history.pop(); const prev = history.pop(); if (prev) openCard(prev); };
}
export const linksOn = () => enabled;
export function setLinks(on) { enabled = on; deps.store.set("links", on); document.body.classList.toggle("no-links", !on); }

// 목록: 서버의 표지가 바뀌었을 때만 다시 받는다
export async function codexSync(sig) {
  if (sig && sig === index.sig) return false;
  if (loading) return loading;
  loading = (async () => {
    try {
      const r = await deps.post("/api/codex");
      index = r; byId = new Map(r.entries.map((e) => [e.id, e]));
      names = [];
      for (const e of r.entries) for (const n of [e.name, ...(e.aka || [])]) if (n && n.length >= 2) names.push([n, e]);
      names.sort((a, b) => b[0].length - a[0].length);
      return true;
    } catch { return false; } finally { loading = null; }
  })();
  return loading;
}
export const codexEntries = () => index.entries;

// 낱말 경계 — 앞은 한글이 아니고, 뒤는 한글이 아니거나 조사 첫 글자
function findName(text, name, from = 0) {
  for (let i = text.indexOf(name, from); i >= 0; i = text.indexOf(name, i + 1)) {
    const b = text[i - 1], a = text[i + name.length];
    if (b && /[가-힣]/.test(b)) continue;
    if (a && /[가-힣]/.test(a) && !JOSA1.has(a)) continue;
    return i;
  }
  return -1;
}
// 한 덩어리(턴·카드) 안에서 같은 것은 처음 나온 자리에만 잇는다
export function linkify(root, { seen = new Set() } = {}) {
  if (!enabled || !names.length || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest(".ent, .player, .who, button, input, textarea, .noent") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const nodes = []; for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  for (let node of nodes) {
    let guard = 0;
    while (node && guard++ < 20) {
      const text = node.nodeValue; let best = null;
      for (const [nm, e] of names) {
        if (seen.has(e.id)) continue;
        const i = findName(text, nm);
        if (i >= 0 && (!best || i < best.i || (i === best.i && nm.length > best.nm.length))) best = { i, nm, e };
      }
      if (!best) break;
      seen.add(best.e.id);
      const after = node.splitText(best.i), rest = after.splitText(best.nm.length);
      const span = document.createElement("span");
      span.className = `ent k-${best.e.kind} lv${best.e.level}`; span.dataset.ent = best.e.id; span.tabIndex = 0; span.setAttribute("role", "button");
      span.setAttribute("aria-label", `${best.e.name} — ${KIND[best.e.kind]}${best.e.level < 2 ? ", 아직 모름" : ""}`);
      span.textContent = best.nm;
      if (best.e.level < 2) { const q = document.createElement("sup"); q.className = "uq"; q.textContent = "?"; span.appendChild(q); }
      after.replaceWith(span);
      node = rest;
    }
  }
}
// 목록이 바뀐 뒤 (새로 알게 된 것): 이미 그린 덩어리를 다시 잇는다
export function relink(root) {
  if (!root) return;
  root.querySelectorAll(".ent").forEach((s) => { s.querySelector("sup")?.remove(); s.replaceWith(document.createTextNode(s.textContent)); });
  root.normalize();
  linkify(root);
}

// ── 미리보기 ──
function showTip(t) {
  const e = byId.get(t.dataset.ent); if (!e) return;
  hideTip();
  const tip = document.createElement("div"); tip.className = "ent-tip"; tip.id = "entTip"; tip.setAttribute("role", "tooltip");
  tip.innerHTML = `<b>${deps.esc(e.name)}</b> <span class="k">${KIND[e.kind] || ""}</span>${e.level < 2 ? ` <span class="unk">? 아직 모른다</span>` : e.level >= 3 ? ` <span class="deep">◆</span>` : ""}<div>${deps.esc(e.short || "")}</div><div class="hint">눌러서 카드 보기</div>`;
  document.body.appendChild(tip);
  const r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(10, Math.min(innerWidth - w - 10, r.left + r.width / 2 - w / 2)) + "px";
  tip.style.top = (r.top - h - 8 > 8 ? r.top - h - 8 : r.bottom + 8) + "px";
}
function hideTip() { document.getElementById("entTip")?.remove(); }

// ── 카드 ──
const monogram = (name) => (String(name || "?").replace(/^[^가-힣A-Za-z]+/, "")[0] || "?");
export async function openCard(id) {
  hideTip();
  const panel = document.getElementById("card"), body = document.getElementById("cardBody");
  panel.hidden = false; panel.classList.add("loading");
  if (history[history.length - 1] !== id) history.push(id);
  if (history.length > 20) history.shift();
  document.getElementById("cardBack").hidden = history.length < 2;
  let e;
  try { e = await deps.post("/api/codex/entry", { id }); } catch { body.innerHTML = `<p class="empty">카드를 못 불렀다</p>`; return; } finally { panel.classList.remove("loading"); }
  const esc = deps.esc;
  const lvWord = e.level >= 3 ? "깊이 안다" : e.level >= 2 ? "안다" : e.level >= 1 ? "들어 본 이름" : "모른다";
  body.innerHTML = `<div class="card-head k-${e.kind}">
      <div class="portrait${e.image ? " img" : ""}">${e.image ? `<img src="${esc(e.image)}" alt="${esc(e.name)}">` : `<span>${esc(monogram(e.name))}</span>`}</div>
      <div class="ttl"><span class="kind">${esc(e.kindLabel || KIND[e.kind] || "")}</span><h3>${esc(e.name)}${e.level < 2 ? `<sup class="uq">?</sup>` : ""}</h3><div class="sub">${esc(e.sub || "")}</div><span class="lv lv${e.level}">${lvWord}</span></div>
    </div>
    ${(e.sections || []).map((s) => `<section class="csec">${s.title ? `<h4>${esc(s.title)}</h4>` : ""}<ul>${s.lines.map((l) => `<li class="${l.unknown ? "unk" : ""}${l.past ? " past" : ""}${l.faint ? " faint" : ""}${l.deep ? " deep" : ""}">${l.unknown ? `<span class="qbox" aria-hidden="true">?</span>` : l.mark ? `<span class="mk">${esc(l.mark)}</span>` : ""}<span class="tx">${esc(l.text)}</span>${l.conf != null ? ` <span class="conf" title="짐작의 확신">${l.conf >= 0.85 ? "●●●" : l.conf >= 0.65 ? "●●○" : "●○○"}</span>` : ""}</li>`).join("")}</ul></section>`).join("")}
    ${e.memoable ? `<section class="csec"><h4>메모 — 회귀해도 남는다</h4><textarea class="memo" id="cardMemo" rows="2" placeholder="이 사람에 대해 적어 둔다">${esc(e.memo || "")}</textarea></section>` : ""}`;
  const seen = new Set([id]);
  body.querySelectorAll(".csec .tx").forEach((x) => linkify(x, { seen }));
  const memo = document.getElementById("cardMemo");
  if (memo) memo.onchange = () => deps.post("/api/memo", { npc: id.split(":")[1], text: memo.value });
  body.scrollTop = 0;
  document.getElementById("cardClose").focus({ preventScroll: true });
}
export function closeCard() { document.getElementById("card").hidden = true; history = []; }
export const cardOpen = () => !document.getElementById("card").hidden;

// ── 수첩의 '백과' 칸 ──
let filter = "all", query = "";
export function encyclopediaHTML() {
  const esc = deps.esc;
  const groups = [["npc", "사람"], ["place", "장소"], ["fac", "세력"], ["gl", "세상"], ["word", "말"]];
  const groupOf = (e) => (e.kind === "loc" || e.kind === "node" || e.kind === "reg" ? "place" : e.kind);
  const list = index.entries.filter((e) => (filter === "all" || groupOf(e) === filter) && (!query || e.name.includes(query) || (e.short || "").includes(query)));
  const unk = index.entries.filter((e) => e.level < 2).length;
  return `<div class="sec"><div class="enc-tools"><input id="encQ" type="search" placeholder="이름으로 찾기" value="${esc(query)}" aria-label="백과에서 찾기">
      <span class="seg" id="encF">${[["all", "전부"], ...groups].map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${filter === k}">${l}</button>`).join("")}</span></div>
      <p class="enc-note">아는 것 ${index.entries.length - unk} · <sup class="uq">?</sup> 들어 본 이름 ${unk} — 이야기에서 밑줄 친 이름을 누르면 카드가 열린다. 알게 될수록 카드가 채워지고, 회귀해도 아는 것은 남는다.</p></div>
    ${groups.filter(([k]) => filter === "all" || filter === k).map(([k, label]) => {
      const rows = list.filter((e) => groupOf(e) === k).sort((a, b) => b.level - a.level || a.name.localeCompare(b.name, "ko"));
      return rows.length ? `<div class="sec"><h4>${label} <span class="faint">${rows.length}</span></h4><div class="enc-list">${rows.map((e) => `<button class="enc-row lv${e.level}" data-ent="${esc(e.id)}"><span class="nm">${esc(e.name)}${e.kind === "reg" ? ` <small class="faint">(땅)</small>` : ""}${e.level < 2 ? `<sup class="uq">?</sup>` : e.level >= 3 ? `<span class="deep">◆</span>` : ""}</span><span class="sh">${esc(e.short || "")}</span></button>`).join("")}</div></div>` : "";
    }).join("") || `<div class="sec empty">찾는 이름이 없다.</div>`}`;
}
export function bindEncyclopedia(root, rerender) {
  root.querySelectorAll(".enc-row").forEach((b) => (b.onclick = () => openCard(b.dataset.ent)));
  root.querySelectorAll("#encF button").forEach((b) => (b.onclick = () => { filter = b.dataset.f; rerender(); }));
  const q = root.querySelector("#encQ");
  if (q) q.oninput = () => { query = q.value.trim(); const pos = q.selectionStart; rerender(); const q2 = root.querySelector("#encQ"); q2?.focus(); q2?.setSelectionRange(pos, pos); };
}
