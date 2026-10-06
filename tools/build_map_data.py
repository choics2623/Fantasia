#!/usr/bin/env python3
"""docs/world/REGIONS.md §17 이동 그래프 → content/base/world/map.json

- 노드·엣지는 REGIONS.md 표에서 그대로 읽는다 (정본 좌표 = x, y).
- 대륙 지도에서 한 점에 겹치는 지역 내부 노드는 표시용 좌표(dx, dy)로 허브 주위에 펼친다.
- 지형(해안선, 산맥, 숲, 강 …)과 시작 상태는 이 스크립트 안에 정의한다.
"""
import json
import math
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "docs/world/REGIONS.md"
OUT = ROOT / "content/base/world/map.json"

REGION_NAMES = {
    1: "드라크마르 용좌령", 2: "회색여울 변경", 3: "잿불 언덕", 4: "루멘", 5: "실바렌", 6: "가시안개 숲",
    7: "녹테른 밤의 영지", 8: "모르바 늪", 9: "세렌 해안", 10: "아르카스 탑섬", 11: "재의 황무지",
    12: "카즈둠 산맥", 13: "흐로스가르드", 14: "바람첨탑", 15: "하르칸 초원", 16: "그롬마르 붉은 황야",
}
TYPE_MAP = [
    (("수도", "도시", "성도", "왕도"), "city"),
    (("항구", "나루", "부두"), "port"),
    (("광산 도시",), "town"),
    (("마을", "광부촌", "숙영지"), "village"),
    (("성채", "요새", "관문", "군영", "왕궁", "저택", "역참", "전당"), "fort"),
    (("폐허", "유적", "이상 지대", "기념지"), "ruin"),
    (("은신처", "비밀"), "secret"),
    (("성소", "쉼터", "궁정", "회합지", "경계석"), "temple"),
    (("광산", "노역장", "혈목장", "수용지", "농장"), "mine"),
    (("둥지", "고개", "습지", "오아시스", "여울", "교역지", "장터", "숲"), "wild"),
]
ROAD_MAP = {"대로": "imperial", "길": "road", "마을길": "road", "순례길": "road", "초원길": "road", "숲길": "trail",
            "오솔길": "trail", "산길": "trail", "늪길": "trail", "황무지": "trail", "지하 갱도": "road",
            "강(하류)": "river", "늪 수로": "river", "바닷길": "sea", "비밀 통로": "secret"}


def node_type(korean):
    for keys, t in TYPE_MAP:
        if any(k in korean for k in keys):
            return t
    return "site"


def cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def parse():
    text = SRC.read_text(encoding="utf-8")
    sec = text[text.index("## 17. 이동 그래프"):]
    nodes_part = sec[sec.index("### 17.2"):sec.index("### 17.3")]
    edges_part = sec[sec.index("### 17.3"):sec.index("### 17.4")]
    nodes, edges = [], []
    for line in nodes_part.splitlines():
        m = re.match(r"\|\s*`([a-z0-9_]+)`", line)
        if m:
            c = cells(line)
            nodes.append({"id": m.group(1), "name": c[1], "region": int(c[2]), "x": int(c[3]), "y": int(c[4]),
                          "kind": c[5], "type": node_type(c[5])})
    for line in edges_part.splitlines():
        if re.match(r"\|\s*\d+\s*\|", line):
            c = cells(line)
            cond = c[6]
            secret = cond.startswith("[비밀]") or c[4] == "비밀 통로"
            edges.append({"from": c[1].strip("`"), "to": c[2].strip("`"), "hours": float(c[3]),
                          "road": "secret" if secret else ROAD_MAP.get(c[4], "road"), "roadName": c[4],
                          "danger": int(c[5]), "cond": cond.replace("[비밀]", "").strip() or None})
    # 설명: 지역 장소 표에서 같은 id 를 가진 첫 행의 가장 긴 칸
    body = text[:text.index("## 17. 이동 그래프")]
    for n in nodes:
        for line in body.splitlines():
            if f"`{n['id']}`" in line and line.lstrip().startswith("|"):
                options = [c for c in cells(line) if "§" not in c] or cells(line)
                best = max(options, key=len)
                n["desc"] = re.sub(r"\*\*|`", "", best)[:220]
                break
    return nodes, edges


def spread(nodes):
    """정본 좌표가 서로 14 이내로 붙은 같은 지역 노드들을 허브 주위에 펼친다 (표시용)."""
    hubs = {}
    for n in nodes:
        same = [m for m in nodes if m is not n and m["region"] == n["region"] and math.hypot(m["x"] - n["x"], m["y"] - n["y"]) < 14]
        if same:
            hubs.setdefault(n["region"], []).append(n)
    for region, cluster in hubs.items():
        cx = sum(n["x"] for n in cluster) / len(cluster)
        cy = sum(n["y"] for n in cluster) / len(cluster)
        for i, n in enumerate(sorted(cluster, key=lambda n: math.atan2(n["y"] - cy, n["x"] - cx))):
            a = -math.pi / 2 + 2 * math.pi * i / len(cluster)
            n["tx"], n["ty"] = n["x"], n["y"]
            n["x"], n["y"] = round(cx + math.cos(a) * 44), round(cy + math.sin(a) * 34)
            n["label"] = "left" if math.cos(a) < -0.2 else "right"


