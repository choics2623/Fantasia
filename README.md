# Fantasia

시뮬레이션 기반 그림다크 판타지 텍스트 선택지 로그라이트 RPG (모바일 우선). LLM이 문장을 쓰고, 규칙 엔진이 결과를 정한다.

## 지금 해 볼 수 있는 것 — 회색여울 한 판
```bash
python3 tools/build_content.py          # 콘텐츠 묶음 (콘텐츠를 고친 뒤에도 — node가 있어야 즉석 인물이 생긴다)
node prototypes/greyford/server.mjs     # 내 PC의 Claude Code 로그인(구독)으로 LLM을 부른다
```
PC는 `http://localhost:5174`, 폰은 서버 창에 나오는 `…?key=…` 주소 (같은 와이파이). 자세한 것은 [prototypes/greyford/README.md](prototypes/greyford/README.md).

회귀점 AS 312 낙엽월 1일 18:00, 절름발이 수탉 배급 줄. 그 자리에 실제로 있는 사람과 말하고, 묻고, 사고, 숨기고, 덤비고, 떠날 수 있다.
세계는 플레이어가 없어도 움직이고(목표 행동), 플레이어가 한 일에는 그 자리에 있던 사람만 반응한다(반응 층). 저장은 시드 + 행동 기록.

## 검사
```bash
node engine/sim/test_whereabouts.mjs     # 위치 엔진 (24)
node engine/sim/test_agenda.mjs          # 회색여울 목표 행동 (26)
node engine/sim/test_agenda_regions.mjs  # 바알카르·루멘·잿불 목표 행동
node engine/sim/test_living.mjs          # 반응 층: 목격·시체·소문·전리품 (27)
node engine/game/test_game.mjs           # 진행 루프: 장면·시간·저장·회귀·생존·평판·승계·탈주 (28)
node engine/game/test_session.mjs        # LLM 붙인 한 판 (가짜 LLM)
node engine/game/test_opening.mjs        # 회귀점의 대본 장면 (14 §6)
node engine/game/test_soul.mjs           # 영혼: 회귀를 건너는 것·근거 미리보기·해금 (03·01·14)
node engine/game/test_body.mjs           # 스킬 성장·몸의 상한·소지품의 자리·도구 (01·06·02)
node engine/game/test_lethal.mjs         # 첫 회차의 치명적 자리·볼크·협박꾼·쫓는 자 (14 §3·§6, 17)
node engine/game/test_story.mjs          # 하루의 끝·지난 이야기·목소리·맹세와 메아리·인물 수첩 (18·15·16·08)
node engine/game/test_p2.mjs             # 약속·낱말·몸의 상태·좋은 행적·내 소문·지도 기억 …
node engine/game/test_p3.mjs             # 숨긴 곳·작전 카드·연애·얼룩·진명·시대의 끝
node engine/game/test_director.mjs       # 연출가: 긴장도·목표 곡선·화자 넷·연출 장면 (18)
node engine/game/test_domain.mjs         # 영역: 세우기·열흘 보고·시설·수색대·관리자 (09)
node engine/game/test_ops.mjs            # 작전 여섯 단계: 준비·실행·탈출·은폐·누명 (11)
node engine/game/test_family.mjs         # 가족: 가문·입양·출산·인질·양육, 진명 넷 (12, GAME_DESIGN §5)
node engine/game/test_rising.mjs         # 봉기 「여울강이 붉어지는 날」·계승 전쟁의 칙허 (SCENARIOS §3.4, 09 §3)
node engine/game/test_regions.mjs        # 다른 고장의 대본 장면과 맹세
node engine/game/test_replay.mjs         # 재생 결정성: 무작위로 놀고 20걸음마다 재생 지문 비교 (28 §1)
node engine/game/test_flags.mjs          # 대본 장면 깃발의 결과·메아리 상한과 밤의 메아리·다라의 꿈 (16 §3.3, 14 §3.4)
node engine/game/test_learning.mjs       # 글과 말·스승·숨긴 사실의 공개 경로·잠긴 선택지·몰아서 보내기·빚 (19 §4, 03 §3, 22 §1.2)
node engine/game/test_echo.mjs           # 앎의 흔적의 세계 반응·세력의 대응 사다리 (03 §4.3, 10 §5)
node engine/game/test_clock.mjs          # 월드 클락: 탈주자 유입·수색·징발 포고·재열병 (03 §2.2)
node engine/game/test_dark.mjs           # 심문·공포 정치·얼룩 재회·애착 마모·피에 무뎌짐 (13)
node engine/game/test_nemesis.mjs        # 숙적의 마음·성향·교훈·사냥꾼 판·처음 보는 원수 (17)
node engine/game/test_journey.mjs        # 안개 속 길 찾기·먼 길·위치 추정의 확신·연출가 추첨·기억 병합·지도 v2
node engine/game/test_narration.mjs      # 서술 문맥: 이야기의 줄기·문체·장소의 감각·대화의 흐름·되풀이 막기
node engine/game/test_codex.mjs          # 백과: 아는 만큼의 카드·?·들은 이름·회귀해도 남는 앎, 동화·은화·금화
node engine/gen/test_gen.mjs             # 정착지·즉석 인물 생성 (25)
python3 tools/validate_npc_cards.py && node tools/validate_agendas.mjs && python3 tools/link_world.py
```

## 기획 문서
- [전체 개요와 문서 목록](docs/GAME_DESIGN.md)
- 진행 루프: [28 진행 루프](docs/systems/28_GAME_LOOP.md) · [27 살아 있는 세계](docs/systems/27_LIVING_WORLD.md) · [26 목표 행동](docs/systems/26_AGENDAS.md) · [24 장소와 행방](docs/systems/24_PLACES_AND_WHEREABOUTS.md)
- LLM: [21 LLM 하이브리드](docs/systems/21_LLM_HYBRID.md) · [22 NPC 페르소나](docs/systems/22_NPC_PERSONA.md)
- [세계관 바이블](docs/world/WORLD_BIBLE.md) · [모바일·LLM 기술 설계](docs/tech/04_MOBILE_AND_LLM.md)
