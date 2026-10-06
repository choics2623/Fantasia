#!/usr/bin/env python3
"""docs/world/CHARACTERS.md (+ SECRETS_AND_HERMITS.md, people/*.md) → content/base/npcs/npcs.json, relations.json

- 인물: §1 색인 표 (ID | 이름 | npc id | 종족·파생종 | 지역 | 역할 | 중요도)
- 관계: §0.3 규약의 튜플 `[npc_대상 | 유형 | 호감 ±N | 신뢰 ±N | 공개여부 | 메모]`
  주체는 그 튜플 위의 가장 가까운 `### … `npc_x`` 제목, 또는 같은 표 행의 첫 npc id.
- 관계 계열(혈연·위계·감정·적대·거래·비밀·조직)은 '유형' 단어로 분류한다.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "docs/world/CHARACTERS.md"
# 같은 형식(색인 표 + ### 항목 + 관계 튜플)을 쓰는 인물 문서들. 지역 열은 '#번호 지역명'으로 쓴다.
EXTRA = [ROOT / "docs/world/SECRETS_AND_HERMITS.md", *sorted((ROOT / "docs/world/people").glob("*.md"))]
OUT = ROOT / "content/base/npcs"
REGION_NAMES = {
    1: "드라크마르 용좌령", 2: "회색여울 변경", 3: "잿불 언덕", 4: "루멘", 5: "실바렌", 6: "가시안개 숲",
    7: "녹테른 밤의 영지", 8: "모르바 늪", 9: "세렌 해안", 10: "아르카스 탑섬", 11: "재의 황무지",
    12: "카즈둠 산맥", 13: "흐로스가르드", 14: "바람첨탑", 15: "하르칸 초원", 16: "그롬마르 붉은 황야",
}
TUPLE = re.compile(r"\[(npc_\w+) \| ([^|]+) \| 호감 ([+-−]?\d+) \| 신뢰 ([+-−]?\d+) \| (공개|비밀|일방)(?: \| ([^\]]*))?\]")
FAMILY_WORDS = [
    ("혈연", "아들 딸 아버지 어머니 아비 어미 형 누나 언니 오빠 동생 남매 형제 자매 쌍둥이 아내 남편 배우자 손자 손녀 할아버지 할머니 조카 삼촌 이모 고모 부모 자녀 혈육 사촌 친척 가족 핏줄 짝 증손 후손 조상 장녀 장자 차녀 서자".split()),
    ("적대", "원한 증오 적 경쟁 라이벌 복수 혐오 경멸 원수 질투 두려움 공포 의심 사냥감 표적 연적 앙숙 배신".split()),
    ("거래", "빚 채권 채무 거래 고객 계약 뇌물 협박 매수 공급 중개 손님 상납 몸값 매입 판매 구매".split()),
    ("비밀", "약점 알고 엿들 비밀 쥐고".split()),
    ("조직", "첩자 밀정 연락 세포 소속 동맹 조직 정보원 첩보 공모 공범 동업 이중".split()),
    ("위계", "주인 노예 부하 상관 부관 가신 영주 하인 감독 스승 제자 고용 상사 수하 사령관 섬김 소유 하수인 시종 시녀 집사 목줄장 군주 여왕 왕 지휘".split()),
    ("감정", "연모 짝사랑 연인 사랑 친구 우정 동경 존경 신뢰 은인 보호 아낌 동지 동료 연민 그리움 애정".split()),
]
FACTION_WORDS = ["이름 없는 자들", "목줄단", "순종의 빛", "끊어진 고리", "잿빛 탑", "비늘 원로회", "바르그 노예사냥", "늪 마녀",
                 "원형장", "잿빛 실", "쥐들의 왕관", "회색 순례자", "마지막 등불", "카스파르", "아우락스", "멜리산드", "세렌 상인 의회"]


def num(s):
    return int(s.replace("−", "-"))


def family(kind, affection):
    for fam, words in FAMILY_WORDS:
        if any(w in kind for w in words):
            return fam
    return "감정" if affection >= 0 else "적대"


def main():
    lines = []
    for src in [SRC, *EXTRA]:
        if src.exists():
            lines += src.read_text(encoding="utf-8").splitlines() + ["## (문서 끝)"]
    npcs, seen = [], set()
    for line in lines:
        m = re.match(r"\|\s*R?\w+-\w+\s*\|([^|]+)\|\s*`(npc_\w+)`\s*\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|", line)
        if not m:
            continue
        name, nid, race, region, role, stars = (c.strip() for c in m.groups())
        if nid in seen:
            continue
        seen.add(nid)
        race_parts = [p.strip() for p in race.split("·")]
        rm = re.search(r"#(\d+)", region)
        tier = {3: "S", 2: "A"}.get(stars.count("★"), "B")
        npcs.append({"id": nid, "name": name, "race": race_parts[0], "subrace": race_parts[1] if len(race_parts) > 1 else "",
                     "region": REGION_NAMES.get(int(rm.group(1))) if rm else region, "role": role, "tier": tier,
                     "factions": [], "summary": ""})
    by_id = {n["id"]: n for n in npcs}

    # 섹션별 본문 → 소속 키워드, 요약
    rels, subject = [], None
    section_text = {}
    for line in lines:
        h = re.match(r"#{3,4} .*`(npc_\w+)`", line)
        if h:
            subject = h.group(1)
            section_text.setdefault(subject, [])
            continue
        if line.startswith("## "):
            subject = None
        row_subject = None
        if line.lstrip().startswith("|"):
            r = re.search(r"`(npc_\w+)`", line)
            row_subject = r.group(1) if r else None
        who = row_subject or subject
        if who and who in section_text:
            section_text[who].append(line)
        if not who:
            continue
        for t in TUPLE.finditer(line):
            target, kind, aff, tru, vis, note = t.groups()
            if target == who:
                continue
            a = num(aff)
            rels.append({"from": who, "to": target, "type": kind.strip(), "family": family(kind, a),
                         "affection": a, "trust": num(tru), "public": vis == "공개", "visibility": vis,
                         "note": (note or "").strip()})
    for nid, body in section_text.items():
        if nid not in by_id:
            continue
        joined = "\n".join(body)
        by_id[nid]["factions"] = [f for f in FACTION_WORDS if f in joined][:4]
        job = re.search(r"\*\*신분·직업\*\*:\s*(.+)", joined)
        if job:
            by_id[nid]["summary"] = job.group(1).strip()[:200]
        age = re.search(r"/\s*(\d+)세", joined)
        if age:
            by_id[nid]["age"] = int(age.group(1))
    # 중복 제거 (같은 주체·대상·유형)
    uniq, keys = [], set()
    for r in rels:
        k = (r["from"], r["to"], r["type"])
        if k not in keys:
            keys.add(k)
            uniq.append(r)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "npcs.json").write_text(json.dumps(npcs, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "relations.json").write_text(json.dumps(uniq, ensure_ascii=False, indent=1), encoding="utf-8")
    fams = {}
    for r in uniq:
        fams[r["family"]] = fams.get(r["family"], 0) + 1
    missing = sorted({r["to"] for r in uniq if r["to"] not in by_id} | {r["from"] for r in uniq if r["from"] not in by_id})
    print(f"npcs={len(npcs)} relations={len(uniq)} families={fams}")
    print(f"unknown ids ({len(missing)}): {missing[:20]}")


if __name__ == "__main__":
    main()
