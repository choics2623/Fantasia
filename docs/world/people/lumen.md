# 인물 명부 — 루멘 성지 (1차 확장: 순종의 빛의 성도)

> 정본: [WORLD_BIBLE.md](../WORLD_BIBLE.md) > [CHARACTERS.md](../CHARACTERS.md) > 이 문서. 시점은 **AS 312 낙엽월 1일**. 형식은 CHARACTERS.md와 같다 (§0.2~0.3 — 색인 표, `### ` 항목, 관계 튜플). 지역 열의 번호는 CHARACTERS 색인과 같다 (#4 루멘).
> 원천: REGIONS §4, CHARACTERS 지역 #4(R04-01~08), HOUSES §5.1·§5.3·§4.6, 세력 데이터(fac_light, fac_broken_ring, fac_lampkeepers, fac_grey_pilgrims). 장소 id는 `content/base/settlements/lumen.yaml`·`pilgrim_shelter.yaml`·`marens_well.yaml`, 일과는 `content/base/routines/lumen.yaml`, 사건은 `content/base/events/lumen_312.yaml`, 사실은 `content/base/facts/phase1_lumen.yaml`(fact_lm_), 카드는 `content/base/npcs/cards/lumen/`, 키트는 `content/base/kits/holy_city.yaml`.
> 수록: **27명** (★★★ 2 / ★★ 17 / ★ 8). 기존 인물(그레고르 7세·알베릭·마테우스·세레니엘·아그네스·베라·펠릭스·오토)은 CHARACTERS와 기존 카드에 있다. 여기서는 그들 곁에서 교단을 실제로 굴리는 사람들을 더한다. 세력 조직도의 빈 자리를 사람으로 채웠다 — 각 항목의 **자리**에 office id.
> 주의: 이 문서의 한나(`npc_lm_hanna`, 58, 루멘 촛불지기)는 잿불 언덕의 열넷(`npc_hanne_fourteen`)과 다른 사람이다. 간수 시몬은 루멘의 시몬이고, 회색여울 하인츠(`npc_heinz`)와 계수소 칼레는 이름만 닮았다.

## 0. 이 도시의 사람들

루멘은 인구 45,700의 성도다. 사슬사제와 수도자 2,700, 상주 순례자 3,000, 나머지는 성표를 목에 건 신도 노동자다. 이 도시에는 개인 주인이 없다 — 주인이 교단이라 매질은 없고, 대신 **고해**가 사람을 서로 묶는다. 하루는 일곱 번의 기도로 나뉘고(4·7·10·13·16·19·22시), 기도마다 누가 오지 않았는지 센다.
권력의 줄은 셋이다. ① **회의** — 일곱 등불(지금은 북부가 비어 여섯 표)이 흰 사슬·검은 사슬을 던진다. 마테우스 대 마티아스, 잿불 언덕이 흔들린다. ② **감수** — 엘다르 금실이 오지 않으면 모든 결정은 '아직 빛이 닿지 않음'이 된다. ③ **정화청 즉결** — 징후자 심문과 화형은 회의를 거치지 않는다.
이 도시의 사람들은 모두 한 가지를 안다. **누군가의 고해는 다른 누군가의 장작이 된다.** 알면서 줄을 서는 이유는 사람마다 다르다. 이 문서는 그 이유를 쓴다.

## 1. 인물 색인

| ID | 이름 | npc id | 종족 · 파생종 | 지역 | 역할 | 중요도 |
|----|------|--------|---------------|------|------|--------|
| P1L-01 | 마티아스 회색손 | `npc_lm_matthias` | 인간 | #4 루멘 | 은빛 강 등불관, 개혁파 후계 후보 (서고 열쇠를 쥔 사람) | ★★★ |
| P1L-02 | 수녀 아델 | `npc_lm_adel` | 인간 | #4 루멘 | 북부 등불관 대리, 일곱째 고리 의장 (허가증을 쥔 사람) | ★★★ |
| P1L-03 | 레아넬 금실 | `npc_lm_leanel` | 엘다르 · 빛실 엘다르 | #4 루멘 | 교리 감수관, 금실을 쥔 엘다르 | ★★ |
| P1L-04 | 이반 타르굴 | `npc_lm_ivan` | 용인 · 용인(비늘혈) | #4 루멘 | 루멘 용인 수비대장 (화형 집행을 맡은 기사) | ★★ |
| P1L-05 | 밀고 접수관 토비아스 | `npc_lm_tobias` | 인간 | #4 루멘 | 밀고 함의 주인 (한 해 412건) | ★★ |
| P1L-06 | 저울사제 하르트문트 | `npc_lm_hartmund` | 인간 | #4 루멘 | 잿빛 저울 첫째, 눈을 재는 옛 의사 | ★★ |
| P1L-07 | 심문 사제 에기디우스 | `npc_lm_aegidius` | 인간 | #4 루멘 | 정화청의 오른손, 꿈을 받아 적는 심문관 | ★★ |
| P1L-08 | 장작지기 코라드 | `npc_lm_corad` | 인간 | #4 루멘 | 정화의 뜰 장작지기, 항아리 212개의 주인 | ★★ |
| P1L-09 | 재삽 뷕 | `npc_lm_byuk` | 크릭 · 감독관 크릭 | #4 루멘 | 재와 장작을 나르는 크릭 잡역 | ★ |
| P1L-10 | 신학원장 안셀름 | `npc_lm_anselm` | 인간 | #4 루멘 | 마테우스를 키운 신학원장, 끊어진 고리의 걸쇠 | ★★ |
| P1L-11 | 견습 니클라스 | `npc_lm_niklas` | 인간 | #4 루멘 | 낭독문 300구절을 석 달에 외운 열여섯 살 | ★★ |
| P1L-12 | 성가 지휘 라우렌츠 곧은목 | `npc_lm_laurenz` | 인간 | #4 루멘 | 성가 막사 지휘 사제 (요한의 스승) | ★★ |
| P1L-13 | 공물 서기 요나스 | `npc_lm_jonas` | 인간 | #4 루멘 | 녹테른 공물 명단을 쓰는 사슬사제 | ★★ |
| P1L-14 | 필사 수사 오틸리에 | `npc_lm_otilie` | 인간 | #4 루멘 | 글을 읽지 못하는 필사 수사 (읽기 시작한 사람) | ★★ |
| P1L-15 | 촛불지기 한나 | `npc_lm_hanna` | 인간 | #4 루멘 | 대성당 촛불지기, 알베릭의 누이, 등잔지기 | ★★ |
| P1L-16 | 고리지기 엘리 | `npc_lm_eli` | 인간 | #4 루멘 | 한나의 아들, 밀고 접수관의 조수 | ★ |
| P1L-17 | 수도자 간수 야코프 | `npc_lm_jakob` | 인간 | #4 루멘 | 침묵의 우물 간수, 끊어진 고리 | ★★ |
| P1L-18 | 간수 '느린' 시몬 | `npc_lm_simon` | 인간 | #4 루멘 | 침묵의 우물 둘째 간수, 끊어진 고리 | ★ |
| P1L-19 | 양초 안나 밀랍손 | `npc_lm_anna` | 인간 | #4 루멘 | 양초 공방장, 잿빛 실 루멘 매듭 | ★★ |
| P1L-20 | 숙소장 베르타 | `npc_lm_berta` | 인간 | #4 루멘 | 순례자 거리 숙소장 (위를 보지 않는 사람) | ★ |
| P1L-21 | 쉼터지기 헤로 | `npc_lm_hero` | 인간 | #4 루멘 | 세 번째 고리 쉼터의 수도자 | ★★ |
| P1L-22 | 우물지기 베아테 | `npc_lm_beate` | 인간 | #4 루멘 | 성 마렌의 우물을 지키는 노수녀, 첫 성표 지킴이 | ★★ |
| P1L-23 | 대장장이 일제 | `npc_lm_ilse` | 인간 | #4 루멘 | 베라의 어머니 (딸의 눈을 보지 않는 사람) | ★★ |
| P1L-24 | 직조공 루츠 | `npc_lm_lutz` | 인간 | #4 루멘 | 베라를 고발한 이웃 | ★ |
| P1L-25 | 순례 노파 마를렌 | `npc_lm_marlene` | 인간 | #4 루멘 | 상주 순례자, 정화의 뜰 곁 벤치의 노파 | ★ |
| P1L-26 | 소금장수 유타 | `npc_lm_yuta` | 인간 | #4 루멘 | 성표 노점의 목줄단 '혀' (마르타의 상대) | ★ |
| P1L-27 | 계수소 고리지기 칼레 | `npc_lm_kale` | 인간 | #4 루멘 | 부두 성표 계수소의 셈쟁이 | ★ |

### 채운 세력 자리 (세력 파일 수정 제안)
| 세력 | office | 현재 holder | 제안 |
|------|--------|-------------|------|
| fac_light | `off_lamp_silver_river` | `unnamed:마티아스 회색손` | `npc_lm_matthias` |
| fac_light | `off_lamp_north_deputy` | `unnamed:아델` | `npc_lm_adel` |
| fac_broken_ring | `off_seventh_ring_chair` | `unnamed:아델` | `npc_lm_adel` |
| fac_light | `off_doctrine_auditor` | `unnamed:레아넬` | `npc_lm_leanel` |
| fac_light | `off_informant_desk` | `unnamed:토비아스` | `npc_lm_tobias` |
| fac_light | `off_ash_scale` | `unnamed:잿빛 저울` | `npc_lm_hartmund` (셋 중 첫째) |
| fac_light | `off_inquisitor` (집합 자리 약 40) | `unnamed:심문 사제 40` | `npc_lm_aegidius` (대표) |
| fac_light | `off_pyre_keeper` | `unnamed:장작지기` | `npc_lm_corad` |
| fac_light | `off_candle_keeper` | `unnamed:한나` | `npc_lm_hanna` |
| fac_broken_ring | `off_seventh_ring_candle` | `unnamed:한나` | `npc_lm_hanna` |
| fac_lampkeepers | `off_candle_keeper` | `unnamed:한나` | `npc_lm_hanna` |
| fac_lampkeepers | `off_ring_keeper` | `unnamed:엘리` | `npc_lm_eli` |
| fac_broken_ring | `off_seventh_ring_well` | `unnamed:수도자 야코프` | `npc_lm_jakob` |
| fac_lampkeepers | `off_first_token` (마렌의 첫 성표 지킴이) | null | `npc_lm_beate` |
| fac_light | (신설 제안) `off_chain_priest_tribute` 공물 명단 서기 | — | `npc_lm_jonas` |
| fac_light | (신설 제안) `off_seminary_rector` 신학원장 | — | `npc_lm_anselm` |
| fac_light | (신설 제안) `off_choirmaster` 성가 지휘 | — | `npc_lm_laurenz` |
| fac_light | (신설 제안) `off_token_tally` 부두 성표 계수소 | — | `npc_lm_kale` |
| fac_drakmar_empire | (신설 제안) `off_lumen_garrison` 루멘 수비대장 | — | `npc_lm_ivan` |
| fac_broken_ring | (신설 제안) `off_clasp_seminary` 신학원 고리의 걸쇠 | — | `npc_lm_anselm` |
| fac_broken_ring | (신설 제안) `off_ring_copyist` 필사 모사 (글을 읽지 못하는 손) | — | `npc_lm_otilie` |
| fac_grey_pilgrims | (신설 제안) `off_ash_courier_lumen` 루멘 재 운반 | — | `npc_lm_byuk` |
| fac_collar | (신설 제안) `off_collar_tongue_lumen` 루멘 노점의 혀 | — | `npc_lm_yuta` |
| 잿빛 실 | (루멘 매듭) 양초 공방장 | REGIONS 4.9 안나 밀랍손 | `npc_lm_anna` |

---
