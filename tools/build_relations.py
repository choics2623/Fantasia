#!/usr/bin/env python3
"""NPC·관계 데이터에서 관계도를 생성한다 (손으로 고치지 말 것).

입력:  content/base/npcs/npcs.json, content/base/npcs/relations.json
출력:  prototypes/relations/index.html  (인터랙티브 뷰어, 데이터 인라인)
       docs/world/relations/README.md, docs/world/relations/<지역>.md  (Mermaid 관계도)
검증:  참조 무결성, 자기 자신과의 관계, 중복 관계, 고립된 S/A 등급 NPC
"""
import collections
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
NPC_DIR = ROOT / "content/base/npcs"
FAMILIES = ["혈연", "위계", "감정", "적대", "거래", "비밀", "조직"]
MERMAID_STYLE = {
    "혈연": "stroke:#2a2521,stroke-width:3px",
    "위계": "stroke:#5b4a8a,stroke-width:2px",
    "감정": "stroke:#3f7a4a,stroke-width:2px",
    "적대": "stroke:#a1342a,stroke-width:2px",
    "거래": "stroke:#9a6a1c,stroke-width:2px",
    "비밀": "stroke:#6b6b6b,stroke-width:1.5px,stroke-dasharray:4 3",
    "조직": "stroke:#2f6f86,stroke-width:1.5px",
}


def load():
    npcs = json.loads((NPC_DIR / "npcs.json").read_text(encoding="utf-8"))
    rels = json.loads((NPC_DIR / "relations.json").read_text(encoding="utf-8"))
    return npcs, rels


def validate(npcs, rels):
    problems = []
    ids = collections.Counter(n["id"] for n in npcs)
    for i, c in ids.items():
        if c > 1:
            problems.append(f"중복 id: {i}")
    known = set(ids)
    seen = set()
    degree = collections.Counter()
    for r in rels:
        for k in ("from", "to"):
            if r[k] not in known:
                problems.append(f"없는 인물 참조: {r[k]} ({r['from']} → {r['to']} {r.get('type')})")
        if r["from"] == r["to"]:
            problems.append(f"자기 자신과의 관계: {r['from']}")
        if r.get("family") not in FAMILIES:
            problems.append(f"알 수 없는 관계 계열 '{r.get('family')}': {r['from']} → {r['to']}")
        key = (r["from"], r["to"], r.get("type"))
        if key in seen:
            problems.append(f"중복 관계: {key}")
        seen.add(key)
        degree[r["from"]] += 1
        degree[r["to"]] += 1
    for n in npcs:
        if n.get("tier") in ("S", "A") and degree[n["id"]] == 0:
            problems.append(f"관계가 없는 {n['tier']}등급 인물: {n['id']}")
    return problems


def mermaid_id(i):
    return re.sub(r"[^A-Za-z0-9_]", "_", i)


def region_doc(region, npcs, rels):
    ids = {n["id"] for n in npcs}
    inner = [r for r in rels if r["from"] in ids and r["to"] in ids]
    lines = ["```mermaid", "graph LR"]
    for n in npcs:
        label = f"{n['name']}<br/><small>{n.get('subrace') or n.get('race', '')} · {n.get('role', '')}</small>"
        lines.append(f'  {mermaid_id(n["id"])}["{label}"]')
    for idx, r in enumerate(inner):
        arrow = "---" if r["family"] == "혈연" else ("-.->" if r.get("public") is False else "-->")
        lines.append(f'  {mermaid_id(r["from"])} {arrow}|{r.get("type", "")}| {mermaid_id(r["to"])}')
    for idx, r in enumerate(inner):
        lines.append(f"  linkStyle {idx} {MERMAID_STYLE.get(r['family'], '')}")
    lines.append("```")
    out = [f"# {region} 관계도", "", "> 자동 생성 문서 — `python3 tools/build_relations.py` 로 다시 만든다. 직접 고치지 말 것.", "",
           "선: 굵은 검정 = 혈연, 보라 = 위계, 초록 = 호감·연모, 빨강 = 적대, 갈색 = 거래·빚, 점선 = 비밀", ""]
    out += lines
    out += ["", "## 관계 목록", "", "| 누가 | 관계 | 누구에게 | 공개 | 메모 |", "|---|---|---|---|---|"]
    name = {n["id"]: n["name"] for n in npcs}
    for r in inner:
        out.append(f"| {name[r['from']]} | {r['family']} · {r.get('type','')} | {name[r['to']]} | {'비밀' if r.get('public') is False else '공개'} | {r.get('note','')} |")
    return "\n".join(out) + "\n"


def main():
    npcs, rels = load()
    problems = validate(npcs, rels)
    report = ROOT / "docs/world/relations/VALIDATION.md"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text("# 관계 데이터 검증 결과\n\n" + ("\n".join(f"- {p}" for p in problems) if problems else "문제 없음.") + "\n", encoding="utf-8")

    by_region = collections.defaultdict(list)
    for n in npcs:
        by_region[n.get("region") or "기타"].append(n)
    index = ["# 인물 관계도", "", "> 자동 생성. 원본 데이터: `content/base/npcs/`. 인터랙티브 뷰어: `prototypes/relations/index.html`", "",
             "| 지역 | 인물 수 | 문서 |", "|---|---|---|"]
    for region, ns in sorted(by_region.items(), key=lambda kv: -len(kv[1])):
        fname = re.sub(r"[^\w가-힣]+", "_", region).strip("_") + ".md"
        (ROOT / "docs/world/relations" / fname).write_text(region_doc(region, ns, rels), encoding="utf-8")
        index.append(f"| {region} | {len(ns)} | [{fname}]({fname}) |")
    index += ["", f"검증: [VALIDATION.md](VALIDATION.md) — 문제 {len(problems)}건"]
    (ROOT / "docs/world/relations/README.md").write_text("\n".join(index) + "\n", encoding="utf-8")

    valid_ids = {n["id"] for n in npcs}
    data = {
        "npcs": npcs,
        "relations": [r for r in rels if r["from"] in valid_ids and r["to"] in valid_ids],
        "defaultRegion": next((n.get("region") for n in npcs if n["id"] == "npc_bram"), ""),
        "defaultFocus": "npc_bram",
    }
    tpl = (ROOT / "prototypes/relations/template.html").read_text(encoding="utf-8")
    a, b = "/*REL_DATA*/", "/*END_REL_DATA*/"
    i, j = tpl.index(a), tpl.index(b)
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    (ROOT / "prototypes/relations/index.html").write_text(tpl[: i + len(a)] + payload + tpl[j:], encoding="utf-8")
    print(f"npcs={len(npcs)} relations={len(rels)} regions={len(by_region)} problems={len(problems)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
