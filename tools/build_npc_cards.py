"""NPC 페르소나 카드 (22_NPC_PERSONA.md).

  python3 tools/build_npc_cards.py            # 빠진 카드의 뼈대만 만든다 (있는 카드는 건드리지 않는다)
  python3 tools/build_npc_cards.py --bundle   # 카드 + 사실 → content/base/npcs/cards.json
"""
import json, os, re, sys
import yaml

ROOT = os.path.join(os.path.dirname(__file__), "..")
CARDS = os.path.join(ROOT, "content/base/npcs/cards")
FACTS = os.path.join(ROOT, "content/base/facts")
SLUG = {
    "회색여울 변경": "greyford", "드라크마르 용좌령": "drakmar", "모르바 늪": "morva", "세렌 해안": "seren",
    "흐로스가르드": "hrosgard", "루멘": "lumen", "실바렌": "silvaren", "역사·고인": "history",
    "녹테른 밤의 영지": "nocturne", "카즈둠 산맥": "kazdum", "잿불 언덕": "emberhills", "하르칸 초원": "harkan",
    "그롬마르 붉은 황야": "grommar", "가시안개 숲": "thornmist", "아르카스 탑섬": "arkas", "재의 황무지": "ashwaste",
    "바람첨탑": "windspire", "무소속": "wanderers",
}


def load_index():
    npcs = json.load(open(os.path.join(ROOT, "content/base/npcs/npcs.json"), encoding="utf-8"))
    rels = json.load(open(os.path.join(ROOT, "content/base/npcs/relations.json"), encoding="utf-8"))
    src = open(os.path.join(ROOT, "docs/world/CHARACTERS.md"), encoding="utf-8").read().split("\n")
    lines = {}
    for i, l in enumerate(src, 1):
        m = re.match(r"^### R\d+-\d+\. .*?`(npc_[a-z0-9_]+)`", l)
        if m:
            lines[m.group(1)] = i
    return npcs, rels, lines


def skeleton(n, rels, line):
    out = {
        "id": n["id"], "name": n["name"], "aka": [], "tier": n["tier"],
        "type": "historical" if n["region"] == "역사·고인" else "living",
        "race": n.get("race"), "subrace": n.get("subrace"), "sex": None, "age": None,
        "region": n["region"], "home": None, "job": n.get("role"), "rank": None,
        "summary": n.get("summary"),
        "source": f"docs/world/CHARACTERS.md:{line}" if line else "docs/world/CHARACTERS.md 색인 한 줄뿐 — 새로 써야 한다",
        "life": [], "appearance": [], "smell": None, "voice_sound": None,
        "personality": {"disposition": {}, "temperament": [], "habits": [], "values": None, "fears": [], "desires": {"short": None, "long": None}},
        "voice": {"register": {}, "tics": [], "use": [], "avoid": [], "length": None, "samples": []},
        "schedule": {"아침": None, "낮": None, "저녁": None, "밤": None}, "places": [],
        "knows": [], "hides": [],
        "relations": [{"to": r["to"], "type": r["type"], "like": r["affection"], "trust": r["trust"], "visibility": r["visibility"], "memo": r.get("note") or None, "words": None} for r in rels if r["from"] == n["id"]],
        "toward_player": None, "persuade": {"likes": [], "hates": []},
        "roles": {"teacher": None, "companion": None, "romance": None},
        "regression": {"fixed": [], "flow": [], "drift": [], "deja_vu": "none"},
        "hard_rules": [], "on_death": None, "story_seeds": [],
    }
    return out


def cmd_skeleton():
    npcs, rels, lines = load_index()
    made = 0
    for n in npcs:
        d = os.path.join(CARDS, SLUG.get(n["region"], "misc"))
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, n["id"] + ".yaml")
        if os.path.exists(p):
            continue
        with open(p, "w", encoding="utf-8") as f:
            yaml.safe_dump(skeleton(n, rels, lines.get(n["id"])), f, allow_unicode=True, sort_keys=False, width=1000)
        made += 1
    print(f"뼈대 {made}개 생성 (총 {len(npcs)}명)")


def cmd_bundle():
    cards, facts = {}, {}
    for dp, _, fs in os.walk(CARDS):
        for fn in sorted(fs):
            if fn.endswith(".yaml"):
                c = yaml.safe_load(open(os.path.join(dp, fn), encoding="utf-8"))
                cards[c["id"]] = c
    for fn in sorted(os.listdir(FACTS)) if os.path.isdir(FACTS) else []:
        if fn.endswith(".yaml"):
            for x in yaml.safe_load(open(os.path.join(FACTS, fn), encoding="utf-8")) or []:
                facts[x["id"]] = x
    out = os.path.join(ROOT, "content/base/npcs/cards.json")
    json.dump({"cards": cards, "facts": facts}, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"카드 {len(cards)} · 사실 {len(facts)} → {out}")


if __name__ == "__main__":
    cmd_bundle() if "--bundle" in sys.argv else cmd_skeleton()
