"""NPC 카드 검증 (22_NPC_PERSONA.md §2). 문제 목록을 출력하고, 문제가 있으면 종료 코드 1."""
import json, os, re, sys
import yaml

ROOT = os.path.join(os.path.dirname(__file__), "..")
CARDS = os.path.join(ROOT, "content/base/npcs/cards")
FACTS = os.path.join(ROOT, "content/base/facts")
NEED = {  # 연표, 견본 대사, 습관, 숨긴 것, 회귀 필드
    "S": (8, 12, 3, 1, ["fixed", "flow", "drift"]),
    "A": (6, 8, 2, 1, ["fixed", "drift"]),
    "B": (3, 4, 1, 0, ["fixed"]),
    "historical": (5, 6, 1, 0, []),
}
PREACH = ["해야 한다", "옳지 않", "잘못된 일", "도덕", "인권", "평등"]
MODERN = ["오케이", "스트레스", "멘탈", "팀워크", "시스템", "프로"]
DISPO = ["용기", "자비", "정직", "신앙", "탐욕", "충성"]


def main():
    npcs = {n["id"] for n in json.load(open(os.path.join(ROOT, "content/base/npcs/npcs.json"), encoding="utf-8"))}
    facts = {}
    for fn in sorted(os.listdir(FACTS)) if os.path.isdir(FACTS) else []:
        if fn.endswith(".yaml"):
            for x in yaml.safe_load(open(os.path.join(FACTS, fn), encoding="utf-8")) or []:
                if x["id"] in facts:
                    print(f"[사실 중복] {x['id']} ({fn})")
                facts[x["id"]] = x
    probs, done, total = [], 0, 0
    for dp, _, fs in os.walk(CARDS):
        for fn in sorted(fs):
            if not fn.endswith(".yaml"):
                continue
            total += 1
            p = os.path.join(dp, fn)
            try:
                c = yaml.safe_load(open(p, encoding="utf-8"))
            except Exception as e:
                probs.append(f"{fn}: YAML 오류 {e}"); continue
            cid = c.get("id")
            P = lambda m: probs.append(f"{cid}: {m}")
            if cid not in npcs:
                P("npcs.json에 없는 id")
            key = "historical" if c.get("type") == "historical" else c.get("tier")
            nl, ns, nh, nhid, nreg = NEED.get(key, NEED["B"])
            pers, voice = c.get("personality") or {}, c.get("voice") or {}
            if len(c.get("life") or []) < nl: P(f"연표 {len(c.get('life') or [])}/{nl}")
            if len(voice.get("samples") or []) < ns: P(f"견본 대사 {len(voice.get('samples') or [])}/{ns}")
            if len(pers.get("habits") or []) < nh: P(f"습관 {len(pers.get('habits') or [])}/{nh}")
            if len(c.get("hides") or []) < nhid: P(f"숨긴 것 {len(c.get('hides') or [])}/{nhid}")
            for k in nreg:
                if not (c.get("regression") or {}).get(k): P(f"회귀 {k} 없음")
            if c.get("type") != "historical":
                if not voice.get("register"): P("register 없음")
                if not c.get("age"): P("나이 없음")
                if len(pers.get("temperament") or []) < 2: P("기질 낱말 부족")
                if set((pers.get("disposition") or {}).keys()) != set(DISPO): P("성향 6축 불완전")
            for f in c.get("knows") or []:
                if f not in facts: P(f"모르는 사실 {f}")
            for h in c.get("hides") or []:
                if h.get("fact") not in facts: P(f"숨긴 사실 {h.get('fact')} 없음")
                if not h.get("reveal_when") or not h.get("cover"): P(f"숨긴 사실 {h.get('fact')}의 reveal_when/cover 없음")
            for r in c.get("relations") or []:
                if r.get("to") not in npcs: P(f"관계 대상 {r.get('to')} 없음")
            for y in (c.get("life") or []):
                if isinstance(y, dict) and isinstance(y.get("year"), int) and y["year"] > 312: P(f"연표가 회귀점 뒤 ({y['year']})")
            text = json.dumps(voice.get("samples") or [], ensure_ascii=False)
            for w in PREACH + MODERN:
                if w in text: P(f"견본 대사 금칙어 '{w}'")
            if not any(x.startswith(cid + ":") for x in probs):
                done += 1
    for x in probs:
        print(x)
    print(f"\n카드 {total}개 중 통과 {done}개 · 문제 {len(probs)}개 · 사실 {len(facts)}개")
    sys.exit(1 if probs else 0)


if __name__ == "__main__":
    main()
