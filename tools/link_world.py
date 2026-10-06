"""세력 ↔ 인물 ↔ 진실을 잇고 검사한다 (23 §5).

  python3 tools/link_world.py            # 검사 + content/build/world_links.json
  python3 tools/link_world.py --apply-fills content/base/factions/_fills.yaml   # 'office → npc' 채우기를 세력 파일에 반영

- 자리(office)의 holder가 정본이다. 카드의 소속은 여기서 '계산'해 묶음에 넣는다 (카드에 손으로 쓴 affiliations는 비밀 가입 등 보충).
- 진실의 holders는 truths*.yaml과 lore/holders_*.yaml을 합친다.
"""
import glob, json, os, sys
import yaml

ROOT = os.path.join(os.path.dirname(__file__), "..")
P = lambda *a: os.path.join(ROOT, *a)


def load_yaml(p):
    return yaml.safe_load(open(p, encoding="utf-8"))


def main():
    npcs = {n["id"]: n for n in json.load(open(P("content/base/npcs/npcs.json"), encoding="utf-8"))}
    factions = {}
    for p in sorted(glob.glob(P("content/base/factions/fac_*.yaml"))):
        f = load_yaml(p); f["_file"] = os.path.basename(p); factions[f["id"]] = f
    cards = {}
    for p in glob.glob(P("content/base/npcs/cards/**/*.yaml"), recursive=True):
        c = load_yaml(p); cards[c["id"]] = c
    truths = {}
    for p in [P("content/base/lore/truths.yaml"), P("content/base/lore/truths_extra.yaml")]:
        if os.path.exists(p):
            for t in load_yaml(p) or []:
                truths[t["id"]] = t
    holders = []
    for p in sorted(glob.glob(P("content/base/lore/holders_*.yaml"))):
        holders += [dict(h, _src=os.path.basename(p)) for h in (load_yaml(p) or [])]
    for t in truths.values():
        for h in t.get("holders") or []:
            holders.append({"truth": t["id"], "who": h.get("who"), "level": h.get("level"), "_src": "truths"})

    probs, warn = [], []
    aff, missing_fac = {}, set()
    filled = total = 0
    for fid, f in factions.items():
        offs = {o["id"]: o for o in f.get("offices") or []}
        if len(offs) != len(f.get("offices") or []):
            probs.append(f"{fid}: 자리 id 중복")
        for o in offs.values():
            total += 1
            h = o.get("holder")
            if isinstance(h, str) and h.startswith("npc_"):
                if h not in npcs:
                    probs.append(f"{fid}.{o['id']}: 없는 인물 {h}")
                else:
                    filled += 1
                    aff.setdefault(h, []).append({"faction": fid, "office": o["id"], "title": o.get("title")})
            r = o.get("reports_to")
            if r and r not in offs:
                probs.append(f"{fid}.{o['id']}: reports_to {r} 없음")
            # 순환 검사
            seen, cur = set(), o["id"]
            while cur:
                if cur in seen:
                    probs.append(f"{fid}: reports_to 순환 ({o['id']})"); break
                seen.add(cur); cur = (offs.get(cur) or {}).get("reports_to")
        for rel in f.get("relations") or []:
            if rel.get("to") not in factions:
                missing_fac.add(rel.get("to"))
    # 카드에 손으로 쓴 소속과 대조
    for cid, c in cards.items():
        for a in c.get("affiliations") or []:
            if a.get("faction") and a["faction"] not in factions:
                missing_fac.add(a["faction"])
            if a.get("office"):
                fac = factions.get(a.get("faction"))
                o = next((x for x in (fac or {}).get("offices") or [] if x["id"] == a["office"]), None)
                if fac and not o:
                    warn.append(f"{cid}: 카드의 자리 {a['faction']}.{a['office']}가 세력 파일에 없음")
                elif o and o.get("holder") != cid:
                    warn.append(f"{cid}: 카드는 {a['faction']}.{a['office']}에 앉았다는데 세력 파일 holder는 {o.get('holder')}")
    # 진실
    tr = {}
    for h in holders:
        if h.get("truth") not in truths:
            probs.append(f"진실 {h.get('truth')} 없음 ({h.get('_src')})"); continue
        who = h.get("who")
        if isinstance(who, str) and who.startswith("npc_"):
            if who not in npcs:
                warn.append(f"진실 {h['truth']}: 없는 인물 {who} ({h['_src']})"); continue
            tr.setdefault(who, {})
            lv = {"rumor": 1, "fragment": 2, "whole": 3}
            prev = tr[who].get(h["truth"])
            if not prev or lv.get(h.get("level"), 0) > lv.get(prev, 0):
                tr[who][h["truth"]] = h.get("level")
        elif isinstance(who, str) and who.startswith("fac_") and who not in factions:
            missing_fac.add(who)

    no_aff = [n for n in npcs if n not in aff and not (cards.get(n) or {}).get("affiliations") and (cards.get(n) or {}).get("type") != "historical"]
    out = {"affiliations": aff, "truths": tr,
           "stats": {"factions": len(factions), "offices": total, "filled": filled, "npcs": len(npcs), "npcs_with_office": len(aff), "truth_holders": len(tr)}}
    os.makedirs(P("content/build"), exist_ok=True)
    json.dump(out, open(P("content/build/world_links.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for x in probs: print("✗", x)
    for x in warn[:40]: print("·", x)
    if len(warn) > 40: print(f"· … 외 {len(warn) - 40}건")
    if missing_fac: print("· 파일이 없는 세력 id:", ", ".join(sorted(x for x in missing_fac if x)))
    s = out["stats"]
    print(f"\n세력 {s['factions']} · 자리 {s['offices']} 중 실제 인물 {s['filled']} ({s['filled']*100//max(1,s['offices'])}%) · 자리 가진 인물 {s['npcs_with_office']}/{s['npcs']} · 진실 아는 인물 {s['truth_holders']} · 소속 없는 인물 {len(no_aff)}")
    sys.exit(1 if probs else 0)


def apply_fills(path):
    fills = load_yaml(path) or []
    by_fac = {}
    for x in fills:
        by_fac.setdefault(x["faction"], []).append(x)
    for fid, xs in by_fac.items():
        p = P("content/base/factions", fid + ".yaml")
        s = open(p, encoding="utf-8").read()
        f = yaml.safe_load(s)
        for x in xs:
            o = next((o for o in f["offices"] if o["id"] == x["office"]), None)
            if not o:
                print(f"✗ {fid}.{x['office']} 없음"); continue
            old = o.get("holder")
            o["holder"] = x["npc"]
            print(f"✓ {fid}.{x['office']}: {old} → {x['npc']}")
        yaml.safe_dump(f, open(p, "w", encoding="utf-8"), allow_unicode=True, sort_keys=False, width=1000)


def sync_from_cards():
    """카드가 '이 자리에 앉았다'고 하고 세력 파일의 그 자리가 비었거나 unnamed면 카드 쪽으로 채운다.
    세력 파일에 없는 자리면 offices 끝에 제안 자리로 더한다. 주석을 지키려고 줄 단위로 고친다."""
    import re
    npcs = {n["id"] for n in json.load(open(P("content/base/npcs/npcs.json"), encoding="utf-8"))}
    changes = {}
    for p in glob.glob(P("content/base/npcs/cards/**/*.yaml"), recursive=True):
        c = load_yaml(p)
        for a in c.get("affiliations") or []:
            if a.get("faction") and a.get("office") and c["id"] in npcs:
                changes.setdefault(a["faction"], []).append((a["office"], c["id"], a))
    for fid, xs in changes.items():
        fp = P("content/base/factions", fid + ".yaml")
        if not os.path.exists(fp):
            continue
        text = open(fp, encoding="utf-8").read()
        f = yaml.safe_load(text)
        offs = {o["id"]: o for o in f.get("offices") or []}
        lines = text.split("\n")
        added = []
        for off, npc, a in xs:
            o = offs.get(off)
            if o is None:
                if off in added:
                    continue
                added.append(off)
                title = a.get("title") or a.get("rank") or off
                block = [f"  - id: {off}", f"    title: {json.dumps(title, ensure_ascii=False)}", f"    holder: {npc}",
                         f"    reports_to: {a.get('reports_to') or 'null'}", "    powers: []", "    chosen_by: null", "    perks: []",
                         "    note: \"1차 확장 작가가 제안한 자리 — 검수 필요\""]
                i = next((k for k, l in enumerate(lines) if re.match(r"^ranks:", l)), len(lines))
                lines[i:i] = block
                print(f"+ {fid}.{off} (새 자리) ← {npc}")
                continue
            h = o.get("holder")
            if h == npc:
                continue
            if h is None or (isinstance(h, str) and h.startswith("unnamed")):
                start = next(k for k, l in enumerate(lines) if re.match(rf"^\s*- id: {re.escape(off)}\s*$", l))
                for k in range(start + 1, len(lines)):
                    if re.match(r"^\s*- id: ", lines[k]) or re.match(r"^\S", lines[k]):
                        break
                    m = re.match(r"^(\s*)holder:", lines[k])
                    if m:
                        lines[k] = f"{m.group(1)}holder: {npc}"
                        print(f"✓ {fid}.{off}: {str(h)[:30]} → {npc}")
                        break
            else:
                print(f"! {fid}.{off}: 이미 {h} — 카드 {npc}와 충돌 (손으로 결정)")
        open(fp, "w", encoding="utf-8").write("\n".join(lines))
        yaml.safe_load(open(fp, encoding="utf-8"))  # 깨지지 않았는지


if __name__ == "__main__":
    if "--sync-from-cards" in sys.argv:
        sync_from_cards()
    elif "--apply-fills" in sys.argv:
        apply_fills(sys.argv[sys.argv.index("--apply-fills") + 1])
    else:
        main()