TERRAIN = {
    "continent": [[70, 95], [200, 45], [330, 32], [480, 22], [620, 45], [760, 40], [900, 70], [965, 160], [975, 300],
                  [960, 420], [972, 520], [930, 600], [860, 650], [780, 672], [705, 652], [655, 676], [600, 672],
                  [540, 672], [470, 690], [400, 676], [330, 690], [250, 670], [170, 640], [100, 600], [60, 520],
                  [40, 420], [55, 320], [40, 220]],
    "islands": [[[540, 700], [575, 692], [600, 706], [590, 728], [555, 732], [535, 718]]],
    "ice": [[60, 0], [960, 0], [960, 60], [780, 72], [620, 92], [480, 60], [330, 90], [200, 80], [80, 110]],
    "blobs": [{"x": 620, "y": 470, "r": 110, "kind": "ash"}, {"x": 730, "y": 615, "r": 70, "kind": "rust"},
              {"x": 590, "y": 330, "r": 50, "kind": "rust"}, {"x": 170, "y": 300, "r": 110, "kind": "forest"},
              {"x": 110, "y": 140, "r": 70, "kind": "forest"}, {"x": 165, "y": 530, "r": 70, "kind": "forest"}],
    "forests": [{"x": 175, "y": 300, "r": 95, "n": 140}, {"x": 110, "y": 145, "r": 65, "n": 80, "dark": True},
                {"x": 170, "y": 530, "r": 60, "n": 70, "dark": True}, {"x": 395, "y": 290, "r": 30, "n": 25}],
    "ridges": [[[700, 170], [740, 240], [770, 300], [790, 380], [800, 430]], [[720, 80], [770, 110], [820, 130]],
               [[300, 120], [380, 112], [470, 120], [560, 128]], [[370, 330], [395, 345]]],
    "swamps": [{"x": 272, "y": 615, "r": 55, "n": 70}, {"x": 423, "y": 212, "r": 14, "n": 10}],
    "steppes": [{"x": 880, "y": 480, "r": 85, "n": 220}],
    "wastes": [{"x": 625, "y": 475, "r": 95}],
    "rivers": [[[400, 360], [366, 414], [330, 470], [372, 540], [418, 598], [480, 640]],
               [[392, 150], [430, 205], [421, 262], [400, 330]]],
}


def main():
    nodes, edges = parse()
    ids = {n["id"] for n in nodes}
    bad = [e for e in edges if e["from"] not in ids or e["to"] not in ids]
    assert not bad, bad
    spread(nodes)
    hubs = {1: "baalkar", 2: "greyford_village", 3: "ember_mines", 4: "lumen", 5: "eternal_garden", 6: "thorn_court",
            7: "first_thirst_castle", 8: "seven_hags_circle", 9: "seren", 10: "grey_tower", 11: "asteria_ruins",
            12: "deephammer_hall", 13: "hrimnir_hall", 14: "windspire", 15: "khan_ordu", 16: "blood_arena"}
    byid = {n["id"]: n for n in nodes}
    for rid, hub in hubs.items():
        byid[hub]["major"] = True
    regions = []
    for rid, name in REGION_NAMES.items():
        h = byid[hubs[rid]]
        regions.append({"id": rid, "name": name, "x": h.get("tx", h["x"]), "y": h.get("ty", h["y"]), "labelDy": -62 if rid != 10 else 34})
    data = {
        "regions": regions, "nodes": nodes, "edges": edges, "terrain": TERRAIN,
        "start": {
            "node": "greyford_village", "hour": 18,
            "knowledge": {"greyford_village": 3, "raven_keep": 2, "filth_marsh": 2, "hungry_hill": 2, "old_stone_ring": 2,
                          "crow_gate": 1, "dragon_pillar_post": 1, "baalkar": 1, "lumen": 1},
            "sketch": ["filth_marsh", "charcoal_camp", "reed_ferry", "hungry_hill"],
            "military": [1, 2, 3],
            "intro": "붕괴력 312년 낙엽월. 회색여울의 농노로 눈을 떴다. 아는 세상은 마을과 그 둘레가 전부다.",
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"map.json: {len(nodes)} nodes, {len(edges)} edges, desc {sum(1 for n in nodes if n.get('desc'))}/{len(nodes)}")


if __name__ == "__main__":
    main()
